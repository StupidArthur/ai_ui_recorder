/**
 * workflow.js - AI 翻译工作流编排模块（结构化最终形态）
 *
 * 当前流程：
 *   Phase 1: LLM 输出 XML → 落盘 JSON（下游）+ XML 镜像与原始批次 XML（排查）
 *   Phase 2: 基于结构化步骤归纳 AI_cases.md
 *   Phase 4: 生成 case_4_agents.txt
 *
 * 设计目标：
 * - 不再依赖 AI_steps.md 作为主数据
 * - JSON 解析失败不阻塞流程，单条自动修复/兜底
 * - 产物稳定可机器消费
 */

import fs from 'fs';
import path from 'path';

import {
  EVIDENCE_CONTEXT_WINDOW_SIZE,
  PHASE2_CASE_WINDOW_STEPS,
  PHASE2_CASE_WINDOW_MAX_TOKENS,
  LLM_AUTO_HEAL_ENABLED,
} from '../utils/config.js';

import { ensureTranslateLayout, getTranslatePaths } from '../utils/run-layout.js';

import { createLlmAudit } from './llm-audit.js';
import { generateAgentTxt } from './phase4/agent-txt-generator.js';
import { parseBatchXmlSteps } from './phase1/xml-step-extractor.js';
import { writePhase1XmlArtifacts } from './phase1/phase1-xml-artifacts.js';
import { clampWindowConsume, maxSlidingWindowRounds } from './xml-parse-utils.js';

import {
  buildPhase2WindowSystemPrompt,
  buildPhase2WindowUserPrompt,
} from './prompts/case-generation.js';
import { slimStepsForPhase2 } from './phase2/slim-step-for-case.js';
import { formatStepsWindowPlainText } from './phase2/format-step-plain-text.js';
import { filterEffectiveStepsForPhase2 } from './phase2/case-window-segmenter.js';
import {
  parsePhase2MarkdownResponse,
  renderCasesMarkdownDocument,
} from './phase2/case-markdown-renderer.js';
import {
  appendFinalSupplementalCase,
  findWindowCoverageGaps,
  isRedundantCaseBlock,
  normalizeCaseMarkdownToGlobalIndices,
  renderCaseCoverageAppendix,
} from './phase2/cases-document-appendix.js';
import {
  buildSystemPrompt as buildStructuredStepSystemPrompt,
  buildUserPrompt as buildStructuredStepUserPrompt,
} from './prompts/step-structured.js';

// ==================== 核心入口函数 ====================

/**
 * 执行完整的 AI 翻译工作流（Phase 1 + Phase 2 + Phase 4）
 *
 * @param {string} runDir - 录制输出目录路径（如 output/run_2026-02-15T06-08-43）
 * @param {Array<Object>} enrichedActions - 预处理后的富化 action 数据数组
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器实例
 * @returns {Promise<{ stepsFile: string, casesFile: string, agentTxtFile: string|null }>}
 */
export async function runWorkflow(runDir, enrichedActions, options = {}) {
  const { log } = options;

  const llmAudit = createLlmAudit(runDir, log);

  // Micro-batching 配置
  const phase1BatchSize = options.phase1BatchSize || 3;
  const phaseWindowSize = options.phaseWindowSize || PHASE2_CASE_WINDOW_STEPS;

  ensureTranslateLayout(runDir);
  const translatePaths = getTranslatePaths(runDir);
  const {
    structuredStepsJson: stepsFile,
    structuredStepsXml: stepsXmlFile,
    llmRawXml: llmRawXmlFile,
    errorsJson: stepErrorsFile,
    casesMd: casesFile,
  } = translatePaths;

  // ========== Phase 1：结构化逐条翻译（微批处理） ==========
  if (log) log.info(`[Phase 1] 正在生成结构化步骤 XML→step_2 (批次大小=${phase1BatchSize})...`);
  const phase1Start = Date.now();

  const { steps, errors } = await runPhase1Structured(stepsFile, stepErrorsFile, enrichedActions, {
    log,
    phase1BatchSize,
    llmAudit,
    stepsXmlFile,
    llmRawXmlFile,
  });

  const phase1Elapsed = ((Date.now() - phase1Start) / 1000).toFixed(1);
  if (log) log.info(`[Phase 1] 完成，共 ${steps.length} 条结构化步骤，耗时 ${phase1Elapsed}s`);
  if (log) log.info(`[Phase 1] JSON 已保存: ${stepsFile}`);
  if (log) log.info(`[Phase 1] XML 镜像: ${stepsXmlFile}`);
  if (log) log.info(`[Phase 1] LLM 原始批次 XML: ${llmRawXmlFile}`);
  if (log && errors.length > 0) {
    log.warn(`[Phase 1] 存在 ${errors.length} 条 LLM 输出异常（自愈已关闭，详见 llm_audit）: ${stepErrorsFile}`);
  }

  // ========== Phase 2：归纳用例 ==========
  if (log) log.info(`[Phase 2] 正在归纳测试用例 (窗口大小=${phaseWindowSize})...`);
  const phase2Start = Date.now();

  await runPhase2FromStructured(steps, casesFile, { log, phaseWindowSize, llmAudit });

  const phase2Elapsed = ((Date.now() - phase2Start) / 1000).toFixed(1);
  if (log) log.info(`[Phase 2] 完成，耗时 ${phase2Elapsed}s`);
  if (log) log.info(`[Phase 2] 文件已保存: ${casesFile}`);

  // ========== Phase 4：Agent TXT 生成 ==========
  let agentTxtFile = null;
  try {
    agentTxtFile = await generateAgentTxt(runDir, steps, { log, phaseWindowSize, llmAudit });
  } catch (err) {
    if (log) log.error(`[Workflow] Agent TXT 生成失败: ${err.message}`);
  }

  // ========== 总结 ==========
  const totalElapsed = ((Date.now() - phase1Start) / 1000).toFixed(1);
  if (log) log.info(`AI 翻译总耗时: ${totalElapsed}s`);

  llmAudit.finalize();

  return {
    stepsFile,
    casesFile,
    agentTxtFile,
  };
}

// ==================== Phase 1：结构化逐条翻译（微批处理） ====================

/**
 * Phase 1：微批处理生成结构化步骤
 *
 * @param {string} stepsFile - 结构化步骤文件路径
 * @param {string} stepErrorsFile - 结构化步骤错误记录文件路径
 * @param {Array<Object>} enrichedActions - 富化后的 action 数据
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器
 * @param {number} [options.phase1BatchSize] - 每批发送给 LLM 的最大动作数
 * @returns {Promise<{ steps: Array<Object>, errors: Array<Object> }>}
 */
async function runPhase1Structured(stepsFile, stepErrorsFile, enrichedActions, options = {}) {
  const { log, llmAudit, stepsXmlFile, llmRawXmlFile } = options;
  const phase1BatchSize = options.phase1BatchSize || 3;

  const steps = [];
  const errors = [];
  const llmRawBatches = [];
  let previousTimestamp = null;

  const flushPhase1Artifacts = () => {
    writeJsonIncremental(stepsFile, steps);
    writeJsonIncremental(stepErrorsFile, errors);
    writePhase1XmlArtifacts({
      steps,
      llmRawBatches,
      structuredXmlPath: stepsXmlFile,
      llmRawXmlPath: llmRawXmlFile,
    });
  };

  const totalActions = enrichedActions.length;
  let cursor = 0;

  while (cursor < totalActions) {
    // 构建当前批次：跳过 skip/noise，用本地函数处理
    const actionBatch = [];
    const skipNoiseIndices = [];

    for (let i = 0; i < phase1BatchSize && cursor + i < totalActions; i++) {
      const enrichedAction = enrichedActions[cursor + i];
      const actionIndex = enrichedAction.index;

      if (enrichedAction.skip || enrichedAction.noise) {
        // skip/noise 直接确定性落地，不发送给 LLM
        const intervalFromPreviousMs = computeIntervalFromPreviousMs(
          enrichedAction.timestamp,
          previousTimestamp,
        );
        const fallbackStep = buildFallbackStructuredStep(
          enrichedAction,
          actionIndex,
          null,
          intervalFromPreviousMs,
        );
        steps.push(fallbackStep);
        skipNoiseIndices.push(actionIndex);
        if (enrichedAction.skip && log)
          log.info(`[Phase 1] 操作 ${actionIndex} 已跳过 [${enrichedAction.skip}]`);
        if (enrichedAction.noise && log)
          log.info(`[Phase 1] 操作 ${actionIndex} 已标记噪声`);
        previousTimestamp = normalizeTimestamp(enrichedAction.timestamp, previousTimestamp);
      } else {
        actionBatch.push(enrichedAction);
      }
    }

    // 如果当前批次没有需要 LLM 处理的动作，直接推进光标
    if (actionBatch.length === 0) {
      cursor += skipNoiseIndices.length;
      flushPhase1Artifacts();
      continue;
    }

    // 构建上下文
    const windowStart = Math.max(0, steps.length - EVIDENCE_CONTEXT_WINDOW_SIZE);
    const recentSteps = steps.slice(windowStart);

    const messages = [
      { role: 'system', content: buildStructuredStepSystemPrompt() },
      { role: 'user', content: buildStructuredStepUserPrompt(actionBatch, recentSteps) },
    ];

    const startIdx = actionBatch[0].index;
    const endIdx = actionBatch[actionBatch.length - 1].index;
    if (log)
      log.info(
        `[Phase 1] 正在处理批次: 操作 ${startIdx}~${endIdx} (共 ${actionBatch.length} 条，纯 skip/noise=${skipNoiseIndices.length} 条)`,
      );

    try {
      const batchLabel = `structured batch index ${startIdx}~${endIdx}`;
      const { callId, raw: rawReply } = await llmAudit.call(
        {
          phase: 'phase1',
          label: batchLabel,
          extra: { actionIndices: actionBatch.map((a) => a.index) },
        },
        messages,
        { temperature: 0, maxTokens: 2000 },
      );

      llmRawBatches.push({
        indexFrom: startIdx,
        indexTo: endIdx,
        raw: rawReply,
      });

      // 解析批量返回
      let batchResult = parseBatchXmlSteps(rawReply, actionBatch, skipNoiseIndices, log);

      const batchProblems = batchResult.errors.map(
        (e) => `[${e.type}] index=${e.index ?? 'batch'}: ${e.reason}`,
      );
      const batchOk =
        batchResult.parsedSteps.length === actionBatch.length
        && batchResult.failedIndices.length === 0
        && batchProblems.length === 0;

      llmAudit.markOutcome(callId, {
        ok: batchOk,
        problems: batchOk ? [] : batchProblems,
        details: {
          parsedCount: batchResult.parsedSteps.length,
          expectedCount: actionBatch.length,
          failedIndices: batchResult.failedIndices,
        },
      });

      // 处理解析结果
      for (const parsedStep of batchResult.parsedSteps) {
        const matchedAction = actionBatch.find((a) => a.index === parsedStep.index);
        if (!matchedAction) {
          if (log)
            log.warn(
              `[Phase 1] LLM 返回了未知 index=${parsedStep.index}，已忽略`,
            );
          continue;
        }
        const intervalFromPreviousMs = computeIntervalFromPreviousMs(
          matchedAction.timestamp,
          previousTimestamp,
        );
        const step = normalizeStructuredStep(
          parsedStep,
          matchedAction,
          parsedStep.index,
          intervalFromPreviousMs,
        );
        steps.push(step);
        previousTimestamp = normalizeTimestamp(matchedAction.timestamp, previousTimestamp);
      }

      // 处理无法解析的条目（逐条 fallback，原因取自具体错误）
      const failedIdxSeen = new Set();
      for (const failedIdx of batchResult.failedIndices) {
        if (failedIdxSeen.has(failedIdx)) continue;
        failedIdxSeen.add(failedIdx);

        const matchedAction = actionBatch.find((a) => a.index === failedIdx);
        if (matchedAction) {
          const intervalFromPreviousMs = computeIntervalFromPreviousMs(
            matchedAction.timestamp,
            previousTimestamp,
          );
          const specificError = batchResult.errors.find((e) => e.index === failedIdx);
          const fallbackReason =
            specificError?.reason || '批次 XML 解析失败或结构不匹配';

          const fallbackStep = buildFallbackStructuredStep(
            matchedAction,
            failedIdx,
            fallbackReason,
            intervalFromPreviousMs,
          );
          steps.push(fallbackStep);
          errors.push({
            index: failedIdx,
            type:
              specificError?.type === 'field-validation-error'
                ? 'field-validation-fallback'
                : 'batch-fallback',
            reason: fallbackReason,
          });
          previousTimestamp = normalizeTimestamp(matchedAction.timestamp, previousTimestamp);
        }
      }

      const batchLevelErrors = batchResult.errors.filter(
        (e) => e.type === 'batch-parse-error' || e.type === 'batch-structure-error',
      );
      if (batchLevelErrors.length > 0) {
        errors.push(...batchLevelErrors);
      }
    } catch (error) {
      if (log) log.error(`[Phase 1] 批次 ${startIdx}~${endIdx} 处理失败: ${error.message}`);
      // markOutcome 已在 llmAudit.call 的 API 失败分支写入；此处为解析后业务异常

      // 整批 fallback
      for (const enrichedAction of actionBatch) {
        const intervalFromPreviousMs = computeIntervalFromPreviousMs(
          enrichedAction.timestamp,
          previousTimestamp,
        );
        const fallbackStep = buildFallbackStructuredStep(
          enrichedAction,
          enrichedAction.index,
          error.message,
          intervalFromPreviousMs,
        );
        steps.push(fallbackStep);
        errors.push({
          index: enrichedAction.index,
          type: 'batch-exception-fallback',
          reason: error.message,
        });
        previousTimestamp = normalizeTimestamp(enrichedAction.timestamp, previousTimestamp);
      }
    }

    // 推进光标
    cursor += phase1BatchSize;
    flushPhase1Artifacts();
  }

  return { steps, errors };
}

/**
 * 解析批量结构化步骤返回
 *
 * @param {string} rawReply - LLM 返回的原始文本
 * @param {Array<Object>} actionBatch - 当前批次的 action 数组
 * @param {Array<number>} skipNoiseIndices - 当前批次中 skip/noise 的 indices
 * @returns {{ parsedSteps: Array<Object>, failedIndices: Array<number>, errors: Array<Object> }}
 */
/**
 * Phase 1 局部字段自动修复（在 validate 之前调用）
 *
 * @param {Object} parsedStep
 * @param {Object|undefined} matchedAction
 * @param {Object|undefined} log
 */
function applyPartialAutoHeal(parsedStep, matchedAction, log) {
  if (!matchedAction) return;

  if (!parsedStep.description || String(parsedStep.description).trim() === '') {
    parsedStep.description = deriveFallbackDescription(matchedAction);
    if (log)
      log.warn(
        `[Phase 1] index=${parsedStep.index} description 为空，已通过局部自愈修复为: "${parsedStep.description}"`,
      );
  }
  if (!parsedStep.uiChange || String(parsedStep.uiChange).trim() === '') {
    parsedStep.uiChange = deriveUiChangeFromDiff(matchedAction.snapshotDiff);
    if (log)
      log.warn(
        `[Phase 1] index=${parsedStep.index} uiChange 为空，已通过局部自愈修复为: "${parsedStep.uiChange}"`,
      );
  }
  if (!parsedStep.page || String(parsedStep.page).trim() === '') {
    parsedStep.page = matchedAction.title || '未知页面';
    if (log)
      log.warn(`[Phase 1] index=${parsedStep.index} page 为空，已通过局部自愈修复为: "${parsedStep.page}"`);
  }
  if (!parsedStep.actionKind || String(parsedStep.actionKind).trim() === '') {
    parsedStep.actionKind = deriveFallbackActionKind(matchedAction);
    if (log)
      log.warn(
        `[Phase 1] index=${parsedStep.index} actionKind 为空，已通过局部自愈修复为: "${parsedStep.actionKind}"`,
      );
  } else {
    parsedStep.actionKind = normalizeActionKind(parsedStep.actionKind);
  }
  if (!parsedStep.target || String(parsedStep.target).trim() === '') {
    parsedStep.target = deriveTarget(matchedAction);
    if (log)
      log.warn(`[Phase 1] index=${parsedStep.index} target 为空，已通过局部自愈修复为: "${parsedStep.target}"`);
  }
  if (!isValidBasisArray(parsedStep.basis)) {
    parsedStep.basis = deriveBasisFromEvidence(matchedAction);
    if (log)
      log.warn(
        `[Phase 1] index=${parsedStep.index} basis 无效，已通过局部自愈补全 (${parsedStep.basis.length} 条证据)`,
      );
  }
  if (!Number.isFinite(Number(parsedStep.confidence))) {
    const healed = deriveConfidenceFromEvidence(matchedAction);
    if (log)
      log.warn(
        `[Phase 1] index=${parsedStep.index} confidence 无效(${parsedStep.confidence})，已修复为 ${healed}`,
      );
    parsedStep.confidence = healed;
  } else {
    parsedStep.confidence = normalizeConfidence(parsedStep.confidence);
  }
  if (!parsedStep.inputText && matchedAction.inputValue) {
    parsedStep.inputText = matchedAction.inputValue;
  }
  if (!parsedStep.key && matchedAction.key) {
    parsedStep.key = matchedAction.key;
  }
}

// ==================== Phase 2：归纳用例 ====================

/**
 * Phase 2：从结构化步骤归纳测试用例
 *
 * @param {Array<Object>} steps - 结构化步骤数组
 * @param {string} casesFile - AI_cases.md 输出文件路径
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器
 */
async function runPhase2FromStructured(steps, casesFile, options = {}) {
  const { log, llmAudit } = options;
  const phaseWindowSize = options.phaseWindowSize || PHASE2_CASE_WINDOW_STEPS;

  const effectiveSteps = filterEffectiveStepsForPhase2(steps);
  const slimAll = slimStepsForPhase2(effectiveSteps);

  if (slimAll.length === 0) {
    const emptyDoc = renderCasesMarkdownDocument([], { documentTitle: '录制流程测试用例归纳' });
    fs.writeFileSync(casesFile, emptyDoc, 'utf-8');
    const coverageFile = path.join(path.dirname(casesFile), 'coverage.md');
    fs.writeFileSync(
      coverageFile,
      '# Case 覆盖核对\n\n> 无有效步骤，未生成 Case。\n',
      'utf-8',
    );
    if (log) log.warn('[Phase 2] 无有效步骤（normal），已写入空文档');
    return;
  }

  const caseBlocks = [];
  const systemPrompt = buildPhase2WindowSystemPrompt();
  const maxRounds = maxSlidingWindowRounds(slimAll.length, phaseWindowSize);

  let cursor = 0;
  let round = 0;

  while (cursor < slimAll.length) {
    round++;
    if (round > maxRounds) {
      if (log) {
        log.warn(
          `[Phase 2] 已达最大轮次 ${maxRounds}，剩余 ${slimAll.length - cursor} 步将写入占位 Case 并退出`,
        );
      }
      const remain = slimAll.slice(cursor);
      caseBlocks.push({
        markdownBlock: `# 测试用例：剩余步骤（本地兜底）\n\n${formatStepsWindowPlainText(remain)}`,
      });
      cursor = slimAll.length;
      break;
    }

    const windowSlim = slimAll.slice(cursor, cursor + phaseWindowSize);
    const expectedIndices = windowSlim.map((s) => s.index);
    const indexListText = JSON.stringify(expectedIndices);
    const windowPlainText = formatStepsWindowPlainText(windowSlim);

    if (log) {
      log.info(
        `[Phase 2] 轮次 ${round}，cursor=${cursor}，窗口步数 ${windowSlim.length}，index ${expectedIndices[0]}–${expectedIndices[expectedIndices.length - 1]}`,
      );
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildPhase2WindowUserPrompt(windowPlainText, indexListText) },
    ];

    const phase2Label = `case window round ${round} index ${expectedIndices[0]}~${expectedIndices[expectedIndices.length - 1]}`;
    let callId;
    let rawReply;

    try {
      ({ callId, raw: rawReply } = await llmAudit.call(
        {
          phase: 'phase2',
          label: phase2Label,
          extra: { round, expectedIndices },
        },
        messages,
        { temperature: 0.3, maxTokens: PHASE2_CASE_WINDOW_MAX_TOKENS },
      ));

      if (!rawReply) {
        throw new Error(`[Phase 2] 轮次 ${round} AI 返回空结果`);
      }

      const parsed = parsePhase2MarkdownResponse(rawReply, expectedIndices);

      const problems = [];
      if (parsed.clampReason) {
        problems.push(`consume clamp: ${parsed.clampReason} (raw=${parsed.rawConsume})`);
      }

      llmAudit.markOutcome(callId, {
        ok: true,
        problems,
        details: {
          consumeStepCount: parsed.consumeStepCount,
          rawConsume: parsed.rawConsume,
          coveredActionIndices: parsed.coveredActionIndices,
        },
      });

      const normalizedBlock = normalizeCaseMarkdownToGlobalIndices(
        String(parsed.markdownBlock || '').trim(),
        parsed.coveredActionIndices,
      );

      if (isRedundantCaseBlock(normalizedBlock, caseBlocks, parsed.coveredActionIndices)) {
        if (log) {
          log.warn(
            `[Phase 2] 轮次 ${round} 跳过重复 Case（index ${parsed.coveredActionIndices.join(', ')} 已在先前正文中出现）`,
          );
        }
      } else {
        caseBlocks.push({ markdownBlock: normalizedBlock });
      }

      const gapIndices = findWindowCoverageGaps(
        normalizedBlock,
        parsed.coveredActionIndices,
      );
      if (gapIndices.length > 0 && log) {
        log.warn(
          `[Phase 2] 轮次 ${round} LLM Case 未引用 index ${gapIndices.join(', ')}，将在全部轮次结束后统一补全（若仍缺失）`,
        );
      }

      const consumed = parsed.consumeStepCount;
      if (log) {
        log.info(
          `[Phase 2] 轮次 ${round} 消费 ${consumed} 步（${expectedIndices[0]}..${expectedIndices[consumed - 1]}）`,
        );
      }
      cursor += consumed;
    } catch (error) {
      if (callId) {
        llmAudit.markOutcome(callId, {
          ok: false,
          problems: [error.message],
          details: { round, expectedIndices },
        });
      }
      const fallbackConsume = Math.max(1, Math.min(1, windowSlim.length));
      caseBlocks.push({
        markdownBlock: `# 测试用例：解析失败兜底\n\n${formatStepsWindowPlainText(windowSlim.slice(0, fallbackConsume))}\n\n> ${error.message}`,
      });
      cursor += fallbackConsume;
      if (log) log.warn(`[Phase 2] 轮次 ${round} 解析失败，消费 ${fallbackConsume} 步后继续: ${error.message}`);
    }
  }

  const supplementedIndices = appendFinalSupplementalCase(caseBlocks, slimAll);
  if (supplementedIndices.length > 0 && log) {
    log.warn(
      `[Phase 2] 终局补全 index ${supplementedIndices.join(', ')}（此前各窗 LLM 均未引用）`,
    );
  }

  const casesText = renderCasesMarkdownDocument(caseBlocks, {
    documentTitle: '录制流程测试用例归纳',
  });

  fs.writeFileSync(casesFile, casesText, 'utf-8');

  const coverageFile = path.join(path.dirname(casesFile), 'coverage.md');
  const coverageText =
    `# Case 覆盖核对\n\n` +
    `> 用例正文见 \`translate/phase2/cases.md\`；Phase 1 全量步骤见 \`translate/phase1/structured_steps.json\`（及 .xml）。\n\n` +
    renderCaseCoverageAppendix(steps, casesText);
  fs.writeFileSync(coverageFile, coverageText, 'utf-8');
  if (log) log.info(`[Phase 2] 覆盖核对表: ${coverageFile}`);

  console.log('\n' + '='.repeat(60));
  console.log('AI 测试用例预览 (AI_cases.md):');
  console.log('='.repeat(60));
  console.log(casesText.length > 1500 ? casesText.slice(0, 1500) + '\n...(更多内容请查看文件)' : casesText);
  console.log('='.repeat(60));
}

// ==================== 工具函数 ====================

/**
 * 结构化 step 归一化
 *
 * @param {Object} parsed
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @param {number|null} intervalFromPreviousMs
 * @returns {Object}
 */
function normalizeStructuredStep(parsed, enrichedAction, actionIndex, intervalFromPreviousMs) {
  const actionKind = normalizeActionKind(parsed.actionKind || deriveFallbackActionKind(enrichedAction));

  return {
    index: actionIndex,
    status: 'normal',
    description: toSingleLine(parsed.description),
    uiChange: toSingleLine(parsed.uiChange) || '无可见变化',
    page: toSingleLine(parsed.page) || (enrichedAction.title || '未知'),
    basis: ['xml:action', 'xml:observation'],
    actionKind,
    target: toSingleLine(parsed.target) || deriveTarget(enrichedAction),
    inputText: toSingleLine(parsed.inputText) || (enrichedAction.inputValue || ''),
    key: toSingleLine(parsed.key) || (enrichedAction.key || ''),
    assertText: '',
    confidence: 0.7,
    intervalFromPreviousMs,
    url: enrichedAction.url || '',
    sourceType: enrichedAction.type || 'unknown',
  };
}

/**
 * 校验结构化 step
 *
 * @param {Object} step
 * @returns {string|null}
 */
function validateStructuredStep(step) {
  if (!step.description || !String(step.description).trim()) return 'description 为空';
  if (!step.uiChange || !String(step.uiChange).trim()) return 'uiChange 为空';
  return null;
}

/**
 * 严格模式：仅保留 LLM 返回的 basis，不从证据推导
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function strictBasisArray(raw) {
  if (Array.isArray(raw)) {
    return raw.map(toSingleLine).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [toSingleLine(raw)];
  }
  return [];
}

/**
 * 构造兜底结构化步骤
 *
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @param {string|null} reason
 * @returns {Object}
 */
function buildFallbackStructuredStep(enrichedAction, actionIndex, reason, intervalFromPreviousMs) {
  const isNoise = Boolean(enrichedAction.noise);
  const isSkip = Boolean(enrichedAction.skip);
  const fallbackDescription = deriveFallbackDescription(enrichedAction);
  const actionKind = deriveFallbackActionKind(enrichedAction);
  const uiChange = deriveUiChangeFromDiff(enrichedAction.snapshotDiff);

  return {
    index: actionIndex,
    status: isSkip ? 'skip' : (isNoise ? 'noise' : 'fallback'),
    description: fallbackDescription,
    uiChange,
    page: enrichedAction.title || '未知',
    basis: [
      isSkip ? `skip: ${String(enrichedAction.skip)}` : '',
      isNoise ? `noise: ${String(enrichedAction.noiseReason || 'UI 无变化')}` : '',
      reason ? `fallbackReason: ${reason}` : '',
    ].filter(Boolean),
    actionKind,
    target: deriveTarget(enrichedAction),
    inputText: enrichedAction.inputValue || '',
    key: enrichedAction.key || '',
    assertText: '',
    confidence: 0.4,
    intervalFromPreviousMs,
    url: enrichedAction.url || '',
    sourceType: enrichedAction.type || 'unknown',
  };
}

/**
 * 计算与上一条操作完成时间的间隔
 *
 * @param {number|string|undefined|null} currentTimestamp
 * @param {number|null} previousTimestamp
 * @returns {number|null}
 */
function computeIntervalFromPreviousMs(currentTimestamp, previousTimestamp) {
  const current = normalizeTimestamp(currentTimestamp, null);
  if (!Number.isFinite(current) || !Number.isFinite(previousTimestamp)) {
    return null;
  }
  const delta = current - previousTimestamp;
  return delta >= 0 ? delta : null;
}

/**
 * 归一化时间戳（毫秒）
 *
 * @param {number|string|undefined|null} value
 * @param {number|null} fallback
 * @returns {number|null}
 */
function normalizeTimestamp(value, fallback = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
}

/**
 * 增量写 JSON 文件
 *
 * @param {string} filePath
 * @param {Array<Object>} data
 */
function writeJsonIncremental(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 规范 actionKind
 *
 * @param {string} value
 * @returns {'click'|'doubleClick'|'rightClick'|'keyPress'|'input'|'assert'|'sleep'|'other'}
 */
function normalizeActionKind(value) {
  const v = String(value || '').trim();
  const map = {
    click: 'click',
    doubleClick: 'doubleClick',
    dblclick: 'doubleClick',
    rightClick: 'rightClick',
    rightclick: 'rightClick',
    keyPress: 'keyPress',
    keypress: 'keyPress',
    input: 'input',
    assert: 'assert',
    sleep: 'sleep',
    other: 'other',
  };
  return map[v] || 'other';
}

/**
 * 规范置信度
 *
 * @param {any} value
 * @returns {number}
 */
function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

/**
 * 单行文本
 *
 * @param {any} value
 * @returns {string}
 */
function toSingleLine(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/**
 * 从 action 构造兜底描述
 *
 * @param {Object} action
 * @returns {string}
 */
function deriveFallbackDescription(action) {
  const element = action.element || {};
  const identify = element.label || element.text || element.placeholder || element.name || element.id || '目标元素';
  switch (action.type) {
    case 'dblclick':
      return `双击 ${identify}`;
    case 'rightclick':
      return `右键点击 ${identify}`;
    case 'keypress':
      return `按下按键 ${action.key || ''}`.trim();
    case 'input':
      return action.inputValue === '[MASKED]'
        ? `在 ${identify} 输入密码（已脱敏）`
        : `在 ${identify} 输入 ${action.inputValue || ''}`.trim();
    case 'click':
      return `点击 ${identify}`;
    default:
      return `执行 ${action.type || '未知'} 操作`;
  }
}

/**
 * 从 action 推导兜底 actionKind
 *
 * @param {Object} action
 * @returns {'click'|'doubleClick'|'rightClick'|'keyPress'|'input'|'assert'|'other'}
 */
function deriveFallbackActionKind(action) {
  switch (action.type) {
    case 'dblclick':
      return 'doubleClick';
    case 'rightclick':
      return 'rightClick';
    case 'keypress':
      return 'keyPress';
    case 'input':
      return 'input';
    case 'click':
      return 'click';
    default:
      return 'other';
  }
}

/**
 * 从 diff 文本提取 UI 变化概述
 *
 * @param {string} snapshotDiff
 * @returns {string}
 */
function deriveUiChangeFromDiff(snapshotDiff) {
  const text = String(snapshotDiff || '');
  if (!text || text.includes('完全相同') || text.includes('无变化')) {
    return '无可见变化';
  }
  return '界面状态发生变化';
}

/**
 * 从 action 推导目标文本
 *
 * @param {Object} action
 * @returns {string}
 */
function deriveTarget(action) {
  const element = action.element || {};
  return element.label || element.text || element.placeholder || element.name || element.id || element.tag || '';
}

/**
 * 判断 basis 是否为有效非空数组
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidBasisArray(value) {
  return Array.isArray(value) && value.some((item) => toSingleLine(item));
}

/**
 * 归一化 basis 字段；无效时从 enriched 证据推导
 *
 * @param {unknown} raw
 * @param {Object} action
 * @returns {string[]}
 */
function normalizeBasisArray(raw, action) {
  if (Array.isArray(raw)) {
    const items = raw.map(toSingleLine).filter(Boolean);
    if (items.length > 0) return items;
  } else if (typeof raw === 'string' && raw.trim()) {
    return [toSingleLine(raw)];
  }
  return deriveBasisFromEvidence(action);
}

/**
 * 从 snapshotDiff / formState / hints 等证据推导 basis
 *
 * @param {Object} action - enrichedAction
 * @returns {string[]}
 */
function deriveBasisFromEvidence(action) {
  const basis = [];

  const hints = action.classification?.hints;
  if (Array.isArray(hints)) {
    for (const hint of hints) {
      const line = toSingleLine(hint);
      if (line) basis.push(line);
    }
  }

  const diffText = String(action.snapshotDiff || '').trim();
  if (diffText && !diffText.includes('完全相同') && !diffText.includes('无变化')) {
    const diffSnippet = diffText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' | ');
    if (diffSnippet) {
      basis.push(`snapshotDiff: ${diffSnippet}`);
    }
  }

  const formChanges = action.formStateChanges;
  if (formChanges?.changed && typeof formChanges.changed === 'object') {
    for (const [xpath, change] of Object.entries(formChanges.changed)) {
      const toVal = formatFormStateValue(change?.to);
      if (toVal) {
        basis.push(`formState变化: ${xpath} → ${toVal}`);
      }
    }
  } else if (action.formStateChangeText) {
    const formSnippet = toSingleLine(action.formStateChangeText).slice(0, 200);
    if (formSnippet) basis.push(`formState: ${formSnippet}`);
  }

  if (action.inputValue) {
    basis.push(
      action.inputValue === '[MASKED]'
        ? 'inputValue: 密码已脱敏'
        : `inputValue: ${action.inputValue}`,
    );
  }

  if (action.originalType && action.originalType !== action.type) {
    basis.push(`语义归并: ${action.originalType} → ${action.type}`);
  }

  const contextSnippet = toSingleLine(action.contextExcerpt || '').slice(0, 150);
  if (contextSnippet) {
    basis.push(`context: ${contextSnippet}`);
  }

  if (basis.length === 0) {
    basis.push(`物理动作: ${action.type || 'unknown'}`);
  }

  return basis;
}

/**
 * 格式化 formState 字段值为可读字符串
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatFormStateValue(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('value' in value) return toSingleLine(value.value);
    if ('checked' in value) return value.checked ? 'checked' : 'unchecked';
    return toSingleLine(JSON.stringify(value));
  }
  return toSingleLine(value);
}

/**
 * 从证据强度推导默认 confidence（LLM 未返回有效值时使用）
 *
 * @param {Object} action - enrichedAction
 * @returns {number}
 */
function deriveConfidenceFromEvidence(action) {
  let score = 0.45;
  if (Array.isArray(action.classification?.hints) && action.classification.hints.length > 0) {
    score += 0.15;
  }
  if (action.inputValue && action.inputValue !== '[MASKED]') {
    score += 0.1;
  }
  const diff = String(action.snapshotDiff || '');
  if (diff && !diff.includes('完全相同') && !diff.includes('无变化')) {
    score += 0.1;
  }
  if (isValidBasisArray(action.basis)) {
    score += 0.05;
  }
  return Math.min(0.85, Math.round(score * 100) / 100);
}

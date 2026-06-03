/**
 * workflow.js - AI 翻译工作流编排模块（结构化最终形态）
 *
 * 当前流程：
 *   Phase 1: 生成结构化步骤 JSON（step_2_structured_steps.json）
 *   Phase 2: 基于结构化步骤归纳 AI_cases.md
 *   Phase 3: 输出 Midscene YAML（no_assert）
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
  AI_STEPS_STRUCTURED_FILENAME,
  AI_STEPS_ERRORS_FILENAME,
  AI_CASES_FILENAME,
  PHASE2_CASE_WINDOW_STEPS,
  PHASE2_CASE_WINDOW_MAX_TOKENS,
  SELENIUM_EXPORT_ENABLED,
} from '../utils/config.js';

import { regenerateFromStructured } from '../selenium_export/regenerate-from-structured.js';

import { callChat, cleanMarkdownFence, parseJsonFromLlmReply } from './ai-client.js';
import { generateMidsceneYaml } from './midscene/index.js';
import { generateAgentTxt } from './phase4/agent-txt-generator.js';

import {
  buildPhase2WindowSystemPrompt,
  buildPhase2WindowUserPrompt,
} from './prompts/case-generation.js';
import { slimStepsForPhase2 } from './phase2/slim-step-for-case.js';
import { filterEffectiveStepsForPhase2 } from './phase2/case-window-segmenter.js';
import {
  parseSingleCaseJsonResponse,
  renderCasesMarkdownDocument,
} from './phase2/case-markdown-renderer.js';
import {
  buildSystemPrompt as buildStructuredStepSystemPrompt,
  buildUserPrompt as buildStructuredStepUserPrompt,
  stepStructuredBatchSchema,
} from './prompts/step-structured.js';

// ==================== 核心入口函数 ====================

/**
 * 执行完整的 AI 翻译工作流（Phase 1 + Phase 2 + Phase 3）
 *
 * @param {string} runDir - 录制输出目录路径（如 output/run_2026-02-15T06-08-43）
 * @param {Array<Object>} enrichedActions - 预处理后的富化 action 数据数组
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器实例
 * @returns {Promise<{ stepsFile: string, casesFile: string, midsceneNoAssertFile: string, agentTxtFile: string|null }>}
 */
export async function runWorkflow(runDir, enrichedActions, options = {}) {
  const { log } = options;

  // Micro-batching 配置
  const phase1BatchSize = options.phase1BatchSize || 3;
  const phaseWindowSize = options.phaseWindowSize || PHASE2_CASE_WINDOW_STEPS;

  const stepsFile = path.join(runDir, AI_STEPS_STRUCTURED_FILENAME);
  const stepErrorsFile = path.join(runDir, AI_STEPS_ERRORS_FILENAME);
  const casesFile = path.join(runDir, AI_CASES_FILENAME);

  // ========== Phase 1：结构化逐条翻译（微批处理） ==========
  if (log) log.info(`[Phase 1] 正在生成结构化步骤 JSON (批次大小=${phase1BatchSize})...`);
  const phase1Start = Date.now();

  const { steps, errors } = await runPhase1Structured(stepsFile, stepErrorsFile, enrichedActions, {
    log,
    phase1BatchSize,
  });

  const phase1Elapsed = ((Date.now() - phase1Start) / 1000).toFixed(1);
  if (log) log.info(`[Phase 1] 完成，共 ${steps.length} 条结构化步骤，耗时 ${phase1Elapsed}s`);
  if (log) log.info(`[Phase 1] 文件已保存: ${stepsFile}`);
  if (log && errors.length > 0) {
    log.warn(`[Phase 1] 存在 ${errors.length} 条模型输出异常，已自动修复或兜底: ${stepErrorsFile}`);
  }

  if (SELENIUM_EXPORT_ENABLED) {
    try {
      regenerateFromStructured(runDir, { log });
    } catch (error) {
      if (log) log.warn(`[Selenium] 终稿生成失败（已忽略）: ${error.message}`);
    }
  }

  // ========== Phase 2：归纳用例 ==========
  if (log) log.info(`[Phase 2] 正在归纳测试用例 (窗口大小=${phaseWindowSize})...`);
  const phase2Start = Date.now();

  await runPhase2FromStructured(steps, casesFile, { log, phaseWindowSize });

  const phase2Elapsed = ((Date.now() - phase2Start) / 1000).toFixed(1);
  if (log) log.info(`[Phase 2] 完成，耗时 ${phase2Elapsed}s`);
  if (log) log.info(`[Phase 2] 文件已保存: ${casesFile}`);

  // ========== Phase 3：Midscene YAML ==========
  if (log) log.info('[Phase 3] 正在生成 Midscene YAML（no_assert）...');
  const { noAssertFile } = generateMidsceneYaml(runDir, steps, { log });

  // ========== Phase 4：Agent TXT 生成 ==========
  let agentTxtFile = null;
  try {
    agentTxtFile = await generateAgentTxt(runDir, steps, { log, phaseWindowSize });
  } catch (err) {
    if (log) log.error(`[Workflow] Agent TXT 生成失败: ${err.message}`);
  }

  // ========== 总结 ==========
  const totalElapsed = ((Date.now() - phase1Start) / 1000).toFixed(1);
  if (log) log.info(`AI 翻译总耗时: ${totalElapsed}s`);

  return {
    stepsFile,
    casesFile,
    midsceneNoAssertFile: noAssertFile,
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
  const { log } = options;
  const phase1BatchSize = options.phase1BatchSize || 3;

  const steps = [];
  const errors = [];
  let previousTimestamp = null;

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
      writeJsonIncremental(stepsFile, steps);
      writeJsonIncremental(stepErrorsFile, errors);
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
      let rawReply = await callChat(messages, {
        temperature: 0,
        maxTokens: 2000,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'step_structured_batch',
            schema: stepStructuredBatchSchema,
            strict: true,
          },
        },
      });

      // 解析批量返回（失败时尝试 JSON 修复重试）
      let batchResult = parseBatchStructuredSteps(rawReply, actionBatch, skipNoiseIndices, log);
      if (
        batchResult.parsedSteps.length === 0
        && batchResult.errors.some((e) => e.type === 'batch-parse-error' || e.type === 'batch-structure-error')
      ) {
        if (log) log.warn(`[Phase 1] 批次 ${startIdx}~${endIdx} JSON 解析失败，尝试修复重试...`);
        const repairedRaw = await tryRepairBatchStructuredReply(rawReply);
        if (repairedRaw) {
          batchResult = parseBatchStructuredSteps(repairedRaw, actionBatch, skipNoiseIndices, log);
        }
      }

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
            specificError?.reason || '批次 JSON 解析失败或结构不匹配';

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
    writeJsonIncremental(stepsFile, steps);
    writeJsonIncremental(stepErrorsFile, errors);
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
 * 归一化 Phase 1 批次 LLM 返回结构（兼容数组 / steps 别名）
 *
 * @param {unknown} parsed
 * @returns {{ parsedSteps?: Array<Object> }|null}
 */
function normalizeBatchLlmPayload(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) {
    return { parsedSteps: parsed };
  }
  if (typeof parsed === 'object') {
    if (Array.isArray(parsed.parsedSteps)) return parsed;
    if (Array.isArray(parsed.steps)) return { parsedSteps: parsed.steps };
  }
  return parsed;
}

/**
 * 解析 Phase 1 批次 LLM 原始输出为 JSON 对象
 *
 * @param {string} rawReply
 * @returns {Object|null}
 */
function parseBatchLlmJson(rawReply) {
  try {
    return parseJsonFromLlmReply(rawReply);
  } catch (_) {
    const cleaned = cleanMarkdownFence(rawReply);
    try {
      return JSON.parse(cleaned);
    } catch (__) {
      return null;
    }
  }
}

/**
 * 批次 JSON 修复：要求模型将非法输出修正为 { parsedSteps: [...] }
 *
 * @param {string} rawReply
 * @returns {Promise<string|null>}
 */
async function tryRepairBatchStructuredReply(rawReply) {
  const messages = [
    {
      role: 'system',
      content:
        '你是 JSON 修复器。只输出一个合法 JSON 对象，不要任何解释或 Markdown。\n' +
        '对象必须包含 parsedSteps 数组；数组每项含 index, description, uiChange, page, basis, actionKind, target, inputText, key, assertText, confidence。',
    },
    {
      role: 'user',
      content: `请把下面文本修正为合法 JSON 对象：\n\n${rawReply.slice(0, 8000)}`,
    },
  ];

  try {
    return await callChat(messages, { temperature: 0, maxTokens: 2500 });
  } catch (_) {
    return null;
  }
}

function parseBatchStructuredSteps(rawReply, actionBatch, skipNoiseIndices, log) {
  const parsedSteps = [];
  const failedIndices = [];
  const errors = [];

  const parsedRaw = parseBatchLlmJson(rawReply);
  const parsed = normalizeBatchLlmPayload(parsedRaw);

  if (!parsed) {
    for (const action of actionBatch) {
      failedIndices.push(action.index);
    }
    errors.push({
      index: actionBatch[0].index,
      type: 'batch-parse-error',
      reason: 'JSON 解析失败',
    });
    return { parsedSteps, failedIndices, errors };
  }

  // 检查是否有 parsedSteps 数组
  if (!parsed.parsedSteps || !Array.isArray(parsed.parsedSteps)) {
    for (const action of actionBatch) {
      failedIndices.push(action.index);
    }
    errors.push({
      index: actionBatch[0].index,
      type: 'batch-structure-error',
      reason: '缺少 parsedSteps 数组',
    });
    return { parsedSteps, failedIndices, errors };
  }

  // 将 skipNoiseIndices 转为 Set 方便查询
  const skipNoiseSet = new Set(skipNoiseIndices);

  // 验证数量一致
  const expectedCount = actionBatch.length + skipNoiseIndices.length;
  const actualCount = parsed.parsedSteps.length;

  if (actualCount !== actionBatch.length) {
    if (log)
      log.warn(
        `[Phase 1] 批次返回数量不匹配: 期望 ${actionBatch.length} 条实际 ${actualCount} 条，将逐条校验`,
      );
  }

  // 遍历 LLM 返回的 parsedSteps，按 index 匹配
  for (const parsedStep of parsed.parsedSteps) {
    if (typeof parsedStep.index !== 'number') {
      continue;
    }

    // 跳过 skip/noise 的 index（这些应该在本地处理了）
    if (skipNoiseSet.has(parsedStep.index)) {
      if (log) log.warn(`[Phase 1] skip/noise index=${parsedStep.index} 出现在 LLM 返回中，已忽略`);
      continue;
    }

    // 获取对应的原始 action，用于补全
    const matchedAction = actionBatch.find((a) => a.index === parsedStep.index);

    applyPartialAutoHeal(parsedStep, matchedAction, log);

    // 验证必需字段 (现在通过了自愈，基本不会再因为 description/uiChange/page 为空而拦截了)
    const validationError = validateStructuredStep(parsedStep);
    if (validationError) {
      if (log)
        log.warn(`[Phase 1] index=${parsedStep.index} 字段验证失败: ${validationError}`);
      failedIndices.push(parsedStep.index);
      errors.push({
        index: parsedStep.index,
        type: 'field-validation-error',
        reason: validationError,
      });
      continue;
    }

    parsedSteps.push(parsedStep);
  }

  // 批次遗漏：LLM 未返回某些 index
  const handledIndices = new Set([
    ...parsedSteps.map((s) => s.index),
    ...failedIndices,
  ]);
  for (const action of actionBatch) {
    if (!handledIndices.has(action.index)) {
      failedIndices.push(action.index);
      errors.push({
        index: action.index,
        type: 'batch-missing-index',
        reason: 'LLM 批次输出未包含该 index',
      });
      if (log) log.warn(`[Phase 1] 批次遗漏 index=${action.index}，将使用兜底步骤`);
    }
  }

  return { parsedSteps, failedIndices, errors };
}

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
  const { log } = options;
  const phaseWindowSize = options.phaseWindowSize || PHASE2_CASE_WINDOW_STEPS;

  const effectiveSteps = filterEffectiveStepsForPhase2(steps);
  const slimAll = slimStepsForPhase2(effectiveSteps);

  if (slimAll.length === 0) {
    const emptyDoc = renderCasesMarkdownDocument([], { documentTitle: '录制流程测试用例归纳' });
    fs.writeFileSync(casesFile, emptyDoc, 'utf-8');
    if (log) log.warn('[Phase 2] 无有效步骤（normal），已写入空文档');
    return;
  }

  const caseBlocks = [];
  const systemPrompt = buildPhase2WindowSystemPrompt();

  let cursor = 0;
  let round = 0;

  while (cursor < slimAll.length) {
    round++;
    const windowSlim = slimAll.slice(cursor, cursor + phaseWindowSize);
    const expectedIndices = windowSlim.map((s) => s.index);
    const indexListText = JSON.stringify(expectedIndices);
    const windowStepsJson = JSON.stringify(windowSlim, null, 2);

    if (log) {
      log.info(
        `[Phase 2] 轮次 ${round}，cursor=${cursor}，窗口步数 ${windowSlim.length}，index ${expectedIndices[0]}–${expectedIndices[expectedIndices.length - 1]}`,
      );
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildPhase2WindowUserPrompt(windowStepsJson, indexListText) },
    ];

    const rawReply = await callChat(messages, {
      temperature: 0.3,
      maxTokens: PHASE2_CASE_WINDOW_MAX_TOKENS,
    });

    if (!rawReply) {
      throw new Error(`[Phase 2] 轮次 ${round} AI 返回空结果`);
    }

    const cleaned = cleanMarkdownFence(rawReply);
    const parsed = parseSingleCaseJsonResponse(cleaned, expectedIndices, windowSlim);
    caseBlocks.push({
      title: parsed.title,
      summary: parsed.summary,
      rows: parsed.rows,
    });

    // 关键：仅消费本轮 case 覆盖的前缀步数，再滑入新步继续归纳
    const consumed = Math.max(1, Math.min(parsed.consumeStepCount || parsed.coveredActionIndices?.length || 1, windowSlim.length));
    if (log) {
      log.info(`[Phase 2] 轮次 ${round} 消费 ${consumed} 步（${expectedIndices[0]}..${expectedIndices[consumed - 1]}）`);
    }
    cursor += consumed;
  }

  const casesText = renderCasesMarkdownDocument(caseBlocks, {
    documentTitle: '录制流程测试用例归纳',
  });

  fs.writeFileSync(casesFile, casesText, 'utf-8');

  console.log('\n' + '='.repeat(60));
  console.log('AI 测试用例预览 (AI_cases.md):');
  console.log('='.repeat(60));
  console.log(casesText.length > 1500 ? casesText.slice(0, 1500) + '\n...(更多内容请查看文件)' : casesText);
  console.log('='.repeat(60));
}

// ==================== 工具函数 ====================

/**
 * 尝试解析并校验结构化 step
 *
 * @param {string} rawReply
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @returns {{ ok: true, step: Object } | { ok: false, error: string }}
 */
function parseAndValidateStructuredStep(rawReply, enrichedAction, actionIndex, intervalFromPreviousMs) {
  const normalized = cleanMarkdownFence(rawReply).trim();
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (_) {
    const extracted = extractFirstJsonObject(normalized);
    if (!extracted) {
      return { ok: false, error: 'JSON 解析失败，且未提取到对象' };
    }
    try {
      parsed = JSON.parse(extracted);
    } catch (err) {
      return { ok: false, error: `JSON 解析失败: ${err.message}` };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '输出不是 JSON 对象' };
  }

  const step = normalizeStructuredStep(parsed, enrichedAction, actionIndex, intervalFromPreviousMs);
  const validationError = validateStructuredStep(step);
  if (validationError) {
    return { ok: false, error: validationError };
  }
  return { ok: true, step };
}

/**
 * 单条修复：要求模型把已有输出修正为严格 JSON
 *
 * @param {string} rawReply
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @returns {Promise<{ ok: true, step: Object } | { ok: false, error: string }>}
 */
async function tryRepairStructuredStep(rawReply, enrichedAction, actionIndex, intervalFromPreviousMs) {
  const messages = [
    {
      role: 'system',
      content: `你是 JSON 修复器。只输出一个合法 JSON 对象，不要任何解释。\n对象必须包含字段：description, uiChange, page, basis, actionKind, target, inputText, key, assertText, confidence。`,
    },
    {
      role: 'user',
      content: `请把下面文本修正为合法 JSON 对象：\n\n${rawReply}`,
    },
  ];

  try {
    const repairedRaw = await callChat(messages, { temperature: 0, maxTokens: 800 });
    return parseAndValidateStructuredStep(repairedRaw, enrichedAction, actionIndex, intervalFromPreviousMs);
  } catch (error) {
    return { ok: false, error: `修复调用失败: ${error.message}` };
  }
}

/**
 * 结构化 step 归一化
 *
 * @param {Object} parsed
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @returns {Object}
 */
/**
 * 可选：多条 enriched 序号共用一个语义注释（Selenium 终稿按序展开多行代码）
 *
 * @param {unknown} raw
 * @param {number} actionIndex
 * @returns {number[]}
 */
function normalizeSourceActionIndices(raw, actionIndex) {
  if (!Array.isArray(raw) || raw.length === 0) return [actionIndex];
  const nums = raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length > 0 ? nums : [actionIndex];
}

function normalizeStructuredStep(parsed, enrichedAction, actionIndex, intervalFromPreviousMs) {
  const actionKind = normalizeActionKind(parsed.actionKind);
  return {
    index: actionIndex,
    status: 'normal',
    description: toSingleLine(parsed.description),
    uiChange: toSingleLine(parsed.uiChange) || '无可见变化',
    page: toSingleLine(parsed.page) || (enrichedAction.title || '未知'),
    basis: normalizeBasisArray(parsed.basis, enrichedAction),
    actionKind,
    target: toSingleLine(parsed.target),
    inputText: toSingleLine(parsed.inputText),
    key: toSingleLine(parsed.key),
    assertText: toSingleLine(parsed.assertText),
    confidence: normalizeConfidence(parsed.confidence),
    intervalFromPreviousMs,
    url: enrichedAction.url || '',
    sourceType: enrichedAction.type || 'unknown',
    sourceActionIndices: normalizeSourceActionIndices(parsed.sourceActionIndices, actionIndex),
  };
}

/**
 * 校验结构化 step
 *
 * @param {Object} step
 * @returns {string|null}
 */
function validateStructuredStep(step) {
  if (!step.description) return 'description 为空';
  if (!step.uiChange) return 'uiChange 为空';
  if (!step.page) return 'page 为空';
  if (!Array.isArray(step.basis)) return 'basis 必须为数组';
  if (!step.actionKind) return 'actionKind 为空';
  if (!Number.isFinite(step.confidence)) return 'confidence 必须为数字';
  return null;
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
    sourceActionIndices: [actionIndex],
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
 * 提取首个 JSON 对象片段
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
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

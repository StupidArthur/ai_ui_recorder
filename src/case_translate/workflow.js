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

import { callChat, cleanMarkdownFence } from './ai-client.js';
import { generateMidsceneYaml } from './midscene/index.js';

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
} from './prompts/step-structured.js';

// ==================== 核心入口函数 ====================

/**
 * 执行完整的 AI 翻译工作流（Phase 1 + Phase 2 + Phase 3）
 *
 * @param {string} runDir - 录制输出目录路径（如 output/run_2026-02-15T06-08-43）
 * @param {Array<Object>} enrichedActions - 预处理后的富化 action 数据数组
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器实例
 * @returns {Promise<{ stepsFile: string, casesFile: string, midsceneNoAssertFile: string }>}
 */
export async function runWorkflow(runDir, enrichedActions, options = {}) {
  const { log } = options;

  const stepsFile = path.join(runDir, AI_STEPS_STRUCTURED_FILENAME);
  const stepErrorsFile = path.join(runDir, AI_STEPS_ERRORS_FILENAME);
  const casesFile = path.join(runDir, AI_CASES_FILENAME);

  // ========== Phase 1：结构化逐条翻译 ==========
  if (log) log.info('[Phase 1] 正在生成结构化步骤 JSON...');
  const phase1Start = Date.now();

  const { steps, errors } = await runPhase1Structured(stepsFile, stepErrorsFile, enrichedActions, { log });

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
  if (log) log.info('[Phase 2] 正在归纳测试用例...');
  const phase2Start = Date.now();

  await runPhase2FromStructured(steps, casesFile, { log });

  const phase2Elapsed = ((Date.now() - phase2Start) / 1000).toFixed(1);
  if (log) log.info(`[Phase 2] 完成，耗时 ${phase2Elapsed}s`);
  if (log) log.info(`[Phase 2] 文件已保存: ${casesFile}`);

  // ========== Phase 3：Midscene YAML ==========
  if (log) log.info('[Phase 3] 正在生成 Midscene YAML（no_assert）...');
  const { noAssertFile } = generateMidsceneYaml(runDir, steps, { log });

  // ========== 总结 ==========
  const totalElapsed = ((Date.now() - phase1Start) / 1000).toFixed(1);
  if (log) log.info(`AI 翻译总耗时: ${totalElapsed}s`);

  return {
    stepsFile,
    casesFile,
    midsceneNoAssertFile: noAssertFile,
  };
}

// ==================== Phase 1：结构化逐条翻译 ====================

/**
 * Phase 1：逐条生成结构化步骤
 *
 * @param {string} stepsFile - 结构化步骤文件路径
 * @param {string} stepErrorsFile - 结构化步骤错误记录文件路径
 * @param {Array<Object>} enrichedActions - 富化后的 action 数据
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器
 * @returns {Promise<{ steps: Array<Object>, errors: Array<Object> }>}
 */
async function runPhase1Structured(stepsFile, stepErrorsFile, enrichedActions, options = {}) {
  const { log } = options;

  const steps = [];
  const errors = [];
  let previousTimestamp = null;

  const totalActions = enrichedActions.length;

  for (let idx = 0; idx < totalActions; idx++) {
    const enrichedAction = enrichedActions[idx];
    const actionIndex = enrichedAction.index;

    // skip/noise 直接确定性落地
    if (enrichedAction.skip || enrichedAction.noise) {
      const intervalFromPreviousMs = computeIntervalFromPreviousMs(enrichedAction.timestamp, previousTimestamp);
      const fallbackStep = buildFallbackStructuredStep(enrichedAction, actionIndex, null, intervalFromPreviousMs);
      steps.push(fallbackStep);
      writeJsonIncremental(stepsFile, steps);
      if (enrichedAction.skip && log) log.info(`[Phase 1] 操作 ${actionIndex} 已跳过 [${enrichedAction.skip}]`);
      if (enrichedAction.noise && log) log.info(`[Phase 1] 操作 ${actionIndex} 已标记噪声`);
      previousTimestamp = normalizeTimestamp(enrichedAction.timestamp, previousTimestamp);
      continue;
    }

    try {
      const windowStart = Math.max(0, steps.length - EVIDENCE_CONTEXT_WINDOW_SIZE);
      const recentSteps = steps.slice(windowStart);
      const messages = [
        { role: 'system', content: buildStructuredStepSystemPrompt() },
        { role: 'user', content: buildStructuredStepUserPrompt(enrichedAction, actionIndex, recentSteps) },
      ];

      if (log) log.info(`[Phase 1] 正在处理操作 ${actionIndex}/${totalActions}...`);

      const rawReply = await callChat(messages, { temperature: 0, maxTokens: 1200 });
      const intervalFromPreviousMs = computeIntervalFromPreviousMs(enrichedAction.timestamp, previousTimestamp);
      const parseResult = parseAndValidateStructuredStep(rawReply, enrichedAction, actionIndex, intervalFromPreviousMs);
      if (!parseResult.ok) {
        const repaired = await tryRepairStructuredStep(rawReply, enrichedAction, actionIndex, intervalFromPreviousMs);
        if (repaired.ok) {
          steps.push(repaired.step);
          errors.push({
            index: actionIndex,
            type: 'repair',
            reason: parseResult.error,
          });
        } else {
          const fallbackStep = buildFallbackStructuredStep(
            enrichedAction,
            actionIndex,
            repaired.error || parseResult.error,
            intervalFromPreviousMs,
          );
          steps.push(fallbackStep);
          errors.push({
            index: actionIndex,
            type: 'fallback',
            reason: repaired.error || parseResult.error,
          });
        }
      } else {
        steps.push(parseResult.step);
      }

      writeJsonIncremental(stepsFile, steps);
      writeJsonIncremental(stepErrorsFile, errors);
      if (log) log.info(`[Phase 1] 操作 ${actionIndex} 结构化结果已保存`);
      previousTimestamp = normalizeTimestamp(enrichedAction.timestamp, previousTimestamp);
    } catch (error) {
      if (log) log.error(`[Phase 1] 操作 ${actionIndex} 结构化生成失败: ${error.message}`);
      const intervalFromPreviousMs = computeIntervalFromPreviousMs(enrichedAction.timestamp, previousTimestamp);
      const fallbackStep = buildFallbackStructuredStep(enrichedAction, actionIndex, error.message, intervalFromPreviousMs);
      steps.push(fallbackStep);
      errors.push({
        index: actionIndex,
        type: 'exception-fallback',
        reason: error.message,
      });
      writeJsonIncremental(stepsFile, steps);
      writeJsonIncremental(stepErrorsFile, errors);
      previousTimestamp = normalizeTimestamp(enrichedAction.timestamp, previousTimestamp);
    }
  }

  writeJsonIncremental(stepsFile, steps);
  writeJsonIncremental(stepErrorsFile, errors);
  return { steps, errors };
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
    const windowSlim = slimAll.slice(cursor, cursor + PHASE2_CASE_WINDOW_STEPS);
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
    basis: Array.isArray(parsed.basis) ? parsed.basis.map(toSingleLine).filter(Boolean) : [],
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

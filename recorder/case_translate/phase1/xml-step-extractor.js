/**
 * phase1/xml-step-extractor.js - Phase 1 LLM XML 输出解析（替代 JSON.parse）
 *
 * 宽松正则 + 降级链 + 按 actionBatch[].index 锚定（防 ID 漂移）。
 */

import {
  XML_REGEX_STEP_BLOCK_MAX_CHARS,
  XML_REGEX_ACTION_OBS_MAX_CHARS,
} from '../../utils/config.js';
import {
  preprocessLlmXmlOutput,
  hasClosingTag,
  boundedCrossLine,
  toSingleLineText,
} from '../xml-parse-utils.js';

/**
 * 从 LLM XML 文本提取 step 列表（按 id 去重，保留首条）
 *
 * @param {string} llmOutput
 * @returns {Array<{ id: number, action: string, observation: string }>}
 */
export function robustExtractSteps(llmOutput) {
  const { text } = preprocessLlmXmlOutput(llmOutput);
  const errors = [];
  const byId = new Map();

  if (!hasClosingTag(text, '</step>')) {
    return { steps: [], errors: [{ type: 'xml-no-close-step', reason: '缺少 </step> 闭合标签' }] };
  }

  const blockPat = new RegExp(
    `<step[^>]*\\bid\\s*=\\s*["']?(\\d+)["']?[^>]*>(${boundedCrossLine(XML_REGEX_STEP_BLOCK_MAX_CHARS)})</step>`,
    'gi',
  );

  let match;
  while ((match = blockPat.exec(text)) !== null) {
    const id = parseInt(match[1], 10);
    if (!Number.isInteger(id) || id <= 0) continue;

    const inner = match[2] || '';
    const actionPat = new RegExp(
      `<action[^>]*>(${boundedCrossLine(XML_REGEX_ACTION_OBS_MAX_CHARS)})</action>`,
      'i',
    );
    const obsPat = new RegExp(
      `<observation[^>]*>(${boundedCrossLine(XML_REGEX_ACTION_OBS_MAX_CHARS)})</observation>`,
      'i',
    );

    const actionM = inner.match(actionPat);
    const obsM = inner.match(obsPat);

    let action = actionM ? toSingleLineText(actionM[1]) : '';
    let observation = obsM ? toSingleLineText(obsM[1]) : '';

    if (action && !observation) {
      observation = '无可见变化';
      errors.push({ type: 'partial-xml', index: id, reason: '缺少 observation 节点' });
    }

    if (!action && !observation) {
      const looseInner = toSingleLineText(inner);
      if (looseInner) {
        action = looseInner;
        observation = '无可见变化';
        errors.push({ type: 'loose-step', index: id, reason: '无法解析 action/observation 子标签' });
      }
    }

    if (!action) continue;

    if (byId.has(id)) {
      errors.push({ type: 'xml-duplicate-id', index: id, reason: '重复 step id，已忽略后续' });
      continue;
    }

    byId.set(id, { id, action, observation });
  }

  return { steps: [...byId.values()], errors };
}

/**
 * 解析 Phase 1 批次 LLM XML 回复，按 actionBatch index 对齐
 *
 * @param {string} rawReply
 * @param {Array<Object>} actionBatch
 * @param {Array<number>} skipNoiseIndices
 * @param {Object} [log]
 * @returns {{ parsedSteps: Array<Object>, failedIndices: number[], errors: Array<Object> }}
 */
export function parseBatchXmlSteps(rawReply, actionBatch, skipNoiseIndices, log) {
  const parsedSteps = [];
  const failedIndices = [];
  const errors = [];

  const expectedIds = new Set(actionBatch.map((a) => a.index));
  const { steps: extracted, errors: extractErrors } = robustExtractSteps(rawReply);
  errors.push(...extractErrors);

  const byId = new Map();
  for (const row of extracted) {
    if (!expectedIds.has(row.id)) {
      errors.push({
        index: row.id,
        type: 'xml-unknown-id',
        reason: `XML id=${row.id} 不在本批 actionBatch 中`,
      });
      if (log) log.warn(`[Phase 1] 忽略未知 XML id=${row.id}`);
      continue;
    }
    byId.set(row.id, {
      index: row.id,
      description: row.action,
      uiChange: row.observation || '无可见变化',
    });
  }

  for (const action of actionBatch) {
    const hit = byId.get(action.index);
    if (hit) {
      parsedSteps.push(hit);
    } else {
      failedIndices.push(action.index);
      errors.push({
        index: action.index,
        type: 'batch-missing-index',
        reason: 'LLM XML 未包含该 index',
      });
      if (log) log.warn(`[Phase 1] XML 遗漏 index=${action.index}，将使用兜底步骤`);
    }
  }

  if (parsedSteps.length === 0 && actionBatch.length > 0) {
    errors.push({
      index: actionBatch[0].index,
      type: 'batch-parse-error',
      reason: '未能从 XML 解析出任何有效 step',
    });
    for (const action of actionBatch) {
      if (!failedIndices.includes(action.index)) {
        failedIndices.push(action.index);
      }
    }
  }

  return { parsedSteps, failedIndices, errors };
}

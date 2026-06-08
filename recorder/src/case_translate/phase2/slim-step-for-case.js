/**
 * slim-step-for-case.js
 *
 * 将 Phase 1 产出的结构化 step 转为 Phase 2 归纳专用瘦身对象。
 * 不修改磁盘上的 step_2_structured_steps.json，仅在内存中投影。
 *
 * 边界信号（与固定窗口方案配合）：
 * - routeKey：页面归属的稳定键，弱化长 query
 * - gapTag：相邻步骤时间间隔的离散标签（contiguous / longGap）
 */

import {
  PHASE2_GAP_TAG_LONG_GAP_MS,
  PHASE2_ASSERT_TEXT_MAX_CHARS,
} from '../../utils/config.js';

/**
 * 从完整 URL 推导 routeKey：pathname + hash 路径段，去掉 hash 内 query
 *
 * @param {string} url
 * @returns {string}
 */
export function buildRouteKey(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';

  try {
    const u = new URL(raw);
    let key = u.pathname || '';
    if (u.hash) {
      const hashNoQuery = u.hash.split('?')[0];
      key += hashNoQuery;
    }
    return key.trim() || raw.split('?')[0].slice(0, 200);
  } catch {
    return raw.split('?')[0].slice(0, 200);
  }
}

/**
 * 由相邻步骤间隔毫秒推导 gapTag
 *
 * @param {number|null|undefined} intervalFromPreviousMs
 * @returns {'contiguous'|'longGap'}
 */
export function buildGapTag(intervalFromPreviousMs) {
  const ms = Number(intervalFromPreviousMs);
  if (!Number.isFinite(ms) || ms < 0) {
    return 'contiguous';
  }
  return ms > PHASE2_GAP_TAG_LONG_GAP_MS ? 'longGap' : 'contiguous';
}

/**
 * 截断 assertText
 *
 * @param {string} text
 * @returns {string}
 */
export function truncateAssertText(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (s.length <= PHASE2_ASSERT_TEXT_MAX_CHARS) return s;
  return s.slice(0, PHASE2_ASSERT_TEXT_MAX_CHARS);
}

/**
 * 单条结构化 step -> Phase 2 瘦身对象（供 LLM 消费）
 *
 * @param {Object} step - normalizeStructuredStep 产物
 * @returns {Object}
 */
export function slimStepForPhase2(step) {
  const actionKind = step.actionKind || 'other';
  const slim = {
    index: step.index,
    actionKind,
    description: String(step.description || '').trim(),
    uiChange: String(step.uiChange || '').trim() || '无可见变化',
    page: String(step.page || '未知').trim(),
    target: String(step.target || '').trim(),
    routeKey: buildRouteKey(step.url),
    gapTag: buildGapTag(step.intervalFromPreviousMs),
  };

  if (actionKind === 'input' && step.inputText != null && String(step.inputText).trim()) {
    slim.inputText = String(step.inputText).trim();
  }
  if (actionKind === 'keyPress' && step.key != null && String(step.key).trim()) {
    slim.key = String(step.key).trim();
  }

  const at = truncateAssertText(step.assertText);
  if (at) {
    slim.assertText = at;
  }

  return slim;
}

/**
 * 将多条原始结构化步骤批量瘦身（调用方应先过滤有效步骤）
 *
 * @param {Array<Object>} steps
 * @returns {Array<Object>}
 */
export function slimStepsForPhase2(steps) {
  return (steps || []).map((s) => slimStepForPhase2(s));
}

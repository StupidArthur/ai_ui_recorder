/**
 * case-window-segmenter.js
 *
 * Phase 2 固定窗口分片：仅在「有效步骤」数组上滑动，不扩窗、不 overlap。
 * 有效步骤默认 status === 'normal'（noise/skip/fallback 等不占窗口额度）。
 */

/**
 * 判断是否为参与 Phase 2 窗口计数的有效步骤
 *
 * @param {Object} step
 * @returns {boolean}
 */
export function isPhase2EffectiveStep(step) {
  if (!step || typeof step !== 'object') return false;
  return step.status === 'normal';
}

/**
 * 从完整步骤列表中筛出有效步骤（保持原顺序与原始 index）
 *
 * @param {Array<Object>} steps
 * @returns {Array<Object>}
 */
export function filterEffectiveStepsForPhase2(steps) {
  return (steps || []).filter(isPhase2EffectiveStep);
}

/**
 * 将数组按固定大小切分为连续窗口（最后一片可能不足 windowSize）
 *
 * @template T
 * @param {Array<T>} items
 * @param {number} windowSize
 * @returns {Array<Array<T>>}
 */
export function chunkIntoFixedWindows(items, windowSize) {
  const list = items || [];
  const size = Math.max(1, Math.floor(Number(windowSize)) || 1);
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

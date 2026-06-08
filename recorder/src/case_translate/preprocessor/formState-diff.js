/**
 * formState-diff.js - 表单状态差异计算模块
 *
 * 计算相邻 action 之间 formStateDelta 的变化，找出用户在两次操作之间
 * 输入/修改了哪些表单元素。
 *
 * 设计目的：
 * - formStateDelta 是每个 action 发生瞬间同步捕获的全页面表单状态
 * - 对比前后两次的 formStateDelta，可以精确得到"两次操作之间输入了什么"
 * - 这对于 keypress 类型的操作尤其有价值（快照可能无法完整捕获输入内容）
 *
 * 使用方式：
 *   import { computeFormStateChanges } from './formState-diff.js';
 *   const changes = computeFormStateChanges(prevFormState, currFormState);
 */

// ==================== 核心函数 ====================

/**
 * 计算两次 formStateDelta 之间的差异
 *
 * 对比规则：
 * - 新增的 key：当前有但上一次没有 → 新出现的表单元素
 * - 消失的 key：上一次有但当前没有 → 被移除的表单元素（通常是页面变化）
 * - 值变化的 key：同一个选择器的值不同 → 用户修改了该表单元素
 *
 * @param {Object|null} prevFormState - 上一个 action 的 formStateDelta（首个 action 传 null）
 * @param {Object|null} currFormState - 当前 action 的 formStateDelta
 * @returns {Object} 差异对象
 * @returns {Object} returns.changed - 值发生变化的元素 { xpathKey: { from, to } }
 * @returns {Object} returns.added - 新出现的元素 { xpathKey: value }
 * @returns {Object} returns.removed - 消失的元素 { xpathKey: value }
 * @returns {boolean} returns.hasChanges - 是否存在任何变化
 */
export function computeFormStateChanges(prevFormState, currFormState) {
  const result = {
    changed: {},
    added: {},
    removed: {},
    hasChanges: false,
  };

  const prev = prevFormState || {};
  const curr = currFormState || {};

  const prevKeys = new Set(Object.keys(prev));
  const currKeys = new Set(Object.keys(curr));

  // 检查值变化和新增
  for (const key of currKeys) {
    if (prevKeys.has(key)) {
      // 两次都有 → 比较值
      if (!isEqual(prev[key], curr[key])) {
        result.changed[key] = { from: prev[key], to: curr[key] };
        result.hasChanges = true;
      }
    } else {
      // 只有当前有 → 新增
      result.added[key] = curr[key];
      result.hasChanges = true;
    }
  }

  // 检查消失的元素
  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      result.removed[key] = prev[key];
      result.hasChanges = true;
    }
  }

  return result;
}

/**
 * 将 formState 差异格式化为人类可读的文本摘要
 *
 * @param {Object} changes - computeFormStateChanges() 的返回值
 * @returns {string|null} 格式化文本，无变化返回 null
 */
export function formatFormStateChanges(changes) {
  if (!changes || !changes.hasChanges) return null;

  const lines = [];

  // 值变化
  for (const [selector, { from, to }] of Object.entries(changes.changed)) {
    lines.push(`[变化] ${selector}: "${from}" → "${to}"`);
  }

  // 新增
  for (const [selector, value] of Object.entries(changes.added)) {
    lines.push(`[新增] ${selector}: "${value}"`);
  }

  // 消失
  for (const [selector, value] of Object.entries(changes.removed)) {
    lines.push(`[消失] ${selector}: "${value}"`);
  }

  return lines.join('\n');
}

// ==================== 内部工具函数 ====================

/**
 * 简单的值相等比较（支持基本类型和简单对象）
 *
 * @param {*} a - 值 A
 * @param {*} b - 值 B
 * @returns {boolean} 是否相等
 */
function isEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;

  // 对象类型：浅层比较
  if (typeof a === 'object' && a !== null && b !== null) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => isEqual(a[k], b[k]));
  }

  return false;
}

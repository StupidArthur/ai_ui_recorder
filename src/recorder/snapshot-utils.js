/**
 * snapshot-utils.js - 快照工具函数（纯函数模块）
 *
 * 提供 Accessibility Snapshot 的裁剪和格式化能力：
 * - pruneSnapshot: 裁剪 AX 快照树（限制深度、移除无意义节点、精简属性）
 * - snapshotToText: 将裁剪后的快照树转为紧凑的 YAML 风格文本
 *
 * 这些函数不依赖任何外部状态，可独立使用。
 *
 * 使用方式：
 *   import { pruneSnapshot, snapshotToText } from './snapshot-utils.js';
 *   const pruned = pruneSnapshot(rawSnapshot, 8);
 *   const text = snapshotToText(pruned);
 */

import { SNAPSHOT_MAX_DEPTH } from '../utils/config.js';

// ==================== 常量定义 ====================

/**
 * 无意义的 AX 节点角色集合
 * 这些角色的叶子节点（无 name、无 value、无子节点）在裁剪时直接丢弃
 */
const SKIP_ROLES = new Set([
  'none', 'generic', 'presentation',
  'LineBreak', 'InlineTextBox', 'StaticText',
]);

// ==================== 核心函数 ====================

/**
 * 裁剪 AX 快照树：限制深度、移除无意义节点、精简属性
 *
 * 策略：
 * 1. 超过最大深度的节点直接丢弃
 * 2. 只保留有值的属性（role 始终保留）
 * 3. 无意义的叶子节点（SKIP_ROLES 中的角色，且无 name/value/children）返回 null
 * 4. 递归处理子节点，过滤掉返回 null 的子节点
 *
 * @param {Object} node - Playwright accessibility.snapshot() 返回的节点
 * @param {number} [maxDepth] - 最大深度，默认使用 config 中的 SNAPSHOT_MAX_DEPTH
 * @param {number} [currentDepth=0] - 当前递归深度（内部使用）
 * @returns {Object|null} 裁剪后的节点，无意义节点返回 null
 */
export function pruneSnapshot(node, maxDepth = SNAPSHOT_MAX_DEPTH, currentDepth = 0) {
  if (!node) return null;
  if (currentDepth > maxDepth) return null;

  // 构建精简节点：只保留有值的属性
  const pruned = { role: node.role };

  if (node.name)        pruned.name = node.name;
  if (node.value)       pruned.value = node.value;
  if (node.description) pruned.description = node.description;
  if (node.checked !== undefined)  pruned.checked = node.checked;
  if (node.pressed !== undefined)  pruned.pressed = node.pressed;
  if (node.expanded !== undefined) pruned.expanded = node.expanded;
  if (node.selected !== undefined) pruned.selected = node.selected;
  if (node.disabled)    pruned.disabled = true;
  if (node.required)    pruned.required = true;
  if (node.level)       pruned.level = node.level;

  // 递归处理子节点
  if (node.children && node.children.length > 0 && currentDepth < maxDepth) {
    const children = node.children
      .map(child => pruneSnapshot(child, maxDepth, currentDepth + 1))
      .filter(Boolean); // 移除 null（无意义节点）

    if (children.length > 0) {
      pruned.children = children;
    }
  }

  // 过滤无意义的叶子节点：没有 name、value、子节点、且 role 不重要的
  if (SKIP_ROLES.has(pruned.role) && !pruned.name && !pruned.value && !pruned.children) {
    return null;
  }

  return pruned;
}

/**
 * 将裁剪后的快照树转为紧凑的 YAML 风格文本
 *
 * 输出格式示例：
 *   - WebArea "首页"
 *     - navigation "主导航"
 *       - link "首页"
 *       - link "关于" [selected]
 *     - button "登录"
 *
 * 这种格式比 JSON 更节省 token，且 LLM 更容易理解层级关系。
 *
 * @param {Object} node - 裁剪后的快照节点
 * @param {number} [indent=0] - 缩进层级（内部使用）
 * @returns {string} YAML 风格的文本表示
 */
export function snapshotToText(node, indent = 0) {
  if (!node) return '';

  const prefix = '  '.repeat(indent) + '- ';
  let line = prefix + node.role;

  // 附加名称
  if (node.name) {
    line += ` "${node.name}"`;
  }

  // 附加属性标记
  const attrs = [];
  if (node.checked !== undefined) attrs.push(node.checked ? 'checked' : 'unchecked');
  if (node.pressed !== undefined) attrs.push(node.pressed ? 'pressed' : 'not-pressed');
  if (node.expanded !== undefined) attrs.push(node.expanded ? 'expanded' : 'collapsed');
  if (node.selected) attrs.push('selected');
  if (node.disabled) attrs.push('disabled');
  if (node.required) attrs.push('required');
  if (node.level) attrs.push(`level=${node.level}`);
  if (node.value) attrs.push(`value="${node.value}"`);

  if (attrs.length > 0) {
    line += ` [${attrs.join(', ')}]`;
  }

  let result = line + '\n';

  // 递归子节点
  if (node.children) {
    for (const child of node.children) {
      result += snapshotToText(child, indent + 1);
    }
  }

  return result;
}

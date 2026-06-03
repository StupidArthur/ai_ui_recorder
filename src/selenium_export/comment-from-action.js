/**
 * comment-from-action.js - 与 Recorder 摘要语义对齐的简短操作说明
 *
 * 供 Selenium 导出注释使用，避免与 meta.actionSummary 描述口径不一致。
 */

/**
 * 由单条 action 生成一行简短中文描述（与 recorder._describeAction 对齐）
 *
 * @param {Object} action
 * @returns {string}
 */
export function shortCommentFromAction(action) {
  const el = action.element || {};
  const identify =
    el.label ||
    el.text ||
    el.placeholder ||
    el.name ||
    el.id ||
    el.xpath?.slice(0, 48) ||
    '';

  switch (action.type) {
    case 'click':
      return `点击 <${el.tag}> "${identify}"`;
    case 'dblclick':
      return `双击 <${el.tag}> "${identify}"`;
    case 'rightclick':
      return `右键点击 <${el.tag}> "${identify}"`;
    case 'keypress':
      return `按键 [${action.key}] 在 <${el.tag}> (${identify})`;
    case 'input':
      return `输入 <${el.tag}> "${identify}"`;
    default:
      return `${action.type || 'unknown'} <${el.tag}>`;
  }
}

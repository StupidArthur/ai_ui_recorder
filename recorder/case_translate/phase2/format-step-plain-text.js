/**
 * format-step-plain-text.js - 将结构化步骤格式化为 Phase 2/4 共用的纯文本块
 */

/**
 * 单条 step → 纯文本（动作 + 界面响应）
 *
 * @param {Object} step
 * @returns {string}
 */
export function formatStepAsPlainText(step) {
  const idx = step.index != null ? step.index : '?';
  const action = String(step.description || '').trim() || '(无动作描述)';
  const obs = String(step.uiChange || '').trim() || '无可见变化';
  return `步骤 ${idx}:\n- 动作: ${action}\n- 界面响应: ${obs}`;
}

/**
 * 多条 step 拼接为窗口输入文本
 *
 * @param {Array<Object>} steps
 * @returns {string}
 */
export function formatStepsWindowPlainText(steps) {
  return (steps || []).map(formatStepAsPlainText).join('\n\n');
}

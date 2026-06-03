/**
 * action-to-driver4.js - 单条 action → 一行 Python（Driver4 + XPath）
 *
 * 入参可为原始录制 action 或预处理后的 enriched（字段兼容）。
 * 仅使用 element.xpath，不使用 CSS selector。
 *
 * 生成代码**仅**调用 Driver4 的 `click` / `set_value`（`open` 在模板中，不在此映射）。
 * 不生成 double_click、right_click、click_xy 等。
 */

/** Python 中安全表示字符串字面量（双引号包裹，内部转义） */
export function pythonStringLiteral(value) {
  if (value == null) return '""';
  return JSON.stringify(String(value));
}

/**
 * 单条 action → 一行或多行 Python（含缩进前缀）
 *
 * @param {Object} action - 含 type、element.xpath、可选 inputValue、position、key
 * @param {Object} [options]
 * @param {string} [options.indent] - 行首缩进，默认 4 空格
 * @returns {string} 可能含换行（TODO 注释）
 */
export function actionToDriver4Lines(action, options = {}) {
  const indent = options.indent ?? '    ';
  const xpath = action.element?.xpath;
  const idx = action.index != null ? action.index : '?';

  if (!xpath || xpath === 'unknown') {
    return `${indent}# TODO: 缺少 element.xpath (action index=${idx}, type=${action.type || 'unknown'})`;
  }

  const xLit = pythonStringLiteral(xpath);

  switch (action.type) {
    case 'input': {
      const val = action.inputValue != null ? String(action.inputValue) : '';
      return `${indent}d.set_value(${xLit}, ${pythonStringLiteral(val)})`;
    }
    case 'click':
      return `${indent}d.click(${xLit})`;
    case 'dblclick':
      return `${indent}# 原为双击，已降级为单击\n${indent}d.click(${xLit})`;
    case 'rightclick':
      return `${indent}# 原为右键，已降级为左键单击\n${indent}d.click(${xLit})`;
    case 'keypress': {
      const k = action.key != null ? String(action.key) : '';
      return (
        `${indent}# TODO: keypress ${pythonStringLiteral(k)} — 导出仅允许 open/click/set_value，请手工补充\n` +
        `${indent}# 目标 xpath: ${xLit}`
      );
    }
    default:
      return `${indent}# TODO: 未映射的 type=${action.type} index=${idx} xpath=${xLit}`;
  }
}

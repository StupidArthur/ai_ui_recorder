/**
 * midscene/yaml-emitter.js - 轻量 YAML 输出器
 */

/**
 * 生成 Midscene YAML 文本
 *
 * @param {{ webUrl: string, taskName: string, flow: Array<Object> }} data
 * @returns {string}
 */
export function renderMidsceneYaml(data) {
  const { webUrl, taskName, flow } = data;
  const lines = [];

  lines.push('web:');
  lines.push(`  url: ${toYamlScalar(webUrl || '')}`);
  lines.push('');
  lines.push('tasks:');
  lines.push(`  - name: ${toYamlScalar(taskName || '自动生成任务')}`);
  lines.push('    flow:');

  for (const item of flow || []) {
    const entries = Object.entries(item || {});
    if (entries.length === 0) continue;

    const [firstKey, firstValue] = entries[0];
    lines.push(`      - ${firstKey}: ${toYamlScalar(firstValue)}`);
    for (let i = 1; i < entries.length; i++) {
      const [k, v] = entries[i];
      lines.push(`        ${k}: ${toYamlScalar(v)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * 将值转为 YAML 标量
 *
 * @param {any} value
 * @returns {string}
 */
function toYamlScalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  const text = value == null ? '' : String(value);
  return JSON.stringify(text);
}


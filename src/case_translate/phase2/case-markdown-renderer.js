/**
 * case-markdown-renderer.js
 *
 * 将多段「单窗口单 Case」的 JSON 结果合并为 AI_cases.md 文档。
 * 同时提供 LLM 原始 JSON 的解析与校验兜底。
 */

/**
 * 从文本中提取首个 JSON 对象子串
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
 * 解析 Phase 2 单窗口返回的 JSON（仅一个 Case）
 *
 * @param {string} rawReply - 已去除 markdown 围栏的文本
 * @param {Array<number>} expectedIndices - 当前窗口内原始 action index 列表（有序）
 * @param {Array<Object>} [slimWindow] - 当前窗口瘦身步骤（与 expectedIndices 顺序一致），用于回填 operation/uiChange
 * @returns {{ title: string, summary: string, coveredActionIndices: number[], consumeStepCount: number, rows: Array<{ order: number, operation: string, uiChange: string }> }}
 */
export function parseSingleCaseJsonResponse(rawReply, expectedIndices, slimWindow = []) {
  const normalized = String(rawReply || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    const extracted = extractFirstJsonObject(normalized);
    if (!extracted) {
      throw new Error('[Phase 2] 单窗口返回不是合法 JSON');
    }
    parsed = JSON.parse(extracted);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('[Phase 2] 单窗口 JSON 根须为对象');
  }

  const title = String(parsed.title || parsed.caseTitle || '未命名用例').trim() || '未命名用例';
  const summary = String(parsed.summary || '').trim();

  let covered = Array.isArray(parsed.coveredActionIndices)
    ? parsed.coveredActionIndices.map((n) => Number(n)).filter(Number.isFinite)
    : [];
  const consumeFromField = Number(parsed.consumeStepCount);

  // 合法覆盖集：expectedIndices 的「前缀连续子数组」
  // 例如 expected=[11,12,13,14]，合法 covered=[11],[11,12],[11,12,13]...
  const isPrefixCovered = (() => {
    if (covered.length <= 0 || covered.length > expectedIndices.length) return false;
    for (let i = 0; i < covered.length; i++) {
      if (covered[i] !== expectedIndices[i]) return false;
    }
    return true;
  })();

  if (!isPrefixCovered) {
    // 次优兜底：允许模型仅给 consumeStepCount
    if (Number.isInteger(consumeFromField) && consumeFromField >= 1 && consumeFromField <= expectedIndices.length) {
      covered = expectedIndices.slice(0, consumeFromField);
    } else if (Array.isArray(parsed.steps) && parsed.steps.length >= 1 && parsed.steps.length <= expectedIndices.length) {
      covered = expectedIndices.slice(0, parsed.steps.length);
    } else {
      covered = [...expectedIndices];
    }
  }

  /** @type {Array<{ actionIndex?: number, operation?: string, uiChange?: string }>} */
  const stepRows = Array.isArray(parsed.steps) ? parsed.steps : [];

  const slimByIndex = new Map();
  for (const s of slimWindow || []) {
    if (s && Number.isFinite(s.index)) slimByIndex.set(s.index, s);
  }

  const rows = [];
  let order = 1;
  let pos = 0;
  for (const idx of covered) {
    let match = stepRows.find((r) => Number(r.actionIndex) === idx);
    if (!match && stepRows[pos]) {
      match = stepRows[pos];
    }
    pos += 1;

    const slim = slimByIndex.get(idx);
    const fallbackOp = slim ? String(slim.description || '').trim() : '';
    const fallbackUi = slim ? String(slim.uiChange || '').trim() : '';

    const operation = match && String(match.operation || '').trim()
      ? String(match.operation).trim()
      : (fallbackOp || `操作 ${idx}`);
    const uiChange = match && String(match.uiChange || '').trim()
      ? String(match.uiChange).trim()
      : (fallbackUi || '无可见变化');

    rows.push({ order: order++, operation, uiChange });
  }

  return {
    title,
    summary,
    coveredActionIndices: covered,
    consumeStepCount: covered.length,
    rows,
  };
}

/**
 * 将多个单 Case 块渲染为完整 Markdown（与历史 AI_cases.md 表格风格一致）
 *
 * @param {Array<{ title: string, summary?: string, rows: Array<{ order: number, operation: string, uiChange: string }> }>} cases
 * @param {Object} [options]
 * @param {string} [options.documentTitle] - 文档总标题
 * @returns {string}
 */
export function renderCasesMarkdownDocument(cases, options = {}) {
  const list = cases || [];
  const documentTitle = String(options.documentTitle || '录制流程测试用例归纳').trim();

  let md = `# ${documentTitle}\n\n`;
  if (list.length === 0) {
    md += '> 无有效步骤（均为 noise/skip/fallback 等），未生成 Case。\n';
    return md;
  }

  list.forEach((c, i) => {
    const caseNo = i + 1;
    md += `## Case ${caseNo}: ${c.title}\n`;
    if (c.summary) {
      md += `\n> ${c.summary}\n\n`;
    }
    md += '| 步骤 | 操作 | UI 变化 |\n';
    md += '|------|------|---------|\n';
    for (const r of c.rows || []) {
      const op = escapeTableCell(r.operation);
      const ui = escapeTableCell(r.uiChange);
      md += `| ${r.order} | ${op} | ${ui} |\n`;
    }
    md += '\n';
  });

  return md.trimEnd() + '\n';
}

/**
 * Markdown 表格单元格转义（管道符、换行）
 *
 * @param {string} text
 * @returns {string}
 */
function escapeTableCell(text) {
  return String(text || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

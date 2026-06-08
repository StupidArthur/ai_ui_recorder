/**
 * cases-document-appendix.js
 *
 * AI_cases.md 附录：Phase 1 全量步骤表、Case 覆盖核对、LLM 遗漏步骤的程序补全 Case。
 */

import { formatStepsWindowPlainText } from './format-step-plain-text.js';

/** Markdown 中可能出现的底层步骤 index 引用模式 */
const STEP_INDEX_PATTERNS = [
  /\[步骤\s*(\d+)\]/gi,
  /###\s*(?:\[)?步骤\s*(\d+)/gi,
  /步骤\s*(\d+)\s*[：:]/gi,
];

/**
 * 从 Case Markdown 正文中提取被引用的底层步骤 index
 *
 * @param {string} markdown
 * @returns {Set<number>}
 */
export function extractMentionedStepIndices(markdown) {
  const found = new Set();
  const text = String(markdown || '');
  for (const pat of STEP_INDEX_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (Number.isInteger(n) && n > 0) found.add(n);
    }
  }
  return found;
}

/**
 * 将 Case 正文中的「窗内序号」1..n 改写为底层全局 index
 *
 * 典型错误：窗口从 index 21 起，模型仍写 ### 步骤 1 / [步骤 2]，会被误判为已覆盖步骤 1–3。
 *
 * @param {string} markdownBlock
 * @param {Array<number>} coveredActionIndices - 本 Case 已消费的全局 index（前缀连续）
 * @returns {string}
 */
export function normalizeCaseMarkdownToGlobalIndices(markdownBlock, coveredActionIndices) {
  const covered = coveredActionIndices || [];
  if (covered.length === 0) return String(markdownBlock || '');

  const firstGlobal = covered[0];
  const n = covered.length;
  let md = String(markdownBlock || '');
  const mentioned = extractMentionedStepIndices(md);

  if ([...mentioned].some((i) => i >= firstGlobal)) {
    return md;
  }

  if (mentioned.size === 0) return md;

  const maxM = Math.max(...mentioned);
  const minM = Math.min(...mentioned);
  if (minM < 1 || maxM > n) return md;
  if (![...mentioned].every((i) => i >= 1 && i <= n)) return md;

  for (let local = 1; local <= n; local++) {
    const global = covered[local - 1];
    if (global == null) continue;

    md = md.replace(
      new RegExp(`(###\\s*)(?:\\[)?步骤\\s*${local}\\b`, 'gi'),
      `$1[步骤 ${global}]`,
    );
    md = md.replace(new RegExp(`\\[步骤\\s*${local}\\]`, 'gi'), `[步骤 ${global}]`);
    md = md.replace(
      new RegExp(`步骤\\s*${local}\\s*([：:])`, 'gi'),
      `[步骤 ${global}]$1`,
    );
  }

  return md;
}

/**
 * 本窗 Case 消费的 index 是否均已在先前 Case 中出现（重复归纳，应丢弃）
 *
 * @param {string} markdownBlock - 已做全局 index 规范化后的正文
 * @param {Array<{ markdownBlock?: string }>} caseBlocks
 * @param {Array<number>} coveredActionIndices
 * @returns {boolean}
 */
export function isRedundantCaseBlock(markdownBlock, caseBlocks, coveredActionIndices) {
  const covered = coveredActionIndices || [];
  if (covered.length === 0) return false;

  const prevMd = (caseBlocks || []).map((c) => c.markdownBlock || '').join('\n\n');
  const prevMentioned = extractMentionedStepIndices(prevMd);
  if (!covered.every((idx) => prevMentioned.has(idx))) return false;

  const newMentioned = extractMentionedStepIndices(markdownBlock);
  if (newMentioned.size === 0) return true;

  return [...newMentioned].every((i) => prevMentioned.has(i));
}

/**
 * 将 Phase 1 遗漏的步骤补成可读 Case（不调用 LLM）
 *
 * @param {Array<Object>} steps - slim 或 full structured step
 * @param {string} title
 * @returns {string}
 */
export function renderSupplementalCaseFromSteps(steps, title) {
  const list = steps || [];
  if (list.length === 0) return '';

  let md = `# 测试用例：${title}\n\n`;
  md += '> 本段由程序根据 Phase 1 结构化步骤自动补全（LLM Case 正文未覆盖这些 index）。\n\n';
  md += '## 1. 业务背景与初始状态\n';
  md += '录制流中上述步骤已发生，但 Phase 2 归纳未写入对应业务描述，此处按 Phase 1 动作与界面响应原样列出供核对。\n\n';
  md += '## 2. 测试步骤流\n\n';

  for (const step of list) {
    const idx = step.index != null ? step.index : '?';
    const action = String(step.description || '').trim() || '(无动作描述)';
    const obs = String(step.uiChange || '').trim() || '无可见变化';
    md += `### [步骤 ${idx}] ${action}\n`;
    md += `- **执行动作**：${action}\n`;
    md += `- **状态验证**：${obs}\n\n`;
  }

  return md.trimEnd();
}

/**
 * 检测本窗 LLM Case 是否遗漏已消费步骤的 index（仅用于日志，不立即插入补全段）
 *
 * @param {string} markdownBlock - LLM 返回的 Case 正文
 * @param {Array<number>} coveredActionIndices - 本窗已消费 index 列表
 * @returns {number[]}
 */
export function findWindowCoverageGaps(markdownBlock, coveredActionIndices) {
  const covered = coveredActionIndices || [];
  if (covered.length === 0) return [];
  const mentioned = extractMentionedStepIndices(markdownBlock);
  return covered.filter((idx) => !mentioned.has(idx));
}

/**
 * Phase 2 全部轮次结束后：对仍未出现在任一 Case 中的步骤追加**一段**程序补全
 * （避免窗内即时补全与下一窗 LLM Case 重复）
 *
 * @param {Array<{ markdownBlock?: string }>} caseBlocks
 * @param {Array<Object>} slimAll - 全部有效 slim 步骤
 * @returns {number[]} 仍被补全的 index 列表
 */
export function appendFinalSupplementalCase(caseBlocks, slimAll) {
  const allMd = (caseBlocks || []).map((c) => c.markdownBlock || '').join('\n\n');
  const mentioned = extractMentionedStepIndices(allMd);
  const missing = (slimAll || [])
    .filter((s) => s.index != null && !mentioned.has(s.index))
    .sort((a, b) => (a.index || 0) - (b.index || 0));

  if (missing.length === 0) return [];

  const title = `未覆盖步骤（程序补全，共 ${missing.length} 步）`;
  const supplemental = renderSupplementalCaseFromSteps(missing, title);
  if (supplemental) {
    caseBlocks.push({ markdownBlock: supplemental });
  }
  return missing.map((s) => s.index);
}

/**
 * 渲染 Phase 1 结构化步骤附录（表格 + 纯文本块）
 *
 * @param {Array<Object>} steps - 完整 structured steps
 * @returns {string}
 */
export function renderPhase1StepsAppendix(steps) {
  const list = steps || [];
  if (list.length === 0) {
    return '## 附录 A：Phase 1 结构化步骤\n\n> 无步骤数据。\n';
  }

  let md =
    '## 附录 A：Phase 1 结构化步骤（核对用；见 `translate/phase1/structured_steps.json`、`.xml`、`llm_raw_batches.xml`）\n\n';
  md += '| index | status | actionKind | 操作（description） | UI 变化（uiChange） | page |\n';
  md += '|------:|--------|------------|-------------------|---------------------|------|\n';

  for (const s of list) {
    const idx = s.index ?? '';
    const status = escapeTableCell(s.status || '');
    const kind = escapeTableCell(s.actionKind || '');
    const desc = escapeTableCell(s.description || '');
    const ui = escapeTableCell(s.uiChange || '');
    const page = escapeTableCell(s.page || '');
    md += `| ${idx} | ${status} | ${kind} | ${desc} | ${ui} | ${page} |\n`;
  }

  md += '\n### Phase 1 逐步纯文本\n\n';
  md += '```text\n';
  md += formatStepsWindowPlainText(list);
  md += '\n```\n';

  return md;
}

/**
 * Case 覆盖核对表：各 index 是否出现在任一 Case 正文
 *
 * @param {Array<Object>} steps
 * @param {string} allCasesMarkdown - 已拼接的 Case 正文（不含附录）
 * @returns {string}
 */
export function renderCaseCoverageAppendix(steps, allCasesMarkdown) {
  const mentioned = extractMentionedStepIndices(allCasesMarkdown);
  const list = (steps || []).filter((s) => s.status === 'normal' || !s.status);

  let md = '## 覆盖表\n\n';
  md += '| index | status | 是否出现在 Case 正文 | 操作摘要 |\n';
  md += '|------:|--------|:--------------------:|----------|\n';

  let missing = 0;
  for (const s of list) {
    const idx = s.index ?? '';
    const ok = mentioned.has(s.index);
    if (!ok && s.status !== 'noise' && s.status !== 'skip') missing += 1;
    const flag = ok ? '是' : '**否**';
    const summary = escapeTableCell(String(s.description || '').slice(0, 60));
    md += `| ${idx} | ${escapeTableCell(s.status || 'normal')} | ${flag} | ${summary} |\n`;
  }

  if (missing > 0) {
    md += `\n> 仍有 **${missing}** 条有效步骤未在 Case 正文中被引用（可能仅出现在附录 A 或程序补全段）。\n`;
  } else {
    md += '\n> 所有有效步骤均在 Case 正文或程序补全段中有对应 index 引用。\n';
  }

  return md;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeTableCell(text) {
  return String(text || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

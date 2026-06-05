/**
 * case-markdown-renderer.js
 *
 * Phase 2：解析 LLM Markdown + case_meta，合并为 AI_cases.md。
 */

import { cleanMarkdownFence } from '../ai-client.js';
import { clampWindowConsume, preprocessLlmXmlOutput } from '../xml-parse-utils.js';

/**
 * 解析 Phase 2 单窗口 Markdown 回复
 *
 * @param {string} rawReply
 * @param {Array<number>} expectedIndices - 当前窗口有序 index 列表
 * @returns {{ markdownBlock: string, consumeStepCount: number, rawConsume: number|null, clampReason: string|null, coveredActionIndices: number[] }}
 */
export function parsePhase2MarkdownResponse(rawReply, expectedIndices) {
  const { text: cleaned } = preprocessLlmXmlOutput(cleanMarkdownFence(String(rawReply || '')));

  const metaPat = /<case_meta[^>]*\bconsumeStepCount\s*=\s*["']?(\d+)["']?[^>]*\/?>/i;
  const metaMatch = cleaned.match(metaPat);

  let rawConsume = null;
  if (metaMatch) {
    rawConsume = parseInt(metaMatch[1], 10);
  }

  let rawLastIndex = null;
  const lastIndexPat = /\blastIndex\s*=\s*["']?(\d+)["']?/i;
  const lastIndexInMeta = metaMatch ? metaMatch[0].match(lastIndexPat) : cleaned.match(lastIndexPat);
  if (lastIndexInMeta) {
    rawLastIndex = parseInt(lastIndexInMeta[1], 10);
  }

  let markdownBlock = cleaned.replace(metaPat, '').trim();
  if (!markdownBlock) {
    markdownBlock = '# 测试用例：未命名用例\n\n（模型未返回 Markdown 正文）';
  }

  const indices = expectedIndices || [];
  const winLen = indices.length;
  let { safeConsume, rawConsume: rawVal, clampReason } = clampWindowConsume(
    rawConsume,
    winLen,
  );

  if (Number.isInteger(rawLastIndex) && rawLastIndex > 0 && winLen > 0) {
    const pos = indices.indexOf(rawLastIndex);
    if (pos >= 0) {
      const anchoredConsume = pos + 1;
      const tailAtConsume = indices[safeConsume - 1];
      if (tailAtConsume !== rawLastIndex) {
        safeConsume = anchoredConsume;
        const detail = `consume/lastIndex 不一致: consume→index ${tailAtConsume ?? '?'}, lastIndex=${rawLastIndex}, 已按 lastIndex 锚定为 ${anchoredConsume} 步`;
        clampReason = clampReason ? `${clampReason}; ${detail}` : detail;
      }
    }
  }

  const coveredActionIndices = indices.slice(0, safeConsume);

  return {
    markdownBlock,
    consumeStepCount: safeConsume,
    rawConsume: rawVal,
    clampReason,
    coveredActionIndices,
  };
}

/**
 * 将多个 Case Markdown 块合并为 AI_cases.md
 *
 * @param {Array<{ markdownBlock?: string, title?: string, summary?: string, rows?: Array<{ order: number, operation: string, uiChange: string }> }>} cases
 * @param {Object} [options]
 * @param {string} [options.documentTitle]
 * @returns {string}
 */
export function renderCasesMarkdownDocument(cases, options = {}) {
  const list = cases || [];
  const documentTitle = String(options.documentTitle || '录制流程测试用例归纳').trim();

  let md = `# ${documentTitle}\n\n`;
  if (list.length === 0) {
    md += '> 无有效步骤（均为 noise/skip/fallback 等），未生成 Case。\n';
  } else {
    list.forEach((c, i) => {
      if (c.markdownBlock) {
        if (i > 0) md += '\n\n---\n\n';
        md += String(c.markdownBlock).trim();
        return;
      }

      const caseNo = i + 1;
      md += `## Case ${caseNo}: ${c.title || '未命名用例'}\n`;
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
  }

  return md.trimEnd() + '\n';
}

/**
 * Markdown 表格单元格转义
 *
 * @param {string} text
 * @returns {string}
 */
function escapeTableCell(text) {
  return String(text || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

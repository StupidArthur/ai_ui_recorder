/**
 * step-structured.js - Phase 1 微批处理 Prompt 入口
 *
 * Prompt 正文：prompts/md/phase1-structured-*.md
 * 输出 JSON 契约已合并进 phase1-structured-system.md 的 Output Format 章节。
 */

import { loadPromptMd } from './loader.js';

/**
 * 构建 Phase 1 批处理 System Prompt
 *
 * @returns {string}
 */
export function buildSystemPrompt() {
  return loadPromptMd('phase1-structured-system.md');
}

/**
 * 构建 Phase 1 批次 JSON 修复 System Prompt
 *
 * @returns {string}
 */
export function buildBatchRepairSystemPrompt() {
  return loadPromptMd('phase1-batch-repair-system.md');
}

/**
 * 构建 Phase 1 批次 JSON 修复 User Prompt
 *
 * @param {string} rawReply - LLM 原始输出
 * @returns {string}
 */
export function buildBatchRepairUserPrompt(rawReply) {
  return loadPromptMd('phase1-batch-repair-user.md', {
    rawReply: String(rawReply || '').slice(0, 8000),
  });
}

/**
 * 构建 Phase 1 批处理 User Prompt
 *
 * @param {Array<Object>} enrichedActionsBatch - 富化后的动作数组
 * @param {Array<Object>} recentSteps - 之前的历史解析结果
 * @returns {string}
 */
export function buildUserPrompt(enrichedActionsBatch, recentSteps) {
  let contextHistory;
  if (recentSteps && recentSteps.length > 0) {
    contextHistory = recentSteps
      .slice(-3)
      .map((s) => `[Index ${s.index}] ${s.description} -> 变化: ${s.uiChange}`)
      .join('\n');
  } else {
    contextHistory = '(无历史上下文，这是起始操作)';
  }

  const actionBlocks = enrichedActionsBatch
    .map((action, i) => {
      const header = `=============【动作 Index: ${action.index} (第 ${i + 1}/${enrichedActionsBatch.length} 个)】=============`;
      const body = JSON.stringify(
        {
          type: action.type,
          timestamp: action.timestamp,
          element: action.element,
          localContext: action.localContext,
          formStateDelta: action.formStateDelta,
          snapshotDiff: action.snapshotDiff,
        },
        null,
        2,
      );
      return `${header}\n${body}\n`;
    })
    .join('\n');

  return loadPromptMd('phase1-structured-user.md', {
    contextHistory,
    actionCount: enrichedActionsBatch.length,
    actionBlocks,
  });
}

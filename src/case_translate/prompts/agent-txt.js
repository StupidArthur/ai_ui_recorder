/**
 * agent-txt.js - Phase 4 Agent TXT Prompt 入口
 *
 * Prompt 正文：prompts/md/phase4-agent-txt-*.md
 * 输出 JSON 契约已合并进 phase4-agent-txt-system.md 的 Output Format 章节。
 */

import { loadPromptMd } from './loader.js';

/**
 * 构建 Phase 4 Agent TXT 的 System Prompt
 *
 * @returns {string}
 */
export function buildAgentTxtSystemPrompt() {
  return loadPromptMd('phase4-agent-txt-system.md');
}

/**
 * 构建 Phase 4 Agent TXT 的 User Prompt
 *
 * @param {string} stepsJson - 结构化步骤的 JSON 字符串
 * @returns {string}
 */
export function buildAgentTxtUserPrompt(stepsJson) {
  return loadPromptMd('phase4-agent-txt-user.md', { stepsJson });
}

/**
 * 构建 Phase 4 JSON 修复 System Prompt
 *
 * @returns {string}
 */
export function buildAgentTxtRepairSystemPrompt() {
  return loadPromptMd('phase4-agent-txt-repair-system.md');
}

/**
 * 构建 Phase 4 JSON 修复 User Prompt
 *
 * @param {string} rawReply - LLM 原始输出
 * @returns {string}
 */
export function buildAgentTxtRepairUserPrompt(rawReply) {
  return loadPromptMd('phase4-agent-txt-repair-user.md', {
    rawReply: String(rawReply || '').slice(0, 6000),
  });
}

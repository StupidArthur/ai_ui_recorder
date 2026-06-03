/**
 * agent-txt.js - Phase 4 Agent TXT Prompt 入口
 *
 * Skill：prompts/md/case-4-agents-skill.md
 * User：本文件内嵌（动态数据拼接）
 */

import { loadPromptMd } from './loader.js';

/**
 * 构建 Phase 4 Agent TXT 的 System Prompt
 *
 * @returns {string}
 */
export function buildAgentTxtSystemPrompt() {
  return loadPromptMd('case-4-agents-skill.md');
}

/**
 * 构建 Phase 4 Agent TXT 的 User Prompt
 *
 * @param {string} stepsJson - 结构化步骤的 JSON 字符串
 * @returns {string}
 */
export function buildAgentTxtUserPrompt(stepsJson) {
  return `请根据以下按时间顺序排列的结构化步骤数据，进行业务逻辑聚合：

${stepsJson}`;
}

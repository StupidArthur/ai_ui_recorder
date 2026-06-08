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
 * 构建 Phase 4 Agent TXT 的 User Prompt（纯文本步骤流）
 *
 * @param {string} stepsPlainText - 本窗步骤纯文本
 * @returns {string}
 */
export function buildAgentTxtUserPrompt(stepsPlainText) {
  return `请根据以下按时间顺序排列的底层步骤记录（纯文本），进行业务逻辑聚合并输出 <agent_chunk> XML：

${stepsPlainText}`;
}

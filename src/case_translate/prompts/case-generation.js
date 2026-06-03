/**
 * case-generation.js - Phase 2 固定窗口 Case 归纳 Prompt 入口
 *
 * Skill：prompts/md/steps-2-cases-skill.md
 * User：本文件内嵌（动态数据拼接）
 */

import { loadPromptMd } from './loader.js';

/**
 * 构建 Phase 2 单窗口 System Prompt
 *
 * @returns {string}
 */
export function buildPhase2WindowSystemPrompt() {
  return loadPromptMd('steps-2-cases-skill.md');
}

/**
 * 构建 Phase 2 单窗口 User Prompt
 *
 * @param {string} windowStepsJson - 当前窗口瘦身步骤的 JSON 字符串
 * @param {string} indexListText - 本窗口 index 列表
 * @returns {string}
 */
export function buildPhase2WindowUserPrompt(windowStepsJson, indexListText) {
  return `本窗口瘦身步骤（JSON 数组）：
${windowStepsJson}

本窗口可用 index 列表（必须从这里取前缀连续子数组）：${indexListText}

请归纳成 1 个 Case，并只输出符合 system 要求的 JSON 对象。`;
}

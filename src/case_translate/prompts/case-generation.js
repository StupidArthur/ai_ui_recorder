/**
 * case-generation.js - Phase 2 固定窗口 Case 归纳 Prompt 入口
 *
 * Prompt 正文：prompts/md/phase2-case-window-*.md
 */

import { loadPromptMd } from './loader.js';

/**
 * 构建 Phase 2 单窗口 System Prompt
 *
 * @returns {string}
 */
export function buildPhase2WindowSystemPrompt() {
  return loadPromptMd('phase2-case-window-system.md');
}

/**
 * 构建 Phase 2 单窗口 User Prompt
 *
 * @param {string} windowStepsJson - 当前窗口瘦身步骤的 JSON 字符串
 * @param {string} indexListText - 本窗口 index 列表
 * @returns {string}
 */
export function buildPhase2WindowUserPrompt(windowStepsJson, indexListText) {
  return loadPromptMd('phase2-case-window-user.md', {
    windowStepsJson,
    indexListText,
  });
}

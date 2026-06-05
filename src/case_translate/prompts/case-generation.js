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
 * 构建 Phase 2 单窗口 User Prompt（纯文本步骤流）
 *
 * @param {string} windowStepsPlainText - 当前窗口步骤纯文本
 * @param {string} indexListText - 本窗口 index 列表 JSON 字符串
 * @returns {string}
 */
export function buildPhase2WindowUserPrompt(windowStepsPlainText, indexListText) {
  return `本窗口底层步骤记录（纯文本）：

${windowStepsPlainText}

本窗口可用 index 列表（consumeStepCount 对应前缀连续子集，从这里取）：${indexListText}

请归纳成 1 个 Case，输出 Markdown 正文，最后一行输出 <case_meta consumeStepCount="N" lastIndex="..."/>。禁止 JSON。`;
}

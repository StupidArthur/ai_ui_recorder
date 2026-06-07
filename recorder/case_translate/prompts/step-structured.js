/**
 * step-structured.js - Phase 1 微批处理 Prompt 入口
 *
 * Skill：prompts/md/snapshots-2-steps-skill.md
 * User：本文件内嵌（动态数据拼接）
 */

import { loadPromptMd } from './loader.js';

/**
 * 构建 Phase 1 批处理 System Prompt
 *
 * @returns {string}
 */
export function buildSystemPrompt() {
  return loadPromptMd('snapshots-2-steps-skill.md');
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

  const actionCount = enrichedActionsBatch.length;
  const actionBlocks = enrichedActionsBatch
    .map((action, i) => {
      const header = `=============【动作 Index: ${action.index} (第 ${i + 1}/${actionCount} 个)】=============`;
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

  return `【历史上下文参考】
以下是发生在本次批处理之前的最近几次动作解析结果，仅供你理解上下文逻辑，**不需要**在你的输出中包含它们：
${contextHistory}

【本次需要解析的动作数组】
注意：以下共有 ${actionCount} 个动作。你必须输出 ${actionCount} 个解析结果。

${actionBlocks}
请立即开始解析，并严格按照 System Prompt 的 Output Format 仅输出 XML，不要输出任何其他解释性文本。`;
}

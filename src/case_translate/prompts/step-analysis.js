/**
 * step-analysis.js - Phase 1 逐条操作分析 Prompt 入口（遗留，当前 workflow 未引用）
 *
 * Prompt 正文：prompts/md/phase1-step-analysis-*.md
 */

import { loadPromptMd } from './loader.js';

/**
 * 构建 Phase 1 的 System Prompt（逐条操作分析）
 *
 * @returns {string}
 */
export function buildSystemPrompt() {
  return loadPromptMd('phase1-step-analysis-system.md');
}

/**
 * 组装单条操作的证据正文（动态数据，非静态 Prompt 文本）
 *
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @param {Array<string>} recentSteps
 * @returns {string}
 */
function buildEvidenceBody(enrichedAction, actionIndex, recentSteps) {
  const parts = [];

  if (enrichedAction.classification && enrichedAction.classification.hints.length > 0) {
    parts.push(`## 💡 AI 分析提示`);
    parts.push(
      `操作分类: ${enrichedAction.classification.category} (${enrichedAction.classification.elementType})`,
    );
    for (const hint of enrichedAction.classification.hints) {
      parts.push(`- ${hint}`);
    }
    parts.push('');
  }

  const snapshotDiff = enrichedAction.snapshotDiff || '（diff 不可用）';
  parts.push(`## ★ Snapshot Diff（操作前后差异，最关键信息）`);
  parts.push(`\`-\` 表示操作前有但操作后消失，\`+\` 表示操作后新增：`);
  parts.push(`\`\`\`diff\n${snapshotDiff}\n\`\`\`\n`);

  if (enrichedAction.formStateChangeText) {
    parts.push(`## ★ 表单状态变化（两次操作之间）`);
    parts.push(`\`\`\`\n${enrichedAction.formStateChangeText}\n\`\`\`\n`);
  }

  if (enrichedAction.contextExcerpt) {
    parts.push(`## ★ 上下文片段（操作元素附近的 UI 结构）`);
    parts.push(`\`\`\`\n${enrichedAction.contextExcerpt}\n\`\`\`\n`);
  }

  if (enrichedAction.type === 'input' && enrichedAction.inputValue) {
    parts.push(`## ★ 输入识别（语义归并）`);
    parts.push(`操作类型已从 click 识别为 **文本输入**。`);
    parts.push(
      `- 目标元素: ${enrichedAction.element?.tag || 'unknown'}${enrichedAction.element?.id ? ' #' + enrichedAction.element.id : ''}`,
    );
    parts.push(`- 输入值: \`${enrichedAction.inputValue}\``);
    if (enrichedAction.inputValue === '[MASKED]') {
      parts.push(`- 说明: 该字段为密码类型，原始值已脱敏`);
    }
    parts.push('');
  }

  const actionInfo = {
    type: enrichedAction.type,
    originalType: enrichedAction.originalType || undefined,
    inputValue: enrichedAction.inputValue || undefined,
    element: enrichedAction.element,
    position: enrichedAction.position,
    key: enrichedAction.key,
    url: enrichedAction.url,
    title: enrichedAction.title,
    timestamp: enrichedAction.timestamp,
  };
  parts.push(`## 操作基础信息`);
  parts.push(`\`\`\`json\n${JSON.stringify(actionInfo, null, 2)}\n\`\`\`\n`);

  if (enrichedAction.formStateDelta && Object.keys(enrichedAction.formStateDelta).length > 0) {
    parts.push(`## 操作前精确表单状态（formStateDelta）`);
    parts.push(`\`\`\`json\n${JSON.stringify(enrichedAction.formStateDelta, null, 2)}\n\`\`\`\n`);
  }

  if (enrichedAction.preSnapshot) {
    parts.push(`## preSnapshot（操作前完整页面状态，供参考）`);
    parts.push(`\`\`\`\n${enrichedAction.preSnapshot}\n\`\`\`\n`);
  }

  if (enrichedAction.postSnapshot) {
    parts.push(`## postSnapshot（操作后完整页面状态，供参考）`);
    parts.push(`\`\`\`\n${enrichedAction.postSnapshot}\n\`\`\`\n`);
  }

  if (recentSteps.length > 0) {
    parts.push(`## 最近操作上下文（最近 ${recentSteps.length} 条步骤描述）`);
    recentSteps.forEach((step, i) => {
      parts.push(`### 操作 ${actionIndex - recentSteps.length + i}\n${step}\n`);
    });
  }

  return parts.join('\n');
}

/**
 * 构建 Phase 1 的 User Prompt（单条操作分析）
 *
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @param {Array<string>} [recentSteps]
 * @returns {string}
 */
export function buildUserPrompt(enrichedAction, actionIndex, recentSteps = []) {
  return loadPromptMd('phase1-step-analysis-user.md', {
    actionIndex,
    evidenceBody: buildEvidenceBody(enrichedAction, actionIndex, recentSteps),
  });
}

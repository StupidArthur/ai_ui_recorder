/**
 * step-analysis.js - Phase 1 提示词模板：逐条操作分析
 *
 * 为 AI 翻译流水线的第 1 阶段构建 System Prompt 和 User Prompt。
 * AI 任务：分析单条用户操作，输出自然语言描述 + 依据 + UI 变化。
 *
 * 数据优先级（由 System Prompt 规定）：
 *   Diff > FormStateDelta > ContextExcerpt > 完整快照
 *
 * 使用方式：
 *   import { buildSystemPrompt, buildUserPrompt } from './step-analysis.js';
 *   const messages = [
 *     { role: 'system', content: buildSystemPrompt() },
 *     { role: 'user', content: buildUserPrompt(enrichedAction, actionIndex, recentSteps) },
 *   ];
 */

// ==================== System Prompt ====================

/**
 * 构建 Phase 1 的 System Prompt（逐条操作分析）
 *
 * @returns {string} system prompt 文本
 */
export function buildSystemPrompt() {
  return `你是资深测试工程师，擅长阅读自动化录制的操作日志，将其翻译为人类可读的操作描述。

# 你的任务
分析一条用户操作记录，输出：
1. 操作的自然语言描述（中文）
2. 你做出该描述的依据（引用具体字段和快照差异）
3. 该操作引起的 UI 变化（不是"预期结果"，而是实际观察到的变化）

# 输入数据说明

你会收到以下信息（按重要性排序）：
- **★ Snapshot Diff**: 预计算好的 preSnapshot → postSnapshot 行级差异（最关键信息）
- **★ formStateDelta 变化**: 两次操作之间表单元素的精确值变化（可选）
- **★ 上下文片段**: 被操作元素在快照中的局部上下文（可选）
- **AI 分析提示**: 程序根据操作类型生成的分析建议（可选）
- **action**: 用户操作的基础信息（type、element、position、url、title、timestamp）
- **preSnapshot / postSnapshot**: 操作前后的整页无障碍树快照（参考）
- **recentContext**: 最近几条已生成的步骤描述（帮助理解操作连续性）

## 快照格式说明
快照是 Playwright accessibility.snapshot() 的精简输出，YAML 风格缩进，例如：
\`\`\`
- WebArea "首页"
  - navigation "主导航"
    - link "首页"
    - link "关于" [selected]
  - button "登录"
\`\`\`
每行格式：\`- role "name" [attributes]\`
缩进表示父子层级关系。
属性包括 checked/unchecked, expanded/collapsed, disabled, value="..." 等。

# 核心规则（必须遵守）

## 规则一：数据优先级
- **Diff** 最重要：它直接展示了操作造成的 UI 变化
- **formStateDelta 变化** 次之：它提供精确的表单输入内容
- **上下文片段** 第三：它帮助定位操作的 UI 区域
- 完整快照仅作为补充参考

## 规则二：基于 Snapshot Diff 分析
- \`-\` 开头的行：操作前有但操作后消失
- \`+\` 开头的行：操作后新增
- 请首先、重点阅读 Diff，再结合 action.element 定位被操作的控件
- 如果 Diff 显示"完全相同"，说明操作没有引起可见 UI 变化，请如实描述

## 规则三：识别输入操作
- 如果操作类型为 "input"（由语义归并识别），则 inputValue 字段是用户在该输入框中输入的精确文本
- 对 input 类型操作，请以 inputValue 为准描述输入内容，格式示例："在用户名输入框中输入 '15700078644'"
- 如果 inputValue 为 "[MASKED]"，说明是密码字段，描述为"在密码输入框中输入密码（已脱敏）"
- 如果提供了 formStateDelta 变化，以其中的精确值为准描述输入内容
- 特别是 [变化] 标记的字段，表示用户在两次操作之间修改了该表单元素

## 规则四：严禁猜测
- 你的每一句描述都必须有操作记录或快照中的明确依据
- 如果信息不足以判断操作的具体含义，你必须如实说明
- 绝对不允许根据 class 名、xpath 路径去推测业务含义

## 规则五：描述 UI 变化而非预期结果
- "UI 变化" = 你从 diff 中实际观察到的变化
- 不要写"预期xx会发生"，而要写"diff 显示 xx 发生了"
- 如果 diff 为空，明确写"UI 无可见变化"

## 规则六：输出格式（严格遵守）
\`\`\`
- **描述**：<自然语言操作描述>
- **依据**：
  - <字段/快照差异说明>
  - <字段/快照差异说明>
  - ...
- **UI 变化**：<实际观察到的 UI 变化>
- **页面**：<操作发生时的页面标题>
\`\`\`

注意：直接输出上面的格式，不要额外包裹 markdown 代码块。`;
}

// ==================== User Prompt ====================

/**
 * 构建 Phase 1 的 User Prompt（单条操作分析）
 *
 * @param {Object} enrichedAction - 富化后的 action 数据（preprocessor 输出）
 * @param {number} actionIndex - 操作序号（1-based）
 * @param {Array<string>} recentSteps - 最近 N 条已生成的步骤描述文本（滑动窗口）
 * @returns {string} user prompt 文本
 */
export function buildUserPrompt(enrichedAction, actionIndex, recentSteps = []) {
  const parts = [];

  parts.push(`请分析以下第 ${actionIndex} 条操作：\n`);

  // ---- AI 分析提示（如果有） ----
  if (enrichedAction.classification && enrichedAction.classification.hints.length > 0) {
    parts.push(`## 💡 AI 分析提示`);
    parts.push(`操作分类: ${enrichedAction.classification.category} (${enrichedAction.classification.elementType})`);
    for (const hint of enrichedAction.classification.hints) {
      parts.push(`- ${hint}`);
    }
    parts.push('');
  }

  // ---- Snapshot Diff（最重要） ----
  const snapshotDiff = enrichedAction.snapshotDiff || '（diff 不可用）';
  parts.push(`## ★ Snapshot Diff（操作前后差异，最关键信息）`);
  parts.push(`\`-\` 表示操作前有但操作后消失，\`+\` 表示操作后新增：`);
  parts.push(`\`\`\`diff\n${snapshotDiff}\n\`\`\`\n`);

  // ---- formStateDelta 变化 ----
  if (enrichedAction.formStateChangeText) {
    parts.push(`## ★ 表单状态变化（两次操作之间）`);
    parts.push(`\`\`\`\n${enrichedAction.formStateChangeText}\n\`\`\`\n`);
  }

  // ---- 上下文片段 ----
  if (enrichedAction.contextExcerpt) {
    parts.push(`## ★ 上下文片段（操作元素附近的 UI 结构）`);
    parts.push(`\`\`\`\n${enrichedAction.contextExcerpt}\n\`\`\`\n`);
  }

  // ---- 输入识别信息（语义归并后新增，高优先级） ----
  if (enrichedAction.type === 'input' && enrichedAction.inputValue) {
    parts.push(`## ★ 输入识别（语义归并）`);
    parts.push(`操作类型已从 click 识别为 **文本输入**。`);
    parts.push(`- 目标元素: ${enrichedAction.element?.tag || 'unknown'}${enrichedAction.element?.id ? ' #' + enrichedAction.element.id : ''}`);
    parts.push(`- 输入值: \`${enrichedAction.inputValue}\``);
    if (enrichedAction.inputValue === '[MASKED]') {
      parts.push(`- 说明: 该字段为密码类型，原始值已脱敏`);
    }
    parts.push('');
  }

  // ---- 操作基础信息 ----
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

  // ---- 当前 formStateDelta（操作瞬间的完整表单快照） ----
  if (enrichedAction.formStateDelta && Object.keys(enrichedAction.formStateDelta).length > 0) {
    parts.push(`## 操作前精确表单状态（formStateDelta）`);
    parts.push(`\`\`\`json\n${JSON.stringify(enrichedAction.formStateDelta, null, 2)}\n\`\`\`\n`);
  }

  // ---- 完整快照（作为参考） ----
  if (enrichedAction.preSnapshot) {
    parts.push(`## preSnapshot（操作前完整页面状态，供参考）`);
    parts.push(`\`\`\`\n${enrichedAction.preSnapshot}\n\`\`\`\n`);
  }

  if (enrichedAction.postSnapshot) {
    parts.push(`## postSnapshot（操作后完整页面状态，供参考）`);
    parts.push(`\`\`\`\n${enrichedAction.postSnapshot}\n\`\`\`\n`);
  }

  // ---- 滑动窗口上下文 ----
  if (recentSteps.length > 0) {
    parts.push(`## 最近操作上下文（最近 ${recentSteps.length} 条步骤描述）`);
    recentSteps.forEach((step, i) => {
      parts.push(`### 操作 ${actionIndex - recentSteps.length + i}\n${step}\n`);
    });
  }

  parts.push(`请严格按照 system prompt 中的规则和格式输出。没有依据的信息不要编造。`);

  return parts.join('\n');
}

/**
 * step-structured.js - Phase 1 提示词模板：逐条操作结构化分析
 *
 * 目标：
 * - 让模型直接输出严格 JSON（单条对象）
 * - 为后续 Midscene YAML 转换提供稳定结构
 */

/**
 * 构建结构化 Step 的 System Prompt
 *
 * @returns {string}
 */
export function buildSystemPrompt() {
  return `你是资深测试工程师。请基于给定操作证据，输出“单条 JSON 对象”，不得输出任何额外文本。

必须遵守：
1) 只输出 JSON 对象，不要 markdown 代码块，不要解释文字。
2) 字段必须完整，缺失信息用空字符串或空数组，不允许省略必填字段。
3) 所有结论必须基于输入证据，禁止猜测业务语义。

输出 JSON Schema（必须严格匹配）：
{
  "description": "string, 本条操作的简洁描述",
  "uiChange": "string, 实际观察到的UI变化；无变化写'无可见变化'",
  "page": "string, 页面标题",
  "basis": ["string", "string"],
  "actionKind": "click|doubleClick|rightClick|keyPress|input|assert|other",
  "target": "string, 操作对象简述",
  "inputText": "string, 输入值；无则空字符串",
  "key": "string, 按键名；无则空字符串",
  "assertText": "string, 可直接用于断言的文本；不适用则空字符串",
  "confidence": 0.0,
  "sourceActionIndices": "可选：正整数数组；仅当本条描述需对应多条连续 enriched 操作（同一注释下多行 Selenium）时填写；一般省略"
}

补充规则：
- confidence 取值 [0,1]。
- 若输入值为 [MASKED]，description 需标注“密码（已脱敏）”。
- basis 至少给 1 条，尽量引用 diff/formState/context 的事实。`;
}

/**
 * 构建结构化 Step 的 User Prompt
 *
 * @param {Object} enrichedAction
 * @param {number} actionIndex
 * @param {Array<Object>} recentSteps
 * @returns {string}
 */
export function buildUserPrompt(enrichedAction, actionIndex, recentSteps = []) {
  const actionInfo = {
    index: actionIndex,
    type: enrichedAction.type,
    originalType: enrichedAction.originalType || undefined,
    inputValue: enrichedAction.inputValue || undefined,
    element: enrichedAction.element,
    key: enrichedAction.key,
    url: enrichedAction.url,
    title: enrichedAction.title,
    timestamp: enrichedAction.timestamp,
    classification: enrichedAction.classification || undefined,
  };

  const recentContext = recentSteps.slice(-5).map((s) => ({
    index: s.index,
    description: s.description,
    actionKind: s.actionKind,
    page: s.page,
  }));

  return `请分析第 ${actionIndex} 条操作并输出严格 JSON。

【最重要证据：Snapshot Diff】
\`\`\`diff
${enrichedAction.snapshotDiff || '（diff 不可用）'}
\`\`\`

【表单状态变化】
\`\`\`
${enrichedAction.formStateChangeText || '（无）'}
\`\`\`

【上下文片段】
\`\`\`
${enrichedAction.contextExcerpt || '（无）'}
\`\`\`

【操作基础信息】
\`\`\`json
${JSON.stringify(actionInfo, null, 2)}
\`\`\`

【最近上下文（可选）】
\`\`\`json
${JSON.stringify(recentContext, null, 2)}
\`\`\``;
}


/**
 * step-structured.js - Phase 1 微批处理 (Micro-Batching) 专用 Prompt 与 Schema 模块
 *
 * 核心目标：确保 N个动作输入，必定得到 N条结构化解析输出，严禁遗漏与合并。
 */

// ==================== JSON Schema (强约束) ====================

/**
 * Phase 1 批处理输出的 JSON Schema
 * 强制要求模型输出包裹在 parsedSteps 数组中，且每一项必须带上输入时的 index
 */
export const stepStructuredBatchSchema = {
  type: 'object',
  properties: {
    parsedSteps: {
      type: 'array',
      description:
        '解析后的 UI 动作数组。必须与输入的动作数组一一对应，数量完全一致。',
      items: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description:
              '必须与输入数据的 index 严格保持一致，这是对齐的唯一标识',
          },
          description: {
            type: 'string',
            description:
              "一句话描述该动作（例如：点击了左侧的'系统设置'菜单）",
          },
          actionKind: {
            type: 'string',
            enum: [
              'click',
              'doubleClick',
              'rightClick',
              'keyPress',
              'input',
              'assert',
              'sleep',
              'other',
            ],
            description: '动作类型归类',
          },
          target: {
            type: 'string',
            description:
              "动作的直接作用对象名称或标识（例如：'提交按钮'，'用户名输入框'）",
          },
          uiChange: {
            type: 'string',
            description:
              "动作发生后，UI 产生了什么具体变化（例如：'弹出了确认对话框'，'无可见变化'）",
          },
          page: {
            type: 'string',
            description: '当前发生操作的页面名称或区域',
          },
          basis: {
            type: 'array',
            items: { type: 'string' },
            description:
              '你得出以上结论的证据来源（如：DOM Diff中新增了某节点，Input增量显示输入了xxx）',
          },
          inputText: {
            type: 'string',
            description: '如果是输入操作，输入了什么内容？若无则留空',
          },
          key: {
            type: 'string',
            description: '如果是按键操作，按下了什么键？若无则留空',
          },
          assertText: {
            type: 'string',
            description: '预留断言字段，默认留空',
          },
          confidence: {
            type: 'number',
            description: '你对这条翻译的置信度 (0.0 到 1.0)',
          },
        },
        required: [
          'index',
          'description',
          'actionKind',
          'target',
          'uiChange',
          'page',
          'basis',
          'confidence',
        ],
      },
    },
  },
  required: ['parsedSteps'],
};

// ==================== Prompt 构建 (强契约) ====================

/**
 * 构建 Phase 1 批处理 System Prompt
 */
export function buildSystemPrompt() {
  return `你是一个资深的 Web UI 自动化测试数据分析专家。
你的任务是将一份包含【多个底层浏览器物理动作】的 JSON 数组，精确翻译为人类可读的结构化测试步骤。

【核心执行红线：N进N出，严禁丢步】
1. **严格的一一对应**：你将收到一个包含 N 个动作的数组。你必须输出一个包含严格 N 个对象的 JSON 数组。
2. **严禁合并**：即使两个动作看起来逻辑连贯（例如：先点击输入框，再敲击回车），你也**绝对不能**把它们合并成一条。每一个输入的 \`index\` 都必须在输出中有一条对应的独立解析。
3. **基于硬证据**：你的翻译必须建立在 \`snapshotDiff\`（操作前后 DOM 的差异）、\`localContext\`（目标元素周边源码）和表单增量之上，不能瞎猜。

【输出要求】
你必须返回符合提供的 JSON Schema 的数据结构，将结果放入 \`parsedSteps\` 数组中。
切记：在输出的每个对象中，必须正确填写 \`index\`，使其与你正在解析的输入动作的 \`index\` 一模一样。`;
}

/**
 * 构建 Phase 1 批处理 User Prompt
 *
 * @param {Array<Object>} enrichedActionsBatch - 富化后的动作数组 (如 3~5 条)
 * @param {Array<Object>} recentSteps - 之前的历史解析结果 (作为上下文)
 * @returns {string}
 */
export function buildUserPrompt(enrichedActionsBatch, recentSteps) {
  let promptText = `【历史上下文参考】\n`;
  promptText += `以下是发生在本次批处理之前的最近几次动作解析结果，仅供你理解上下文逻辑，**不需要**在你的输出中包含它们：\n`;

  if (recentSteps && recentSteps.length > 0) {
    const contextSteps = recentSteps
      .slice(-3)
      .map((s) => `[Index ${s.index}] ${s.description} -> 变化: ${s.uiChange}`);
    promptText += contextSteps.join('\n') + `\n\n`;
  } else {
    promptText += `(无历史上下文，这是起始操作)\n\n`;
  }

  promptText += `【本次需要解析的动作数组】\n`;
  promptText += `注意：以下共有 ${enrichedActionsBatch.length} 个动作。你必须输出 ${enrichedActionsBatch.length} 个解析结果。\n\n`;

  // 强化视觉隔离：把每个动作包装在明显的边界内，防止模型眼花
  enrichedActionsBatch.forEach((action, i) => {
    promptText += `=============【动作 Index: ${action.index} (第 ${i + 1}/${enrichedActionsBatch.length} 个)】=============\n`;
    promptText +=
      JSON.stringify(
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
      ) + `\n\n`;
  });

  promptText += `请立即开始解析，并严格按照 Schema 输出 JSON 对象。`;

  return promptText;
}

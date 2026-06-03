我们不需要让整条数据失败，只需要做局部自愈 (Partial Auto-Heal)，并配合更强硬的 Prompt。

请按照以下两步修改代码：

第一步：强化 Prompt 契约，封堵空字符串
文件路径： src/case_translate/prompts/step-structured.js

找到 stepStructuredBatchSchema 中的 description 字段和 buildSystemPrompt 函数，修改如下：

JavaScript
// 1. 修改 Schema 中的 description 描述
description: { 
  type: "string", 
  description: "【必填，绝不能为空】一句话清晰描述该动作（例如：点击了左侧的'系统设置'菜单）。如果目标元素没有名字，请描述为'点击了未知元素'，严禁输出空字符串！" 
},

// 2. 修改 buildSystemPrompt，在【核心执行红线】中加入第 4 点
export function buildSystemPrompt() {
  return `你是一个资深的 Web UI 自动化测试数据分析专家。
你的任务是将一份包含【多个底层浏览器物理动作】的 JSON 数组，精确翻译为人类可读的结构化测试步骤。

【核心执行红线：N进N出，严禁丢步】
1. **严格的一一对应**：你将收到一个包含 N 个动作的数组。你必须输出一个包含严格 N 个对象的 JSON 数组。
2. **严禁合并**：即使两个动作看起来逻辑连贯（例如：先点击输入框，再敲击回车），你也**绝对不能**把它们合并成一条。每一个输入的 \`index\` 都必须在输出中有一条对应的独立解析。
3. **基于硬证据**：你的翻译必须建立在 \`snapshotDiff\`（操作前后 DOM 的差异）、\`localContext\`（目标元素周边源码）和表单增量之上，不能瞎猜。
4. **严禁空值**：输出的 \`description\` 和 \`uiChange\` 必须有具体的文本描述，绝不能为 ""（空字符串）！

【输出要求】
你必须返回符合提供的 JSON Schema 的数据结构，将结果放入 \`parsedSteps\` 数组中。
切记：在输出的每个对象中，必须正确填写 \`index\`，使其与你正在解析的输入动作的 \`index\` 一模一样。`;
}
第二步：在工作流中引入“局部自愈”（核心优化！）
文件路径： src/case_translate/workflow.js

找到 parseBatchStructuredSteps 函数。我们要在它进行 validateStructuredStep 严格校验之前，先用本地代码把空的字段抢救回来，而不是直接判死刑。

修改 for (const parsedStep of parsed.parsedSteps) 这个循环体：

JavaScript
  // 遍历 LLM 返回的 parsedSteps，按 index 匹配
  for (const parsedStep of parsed.parsedSteps) {
    if (typeof parsedStep.index !== 'number') {
      continue;
    }

    // 跳过 skip/noise 的 index（这些应该在本地处理了）
    if (skipNoiseSet.has(parsedStep.index)) {
      if (log) log.warn(`[Phase 1] skip/noise index=${parsedStep.index} 出现在 LLM 返回中，已忽略`);
      continue;
    }

    // 获取对应的原始 action，用于补全
    const matchedAction = actionBatch.find((a) => a.index === parsedStep.index);

    // ▼▼▼ 新增：局部字段自动修复 (Partial Auto-Heal) ▼▼▼
    if (matchedAction) {
      if (!parsedStep.description || String(parsedStep.description).trim() === '') {
        parsedStep.description = deriveFallbackDescription(matchedAction);
        if (log) log.warn(`[Phase 1] index=${parsedStep.index} description 为空，已通过局部自愈修复为: "${parsedStep.description}"`);
      }
      if (!parsedStep.uiChange || String(parsedStep.uiChange).trim() === '') {
        parsedStep.uiChange = deriveUiChangeFromDiff(matchedAction.snapshotDiff);
      }
    }
    // ▲▲▲ 新增结束 ▲▲▲

    // 验证必需字段 (现在通过了自愈，基本不会再因为 description 为空而拦截了)
    const validationError = validateStructuredStep(parsedStep);
    if (validationError) {
      if (log)
        log.warn(`[Phase 1] index=${parsedStep.index} 字段验证失败: ${validationError}`);
      failedIndices.push(parsedStep.index);
      errors.push({
        index: parsedStep.index,
        type: 'field-validation-error',
        reason: validationError,
      });
      continue;
    }

    parsedSteps.push(parsedStep);
  }
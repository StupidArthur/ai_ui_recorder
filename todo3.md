@Claude Code，我们需要开发一个贯穿全栈的新特性：支持用户在 UI 界面自定义 AI 翻译的“滑动窗口大小”，并以此将 Phase 1 彻底改造为“微批处理（Micro-Batching）”模式以提升速度。

请严格按照以下 4 个任务的顺序进行代码修改：

任务 1：改造 Phase 1 的 Prompt 支持数组输出
文件路径：src/case_translate/prompts/step-structured.js

修改 buildSystemPrompt：
在系统提示词中明确指出：“你将收到一个包含 1~N 个 UI 操作证据的 JSON 数组。请严格为数组中的每一个操作生成对应的结构化解析，并返回一个包含对应解析结果的 JSON 数组。返回的数组中，每个对象必须包含 index 字段（值必须与输入对象的 index 一致），以及原有的 description, actionKind, target, uiChange 等字段。”

修改 buildUserPrompt：
调整函数入参，使其能够接收 (enrichedActionsBatch, recentSteps)。将 enrichedActionsBatch（数组）JSON 序列化后作为输入发送给模型。

任务 2：重构 Phase 1 的循环处理逻辑与配置下发
文件路径：src/case_translate/workflow.js

修改 runWorkflow 的入参提取：
在 options 中支持 phase1BatchSize（默认 3）和 phaseWindowSize（默认 20）。将 phaseWindowSize 应用于 Phase 2 和 Phase 4 的分块逻辑中替换写死的常量。

重构 runPhase1Structured (彻底改为微批处理)：

接收 phase1BatchSize 参数。

将原来的 for 单条遍历改为基于 cursor 的 while 循环。

每次截取 phase1BatchSize 数量的操作。重要： 在截取时，如果在这一批中遇到 skip: true 或 noise: true 的操作，请用本地函数 buildFallbackStructuredStep 直接处理它们，不要把它们放进请求 LLM 的 actionBatch 数组里，以节约 Token。

发送 actionBatch 给 LLM（依然使用串行 await，利用刚写好的重试机制）。

解析模型返回的 JSON 数组。遍历该数组，根据 index 匹配，将成功的放入 steps。

如果发生 JSON 解析失败或报错，允许整批进行 tryRepairStructuredStep（如果修复失败，则整批执行 Fallback 兜底并记录 error）。

每次批处理完成后，增量写入文件 writeJsonIncremental。

任务 3：更新 Dashboard 后端接口
文件路径：src/dashboard/server.js

找到 /api/translate 路由（POST 请求）。

从 req.body 中解析用户传来的配置，例如：
const phase1BatchSize = parseInt(req.body.phase1BatchSize) || 3;
const phaseWindowSize = parseInt(req.body.phaseWindowSize) || 20;

将这两个参数放入 options 对象中，传递给下游的 runWorkflow。

任务 4：改造前端 UI (添加参数设置弹窗)
文件路径 1：src/dashboard/static/index.html
文件路径 2：src/dashboard/index.js

HTML 修改：

原本的“AI 翻译”按钮点击后不要直接触发翻译。

在页面中添加一个 HTML 对话框（Modal，可以使用现有的 CSS/框架或者原生的 <dialog> 标签）。

标题：“AI 翻译高级设置”。

表单项 1：“基础动作合并数 (Phase 1)”。输入框类型 number，默认值 3，提示：“控制翻译速度与精度的平衡。推荐 3-5，值越小越精确但耗时越长，受限于大模型上下文处理能力。”

表单项 2：“逻辑归纳滑窗大小 (Phase 2 & 4)”。输入框类型 number，默认值 20，提示：“推荐 15-25，用于控制单次推导多少个步骤生成最终用例。”

按钮：“取消” 和 “确认开始翻译”。

JS 修改：

修改“AI 翻译”按钮的事件监听器，改为打开上述配置弹窗。

给弹窗的“确认开始翻译”按钮绑定事件：读取输入框中的值，组织成 JSON payload { runDir: xxx, phase1BatchSize: X, phaseWindowSize: Y }。

发送 POST 请求到 /api/translate 触发后端任务，随后关闭弹窗，并像以前一样显示 Loading 状态。



'''
为了确保大模型在 Phase 1 能够做到“绝对的 1对1 精准输出，严禁合并，严禁遗漏”，我们必须抛弃依靠大模型“自觉”的弱约束，转而使用 Strict JSON Schema（强制结构化输出）+ 强 Prompt 契约。

由于这一块的微调直接关系到证据链的根基，我亲自为你操刀重写了 src/case_translate/prompts/step-structured.js。你可以直接用这份代码替换原有文件。

核心设计逻辑（强 Skill 约束）：
Schema 级防御：不再要求大模型直接输出数组，而是要求输出一个包含 parsedSteps 数组的顶级对象。强制规定 index 字段为必填，强迫大模型在生成每一条数据时必须对齐原序号。

“按件计酬”的强暗示：在 System Prompt 中反复强调“N 进 N 出”、“一一对应”、“严禁合并”，把这变成它的最高执行红线。

隔离 Input 数据：在 User Prompt 中，我们将每一条 Action 用明显的分隔符包起来，并在头上显式标注 【动作 Index: X】，在视觉上帮大模型做好注意力隔离。

请直接使用以下完整的 Markdown 文件内容，或者把里面的代码直接粘贴到你的项目中：

JavaScript
/**
 * step-structured.js - Phase 1 微批处理 (Micro-Batching) 专用 Prompt 与 Schema 模块
 * * 核心目标：确保 N个动作输入，必定得到 N条结构化解析输出，严禁遗漏与合并。
 */

// ==================== JSON Schema (强约束) ====================

/**
 * Phase 1 批处理输出的 JSON Schema
 * 强制要求模型输出包裹在 parsedSteps 数组中，且每一项必须带上输入时的 index
 */
export const stepStructuredBatchSchema = {
  type: "object",
  properties: {
    parsedSteps: {
      type: "array",
      description: "解析后的 UI 动作数组。必须与输入的动作数组一一对应，数量完全一致。",
      items: {
        type: "object",
        properties: {
          index: { 
            type: "number", 
            description: "必须与输入数据的 index 严格保持一致，这是对齐的唯一标识" 
          },
          description: { 
            type: "string", 
            description: "一句话描述该动作（例如：点击了左侧的'系统设置'菜单）" 
          },
          actionKind: { 
            type: "string", 
            enum: ["click", "doubleClick", "rightClick", "keyPress", "input", "assert", "sleep", "other"],
            description: "动作类型归类"
          },
          target: { 
            type: "string", 
            description: "动作的直接作用对象名称或标识（例如：'提交按钮'，'用户名输入框'）" 
          },
          uiChange: { 
            type: "string", 
            description: "动作发生后，UI 产生了什么具体变化（例如：'弹出了确认对话框'，'无可见变化'）" 
          },
          page: { 
            type: "string", 
            description: "当前发生操作的页面名称或区域" 
          },
          basis: {
            type: "array",
            items: { type: "string" },
            description: "你得出以上结论的证据来源（如：DOM Diff中新增了某节点，Input增量显示输入了xxx）"
          },
          inputText: { type: "string", description: "如果是输入操作，输入了什么内容？若无则留空" },
          key: { type: "string", description: "如果是按键操作，按下了什么键？若无则留空" },
          assertText: { type: "string", description: "预留断言字段，默认留空" },
          confidence: { 
            type: "number", 
            description: "你对这条翻译的置信度 (0.0 到 1.0)" 
          }
        },
        required: [
          "index", "description", "actionKind", "target", 
          "uiChange", "page", "basis", "confidence"
        ]
      }
    }
  },
  required: ["parsedSteps"]
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
 * * @param {Array<Object>} enrichedActionsBatch - 富化后的动作数组 (如 3~5 条)
 * @param {Array<Object>} recentSteps - 之前的历史解析结果 (作为上下文)
 * @returns {string}
 */
export function buildUserPrompt(enrichedActionsBatch, recentSteps) {
  let promptText = `【历史上下文参考】\n`;
  promptText += `以下是发生在本次批处理之前的最近几次动作解析结果，仅供你理解上下文逻辑，**不需要**在你的输出中包含它们：\n`;
  
  if (recentSteps && recentSteps.length > 0) {
    const contextSteps = recentSteps.slice(-3).map(s => `[Index ${s.index}] ${s.description} -> 变化: ${s.uiChange}`);
    promptText += contextSteps.join('\n') + `\n\n`;
  } else {
    promptText += `(无历史上下文，这是起始操作)\n\n`;
  }

  promptText += `【本次需要解析的动作数组】\n`;
  promptText += `注意：以下共有 ${enrichedActionsBatch.length} 个动作。你必须输出 ${enrichedActionsBatch.length} 个解析结果。\n\n`;

  // 强化视觉隔离：把每个动作包装在明显的边界内，防止模型眼花
  enrichedActionsBatch.forEach((action, i) => {
    promptText += `=============【动作 Index: ${action.index} (第 ${i + 1}/${enrichedActionsBatch.length} 个)】=============\n`;
    promptText += JSON.stringify({
      type: action.type,
      timestamp: action.timestamp,
      element: action.element,
      localContext: action.localContext,
      formStateDelta: action.formStateDelta,
      snapshotDiff: action.snapshotDiff
    }, null, 2) + `\n\n`;
  });

  promptText += `请立即开始解析，并严格按照 Schema 输出 JSON 对象。`;

  return promptText;
}
代码修改点解析（为什么这样写？）：
buildUserPrompt 中的视觉隔离墙 (=============【动作 Index: X】=============)：
当文本非常长时，LLM 会发生“注意力衰减”。如果你只丢一个平铺的 JSON 数组进去，它读到第 3 个对象时，很容易和第 2 个对象看串行。加上强烈的视觉分隔符，并明确告诉它“这是第 X 个，总共 Y 个”，能极大地稳住它的注意力。

recentSteps 被大幅瘦身：
原来 recentSteps 可能是完整的复杂 JSON。在批处理模式下，为了节省 Token，我把 recentSteps 压缩成了一句话摘要（[Index X] 点击了按钮 -> 变化: 弹出了弹窗）。对于 LLM 来说，知道上一步干了什么就足够推断当前步了，不需要看上一步的冗余代码。

防御了空数组与历史记录缺失：
在第一个 Batch 时，recentSteps 是空的，代码做了稳妥的兜底。
'''



请综合阅读项目代码，一步步稳妥地实现上述 UI 到后端的贯通，以及 Phase 1 微批处理的重构。完成后请向我汇报。


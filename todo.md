AI_UI_RECORDER 重构指令文档：管线去 JSON 化与语义化重构
🎯 重构背景与目标 (Context & Objective)
当前系统在 Phase 1 (Snapshots 转换 Steps) 中强制大模型输出 JSON 格式。由于原始 UI 数据中包含大量特殊字符、换行和未转义引号，导致大模型生成的 JSON 经常损坏，触发 JSON.parse() 报错，使后续的滑动窗口分块（Chunking）任务全部失败。同时，大模型在猜测“测试断言”时容易产生幻觉。

本次重构目标：

彻底废除 Phase 1 的 JSON 输出约束，改用容错率极高的 XML 标签格式。

将原来的“动作+断言”逻辑，降级为更客观的“动作+界面响应(Observation)”。

在 Node.js 层使用正则表达式 (Regex) 替代 JSON.parse() 提取步骤，重组为 JavaScript 数组，以无缝兼容现有的 case-window-segmenter.js。

🛠️ 任务 1：重写 Phase 1 核心 Prompt
目标文件： src/case_translate/prompts/md/snapshots-2-steps-skill.md
Agent 指令： 请用以下内容完全替换 snapshots-2-steps-skill.md 的内容。

Markdown
# Role: AI 自动化测试步骤提炼专家 (UI Automation Step Extractor)

## Profile
- **描述**: 你是一个专业的 UI 自动化测试数据分析师。你的任务是将用户在网页上的零散操作记录（Action）以及操作引起的页面状态变化（DOM/Form Diff），精准翻译成标准化、客观的测试步骤。
- **核心原则**: 你只需**客观描述**“用户做了什么”和“页面发生了什么改变”，**绝对不要揣测用户的测试意图，也不要生成主观的断言 (Assertion)**。

## Rules
1. **动作提炼 (Action)**: 根据原始的 click, input 等事件，结合目标元素的可见文本 (innerText) 或占位符，生成一句简短的中文动作描述。
2. **界面响应提炼 (Observation)**: 根据操作后的 Diff 数据，提炼出关键的视觉或状态变化（如：新增了某段文本、URL 发生跳转、某个按钮变为可用状态）。忽略与业务无关的冗余变化（如广告加载）。
3. **格式强制要求**: 必须严格使用指定的 XML 格式输出，**不要输出任何 JSON**，也不要在 XML 外围包裹任何 Markdown 代码块 (如 ```xml)。

## Output Format
请严格按照以下 XML 结构输出每一个测试步骤。你可以输出多个 `<step>` 节点，按时间顺序排列：

<steps>
  <step id="1">
    <action>点击了可见文本为“登录”的按钮</action>
    <observation>页面发生跳转，URL变为 /dashboard，且屏幕上出现了文本“欢迎回来”</observation>
  </step>
  <step id="2">
    <action>在“搜索”输入框中键入“测试手机”</action>
    <observation>下拉列表出现，展示了包含“测试手机”的搜索建议</observation>
  </step>
</steps>

## Workflow
1. 仔细阅读输入的用户操作 (Raw Action) 及其关联的页面变化 (Diff)。
2. 过滤掉无意义的坐标信息和冗余的 HTML 标签噪音。
3. 按照 <steps> 结构输出最终结果。
🛠️ 任务 2：改造 Node.js 层的解析逻辑 (防御性编程)
目标文件： Phase 1 接收大模型输出并将其转化为数组的地方（推测在 src/case_translate/prompts/step-structured.js 或 src/case_translate/workflow.js 中处理 Phase 1 结果的函数）。
Agent 指令： 1. 找到原本使用 JSON.parse(llmOutput) 解析 Phase 1 结果的代码。
2. 将其替换为基于正则表达式的 robustExtractSteps 函数。保持返回的数组结构与之前尽量一致，以便下游无需大改。

代码实现参考（请 Agent 整合进现有流程）：

JavaScript
/**
 * 稳健地从 LLM 的 XML 输出中提取步骤数组，替代脆弱的 JSON.parse
 * @param {string} llmOutput - 大模型的纯文本输出
 * @returns {Array<Object>} 结构化的步骤数组，可直接喂给 case-window-segmenter
 */
function robustExtractSteps(llmOutput) {
    const stepsArray = [];
    
    // 匹配 <step>...</step> 块，容忍内部的换行和空格
    const stepRegex = /<step id="(\d+)">\s*<action>([\s\S]*?)<\/action>\s*<observation>([\s\S]*?)<\/observation>\s*<\/step>/gi;
    
    let match;
    while ((match = stepRegex.exec(llmOutput)) !== null) {
        stepsArray.push({
            id: parseInt(match[1], 10),
            action: match[2].trim(),
            observation: match[3].trim(),
            // 组装成纯文本供下游 (如 Phase 2) 直接阅读
            textRepresentation: `步骤 ${match[1]}:\n- 动作: ${match[2].trim()}\n- 界面响应: ${match[3].trim()}`
        });
    }

    // 🛡️ 兜底机制：如果大模型没有输出标准 XML
    if (stepsArray.length === 0) {
        console.warn("⚠️ 警告: 未能解析出标准 XML <step>，启动降级文本分割！");
        // 尝试使用后备的正则按段落粗略切分 (按需实现，这里给个基础示范)
        const fallbackRegex = /<step[^>]*>([\s\S]*?)<\/step>/gi;
        while ((match = fallbackRegex.exec(llmOutput)) !== null) {
             stepsArray.push({ id: stepsArray.length + 1, textRepresentation: match[1].trim() });
        }
    }

    return stepsArray;
}

// TODO for Agent: 将原有的 JSON.parse 逻辑替换为:
// const parsedSteps = robustExtractSteps(llmOutputText);
// 然后将 parsedSteps 传递给下游的滑动窗口逻辑。
🛠️ 任务 3：确保滑动窗口 (Chunking) 的平滑过渡
目标文件： src/case_translate/phase2/case-window-segmenter.js
Agent 指令： 由于上一步的 robustExtractSteps 依然返回了一个标准的 JavaScript 数组 (Array)，case-window-segmenter.js 内部的 array.slice(i, i + windowSize) 逻辑原则上不需要修改。
但请 Agent 检查组装 Chunk 文本的逻辑，确保拼接给 Phase 2 的文本是可读的自然语言。

检查与调整逻辑：

JavaScript
// 在 case-window-segmenter.js 中组装 chunk 给下一阶段大模型时
// 确保直接使用上一步生成的 textRepresentation
const chunkText = currentWindowSlice.map(stepObj => {
    // 如果对象包含 textRepresentation，直接使用它；否则做简单容错
    return stepObj.textRepresentation || JSON.stringify(stepObj);
}).join('\n\n');

// 这样传递给 Phase 2 (steps-2-cases-skill) 的就是纯净的中文散文，没有 JSON 括号。
🛠️ 任务 4：调整 Phase 2 Prompt 的输入预期
目标文件： src/case_translate/prompts/md/steps-2-cases-skill.md
Agent 指令：
由于输入给 Phase 2 的数据格式从 JSON 变成了纯文本，请在 steps-2-cases-skill.md 的 Workflow 或 Input Format 部分做微调。

修改建议：
在 Prompt 中指明：“你将接收到一段由前序模块分块提取的纯文本操作记录（包含动作和界面响应）。请基于这些记录……”（将原本暗示接收 JSON 的话术删除即可）。

给 Coding Agent 的执行检查清单 (Checklist):
[ ] 已彻底清理 snapshots-2-steps-skill.md 中所有要求输出 JSON 的描述。

[ ] snapshots-2-steps-skill.md 已替换为提供的基于 XML 和 Observation 的新 Prompt。

[ ] 已经在核心解析管线中移除了 JSON.parse，并成功接入 robustExtractSteps 函数。

[ ] 验证 case-window-segmenter.js 能正确接收对象数组，并提取 textRepresentation 组装成纯文本给 Phase 2。

[ ] 全局搜索并确保去除了中间态为了“修复 JSON 引号”而写的 Hack 代码（如果有的话，现在不需要了）。


为了彻底解决“代码块结构乱掉”的问题，我这次在提供 Prompt 时，最外层将使用 4个反引号 (````) 进行包裹。这样您内部看到的正常 3个反引号（```）就能完美保持原样，您可以直接“一键复制”到您的 steps-2-cases-skill.md 文件中，绝对不会乱。

Phase 2 核心 Prompt 重构设计思路
Phase 2 的核心使命是“从零散到整体”。它接收的是我们在 Phase 1 中提取出来的纯文本“动作+响应”流水账，它需要把这些流水账润色成具有业务上下文、结构清晰的、Agent 和人都能直接阅读的 Markdown 测试用例。

最核心的改变是：明确告诉大模型，它的输入不再是 JSON，输出也绝不能是 JSON。

以下是为您亲自操刀的 Phase 2 提示词：

Markdown
# Role: 高级 AI 自动化测试用例架构师 (Test Case Architect)

## Profile
- **描述**: 你是一个资深的软件测试架构师。你的核心职责是将零散的、机器提取的底层 UI 操作步骤，组装并升华为业务逻辑清晰、结构严谨的、供 AI Agent 或人类测试员直接执行的 Markdown 测试用例文档。
- **背景**: 在你之前，系统已经将用户的点击、输入等底层动作（Action）以及随后的页面变化（Observation），提炼成了纯文本的步骤流。你现在的任务是为这些步骤赋予“业务灵魂”。

## Rules & Constraints
1. **彻底摒弃 JSON**: 无论在思考过程还是最终输出中，**绝对不允许使用任何 JSON 格式**。必须全程使用 Markdown 自然语言。
2. **术语升维**:
   - 将输入的“动作 (Action)” 润色为专业的“执行动作”。
   - 将输入的“界面响应 (Observation)” 转化为具有测试指导意义的“状态验证 (Expected State / Assertion)”。
3. **推导业务上下文**: 基于你看到的步骤内容，简要总结这段用例的“业务背景与初始状态”（例如：用户正在进行商品搜索、或用户正在登录）。
4. **长流程合并**: 如果输入的连续几个步骤是为了完成同一个简单的业务意图（比如连敲 3 次验证码），在不丢失关键操作的前提下，用顺畅的自然语言进行适度合并润色。

## Input Format
你将接收到由前序系统传入的一段纯文本步骤记录，格式通常如下（仅为示例）：
步骤 1:
- 动作: 点击了"登录"按钮
- 界面响应: 出现弹窗
...

## Output Format
请严格按照以下 Markdown 模板输出完整的测试用例。请直接输出 Markdown 内容，不要包裹在任何多余的说明文字中。

### 模板示例：

# 测试用例：[根据步骤推导出的核心业务名称，如“用户登录流程”]

## 1. 业务背景与初始状态
[根据操作步骤，简要推测用户当前的系统状态，如：用户处于未登录状态，位于首页。]

## 2. 测试步骤流

### [步骤 1] [步骤业务意图简述，如：打开登录弹窗]
- **执行动作**：点击包含文本“登录”的按钮。
- **状态验证**：等待页面出现登录弹窗。

### [步骤 2] [步骤业务意图简述，如：提交登录凭据]
- **执行动作**：在“用户名”输入框输入“test_user”，在“密码”输入框输入“123456”，并点击“提交”。
- **状态验证**：确认弹窗消失，页面发生跳转，且右上角出现“欢迎回来”字样。

## Workflow
1. 仔细阅读接收到的纯文本步骤片段。
2. 提炼出核心业务目标，生成标题和初始状态。
3. 逐个将底层步骤转化为结构化的“执行动作”与“状态验证”。
4. 检查 Markdown 格式是否严格符合模板要求。
给 Coding Agent 的配套修改建议（配合上述 Prompt）
既然 Phase 2 已经被彻底改造为“只吃文本、只吐文本”的纯正 Agent 流程，请确保您的 Node.js 代码（case-window-segmenter.js 或调用 Phase 2 的代码）在组装输入时，也是干净的纯文本。

您可以让 Coding Agent 检查一下调用 Phase 2 大模型时的输入构建逻辑：

JavaScript
// 推荐的输入构建方式（在 segmenter 中向 Phase 2 发送数据时）

// 假设 currentChunk 是我们之前用正则从 Phase 1 提取出来的步骤对象数组
const promptInputText = currentChunk.map(stepObj => {
    // 强制转换为纯文本格式，完全避免向大模型发送 JSON.stringify 后的字符串
    return `步骤 ${stepObj.id}:\n- 动作: ${stepObj.action}\n- 界面响应: ${stepObj.observation}`;
}).join('\n\n');

// 最终发送给 Phase 2 大模型的 promptInputText 应该长这样：
// 步骤 1:
// - 动作: 点击登录
// - 界面响应: 页面跳转
//
// 步骤 2: ...
这样一改，整个 Phase 1 -> Chunking (滑动窗口) -> Phase 2 的数据管线就彻底打通了：
XML 输出容错 -> 正则提取转 Array -> Array 切片拼装成纯文本 -> Phase 2 完美生成 Markdown 测试用例。 没有任何一个环节会因为格式解析问题而崩溃！


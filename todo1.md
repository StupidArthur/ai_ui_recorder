请立即停止关于 Selenium 和 XPath (driver4.js, inject-script.js) 的分析，那不是当前的研发任务。

我们现在的核心任务是：在现有的工作流中新增一个旁路分支（Phase 4），用于生成供外部下游 AI Agent 消费的纯文本测试用例（case_4_agents.txt）。 下游的 Agent 有非常严格的执行红线（详见已上传的 skill.md）：它“严禁跳步”，依赖强 DOM 特征定位，且通过严格比对步骤序号来判定任务结束。因此，我们不能复用 Phase 2 的 AI_cases.md（因为它太简略了），而是要基于 Phase 1 的微观产物（step_2_structured_steps.json）重新生成。

为了避免 LLM 在长上下文中出现步骤编号断层，我们采用了“滑动窗口切块 + LLM逻辑分组(JSON) + 本地 Node.js 统一渲染(TXT)”的架构。

请你严格按照以下 Markdown 设计文档，帮我创建相应的文件并修改 workflow.js。

AI UI Recorder 扩展方案：Phase 4 (Agent 用例生成) 详细设计与实现指导
1. 新增 Prompt 与 Schema 模块
文件路径：src/case_translate/prompts/agent-txt.js（请创建）

JavaScript
// src/case_translate/prompts/agent-txt.js

export const agentTxtOutputSchema = {
  type: "object",
  properties: {
    useCaseName: { type: "string", description: "当前整个测试用例的名称，概括核心业务流程" },
    useCasePurpose: { type: "string", description: "测试目的" },
    agentSteps: {
      type: "array",
      description: "按业务逻辑划分的宏观步骤列表",
      items: {
        type: "object",
        properties: {
          logicalName: { type: "string", description: "业务逻辑步骤名，例如：访问系统/设置配置" },
          microActions: {
            type: "array",
            items: { type: "string" },
            description: "该逻辑步骤下的微观动作列表。必须包含明确的定位特征（文本、图标），严禁高度概括或遗漏过渡态。"
          },
          consumeStepCount: { type: "number", description: "该逻辑步骤一共消耗了传入数据中的几个微观步骤" }
        },
        required: ["logicalName", "microActions", "consumeStepCount"]
      }
    }
  },
  required: ["useCaseName", "useCasePurpose", "agentSteps"]
};

export function buildAgentTxtSystemPrompt() {
  return `你是一个资深的 Web UI 自动化测试用例编写专家。
你的任务是将 AI UI Recorder 捕获的一系列底层物理操作（JSON格式），转化为供下游自动化 Agent 消费的“逻辑步骤”。

【下游 Agent 的执行红线与约束】
1. **强依赖 DOM 定位**：Agent 是无视觉的，依靠你的描述去寻找元素。微观动作描述中必须包含明确的位置、文本、表单输入值或图标特征（如“输入用户名：xxx”，“点击左侧导航栏的偏好设置”）。
2. **严禁跳步与高度概括**：Agent 只能按顺序执行。如果弹窗需要先点击某个按钮才会出现，你必须拆成两步写（包含过渡态的确认），绝不能直接概括为“在隐藏弹窗中填表”。

【任务要求】
你不需要自己编写 TXT 文本，而是将传入的微观操作数组，按照“业务逻辑”进行聚合，输出 JSON 数据。
- logicalName：高度概括这几个操作在做什么（如：设置系统配置）。
- microActions：属于该逻辑的动作细节数组。
- consumeStepCount：你这一个 logicalName 聚合了传入数据中的几条底层步骤。请务必计算准确，这关系到系统的滑窗推进。`;
}

export function buildAgentTxtUserPrompt(stepsJson) {
  return `请根据以下按时间顺序排列的结构化步骤数据，进行业务逻辑聚合：\n\n${stepsJson}`;
}
2. 新增 Phase 4 核心逻辑模块 (滑动窗口处理)
文件路径：src/case_translate/phase4/agent-txt-generator.js（请创建目录及文件）

JavaScript
// src/case_translate/phase4/agent-txt-generator.js
import fs from 'fs';
import path from 'path';
import { callChat } from '../ai-client.js'; 
import { buildAgentTxtSystemPrompt, buildAgentTxtUserPrompt, agentTxtOutputSchema } from '../prompts/agent-txt.js';

const CHUNK_SIZE = 20; // 每次喂给 LLM 的最大微观步骤数

export async function generateAgentTxt(runDir, structuredSteps, options = {}) {
  const { log } = options;
  if (log) log.info('[Agent TXT] 开始生成 Agent 专用测试用例...');

  // 1. 过滤掉无效操作，保留正常步骤
  const effectiveSteps = structuredSteps.filter(s => s.status === 'normal' || s.status === 'fallback');
  
  let cursor = 0;
  let globalAgentSteps = [];
  let globalUseCaseName = "未命名测试用例";
  let globalUseCasePurpose = "验证系统功能正常";

  // 2. 滑动窗口处理
  while (cursor < effectiveSteps.length) {
    const chunk = effectiveSteps.slice(cursor, cursor + CHUNK_SIZE);
    
    // 精简数据丢给大模型，避免 Token 浪费
    const slimChunk = chunk.map(s => ({
      description: s.description,
      action: s.actionKind,
      target: s.target,
      uiChange: s.uiChange
    }));

    const messages = [
      { role: 'system', content: buildAgentTxtSystemPrompt() },
      { role: 'user', content: buildAgentTxtUserPrompt(JSON.stringify(slimChunk, null, 2)) }
    ];

    try {
      if (log) log.info(`[Agent TXT] 正在处理步骤 ${cursor} 到 ${cursor + chunk.length}...`);
      
      const rawReply = await callChat(messages, { 
        temperature: 0.1,
        response_format: { type: "json_schema", json_schema: { name: "agent_txt_schema", schema: agentTxtOutputSchema, strict: true } }
      });
      
      const parsedReply = JSON.parse(rawReply);
      
      if (cursor === 0 && parsedReply.useCaseName) {
        globalUseCaseName = parsedReply.useCaseName;
        globalUseCasePurpose = parsedReply.useCasePurpose;
      }

      let consumedInThisChunk = 0;
      for (const logicalStep of parsedReply.agentSteps) {
         globalAgentSteps.push(logicalStep);
         consumedInThisChunk += (logicalStep.consumeStepCount || 1);
      }

      // 推进游标。如果 LLM 算错或没算，保底推进当前 chunk 长度，避免死循环
      cursor += (consumedInThisChunk > 0 && consumedInThisChunk <= chunk.length) ? consumedInThisChunk : chunk.length;

    } catch (error) {
      if (log) log.error(`[Agent TXT] Chunk 处理失败: ${error.message}`);
      // 容错：失败则强制跳过当前块，继续下一块
      cursor += CHUNK_SIZE; 
    }
  }

  // 3. 本地代码统一渲染为 TXT，保证状态机编号绝对单调递增
  let finalTxt = `测试用例名称：${globalUseCaseName}\n测试目的：${globalUseCasePurpose}\n\n测试步骤：\n\n`;

  globalAgentSteps.forEach((step, index) => {
    finalTxt += `步骤${index + 1}: ${step.logicalName}\n`;
    step.microActions.forEach(action => {
      finalTxt += `- ${action}\n`;
    });
    finalTxt += `\n`;
  });

  const txtFilePath = path.join(runDir, 'case_4_agents.txt');
  fs.writeFileSync(txtFilePath, finalTxt.trim(), 'utf-8');
  if (log) log.info(`[Agent TXT] 生成成功，文件已保存至: ${txtFilePath}`);
  
  return txtFilePath;
}
3. 主流程接入
文件路径：修改现有的 src/case_translate/workflow.js

在 workflow.js 的顶部引入模块：

JavaScript
import { generateAgentTxt } from './phase4/agent-txt-generator.js';
在 runWorkflow 函数内部（Phase 1 结束后，Phase 2 执行前后均可），加入以下逻辑：

JavaScript
  // ▼▼▼ 新增：Phase 4 旁路分支 (Agent TXT 生成) ▼▼▼
  let agentTxtFile = null;
  try {
    agentTxtFile = await generateAgentTxt(runDir, steps, { log });
  } catch (err) {
    if (log) log.error(`[Workflow] 致命错误，Agent TXT 生成失败: ${err.message}`);
  }
  // ▲▲▲ 新增结束 ▲▲▲
并在最后的 return 对象中导出 agentTxtFile。

请阅读上述全部指令并开始修改。
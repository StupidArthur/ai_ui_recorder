@Claude Code，请阅读以下最新的系统改造需求。

当前我们的系统在使用在线大模型 API 时，经常遇到响应慢或请求失败的问题。为了保证流水线的健壮性，我们需要实现“全局 API 重试机制”，并在此基础上完成 Phase 4 (Agent 文本用例生成) 的开发。

请严格按照以下 4 个步骤进行代码的修改与创建：

任务 1：实现全局 LLM 调用重试机制
文件路径：src/case_translate/ai-client.js

修改要求：
找到 callChat 函数。在其实际发起网络请求/调用 API 的逻辑外部，包裹一个最大重试 3 次的机制。

重试条件：任何网络报错或 API 调用失败。

退避延迟：每次失败后，延迟执行（例如第 1 次失败等 2 秒，第 2 次失败等 4 秒）再重试。

日志记录：在重试时打印 console.warn 或日志，提示“LLM 调用失败，正在进行第 X 次重试...”。

抛出异常：如果 3 次全部失败，则向上抛出最终的 Error。

任务 2：创建 Phase 4 的 Prompt 与 Schema 模块 (包含截断防割裂优化)
文件路径：src/case_translate/prompts/agent-txt.js（请创建）

请写入以下代码（请注意 Prompt 中关于 consumeStepCount 的防割裂优化）：

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
- consumeStepCount：你这一个 logicalName 聚合了传入数据中的几条底层步骤。请务必计算准确。**注意：如果你发现传入数据的最后几个微观动作不足以形成一个完整的业务逻辑闭环，请不要强行归纳它们（直接丢弃并在 consumeStepCount 中减去它们的数量），剩余的未处理动作会由系统在下一批次滑窗中处理。**`;
}

export function buildAgentTxtUserPrompt(stepsJson) {
  return `请根据以下按时间顺序排列的结构化步骤数据，进行业务逻辑聚合：\n\n${stepsJson}`;
}
任务 3：创建 Phase 4 核心逻辑模块 (滑动窗口处理)
文件路径：src/case_translate/phase4/agent-txt-generator.js（请创建）

请写入以下代码：

JavaScript
// src/case_translate/phase4/agent-txt-generator.js
import fs from 'fs';
import path from 'path';
import { callChat } from '../ai-client.js'; 
import { buildAgentTxtSystemPrompt, buildAgentTxtUserPrompt, agentTxtOutputSchema } from '../prompts/agent-txt.js';

const CHUNK_SIZE = 20;

export async function generateAgentTxt(runDir, structuredSteps, options = {}) {
  const { log } = options;
  if (log) log.info('[Agent TXT] 开始生成 Agent 专用测试用例...');

  const effectiveSteps = structuredSteps.filter(s => s.status === 'normal' || s.status === 'fallback');
  if (effectiveSteps.length === 0) {
    if (log) log.warn('[Agent TXT] 无有效步骤，跳过生成');
    return null;
  }
  
  let cursor = 0;
  let globalAgentSteps = [];
  let globalUseCaseName = "未命名测试用例";
  let globalUseCasePurpose = "验证系统功能正常";

  while (cursor < effectiveSteps.length) {
    const chunk = effectiveSteps.slice(cursor, cursor + CHUNK_SIZE);
    
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
      
      // 此处的 callChat 已经由 Task 1 赋予了底层 3 次重试的能力
      const rawReply = await callChat(messages, { 
        temperature: 0.1,
        response_format: { type: "json_schema", json_schema: { name: "agent_txt_schema", schema: agentTxtOutputSchema, strict: true } }
      });
      
      const parsedReply = JSON.parse(rawReply);
      
      if (cursor === 0 && parsedReply.useCaseName) {
        globalUseCaseName = parsedReply.useCaseName;
        globalUseCasePurpose = parsedReply.useCasePurpose || "验证系统功能正常";
      }

      let consumedInThisChunk = 0;
      for (const logicalStep of (parsedReply.agentSteps || [])) {
         globalAgentSteps.push(logicalStep);
         consumedInThisChunk += (logicalStep.consumeStepCount || 1);
      }

      cursor += (consumedInThisChunk > 0 && consumedInThisChunk <= chunk.length) ? consumedInThisChunk : chunk.length;

    } catch (error) {
      if (log) log.error(`[Agent TXT] Chunk 处理彻底失败 (已用尽重试): ${error.message}`);
      cursor += CHUNK_SIZE; 
    }
  }

  // 本地统一渲染 TXT，保证状态机编号单调递增
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
任务 4：主流程优雅挂载
文件路径：src/case_translate/workflow.js

在文件顶部引入：

JavaScript
import { generateAgentTxt } from './phase4/agent-txt-generator.js';
在 runWorkflow 函数内部（推荐在 Phase 3 代码之后，总结代码之前），插入以下逻辑：

JavaScript
  // ========== Phase 4：Agent TXT 生成 ==========
  let agentTxtFile = null;
  try {
    agentTxtFile = await generateAgentTxt(runDir, steps, { log });
  } catch (err) {
    if (log) log.error(`[Workflow] Agent TXT 生成失败: ${err.message}`);
  }
在 runWorkflow 返回的对象中，加入 agentTxtFile。

请仔细完成上述修改，完成后向我简要汇报。
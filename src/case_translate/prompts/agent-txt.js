/**
 * agent-txt.js - Phase 4 (Agent TXT 生成) 的 Prompt 与 Schema 模块
 *
 * 下游 AI Agent 依赖此模块生成的纯文本测试用例执行自动化任务。
 * 约束：严禁跳步、依赖强 DOM 特征定位、严格步骤序号。
 */

// ==================== JSON Schema ====================

/**
 * Phase 4 Agent TXT 输出的 JSON Schema
 * 用于大模型 JSON Mode 响应格式
 */
export const agentTxtOutputSchema = {
  type: 'object',
  properties: {
    useCaseName: {
      type: 'string',
      description: '当前整个测试用例的名称，概括核心业务流程',
    },
    useCasePurpose: {
      type: 'string',
      description: '测试目的',
    },
    agentSteps: {
      type: 'array',
      description: '按业务逻辑划分的宏观步骤列表',
      items: {
        type: 'object',
        properties: {
          logicalName: {
            type: 'string',
            description: '业务逻辑步骤名，例如：访问系统/设置配置',
          },
          microActions: {
            type: 'array',
            items: { type: 'string' },
            description:
              '该逻辑步骤下的微观动作列表。必须包含明确的定位特征（文本、图标），严禁高度概括或遗漏过渡态。',
          },
          consumeStepCount: {
            type: 'number',
            description: '该逻辑步骤一共消耗了传入数据中的几个微观步骤',
          },
        },
        required: ['logicalName', 'microActions', 'consumeStepCount'],
      },
    },
  },
  required: ['useCaseName', 'useCasePurpose', 'agentSteps'],
};

// ==================== Prompt 构建 ====================

/**
 * 构建 Phase 4 Agent TXT 的 System Prompt
 *
 * @returns {string}
 */
export function buildAgentTxtSystemPrompt() {
  return `你是一个资深的 Web UI 自动化测试用例编写专家。
你的任务是将 AI UI Recorder 捕获的一系列底层物理操作（JSON格式），转化为供下游自动化 Agent 消费的"逻辑步骤"。

【下游 Agent 的执行红线与约束】
1. **强依赖 DOM 定位**：Agent 是无视觉的，依靠你的描述去寻找元素。微观动作描述中必须包含明确的位置、文本、表单输入值或图标特征（如"输入用户名：xxx"，"点击左侧导航栏的偏好设置"）。
2. **严禁跳步与高度概括**：Agent 只能按顺序执行。如果弹窗需要先点击某个按钮才会出现，你必须拆成两步写（包含过渡态的确认），绝不能直接概括为"在隐藏弹窗中填表"。

【任务要求】
你不需要自己编写 TXT 文本，而是将传入的微观操作数组，按照"业务逻辑"进行聚合，输出 JSON 数据。
- logicalName：高度概括这几个操作在做什么（如：设置系统配置）。
- microActions：属于该逻辑的动作细节数组。
- consumeStepCount：你这一个 logicalName 聚合了传入数据中的几条底层步骤。请务必计算准确，这关系到系统的滑窗推进。`;
}

/**
 * 构建 Phase 4 Agent TXT 的 User Prompt
 *
 * @param {string} stepsJson - 结构化步骤的 JSON 字符串
 * @returns {string}
 */
export function buildAgentTxtUserPrompt(stepsJson) {
  return `请根据以下按时间顺序排列的结构化步骤数据，进行业务逻辑聚合：\n\n${stepsJson}`;
}

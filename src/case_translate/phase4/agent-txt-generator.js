/**
 * agent-txt-generator.js - Phase 4 核心逻辑模块（滑动窗口处理）
 *
 * 架构：滑动窗口切块 + LLM 逻辑分组(JSON) + 本地 Node.js 统一渲染(TXT)
 *
 * 设计目标：
 * - 保证步骤编号绝对单调递增（LLM 不可靠，本地渲染保证）
 * - 避免 LLM 在长上下文中出现步骤编号断层
 * - 生成供下游 AI Agent 消费的纯文本测试用例
 */

import fs from 'fs';
import path from 'path';
import { callChat } from '../ai-client.js';
import { buildAgentTxtSystemPrompt, buildAgentTxtUserPrompt, agentTxtOutputSchema } from '../prompts/agent-txt.js';

/** 默认滑动窗口大小 */
const DEFAULT_CHUNK_SIZE = 20;

/**
 * Phase 4：生成供 Agent 使用的纯文本测试用例
 *
 * @param {string} runDir - 录制输出目录路径
 * @param {Array<Object>} structuredSteps - Phase 1 输出的结构化步骤数组
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器实例
 * @param {number} [options.phaseWindowSize] - 滑动窗口大小，默认 20
 * @returns {Promise<string>} 生成的 TXT 文件路径
 */
export async function generateAgentTxt(runDir, structuredSteps, options = {}) {
  const { log } = options;
  const phaseWindowSize = options.phaseWindowSize || DEFAULT_CHUNK_SIZE;
  if (log) log.info(`[Agent TXT] 开始生成 Agent 专用测试用例 (窗口大小=${phaseWindowSize})...`);

  // 1. 过滤掉无效操作，保留正常步骤
  const effectiveSteps = structuredSteps.filter(
    (s) => s.status === 'normal' || s.status === 'fallback',
  );

  if (effectiveSteps.length === 0) {
    if (log) log.warn('[Agent TXT] 无有效步骤，跳过生成');
    return null;
  }

  let cursor = 0;
  let globalAgentSteps = [];
  let globalUseCaseName = '未命名测试用例';
  let globalUseCasePurpose = '验证系统功能正常';

  // 2. 滑动窗口处理
  while (cursor < effectiveSteps.length) {
    const chunk = effectiveSteps.slice(cursor, cursor + phaseWindowSize);

    // 精简数据丢给大模型，避免 Token 浪费
    const slimChunk = chunk.map((s) => ({
      description: s.description,
      action: s.actionKind,
      target: s.target,
      uiChange: s.uiChange,
    }));

    const messages = [
      { role: 'system', content: buildAgentTxtSystemPrompt() },
      { role: 'user', content: buildAgentTxtUserPrompt(JSON.stringify(slimChunk, null, 2)) },
    ];

    try {
      if (log)
        log.info(`[Agent TXT] 正在处理步骤 ${cursor} 到 ${cursor + chunk.length}...`);

      const rawReply = await callChat(messages, {
        temperature: 0.1,
        maxTokens: 2000,
        // 大模型 JSON Schema 响应格式
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'agent_txt_schema',
            schema: agentTxtOutputSchema,
            strict: true,
          },
        },
      });

      const parsedReply = JSON.parse(rawReply);

      if (cursor === 0 && parsedReply.useCaseName) {
        globalUseCaseName = parsedReply.useCaseName;
        globalUseCasePurpose = parsedReply.useCasePurpose || '验证系统功能正常';
      }

      let consumedInThisChunk = 0;
      for (const logicalStep of parsedReply.agentSteps || []) {
        globalAgentSteps.push(logicalStep);
        consumedInThisChunk += logicalStep.consumeStepCount || 1;
      }

      // 推进游标。如果 LLM 算错或没算，保底推进当前 chunk 长度，避免死循环
      cursor +=
        consumedInThisChunk > 0 && consumedInThisChunk <= chunk.length
          ? consumedInThisChunk
          : chunk.length;
    } catch (error) {
      if (log) log.error(`[Agent TXT] Chunk 处理彻底失败 (已用尽重试): ${error.message}`);
      // 容错：失败则强制跳过当前块，继续下一块
      cursor += phaseWindowSize;
    }
  }

  // 3. 本地代码统一渲染为 TXT，保证状态机编号绝对单调递增
  let finalTxt = `测试用例名称：${globalUseCaseName}\n测试目的：${globalUseCasePurpose}\n\n测试步骤：\n\n`;

  globalAgentSteps.forEach((step, index) => {
    finalTxt += `步骤${index + 1}: ${step.logicalName}\n`;
    step.microActions.forEach((action) => {
      finalTxt += `- ${action}\n`;
    });
    finalTxt += `\n`;
  });

  const txtFilePath = path.join(runDir, 'case_4_agents.txt');
  fs.writeFileSync(txtFilePath, finalTxt.trim(), 'utf-8');
  if (log) log.info(`[Agent TXT] 生成成功，文件已保存至: ${txtFilePath}`);

  return txtFilePath;
}

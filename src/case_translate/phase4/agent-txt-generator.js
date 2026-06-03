/**
 * agent-txt-generator.js - Phase 4 核心逻辑模块（滑动窗口处理）
 *
 * 架构：滑动窗口切块 + LLM 逻辑分组(JSON) + 本地 Node.js 统一渲染(TXT)
 *
 * 设计目标：
 * - 保证步骤编号绝对单调递增（LLM 不可靠，本地渲染保证）
 * - LLM JSON 解析失败时：修复重试 → 本地确定性兜底（不丢步骤）
 * - 生成供下游 AI Agent 消费的纯文本测试用例
 */

import fs from 'fs';
import path from 'path';
import { callChat, parseJsonFromLlmReply } from '../ai-client.js';
import { buildAgentTxtSystemPrompt, buildAgentTxtUserPrompt } from '../prompts/agent-txt.js';

/** 默认滑动窗口大小 */
const DEFAULT_CHUNK_SIZE = 20;

/**
 * 将单条结构化步骤格式化为 Agent 可执行的微观动作描述
 *
 * @param {Object} step
 * @returns {string}
 */
function formatStepAsMicroAction(step) {
  const target = step.target || '目标元素';
  switch (step.actionKind) {
    case 'input': {
      const val = step.inputText === '[MASKED]' ? '******' : (step.inputText || '');
      return val ? `在「${target}」输入 ${val}` : `在「${target}」输入内容`;
    }
    case 'keyPress':
      return `在「${target}」按下 ${step.key || 'Enter'} 键`;
    case 'doubleClick':
      return `双击「${target}」`;
    case 'rightClick':
      return `右键点击「${target}」`;
    case 'click':
    default:
      return `点击「${target}」`;
  }
}

/**
 * 本地确定性聚合：每条结构化步骤对应一个逻辑步骤（1:1）
 *
 * @param {Array<Object>} chunk
 * @returns {Array<Object>}
 */
function buildLocalAgentStepsFromChunk(chunk) {
  return chunk.map((step) => ({
    logicalName: step.description || `操作 ${step.index}`,
    microActions: [formatStepAsMicroAction(step)],
    consumeStepCount: 1,
  }));
}

/**
 * 从结构化步骤推导用例名称
 *
 * @param {Array<Object>} steps
 * @returns {string}
 */
function deriveUseCaseNameFromSteps(steps) {
  const first = steps[0];
  if (!first) return '未命名测试用例';
  const page = first.page && first.page !== '未知' ? first.page : '';
  const desc = first.description || '';
  if (page && desc) return `${page} - ${desc.slice(0, 30)}`;
  return desc.slice(0, 40) || page || '录制流程测试用例';
}

/**
 * 尝试调用 LLM 修复非法 JSON 输出
 *
 * @param {string} rawReply
 * @returns {Promise<Object|null>}
 */
async function tryRepairAgentTxtJson(rawReply) {
  const messages = [
    {
      role: 'system',
      content:
        '你是 JSON 修复器。只输出一个合法 JSON 对象，不要任何解释、思考过程或 Markdown。\n' +
        '对象必须包含字段：useCaseName(string), useCasePurpose(string), agentSteps(array)。\n' +
        'agentSteps 每项含 logicalName, microActions(string[]), consumeStepCount(number)。',
    },
    {
      role: 'user',
      content: `请把下面文本修正为合法 JSON 对象：\n\n${rawReply.slice(0, 6000)}`,
    },
  ];

  try {
    const repaired = await callChat(messages, { temperature: 0, maxTokens: 2000 });
    return parseJsonFromLlmReply(repaired);
  } catch (_) {
    return null;
  }
}

/**
 * 解析 LLM 返回的 Agent TXT JSON（含修复重试）
 *
 * @param {string} rawReply
 * @returns {Promise<Object>}
 */
async function parseAgentTxtReply(rawReply) {
  try {
    return parseJsonFromLlmReply(rawReply);
  } catch (firstError) {
    const repaired = await tryRepairAgentTxtJson(rawReply);
    if (repaired) return repaired;
    throw firstError;
  }
}

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

  const effectiveSteps = structuredSteps.filter(
    (s) => s.status === 'normal' || s.status === 'fallback',
  );

  if (effectiveSteps.length === 0) {
    if (log) log.warn('[Agent TXT] 无有效步骤，跳过生成');
    return null;
  }

  let cursor = 0;
  let globalAgentSteps = [];
  let globalUseCaseName = deriveUseCaseNameFromSteps(effectiveSteps);
  let globalUseCasePurpose = '验证录制业务流程可正常执行';
  let usedLocalFallback = false;

  while (cursor < effectiveSteps.length) {
    const chunk = effectiveSteps.slice(cursor, cursor + phaseWindowSize);

    const slimChunk = chunk.map((s) => ({
      description: s.description,
      action: s.actionKind,
      target: s.target,
      inputText: s.inputText,
      uiChange: s.uiChange,
    }));

    const messages = [
      { role: 'system', content: buildAgentTxtSystemPrompt() },
      { role: 'user', content: buildAgentTxtUserPrompt(JSON.stringify(slimChunk, null, 2)) },
    ];

    let parsedReply = null;
    let chunkHandledByLocal = false;

    try {
      if (log) log.info(`[Agent TXT] 正在处理步骤 ${cursor + 1}~${cursor + chunk.length}...`);

      const rawReply = await callChat(messages, {
        temperature: 0.1,
        maxTokens: 2000,
      });

      parsedReply = await parseAgentTxtReply(rawReply);
    } catch (error) {
      if (log)
        log.warn(
          `[Agent TXT] LLM 解析失败 (${error.message})，使用本地确定性兜底渲染 ${chunk.length} 步`,
        );
      parsedReply = {
        agentSteps: buildLocalAgentStepsFromChunk(chunk),
      };
      usedLocalFallback = true;
      chunkHandledByLocal = true;
    }

    if (cursor === 0 && parsedReply.useCaseName && !chunkHandledByLocal) {
      globalUseCaseName = parsedReply.useCaseName;
      globalUseCasePurpose = parsedReply.useCasePurpose || globalUseCasePurpose;
    }

    const agentSteps = Array.isArray(parsedReply.agentSteps) ? parsedReply.agentSteps : [];

    if (agentSteps.length === 0) {
      if (log) log.warn('[Agent TXT] LLM 返回空 agentSteps，使用本地兜底');
      globalAgentSteps.push(...buildLocalAgentStepsFromChunk(chunk));
      usedLocalFallback = true;
      cursor += chunk.length;
      continue;
    }

    let consumedInThisChunk = 0;
    for (const logicalStep of agentSteps) {
      globalAgentSteps.push(logicalStep);
      consumedInThisChunk += logicalStep.consumeStepCount || 1;
    }

    cursor +=
      consumedInThisChunk > 0 && consumedInThisChunk <= chunk.length
        ? consumedInThisChunk
        : chunk.length;
  }

  if (globalAgentSteps.length === 0) {
    if (log) log.warn('[Agent TXT] 全局步骤为空，对全部有效步骤做本地兜底');
    globalAgentSteps = buildLocalAgentStepsFromChunk(effectiveSteps);
    usedLocalFallback = true;
  }

  let finalTxt = `测试用例名称：${globalUseCaseName}\n测试目的：${globalUseCasePurpose}\n\n测试步骤：\n\n`;

  globalAgentSteps.forEach((step, index) => {
    finalTxt += `步骤${index + 1}: ${step.logicalName || `逻辑步骤 ${index + 1}`}\n`;
    const actions = Array.isArray(step.microActions) ? step.microActions : [];
    if (actions.length === 0) {
      finalTxt += `- （无微观动作描述）\n`;
    } else {
      actions.forEach((action) => {
        finalTxt += `- ${action}\n`;
      });
    }
    finalTxt += `\n`;
  });

  const txtFilePath = path.join(runDir, 'case_4_agents.txt');
  fs.writeFileSync(txtFilePath, finalTxt.trim(), 'utf-8');

  if (log) {
    log.info(
      `[Agent TXT] 生成成功 (${globalAgentSteps.length} 个逻辑步骤${usedLocalFallback ? '，含本地兜底' : ''})，文件: ${txtFilePath}`,
    );
  }

  return txtFilePath;
}

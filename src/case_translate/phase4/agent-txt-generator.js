/**
 * agent-txt-generator.js - Phase 4 核心逻辑（滑动窗口 + XML 解析 + 本地渲染 TXT）
 *
 * 架构：滑动窗口切块 + LLM XML(agent_chunk) + Node 本地渲染 case_4_agents.txt
 */

import fs from 'fs';
import path from 'path';
import { parseAgentChunkXml } from './xml-agent-chunk-parser.js';
import {
  buildAgentTxtSystemPrompt,
  buildAgentTxtUserPrompt,
} from '../prompts/agent-txt.js';
import { formatStepsWindowPlainText } from '../phase2/format-step-plain-text.js';
import { clampWindowConsume, maxSlidingWindowRounds } from '../xml-parse-utils.js';
import { getTranslatePaths } from '../../utils/run-layout.js';

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
export function buildLocalAgentStepsFromChunk(chunk) {
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
 * Phase 4：生成供 Agent 使用的纯文本测试用例
 *
 * @param {string} runDir
 * @param {Array<Object>} structuredSteps
 * @param {Object} [options]
 * @param {Object} [options.log]
 * @param {number} [options.phaseWindowSize]
 * @returns {Promise<string|null>}
 */
export async function generateAgentTxt(runDir, structuredSteps, options = {}) {
  const { log, llmAudit } = options;
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

  const maxRounds = maxSlidingWindowRounds(effectiveSteps.length, phaseWindowSize);
  let round = 0;

  while (cursor < effectiveSteps.length) {
    round++;
    if (round > maxRounds) {
      if (log) {
        log.warn(
          `[Agent TXT] 已达最大轮次 ${maxRounds}，剩余步骤本地 1:1 兜底`,
        );
      }
      globalAgentSteps.push(...buildLocalAgentStepsFromChunk(effectiveSteps.slice(cursor)));
      usedLocalFallback = true;
      cursor = effectiveSteps.length;
      break;
    }

    const chunk = effectiveSteps.slice(cursor, cursor + phaseWindowSize);
    const windowPlainText = formatStepsWindowPlainText(chunk);

    const messages = [
      { role: 'system', content: buildAgentTxtSystemPrompt() },
      { role: 'user', content: buildAgentTxtUserPrompt(windowPlainText) },
    ];

    const chunkStart = cursor + 1;
    const chunkEnd = cursor + chunk.length;
    const phase4Label = `agent txt chunk steps ${chunkStart}~${chunkEnd}`;
    const auditMeta = { stepIndices: chunk.map((s) => s.index), round };

    let parsedChunk = null;
    let callId = null;
    let rawReply;

    try {
      if (log) log.info(`[Agent TXT] 正在处理步骤 ${chunkStart}~${chunkEnd}...`);

      if (!llmAudit) {
        throw new Error('llmAudit 未注入，无法审计 Phase 4 调用');
      }

      ({ callId, raw: rawReply } = await llmAudit.call(
        {
          phase: 'phase4',
          label: phase4Label,
          extra: auditMeta,
        },
        messages,
        { temperature: 0.1, maxTokens: 2000 },
      ));

      parsedChunk = parseAgentChunkXml(rawReply);

      const parseOk = parsedChunk != null && parsedChunk.agentSteps?.length > 0;
      const problems = parseOk ? [] : ['agent_chunk XML 解析失败或 agentSteps 为空'];

      let safeConsume = chunk.length;
      let rawConsume = null;
      let clampReason = null;
      if (parseOk) {
        ({ safeConsume, rawConsume, clampReason } = clampWindowConsume(
          parsedChunk.totalConsume,
          chunk.length,
        ));
        if (clampReason) problems.push(clampReason);
      }

      llmAudit.markOutcome(callId, {
        ok: parseOk,
        problems,
        details: {
          useCaseName: parsedChunk?.useCaseName,
          agentStepCount: parsedChunk?.agentSteps?.length ?? 0,
          totalConsume: parsedChunk?.totalConsume,
          safeConsume,
          rawConsume,
        },
      });
    } catch (error) {
      if (callId) {
        llmAudit.markOutcome(callId, {
          ok: false,
          problems: [error.message],
          details: auditMeta,
        });
      }
      if (log) {
        log.warn(
          `[Agent TXT] LLM 失败 (${error.message})，使用本地兜底 ${chunk.length} 步`,
        );
      }
      parsedChunk = null;
      usedLocalFallback = true;
    }

    if (!parsedChunk || !parsedChunk.agentSteps?.length) {
      if (log) log.warn('[Agent TXT] XML 无效，使用本地兜底');
      const localSteps = buildLocalAgentStepsFromChunk(chunk);
      globalAgentSteps.push(...localSteps);
      usedLocalFallback = true;
      cursor += chunk.length;
      continue;
    }

    if (cursor === 0 && parsedChunk.useCaseName) {
      globalUseCaseName = parsedChunk.useCaseName;
      if (parsedChunk.useCasePurpose) {
        globalUseCasePurpose = parsedChunk.useCasePurpose;
      }
    }

    const { safeConsume, rawConsume, clampReason } = clampWindowConsume(
      parsedChunk.totalConsume,
      chunk.length,
    );

    let consumedInChunk = 0;
    for (const logicalStep of parsedChunk.agentSteps) {
      globalAgentSteps.push(logicalStep);
      consumedInChunk += logicalStep.consumeStepCount || 1;
      if (consumedInChunk >= safeConsume) break;
    }

    cursor += safeConsume;
    if (log) {
      log.info(
        `[Agent TXT] 轮次 ${round} 消费 ${safeConsume} 步 (raw=${rawConsume ?? 'n/a'}${clampReason ? `, ${clampReason}` : ''})`,
      );
    }
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
    finalTxt += '\n';
  });

  const { agentsTxt: txtFilePath } = getTranslatePaths(runDir);
  fs.writeFileSync(txtFilePath, finalTxt.trim(), 'utf-8');

  if (log) {
    log.info(
      `[Agent TXT] 生成成功 (${globalAgentSteps.length} 个逻辑步骤${usedLocalFallback ? '，含本地兜底' : ''})，文件: ${txtFilePath}`,
    );
  }

  return txtFilePath;
}

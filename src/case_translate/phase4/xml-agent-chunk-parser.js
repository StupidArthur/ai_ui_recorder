/**
 * phase4/xml-agent-chunk-parser.js - Phase 4 LLM agent_chunk XML 解析
 */

import {
  XML_REGEX_LOGICAL_STEP_MAX_CHARS,
  XML_REGEX_MICRO_MAX_CHARS,
} from '../../utils/config.js';
import {
  preprocessLlmXmlOutput,
  hasClosingTag,
  boundedCrossLine,
  toSingleLineText,
} from '../xml-parse-utils.js';

/**
 * 解析单窗 agent_chunk XML
 *
 * @param {string} rawReply
 * @returns {{ useCaseName?: string, useCasePurpose?: string, agentSteps: Array<{ logicalName: string, microActions: string[], consumeStepCount: number }>, totalConsume: number|null }|null}
 */
export function parseAgentChunkXml(rawReply) {
  const { text } = preprocessLlmXmlOutput(rawReply);

  if (!hasClosingTag(text, '</agent_chunk>') && !/<agent_chunk/i.test(text)) {
    return null;
  }

  const chunkPat = /<agent_chunk[^>]*\btotalConsume\s*=\s*["']?(\d+)["']?[^>]*>/i;
  const chunkMatch = text.match(chunkPat);
  let totalConsume = chunkMatch ? parseInt(chunkMatch[1], 10) : null;
  if (!Number.isFinite(totalConsume)) {
    totalConsume = null;
  }

  let useCaseName;
  let useCasePurpose;
  const useCasePat = /<use_case[^>]*\bname\s*=\s*["']([^"']*)["'][^>]*\bpurpose\s*=\s*["']([^"']*)["'][^>]*\/?>/i;
  const useCaseAlt = /<use_case[^>]*\bname\s*=\s*["']([^"']*)["'][^>]*\/?>/i;
  const uc = text.match(useCasePat) || text.match(useCaseAlt);
  if (uc) {
    useCaseName = toSingleLineText(uc[1]);
    useCasePurpose = uc[2] != null ? toSingleLineText(uc[2]) : undefined;
  }

  const agentSteps = [];
  const logicalPat = new RegExp(
    `<logical_step[^>]*\\bconsume\\s*=\\s*["']?(\\d+)["']?[^>]*>(${boundedCrossLine(XML_REGEX_LOGICAL_STEP_MAX_CHARS)})</logical_step>`,
    'gi',
  );

  let lm;
  while ((lm = logicalPat.exec(text)) !== null) {
    const consumeStepCount = parseInt(lm[1], 10) || 1;
    const inner = lm[2] || '';

    const namePat = new RegExp(
      `<name[^>]*>(${boundedCrossLine(XML_REGEX_MICRO_MAX_CHARS)})</name>`,
      'i',
    );
    const nameM = inner.match(namePat);
    const logicalName = nameM ? toSingleLineText(nameM[1]) : '逻辑步骤';

    const microPat = new RegExp(
      `<micro[^>]*>(${boundedCrossLine(XML_REGEX_MICRO_MAX_CHARS)})</micro>`,
      'gi',
    );
    const microActions = [];
    let mm;
    while ((mm = microPat.exec(inner)) !== null) {
      const line = toSingleLineText(mm[1]);
      if (line) microActions.push(line);
    }

    if (microActions.length === 0 && logicalName) {
      microActions.push(logicalName);
    }

    agentSteps.push({
      logicalName,
      microActions,
      consumeStepCount: Math.max(1, consumeStepCount),
    });
  }

  if (agentSteps.length === 0) {
    return null;
  }

  if (totalConsume == null) {
    totalConsume = agentSteps.reduce((s, x) => s + (x.consumeStepCount || 1), 0);
  }

  return {
    useCaseName,
    useCasePurpose,
    agentSteps,
    totalConsume,
  };
}

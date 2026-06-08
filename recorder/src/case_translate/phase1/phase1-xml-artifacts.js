/**
 * phase1-xml-artifacts.js - Phase 1 XML 中间产物落盘（供人工排查 LLM / Skill）
 *
 * 与 JSON 主产物并行：
 * - translate/phase1/structured_steps.xml：归一化后的步骤镜像（与 Skill 同构 action/observation）
 * - translate/phase1/llm_raw_batches.xml：各批次 LLM 原始回复（CDATA，便于对照解析器）
 */

import fs from 'fs';
import { preprocessLlmXmlOutput } from '../xml-parse-utils.js';

/**
 * XML 文本转义（用于元素体）
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeXmlText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 将归一化 structured step 渲染为 Skill 同构 XML
 *
 * @param {Array<Object>} steps
 * @returns {string}
 */
export function renderStructuredStepsXml(steps) {
  const list = steps || [];
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<steps>'];

  for (const step of list) {
    const id = step.index != null ? step.index : '?';
    const status = step.status ? ` status="${escapeXmlText(step.status)}"` : '';
    const action = escapeXmlText(step.description || '');
    const observation = escapeXmlText(step.uiChange || '无可见变化');
    lines.push(`  <step id="${id}"${status}>`);
    lines.push(`    <action>${action}</action>`);
    lines.push(`    <observation>${observation}</observation>`);
    lines.push('  </step>');
  }

  lines.push('</steps>');
  return `${lines.join('\n')}\n`;
}

/**
 * 将各批次 LLM 原始回复写入 XML（CDATA）
 *
 * @param {Array<{ indexFrom: number, indexTo: number, raw: string }>} batches
 * @returns {string}
 */
export function renderLlmRawBatchesXml(batches) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<phase1_llm_batches>',
    '  <!-- 各批次 LLM 原始输出，用于对照 snapshots-2-steps-skill 与 xml-step-extractor -->',
  ];

  for (const batch of batches || []) {
    const from = batch.indexFrom ?? '?';
    const to = batch.indexTo ?? '?';
    const { text } = preprocessLlmXmlOutput(batch.raw || '');
    lines.push(`  <batch indexFrom="${from}" indexTo="${to}">`);
    lines.push('    <![CDATA[');
    lines.push(text);
    lines.push('    ]]>');
    lines.push('  </batch>');
  }

  lines.push('</phase1_llm_batches>');
  return `${lines.join('\n')}\n`;
}

/**
 * 增量写 Phase 1 XML 产物（与 JSON 同步）
 *
 * @param {Object} params
 * @param {Array<Object>} params.steps - 当前已归一化步骤
 * @param {Array<{ indexFrom: number, indexTo: number, raw: string }>} params.llmRawBatches
 * @param {string} params.structuredXmlPath
 * @param {string} params.llmRawXmlPath
 */
export function writePhase1XmlArtifacts({
  steps,
  llmRawBatches,
  structuredXmlPath,
  llmRawXmlPath,
}) {
  if (structuredXmlPath) {
    fs.writeFileSync(structuredXmlPath, renderStructuredStepsXml(steps), 'utf-8');
  }
  if (llmRawXmlPath) {
    fs.writeFileSync(llmRawXmlPath, renderLlmRawBatchesXml(llmRawBatches), 'utf-8');
  }
}

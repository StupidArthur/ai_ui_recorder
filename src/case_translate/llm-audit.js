/**
 * llm-audit.js - LLM 请求/响应全量审计
 *
 * 每次 callChat 落盘一条记录（含完整 messages 与 raw 回复），
 * 并维护 index.json / problems.json 便于跑完后定位有问题的输入输出对。
 */

import fs from 'fs';
import path from 'path';

import { callChat } from './ai-client.js';
import { loadAIClientConfig } from '../utils/ai-config.js';
import { LLM_AUDIT_DIRNAME } from '../utils/config.js';

export { LLM_AUDIT_DIRNAME };

/** 单条 call 记录文件名前缀 */
const CALL_FILE_PREFIX = 'call_';

/**
 * 创建 LLM 审计会话（绑定一次 translate run）
 *
 * @param {string} runDir - 录制输出目录
 * @param {Object} [log] - 可选日志器
 * @returns {{
 *   call: Function,
 *   markOutcome: Function,
 *   finalize: Function,
 *   auditDir: string,
 * }}
 */
export function createLlmAudit(runDir, log) {
  const auditDir = path.join(runDir, LLM_AUDIT_DIRNAME);
  fs.mkdirSync(auditDir, { recursive: true });

  const runtimeAIConfig = loadAIClientConfig();
  const indexEntries = [];
  let seq = 0;

  /**
   * @param {Object} meta
   * @param {string} meta.phase
   * @param {string} meta.label
   * @param {Object} [meta.extra]
   * @returns {string} callId
   */
  function beginCall(meta) {
    seq += 1;
    const callId = `${CALL_FILE_PREFIX}${String(seq).padStart(4, '0')}`;
    const record = {
      id: callId,
      phase: meta.phase,
      label: meta.label,
      extra: meta.extra || {},
      startedAt: new Date().toISOString(),
      finishedAt: null,
      request: null,
      response: null,
      outcome: null,
    };
    writeCallFile(callId, record);
    indexEntries.push({
      id: callId,
      phase: meta.phase,
      label: meta.label,
      ok: null,
      problems: [],
      file: `${callId}.json`,
    });
    flushIndex();
    return callId;
  }

  /**
   * @param {string} callId
   * @param {Object} request
   */
  function attachRequest(callId, request) {
    patchCall(callId, { request });
  }

  /**
   * @param {string} callId
   * @param {{ raw?: string, error?: string }} payload
   */
  function finishResponse(callId, payload) {
    patchCall(callId, {
      finishedAt: new Date().toISOString(),
      response: payload,
    });
  }

  /**
   * @param {string} callId
   * @param {{ ok: boolean, problems?: string[], details?: Object }} outcome
   */
  function markOutcome(callId, outcome) {
    patchCall(callId, { outcome });
    const entry = indexEntries.find((e) => e.id === callId);
    if (entry) {
      entry.ok = Boolean(outcome.ok);
      entry.problems = Array.isArray(outcome.problems) ? outcome.problems : [];
      if (outcome.details) entry.details = outcome.details;
    }
    flushIndex();
  }

  /**
   * 调用 LLM 并写入审计记录
   *
   * @param {Object} meta - phase / label / extra
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [chatOptions]
   * @returns {Promise<{ callId: string, raw: string }>}
   */
  async function call(meta, messages, chatOptions = {}) {
    const callId = beginCall(meta);
    attachRequest(callId, {
      model: chatOptions.model || runtimeAIConfig.model,
      temperature: chatOptions.temperature,
      maxTokens: chatOptions.maxTokens,
      messages,
    });

    try {
      const raw = await callChat(messages, chatOptions);
      finishResponse(callId, { raw });
      return { callId, raw };
    } catch (error) {
      finishResponse(callId, { error: error.message });
      markOutcome(callId, {
        ok: false,
        problems: [`API 调用失败: ${error.message}`],
      });
      throw error;
    }
  }

  /**
   * 跑完后写入 problems.json 并打摘要日志
   */
  function finalize() {
    const problems = indexEntries.filter((e) => e.ok === false);
    const pending = indexEntries.filter((e) => e.ok === null);

    for (const entry of pending) {
      entry.ok = false;
      entry.problems = ['未标记 outcome（调用方遗漏 markOutcome）'];
    }

    flushIndex();

    const problemsPath = path.join(auditDir, 'problems.json');
    fs.writeFileSync(problemsPath, JSON.stringify(problems, null, 2), 'utf-8');

    const summary = {
      totalCalls: indexEntries.length,
      okCalls: indexEntries.filter((e) => e.ok === true).length,
      problemCalls: indexEntries.filter((e) => e.ok === false).length,
      auditDir,
      indexFile: path.join(auditDir, 'index.json'),
      problemsFile: problemsPath,
    };
    fs.writeFileSync(path.join(auditDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

    if (log) {
      log.info(
        `[LLM Audit] 共 ${summary.totalCalls} 次调用，${summary.problemCalls} 次有问题 → ${problemsPath}`,
      );
      for (const p of problems) {
        log.warn(`[LLM Audit] ❌ ${p.id} ${p.phase} ${p.label}: ${p.problems.join('; ')}`);
      }
    }

    return summary;
  }

  function writeCallFile(callId, record) {
    fs.writeFileSync(path.join(auditDir, `${callId}.json`), JSON.stringify(record, null, 2), 'utf-8');
  }

  function readCallFile(callId) {
    const filePath = path.join(auditDir, `${callId}.json`);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  function patchCall(callId, patch) {
    const record = readCallFile(callId);
    Object.assign(record, patch);
    writeCallFile(callId, record);
  }

  function flushIndex() {
    fs.writeFileSync(path.join(auditDir, 'index.json'), JSON.stringify(indexEntries, null, 2), 'utf-8');
  }

  return { call, markOutcome, finalize, auditDir };
}

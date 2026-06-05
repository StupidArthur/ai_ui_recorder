/**
 * xml-parse-utils.js - LLM XML 输出预处理与滑动窗口安全钳制
 *
 * 供 Phase 1/2/4 解析模块共用：去围栏、ReDoS 预检、consume 钳制。
 */

import { cleanMarkdownFence } from './ai-client.js';
import {
  PHASE1_LLM_RAW_MAX_CHARS,
  SLIDING_WINDOW_MAX_ROUND_MULTIPLIER,
} from '../utils/config.js';

/**
 * 预处理 LLM 原始文本（去围栏 / BOM / 换行）
 *
 * @param {string} raw
 * @param {number} [maxChars] - 超长截断上限，默认 PHASE1_LLM_RAW_MAX_CHARS
 * @returns {{ text: string, truncated: boolean }}
 */
export function preprocessLlmXmlOutput(raw, maxChars = PHASE1_LLM_RAW_MAX_CHARS) {
  let text = cleanMarkdownFence(String(raw || ''));
  text = text.replace(/^\uFEFF/, '');
  text = text.replace(/\r\n/g, '\n');

  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  return { text, truncated };
}

/**
 * 是否包含闭合标签（轻量 ReDoS 预检）
 *
 * @param {string} text
 * @param {string} closeTagLiteral - 如 '</step>'
 * @returns {boolean}
 */
export function hasClosingTag(text, closeTagLiteral) {
  return String(text || '').toLowerCase().includes(String(closeTagLiteral).toLowerCase());
}

/**
 * 构建带上界的跨行非贪婪片段（用于 RegExp 源码）
 *
 * @param {number} maxChars
 * @returns {string}
 */
export function boundedCrossLine(maxChars) {
  const n = Math.max(1, Math.floor(Number(maxChars)) || 1);
  return `[\\s\\S]{0,${n}}?`;
}

/**
 * 钳制滑动窗口消费步数（至少 1，至多窗口长度）
 *
 * @param {unknown} rawConsume
 * @param {number} windowLength
 * @returns {{ safeConsume: number, rawConsume: number|null, clampReason: string|null }}
 */
export function clampWindowConsume(rawConsume, windowLength) {
  const winLen = Math.max(1, Math.floor(Number(windowLength)) || 1);
  const parsed = Number(rawConsume);
  const hasNum = Number.isFinite(parsed);
  const raw = hasNum ? Math.trunc(parsed) : null;

  let clampReason = null;
  if (!hasNum || raw <= 0) {
    clampReason = 'zero-consume-clamped';
  } else if (raw > winLen) {
    clampReason = 'over-consume-clamped';
  }

  const safeConsume = Math.max(1, Math.min(hasNum ? raw : 1, winLen));
  return { safeConsume, rawConsume: raw, clampReason };
}

/**
 * 滑动窗口最大允许轮次（保险丝）
 *
 * 说明：
 * - LLM 每轮 consume 可能远小于 windowSize（如一次只归纳 4 步），不能仅用 ceil(total/window) 估算轮次。
 * - 下限取 total：假设每轮至少消费 1 步，保证常规录制长度能扫完。
 * - 上限再与 ceil(total/window)*MULTIPLIER 取较大值，防止异常卡死时仍有兜底出口。
 *
 * @param {number} totalItems
 * @param {number} windowSize
 * @returns {number}
 */
export function maxSlidingWindowRounds(totalItems, windowSize) {
  const total = Math.max(0, Math.floor(Number(totalItems)) || 0);
  const size = Math.max(1, Math.floor(Number(windowSize)) || 1);
  const base = Math.ceil(total / size);
  const fuseFromWindow = Math.max(1, base * SLIDING_WINDOW_MAX_ROUND_MULTIPLIER);
  const minRoundsForFullScan = total;
  return Math.max(minRoundsForFullScan, fuseFromWindow);
}

/**
 * 单行文本规范化
 *
 * @param {any} value
 * @returns {string}
 */
export function toSingleLineText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

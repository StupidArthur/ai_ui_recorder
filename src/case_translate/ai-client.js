/**
 * ai-client.js - OpenAI SDK 纯封装层
 *
 * 本模块只做两件事：
 * 1. callChat(messages, options) — 调用 OpenAI Chat Completions API
 * 2. cleanMarkdownFence(text) — 清理 AI 输出中多余的 markdown 代码围栏
 *
 * 所有 Prompt 构建逻辑已迁移至 prompts/ 子模块，
 * 所有工作流编排逻辑已迁移至 workflow.js。
 *
 * 使用方式：
 *   import { callChat, cleanMarkdownFence } from './ai-client.js';
 *   const reply = await callChat([
 *     { role: 'system', content: '...' },
 *     { role: 'user', content: '...' },
 *   ]);
 */

import OpenAI from 'openai';
import { loadAIClientConfig } from '../utils/ai-config.js';

// ==================== API 配置 ====================

const runtimeAIConfig = loadAIClientConfig();

/** OpenAI 客户端单例 */
const client = new OpenAI({
  apiKey: runtimeAIConfig.apiKey,
  baseURL: runtimeAIConfig.baseUrl,
});

// ==================== 重试配置 ====================

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

// ==================== 核心 API ====================

/**
 * 调用 OpenAI Chat Completions API（带全局重试机制）
 *
 * @param {Array<{role: string, content: string}>} messages - 消息数组（system + user + ...）
 * @param {Object} [options] - 可选参数
 * @param {number} [options.temperature=0.2] - 生成温度（0~2）
 * @param {number} [options.maxTokens=2000] - 最大生成 token 数
 * @param {string} [options.model] - 覆盖默认模型名称
 * @returns {Promise<string>} AI 生成的回复文本
 * @throws {Error} API 调用失败或返回空结果时抛出错误
 */
export async function callChat(messages, options = {}) {
  const {
    temperature = 0.2,
    maxTokens = 2000,
    model = runtimeAIConfig.model,
    response_format,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const requestOptions = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      // 如果提供了 response_format，则加入请求中（用于 JSON Schema 模式）
      if (response_format) {
        requestOptions.response_format = response_format;
      }

      const completion = await client.chat.completions.create(requestOptions);

      const content = completion.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('AI 返回空结果');
      }

      return content;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 指数退避: 2s, 4s
        console.warn(`[LLM 调用失败，第 ${attempt} 次重试] ${error.message}，${delay}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`[LLM 调用彻底失败] 已重试 ${MAX_RETRIES} 次，最终错误: ${lastError.message}`);
}

// ==================== 工具函数 ====================

/**
 * 清理 AI 输出中可能包裹的 markdown 代码围栏
 *
 * AI 有时会把整个回答用 ```markdown ... ``` 包裹起来，
 * 尽管 prompt 中已要求不要这样做。此函数将这层多余的围栏剥除，
 * 保留内部的纯内容。
 * 同时剥离 <thinking>...</thinking> 思考标签。
 *
 * @param {string} text - AI 原始输出文本
 * @returns {string} 清理后的文本
 */
export function cleanMarkdownFence(text) {
  if (!text) return '';

  let trimmed = text.trim();

  // 剥离常见思考/推理标签（MiniMax 等模型）
  trimmed = trimmed.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  trimmed = trimmed.replace(/[\s\S]*?<\/think>/gi, '');

  // 剥离完整 markdown 代码块包裹（```json / ```markdown / ```）
  const fenced = trimmed.match(/^```(?:json|markdown)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) {
    return fenced[1].trim();
  }

  // 兼容旧逻辑：首尾 ``` 但中间无闭合换行
  if (/^```(?:markdown|json)?\s*\n/.test(trimmed) && trimmed.endsWith('```')) {
    const firstNewline = trimmed.indexOf('\n');
    return trimmed.slice(firstNewline + 1, trimmed.length - 3).trim();
  }

  return trimmed;
}

/**
 * 从 LLM 原始输出中提取首个 JSON 对象片段
 *
 * @param {string} text
 * @returns {string|null}
 */
export function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * 解析 LLM 输出为 JSON 对象（清理围栏 → 直接 parse → 暴力提取）
 *
 * @param {string} text - LLM 原始输出
 * @returns {Object}
 * @throws {Error} 无法解析时抛出
 */
export function parseJsonFromLlmReply(text) {
  const cleaned = cleanMarkdownFence(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_) {
    // fall through
  }

  const extracted = extractFirstJsonObject(cleaned);
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_) {
      // fall through
    }
  }

  throw new Error('无法从 LLM 输出解析 JSON 对象');
}

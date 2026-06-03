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

// ==================== 核心 API ====================

/**
 * 调用 OpenAI Chat Completions API
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
  } = options;

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const content = completion.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI 返回空结果');
  }

  return content;
}

// ==================== 工具函数 ====================

/**
 * 清理 AI 输出中可能包裹的 markdown 代码围栏
 *
 * AI 有时会把整个回答用 ```markdown ... ``` 包裹起来，
 * 尽管 prompt 中已要求不要这样做。此函数将这层多余的围栏剥除，
 * 保留内部的纯内容。
 *
 * @param {string} text - AI 原始输出文本
 * @returns {string} 清理后的文本
 */
export function cleanMarkdownFence(text) {
  if (!text) return '';

  const trimmed = text.trim();

  // 检测是否以 ```markdown 或 ``` 开头，且以 ``` 结尾
  if (/^```(?:markdown)?\s*\n/.test(trimmed) && trimmed.endsWith('```')) {
    const firstNewline = trimmed.indexOf('\n');
    return trimmed.slice(firstNewline + 1, trimmed.length - 3).trim();
  }

  return trimmed;
}

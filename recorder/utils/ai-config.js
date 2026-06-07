/**
 * ai-config.js - AI 配置加载器
 *
 * 目标：
 * 1. 开发环境和 EXE 运行时都能读取同一份本地配置
 * 2. 敏感信息不写入源码，优先读取运行目录的配置文件
 * 3. 提供环境变量兜底能力
 *
 * 配置查找优先级：
 *   1) process.cwd()/config/ai.local.json
 *   2) dirname(process.execPath)/config/ai.local.json
 *   3) 环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL
 */

import fs from 'fs';
import path from 'path';

/** 本地 AI 配置相对路径（相对于运行目录） */
const AI_LOCAL_CONFIG_SUBPATH = path.join('config', 'ai.local.json');

/** 默认模型名（未显式配置时使用） */
const DEFAULT_MODEL_NAME = 'Qwen/Qwen3-VL-235B-A22B-Instruct';

/**
 * 构建候选配置文件路径列表
 *
 * @returns {string[]} 候选路径（按优先级排序，去重）
 */
function buildCandidateConfigPaths() {
  const candidates = [];

  // 1) 运行目录（开发环境/EXE 通用）
  candidates.push(path.resolve(process.cwd(), AI_LOCAL_CONFIG_SUBPATH));

  // 1b) recorder/config/ 目录（项目重构后的路径）
  candidates.push(path.resolve(process.cwd(), 'recorder', AI_LOCAL_CONFIG_SUBPATH));

  // 2) 可执行文件所在目录（EXE 双击时更稳妥）
  if (process.execPath) {
    const exeDir = path.dirname(process.execPath);
    candidates.push(path.resolve(exeDir, AI_LOCAL_CONFIG_SUBPATH));
  }

  // 去重并保持顺序
  return Array.from(new Set(candidates));
}

/**
 * 尝试从本地 JSON 文件读取 AI 配置
 *
 * @param {string[]} candidatePaths - 候选路径列表
 * @returns {{ config: Object|null, source: string|null }}
 */
function loadFromLocalFile(candidatePaths) {
  for (const configPath of candidatePaths) {
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      // 兼容 Windows 下可能带 BOM 的 UTF-8 文件，避免 JSON.parse 报错
      const normalizedRaw = raw.replace(/^\uFEFF/, '');
      const parsed = JSON.parse(normalizedRaw);
      return {
        config: parsed,
        source: `file:${configPath}`,
      };
    } catch (error) {
      throw new Error(`AI 配置文件解析失败: ${configPath} (${error.message})`);
    }
  }

  return { config: null, source: null };
}

/**
 * 从环境变量读取 AI 配置
 *
 * @returns {{ config: Object, source: string }}
 */
function loadFromEnv() {
  return {
    config: {
      baseUrl: process.env.AI_BASE_URL,
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL,
    },
    source: 'env',
  };
}

/**
 * 归一化并校验配置
 *
 * @param {Object|null} config - 原始配置对象
 * @param {string|null} source - 配置来源
 * @param {string[]} candidatePaths - 候选路径列表（用于错误提示）
 * @returns {{ baseUrl: string, apiKey: string, model: string, source: string }}
 */
function normalizeAndValidate(config, source, candidatePaths) {
  const baseUrl = (config?.baseUrl || '').trim();
  const apiKey = (config?.apiKey || '').trim();
  const model = (config?.model || DEFAULT_MODEL_NAME).trim();

  const missing = [];
  if (!baseUrl) missing.push('baseUrl');
  if (!apiKey) missing.push('apiKey');

  if (missing.length > 0) {
    const searched = candidatePaths.map(p => `  - ${p}`).join('\n');
    throw new Error(
      `AI 配置缺失字段: ${missing.join(', ')}\n` +
      `请在以下任一路径创建配置文件（推荐）:\n${searched}\n` +
      '或设置环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL。'
    );
  }

  return {
    baseUrl,
    apiKey,
    model,
    source: source || 'unknown',
  };
}

/**
 * 加载 AI 客户端配置（运行时调用）
 *
 * @returns {{ baseUrl: string, apiKey: string, model: string, source: string }}
 */
export function loadAIClientConfig() {
  const candidatePaths = buildCandidateConfigPaths();

  // 优先本地文件
  const fromFile = loadFromLocalFile(candidatePaths);
  if (fromFile.config) {
    return normalizeAndValidate(fromFile.config, fromFile.source, candidatePaths);
  }

  // 兜底环境变量
  const fromEnv = loadFromEnv();
  return normalizeAndValidate(fromEnv.config, fromEnv.source, candidatePaths);
}


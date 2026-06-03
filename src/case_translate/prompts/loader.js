/**
 * loader.js - Prompt Markdown 加载与占位符替换
 *
 * 所有 LLM 提示词正文存放在 prompts/md/*.md，代码只负责读取与插值。
 * JSON Schema 存放在 prompts/schema/*.json。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 运行时 Markdown 缓存（避免重复读盘） */
const markdownCache = new Map();

/**
 * 解析 Prompt Markdown 目录（兼容开发目录与 EXE 分发目录）
 *
 * @returns {string}
 */
function resolveMdDir() {
  const candidates = [
    path.join(__dirname, 'md'),
    path.join(process.cwd(), 'src/case_translate/prompts/md'),
    path.join(path.dirname(process.execPath), 'prompts/md'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`找不到 Prompt Markdown 目录，已尝试: ${candidates.join(' | ')}`);
}

/**
 * 解析 Prompt Schema 目录
 *
 * @returns {string}
 */
function resolveSchemaDir() {
  const candidates = [
    path.join(__dirname, 'schema'),
    path.join(process.cwd(), 'src/case_translate/prompts/schema'),
    path.join(path.dirname(process.execPath), 'prompts/schema'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`找不到 Prompt Schema 目录，已尝试: ${candidates.join(' | ')}`);
}

/**
 * 读取 Markdown Prompt 并替换 {{key}} 占位符
 *
 * @param {string} relativePath - 相对 prompts/md/ 的路径
 * @param {Record<string, string|number>} [vars] - 占位符键值
 * @returns {string}
 */
export function loadPromptMd(relativePath, vars = {}) {
  let text = markdownCache.get(relativePath);
  if (text === undefined) {
    const fullPath = path.join(resolveMdDir(), relativePath);
    text = fs.readFileSync(fullPath, 'utf-8').replace(/^\uFEFF/, '');
    markdownCache.set(relativePath, text);
  }

  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return result.trim();
}

/**
 * 读取 JSON Schema 文件
 *
 * @param {string} relativePath - 相对 prompts/schema/ 的路径
 * @returns {Object}
 */
export function loadPromptSchema(relativePath) {
  const fullPath = path.join(resolveSchemaDir(), relativePath);
  const raw = fs.readFileSync(fullPath, 'utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

/**
 * 清空 Markdown 缓存（Prompt 文件修改后可用于热重载）
 */
export function clearPromptCache() {
  markdownCache.clear();
}

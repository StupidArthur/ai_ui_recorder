/**
 * loader.js - 加载 Skill Prompt Markdown（User 消息由各 *.js 内嵌拼接）
 *
 * 所有 LLM Skill 提示词存放在 prompts/md/*-skill.md；User 消息由各 prompts/*.js 内嵌拼接。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 模块所在目录（ESM 开发环境）；pkg CJS bundle 下为 null，改由 execPath 解析 prompts/
 */
let moduleDir = null;
try {
  if (import.meta.url) {
    moduleDir = path.dirname(fileURLToPath(import.meta.url));
  }
} catch (_) {
  // pkg 打包后 import.meta.url 不可用
}

/** 运行时 Markdown 缓存（避免重复读盘） */
const markdownCache = new Map();

/**
 * 解析 Prompt Markdown 目录（兼容开发目录与 EXE 分发目录）
 *
 * @returns {string}
 */
function resolveMdDir() {
  const candidates = [];
  if (moduleDir) {
    candidates.push(path.join(moduleDir, 'md'));
  }
  candidates.push(
    path.join(path.dirname(process.execPath), 'prompts/md'),
    path.join(process.cwd(), 'src/case_translate/prompts/md'),
  );
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`找不到 Prompt Markdown 目录，已尝试: ${candidates.join(' | ')}`);
}

/**
 * 读取 Skill Prompt Markdown 文件
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
 * 清空 Markdown 缓存（Prompt 文件修改后可用于热重载）
 */
export function clearPromptCache() {
  markdownCache.clear();
}

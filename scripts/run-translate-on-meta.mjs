/**
 * run-translate-on-meta.mjs - 对指定 meta.json 跑翻译（开发调试用）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../src/case_translate/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function loadAiEnv() {
  const candidates = [
    path.join(repoRoot, 'config', 'ai.local.json'),
    path.join(repoRoot, 'release1', 'config', 'ai.local.json'),
  ];
  for (const configPath of candidates) {
    if (!fs.existsSync(configPath)) continue;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
    if (config.baseUrl) process.env.AI_BASE_URL = String(config.baseUrl).trim();
    if (config.apiKey) process.env.AI_API_KEY = String(config.apiKey).trim();
    if (config.model) process.env.AI_MODEL = String(config.model).trim();
    console.log(`[INFO] AI 配置: ${configPath}`);
    return;
  }
  console.warn('[WARN] 未找到 ai.local.json');
}

/** 要翻译的 run 目录名列表（相对 release1/output） */
const RUN_NAMES = [
  'run_2026-06-03T07-11-48',
  'run_2026-06-03T10-35-53',
];

loadAiEnv();

for (const runName of RUN_NAMES) {
  const metaPath = path.join(repoRoot, 'release1/output', runName, 'meta.json');
  console.log(`\n========== 翻译: ${runName} ==========\n`);
  await generate(metaPath);
}

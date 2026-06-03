/**
 * regenerate-from-structured.js - 由 step_2 + enriched 重写 Selenium 终稿 Python
 *
 * 禁止仅用原始 actions/ 推断输入；代码行一律来自 preprocessed/enriched。
 */

import fs from 'fs';
import path from 'path';

import {
  META_FILENAME,
  PREPROCESSED_SUBDIR,
  ENRICHED_DATA_SUBDIR,
  AI_STEPS_STRUCTURED_FILENAME,
  SELENIUM_FINAL_FILENAME,
} from '../utils/config.js';
import { buildFinalHeader, buildFinalFooter } from './templates.js';
import { actionToDriver4Lines } from './action-to-driver4.js';

/**
 * 解析 step_2 JSON（数组）
 *
 * @param {string} runDir
 * @returns {Array<Object>}
 */
function readStructuredSteps(runDir) {
  const p = path.join(runDir, AI_STEPS_STRUCTURED_FILENAME);
  if (!fs.existsSync(p)) {
    throw new Error(`未找到结构化步骤文件: ${p}`);
  }
  const raw = fs.readFileSync(p, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`结构化步骤格式错误: 应为数组`);
  }
  return data;
}

/**
 * 读取 meta 起始 URL
 *
 * @param {string} runDir
 * @returns {string}
 */
function readStartUrl(runDir) {
  const metaPath = path.join(runDir, META_FILENAME);
  if (!fs.existsSync(metaPath)) return '';
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return meta.targetUrl || meta.actionSummary?.[0]?.url || '';
  } catch {
    return '';
  }
}

/**
 * enriched 文件路径（action index 1-based）
 *
 * @param {string} runDir
 * @param {number} actionIndex
 * @returns {string}
 */
function enrichedFilePath(runDir, actionIndex) {
  const enrichedDir = path.join(runDir, PREPROCESSED_SUBDIR, ENRICHED_DATA_SUBDIR);
  return path.join(enrichedDir, `enriched_${String(actionIndex).padStart(3, '0')}.json`);
}

/**
 * 加载单条 enriched action
 *
 * @param {string} runDir
 * @param {number} actionIndex
 * @returns {Object|null}
 */
function loadEnrichedAction(runDir, actionIndex) {
  const fp = enrichedFilePath(runDir, actionIndex);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 结构化步骤中用于生成代码的 action 序号列表
 *
 * @param {Object} step
 * @returns {number[]}
 */
export function resolveSourceActionIndices(step) {
  const fallback = [step.index];
  const raw = step.sourceActionIndices;
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const nums = raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length > 0 ? nums : fallback;
}

/**
 * 将 description 拆成多行注释
 *
 * @param {string} text
 * @returns {string[]}
 */
function descriptionToCommentLines(text) {
  const t = String(text || '').trim() || '(无描述)';
  return t.split(/\r?\n/).map((line) => `    # ${line.replace(/^\s+/, '')}`);
}

/**
 * 生成终稿全文并写入 run 目录
 *
 * @param {string} runDir
 * @param {Object} [options]
 * @param {Object} [options.log]
 * @returns {{ finalPath: string, lineCount: number }}
 */
export function regenerateFromStructured(runDir, options = {}) {
  const { log } = options;
  const steps = readStructuredSteps(runDir);
  const startUrl = readStartUrl(runDir);

  const outPath = path.join(runDir, SELENIUM_FINAL_FILENAME);
  const parts = [buildFinalHeader(startUrl)];

  for (const step of steps) {
    const indices = resolveSourceActionIndices(step);
    parts.push(`    # semantic_step_index=${step.index} status=${step.status || 'normal'}`);
    parts.push(...descriptionToCommentLines(step.description));

    if (step.status === 'skip' || step.status === 'noise') {
      parts.push(`    # （本步为 skip/noise，不生成 Driver4 调用）`);
      parts.push('');
      continue;
    }

    for (const aid of indices) {
      const enriched = loadEnrichedAction(runDir, aid);
      if (!enriched) {
        parts.push(
          `    # TODO: 缺少 enriched_${String(aid).padStart(3, '0')}.json，跳过`,
        );
        continue;
      }
      if (enriched.skip) {
        parts.push(`    # enriched action ${aid} skip=${JSON.stringify(enriched.skip)}`);
        continue;
      }
      parts.push(`    # --- enriched action index=${aid} type=${enriched.type} ---`);
      parts.push(actionToDriver4Lines(enriched, { indent: '    ' }));
    }
    parts.push('');
  }

  parts.push(buildFinalFooter());
  const body = parts.join('\n');
  fs.writeFileSync(outPath, body, 'utf-8');

  const lineCount = body.split(/\r?\n/).length;
  if (log) {
    log.info(`Selenium 终稿已写入: ${outPath}（约 ${lineCount} 行）`);
  }

  return { finalPath: outPath, lineCount };
}

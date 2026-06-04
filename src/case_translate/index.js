/**
 * index.js - AI 用例翻译入口模块
 *
 * 纯入口，只做三件事：
 * 1. 查找 meta.json（自动定位最近一次录制）
 * 2. 调用 preprocessor 进行数据预处理
 * 3. 调用 workflow 执行 AI 翻译工作流（结构化步骤 + Case 归纳 + Agent TXT）
 *
 * 与录制模块完全解耦：
 * - 录制器负责生产 meta.json + actions/ + snapshots/（数据生产者）
 * - 本模块负责消费这些数据（数据消费者）
 * - 可对同一份录制数据反复运行
 *
 * 运行方式：
 *   node src/case_translate
 *
 * 默认自动查找最近一次录制的 meta.json。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '../utils/logger.js';
import {
  OUTPUT_BASE_DIR,
  META_FILENAME,
  GENERATE_LOG_FILENAME,
} from '../utils/config.js';

import { preprocess } from './preprocessor/index.js';
import { runWorkflow } from './workflow.js';
import { pingLlm } from './ai-client.js';

// ==================== 工具函数 ====================

/**
 * 自动查找最近一次录制的 meta.json 文件
 * 扫描 output/ 目录下所有 run_* 子目录，按名称倒序取最新的
 *
 * @returns {string|null} meta.json 的路径，找不到返回 null
 */
function findLatestMetaFile() {
  const outputDir = OUTPUT_BASE_DIR;

  if (!fs.existsSync(outputDir)) return null;

  const runDirs = fs.readdirSync(outputDir)
    .filter(name => name.startsWith('run_'))
    .map(name => path.join(outputDir, name))
    .filter(p => fs.statSync(p).isDirectory())
    .sort()
    .reverse();

  for (const dir of runDirs) {
    const metaFile = path.join(dir, META_FILENAME);
    if (fs.existsSync(metaFile)) {
      return metaFile;
    }
  }

  return null;
}

// ==================== 入口函数 ====================

/**
 * 从录制数据生成 AI 测试用例（完整流水线）
 *
 * 流程：查找 meta → 预处理 → AI 工作流（Phase 1 + Phase 2 + Phase 3）
 *
 * @param {string} [metaFilePath] - meta.json 的路径，不传则自动查找最近一次录制
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.onLog] - 日志消息回调（可选，Dashboard 模式使用）
 * @param {boolean} [options.skipLlmPing=false] - 为 true 时跳过开始前 LLM 探活（Dashboard 已在 HTTP 层探活）
 * @returns {Promise<{ stepsFile: string, casesFile: string }>} 生成的文件路径
 * @throws {Error} 找不到文件或 AI 返回空结果时抛出错误
 */
export async function generate(metaFilePath, options = {}) {
  const { onLog, skipLlmPing = false } = options;

  // ---------- 确定 meta.json 路径 ----------
  const targetFile = metaFilePath || findLatestMetaFile();

  if (!targetFile) {
    throw new Error('未找到 meta.json 文件。请指定路径或先运行录制器。');
  }

  if (!fs.existsSync(targetFile)) {
    throw new Error(`文件不存在: ${targetFile}`);
  }

  // ---------- 初始化日志 ----------
  const runDir = path.dirname(targetFile);
  const logFile = path.join(runDir, GENERATE_LOG_FILENAME);
  const log = createLogger(logFile, { onMessage: onLog });

  log.info('========== AI 测试用例生成 ==========');
  log.info(`录制数据目录: ${runDir}`);

  if (!skipLlmPing) {
    log.info('正在检测 LLM 连通性（探活）...');
    try {
      const pingReply = await pingLlm();
      const preview = pingReply.length > 40 ? `${pingReply.slice(0, 40)}...` : pingReply;
      log.info(`LLM 探活成功: ${preview}`);
    } catch (error) {
      if (error.detail) {
        log.warn(`LLM 探活详情: ${error.detail}`);
      }
      log.error(error.message);
      throw error;
    }
  }

  // ---------- 第1步：数据预处理 ----------
  const { enrichedActions, meta } = await preprocess(runDir, { log });

  if (!enrichedActions || enrichedActions.length === 0) {
    log.warn('预处理结果为空，无法生成测试用例');
    return { stepsFile: null, casesFile: null };
  }

  log.info(`预处理完成: ${enrichedActions.length} 条富化数据`);

  // ---------- 第2步：AI 翻译工作流 ----------
  const result = await runWorkflow(runDir, enrichedActions, { log });

  log.info('========== AI 测试用例生成完成 ==========');
  console.log(`\n测试用例: ${result.casesFile}`);
  console.log(`步骤分析: ${result.stepsFile}`);

  return result;
}

/**
 * 导出给统一入口调用
 *
 * @param {string} [metaFilePath]
 * @param {Object} [options]
 * @returns {Promise<{ stepsFile: string, casesFile: string }>}
 */
export async function runTranslate(metaFilePath = undefined, options = {}) {
  return generate(metaFilePath, options);
}

// ==================== 主程序入口 ====================

/**
 * 判断当前模块是否被直接运行（而非被 import）
 * ES Module 中没有 require.main，用 process.argv[1] 与 import.meta.url 对比
 */
function isMainModule() {
  try {
    const metaUrl = import.meta?.url;
    if (!metaUrl) return false;
    const modulePath = fileURLToPath(metaUrl);
    const runPath = path.resolve(process.argv[1]);
    return runPath === modulePath || runPath + path.sep + 'index.js' === modulePath;
  } catch (_) {
    return false;
  }
}

// 仅在命令行直接运行时调用（Dashboard 模式通过 import { generate } 使用）
if (isMainModule()) {
  /** 从函数参数获取 meta.json 路径（不使用命令行参数） */
  const META_FILE_PATH = undefined; // 设为 undefined 则自动查找最近一次录制

  generate(META_FILE_PATH).catch((error) => {
    console.error('生成失败:', error.message);
    process.exit(1);
  });
}

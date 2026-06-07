/**
 * standalone-cli.js - 独立翻译启动器（可打包 EXE）
 *
 * 设计目标：
 * 1. 启动器可放在 output 文件夹同级目录运行（目标机可无 Node）
 * 2. ai.local.json 放在启动器同级目录即可生效
 * 3. 默认翻译 output/ 下最新 run_* 目录
 * 4. 支持命令行参数指定 output 下的目录名（例如 run_2026-03-09T12-00-00）
 *
 * 用法（Node）：
 *   node src/case_translate/standalone-cli.js
 *   node src/case_translate/standalone-cli.js run_2026-03-09T12-00-00
 *
 * 用法（EXE）：
 *   .\translate-standalone.exe
 *   .\translate-standalone.exe run_2026-03-09T12-00-00
 */

import fs from 'fs';
import path from 'path';

import { runTranslate } from './index.js';

/** 运行目录下 output 文件夹名 */
const OUTPUT_DIR_NAME = 'output';

/** 运行目录同级 AI 配置文件名 */
const LOCAL_AI_CONFIG_FILENAME = 'ai.local.json';

/** 录制目录前缀 */
const RUN_DIR_PREFIX = 'run_';

/** 元信息文件名 */
const META_FILENAME = 'meta.json';

/**
 * 获取启动器所在目录
 *
 * 说明：
 * - EXE 场景：使用 process.execPath 所在目录
 * - Node 场景：使用当前工作目录 process.cwd()
 *
 * @returns {string}
 */
function getLauncherDir() {
  const isPkg = typeof process.pkg !== 'undefined';
  if (isPkg) {
    return path.dirname(process.execPath);
  }
  return process.cwd();
}

/**
 * 从启动器同级目录读取 ai.local.json，并注入到环境变量
 * 这样可复用现有 ai-config 的环境变量兜底逻辑。
 *
 * @param {string} launcherDir - 启动器目录
 */
function loadSiblingAIConfigToEnv(launcherDir) {
  const configPath = path.join(launcherDir, LOCAL_AI_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    console.log(`[INFO] 未找到同级 AI 配置文件: ${configPath}`);
    return;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
    const config = JSON.parse(raw);
    if (config.baseUrl) process.env.AI_BASE_URL = String(config.baseUrl).trim();
    if (config.apiKey) process.env.AI_API_KEY = String(config.apiKey).trim();
    if (config.model) process.env.AI_MODEL = String(config.model).trim();
    console.log(`[INFO] 已加载同级 AI 配置: ${configPath}`);
  } catch (error) {
    throw new Error(`解析 ai.local.json 失败: ${configPath} (${error.message})`);
  }
}

/**
 * 在 output 下查找最新 run_* 目录
 *
 * @param {string} outputDir - output 绝对路径
 * @returns {string|null}
 */
function findLatestRunDir(outputDir) {
  if (!fs.existsSync(outputDir)) return null;

  const runDirs = fs.readdirSync(outputDir)
    .filter((name) => name.startsWith(RUN_DIR_PREFIX))
    .map((name) => path.join(outputDir, name))
    .filter((dirPath) => {
      try {
        return fs.statSync(dirPath).isDirectory();
      } catch (_) {
        return false;
      }
    })
    .sort()
    .reverse();

  for (const runDir of runDirs) {
    const metaPath = path.join(runDir, META_FILENAME);
    if (fs.existsSync(metaPath)) {
      return runDir;
    }
  }
  return null;
}

/**
 * 解析命令行参数中的目标录制目录名
 *
 * @returns {string|undefined}
 */
function parseTargetRunDirName() {
  const rawArg = process.argv[2];
  if (!rawArg) return undefined;

  // 允许用户传 run_xxx，或误传 output/run_xxx，统一取 basename
  const runDirName = path.basename(rawArg);
  return runDirName;
}

/**
 * 根据可选目录名，解析最终 meta.json 绝对路径
 *
 * @param {string} outputDir - output 绝对路径
 * @param {string|undefined} runDirName - 目标 run 目录名
 * @returns {string}
 */
function resolveMetaPath(outputDir, runDirName) {
  let runDir;

  if (runDirName) {
    runDir = path.join(outputDir, runDirName);
    if (!fs.existsSync(runDir)) {
      throw new Error(`指定目录不存在: ${runDir}`);
    }
  } else {
    runDir = findLatestRunDir(outputDir);
    if (!runDir) {
      throw new Error(`未找到可翻译目录，请确认存在: ${outputDir}\\run_*`);
    }
  }

  const metaPath = path.join(runDir, META_FILENAME);
  if (!fs.existsSync(metaPath)) {
    throw new Error(`缺少 meta.json: ${metaPath}`);
  }
  return metaPath;
}

/**
 * 独立翻译启动入口
 */
async function run() {
  try {
    const launcherDir = getLauncherDir();
    const outputDir = path.join(launcherDir, OUTPUT_DIR_NAME);
    const runDirName = parseTargetRunDirName();

    console.log(`[INFO] 启动器目录: ${launcherDir}`);
    console.log(`[INFO] 输出目录: ${outputDir}`);

    loadSiblingAIConfigToEnv(launcherDir);
    const metaPath = resolveMetaPath(outputDir, runDirName);

    console.log(`[INFO] 翻译目标: ${path.dirname(metaPath)}`);
    await runTranslate(metaPath);
  } catch (error) {
    console.error(`翻译失败: ${error.message}`);
    process.exit(1);
  }
}

run();


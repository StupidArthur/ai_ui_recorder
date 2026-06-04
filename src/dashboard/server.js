/**
 * server.js - Dashboard HTTP 服务与 API 路由
 *
 * 提供以下能力：
 * - 静态文件服务（index.html 等）
 * - RESTful API（录制控制、AI 翻译控制、录制历史查阅）
 * - SSE（Server-Sent Events）实时日志推送
 *
 * 不引入任何外部 HTTP 框架，仅使用 Node.js 内置 http 模块。
 *
 * API 列表：
 *   GET  /api/status              - 获取当前状态和配置
 *   POST /api/record/start        - 开始录制
 *   POST /api/record/stop         - 停止录制
 *   POST /api/translate/start     - 开始 AI 翻译
 *   GET  /api/runs                - 获取所有录制历史列表
 *   GET  /api/runs/:runId/files   - 列出该 run 下可预览的「给人看」产物（白名单且已生成）
 *   GET  /api/runs/:runId/file    - 读取指定录制目录下的文件
 *   GET  /api/logs                - SSE 实时日志流
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  TARGET_URL,
  OUTPUT_BASE_DIR,
  META_FILENAME,
  AI_STEPS_FILENAME,
  AI_STEPS_STRUCTURED_FILENAME,
  AI_CASES_FILENAME,
  AI_STEPS_ERRORS_FILENAME,
  PREPROCESS_LOG_FILENAME,
  GENERATE_LOG_FILENAME,
  DASHBOARD_PREVIEW_FILES,
} from '../utils/config.js';

// ==================== 常量 ====================

/** Dashboard HTTP 服务端口 */
const DASHBOARD_PORT = 3000;

/**
 * 返回 run 目录下「给人看」且已生成的预览文件（白名单 + 存在性检查）
 *
 * @param {string} runDir - run 绝对路径
 * @returns {string[]}
 */
function listRunPreviewFiles(runDir) {
  return DASHBOARD_PREVIEW_FILES.filter((name) => fs.existsSync(path.join(runDir, name)));
}

/** 静态文件目录（pkg 打包时 import.meta.url 为 undefined，用 exe 所在目录） */
let STATIC_DIR;
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  STATIC_DIR = path.join(__dirname, 'static');
} catch (_) {
  STATIC_DIR = path.join(path.dirname(process.execPath), 'static');
}

/** MIME 类型映射 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ==================== 全局状态 ====================

/**
 * 应用状态枚举
 * @enum {string}
 */
const AppState = {
  IDLE: 'idle',
  RECORDING: 'recording',
  TRANSLATING: 'translating',
};

/** 当前应用状态 */
let currentState = AppState.IDLE;

/** 当前 Recorder 实例（录制中有效） */
let currentRecorder = null;

/** 当前录制的 runDir（录制完成后保留，供翻译使用） */
let lastRunDir = null;

/** SSE 客户端连接集合 */
const sseClients = new Set();

/** 延迟加载模块缓存（避免 dashboard 启动即触发 Playwright 加载） */
let RecorderClass = null;
let generateFn = null;

// ==================== SSE 日志广播 ====================

/**
 * 向所有 SSE 客户端广播一条日志消息
 *
 * @param {Object} logEntry - 日志条目
 * @param {string} logEntry.level - 日志级别（INFO/WARN/ERROR）
 * @param {string} logEntry.message - 日志消息
 * @param {string} logEntry.timestamp - ISO 时间戳
 * @param {string} logEntry.logLine - 完整格式化日志行
 */
function broadcastLog(logEntry) {
  const data = JSON.stringify(logEntry);
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

/**
 * 广播一条状态变更事件
 *
 * @param {string} state - 新状态
 * @param {Object} [extra] - 附加信息
 */
function broadcastStateChange(state, extra = {}) {
  const data = JSON.stringify({ type: 'state', state, ...extra });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// ==================== 工具函数 ====================

/**
 * 读取请求体 JSON
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<Object>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('无效的 JSON 请求体'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 *
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {Object} data
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/**
 * 发送错误响应
 *
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {string} message
 */
function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

/**
 * 获取所有录制历史目录列表
 *
 * @returns {Array<Object>} 录制历史列表，按时间倒序
 */
function getRunsList() {
  const outputDir = OUTPUT_BASE_DIR;
  if (!fs.existsSync(outputDir)) return [];

  const runs = fs.readdirSync(outputDir)
    .filter(name => name.startsWith('run_'))
    .map(name => {
      const runDir = path.join(outputDir, name);
      const metaFile = path.join(runDir, META_FILENAME);
      const hasMeta = fs.existsSync(metaFile);
      const hasSteps = fs.existsSync(path.join(runDir, AI_STEPS_STRUCTURED_FILENAME))
        || fs.existsSync(path.join(runDir, AI_STEPS_FILENAME));
      const hasCases = fs.existsSync(path.join(runDir, AI_CASES_FILENAME));
      const hasStepErrors = fs.existsSync(path.join(runDir, AI_STEPS_ERRORS_FILENAME));
      const hasAgentTxt = fs.existsSync(path.join(runDir, 'case_4_agents.txt'));
      const hasPreprocessLog = fs.existsSync(path.join(runDir, PREPROCESS_LOG_FILENAME));
      const hasGenerateLog = fs.existsSync(path.join(runDir, GENERATE_LOG_FILENAME));

      let meta = null;
      if (hasMeta) {
        try {
          meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        } catch (_) { /* ignore */ }
      }

      return {
        id: name,
        dir: runDir,
        hasMeta,
        hasSteps,
        hasCases,
        hasStepErrors,
        hasAgentTxt,
        hasPreprocessLog,
        hasGenerateLog,
        totalActions: meta?.totalActions || 0,
        targetUrl: meta?.targetUrl || '',
        recordStartTime: meta?.recordStartTime || '',
        recordEndTime: meta?.recordEndTime || '',
      };
    })
    .sort((a, b) => b.id.localeCompare(a.id));

  return runs;
}

/**
 * 按需加载 Recorder 模块
 *
 * 仅在真正开始录制时加载，避免 Dashboard 启动阶段触发 Playwright 模块初始化。
 */
async function ensureRecorderModuleLoaded() {
  if (!RecorderClass) {
    // #region agent log
    fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H3',location:'src/dashboard/server.js:ensureRecorderModuleLoaded:beforeImport',message:'before import recorder module',data:{remainingMcpEnvKeys:Object.keys(process.env||{}).filter(k=>k.startsWith('PLAYWRIGHT_MCP_'))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const recorderModule = await import('../recorder/recorder.js');
    RecorderClass = recorderModule.Recorder;
    // #region agent log
    fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H3',location:'src/dashboard/server.js:ensureRecorderModuleLoaded:afterImport',message:'after import recorder module',data:{recorderLoaded:!!RecorderClass},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }
}

/**
 * 按需加载翻译模块
 */
async function ensureTranslateModuleLoaded() {
  if (!generateFn) {
    const translateModule = await import('../case_translate/index.js');
    generateFn = translateModule.generate;
  }
}

// ==================== API 处理器 ====================

/**
 * GET /api/status - 获取当前状态
 */
function handleStatus(req, res) {
  sendJSON(res, 200, {
    state: currentState,
    defaultUrl: TARGET_URL,
    lastRunDir: lastRunDir ? path.basename(lastRunDir) : null,
  });
}

/**
 * POST /api/record/start - 开始录制
 */
async function handleRecordStart(req, res) {
  if (currentState !== AppState.IDLE) {
    return sendError(res, 400, `当前状态为 ${currentState}，无法开始录制`);
  }

  try {
    const body = await readBody(req);
    const url = body.url || TARGET_URL;

    if (!url) {
      return sendError(res, 400, '未提供录制 URL');
    }

    currentState = AppState.RECORDING;
    broadcastStateChange(AppState.RECORDING);

    // 延迟加载 Recorder（避免 Dashboard 启动即加载 Playwright）
    await ensureRecorderModuleLoaded();

    // 创建 Recorder 并注入日志回调
    currentRecorder = new RecorderClass({
      onLog: broadcastLog,
    });

    // 启动录制（异步）
    await currentRecorder.start(url);
    lastRunDir = currentRecorder.outputPaths.runDir;

    // 监听浏览器断开（用户关闭浏览器窗口 → 自动停止）
    currentRecorder.browser.on('disconnected', () => {
      // 等待 recorder 内部清理完成
      setTimeout(() => {
        currentState = AppState.IDLE;
        currentRecorder = null;
        broadcastStateChange(AppState.IDLE, { message: '录制完成（浏览器已关闭）' });
      }, 2000);
    });

    sendJSON(res, 200, {
      message: '录制已开始',
      runDir: path.basename(lastRunDir),
      url,
    });

  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H5',location:'src/dashboard/server.js:handleRecordStart:catch',message:'record start failed in api handler',data:{errorName:error?.name||'',errorMessage:error?.message||'',stackHead:(error?.stack||'').split('\\n').slice(0,4).join('\\n')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    currentState = AppState.IDLE;
    currentRecorder = null;
    sendError(res, 500, `启动录制失败: ${error.message}`);
  }
}

/**
 * POST /api/record/stop - 停止录制
 */
async function handleRecordStop(req, res) {
  if (currentState !== AppState.RECORDING || !currentRecorder) {
    return sendError(res, 400, '当前未在录制中');
  }

  try {
    await currentRecorder.stop();
    currentState = AppState.IDLE;
    const runDir = lastRunDir;
    currentRecorder = null;

    broadcastStateChange(AppState.IDLE, { message: '录制已手动停止' });

    sendJSON(res, 200, {
      message: '录制已停止',
      runDir: runDir ? path.basename(runDir) : null,
    });
  } catch (error) {
    currentState = AppState.IDLE;
    currentRecorder = null;
    sendError(res, 500, `停止录制失败: ${error.message}`);
  }
}

/**
 * POST /api/translate/start - 开始 AI 翻译
 */
async function handleTranslateStart(req, res) {
  if (currentState !== AppState.IDLE) {
    return sendError(res, 400, `当前状态为 ${currentState}，无法开始翻译`);
  }

  try {
    const body = await readBody(req);

    // 确定目标录制目录
    let metaFilePath = null;
    if (body.runId) {
      metaFilePath = path.join(OUTPUT_BASE_DIR, body.runId, META_FILENAME);
    }
    // 不传 runId 则由 generate 自动查找最近一次

    // Micro-batching 配置参数
    const phase1BatchSize = parseInt(body.phase1BatchSize) || 3;
    const phaseWindowSize = parseInt(body.phaseWindowSize) || 20;

    await ensureTranslateModuleLoaded();

    const { pingLlm, LLM_PING_FAIL_MESSAGE } = await import('../case_translate/ai-client.js');
    const pingTs = new Date().toISOString();
    broadcastLog({
      level: 'INFO',
      message: '正在检测 LLM 连通性...',
      timestamp: pingTs,
      logLine: `[${pingTs}] [INFO] 正在检测 LLM 连通性...`,
    });

    try {
      await pingLlm();
    } catch (pingError) {
      const failMsg = pingError?.message || LLM_PING_FAIL_MESSAGE;
      const failTs = new Date().toISOString();
      broadcastLog({
        level: 'ERROR',
        message: failMsg,
        timestamp: failTs,
        logLine: `[${failTs}] [ERROR] ${failMsg}`,
      });
      if (pingError?.detail) {
        const detailTs = new Date().toISOString();
        broadcastLog({
          level: 'WARN',
          message: `探活详情: ${pingError.detail}`,
          timestamp: detailTs,
          logLine: `[${detailTs}] [WARN] 探活详情: ${pingError.detail}`,
        });
      }
      return sendError(res, 503, failMsg);
    }

    currentState = AppState.TRANSLATING;
    broadcastStateChange(AppState.TRANSLATING);

    sendJSON(res, 200, { message: 'AI 翻译已开始' });

    // 异步执行翻译（探活已在上方完成）
    try {
      const result = await generateFn(metaFilePath, {
        onLog: broadcastLog,
        phase1BatchSize,
        phaseWindowSize,
        skipLlmPing: true,
      });
      currentState = AppState.IDLE;
      broadcastStateChange(AppState.IDLE, {
        message: 'AI 翻译完成',
        stepsFile: result.stepsFile,
        casesFile: result.casesFile,
      });
    } catch (error) {
      currentState = AppState.IDLE;
      broadcastStateChange(AppState.IDLE, {
        message: `AI 翻译失败: ${error.message}`,
      });
    }

  } catch (error) {
    currentState = AppState.IDLE;
    sendError(res, 500, `启动翻译失败: ${error.message}`);
  }
}

/**
 * GET /api/runs - 获取录制历史列表
 */
function handleGetRuns(req, res) {
  const runs = getRunsList();
  sendJSON(res, 200, { runs });
}

/**
 * GET /api/runs/:runId/files - 列出该 run 下可预览的文件
 */
function handleGetRunFiles(req, res, runId) {
  if (!runId || runId.includes('..') || runId.includes('/') || runId.includes('\\')) {
    return sendError(res, 400, '非法 runId');
  }

  const runDir = path.join(OUTPUT_BASE_DIR, runId);
  if (!fs.existsSync(runDir)) {
    return sendError(res, 404, '录制目录不存在');
  }

  try {
    const files = listRunPreviewFiles(runDir);
    sendJSON(res, 200, { files });
  } catch (error) {
    sendError(res, 500, `扫描文件失败: ${error.message}`);
  }
}

/**
 * GET /api/runs/:runId/file?path=xxx - 读取指定录制目录下的文件
 */
function handleGetRunFile(req, res, runId, filePath) {
  if (!runId || !filePath) {
    return sendError(res, 400, '缺少 runId 或 path 参数');
  }

  // 安全检查：防止路径穿越
  const normalizedPath = path.normalize(filePath);
  if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
    return sendError(res, 403, '非法路径');
  }

  const fullPath = path.join(OUTPUT_BASE_DIR, runId, normalizedPath);

  if (!fs.existsSync(fullPath)) {
    return sendError(res, 404, '文件不存在');
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      // 列出目录内容
      const files = fs.readdirSync(fullPath);
      return sendJSON(res, 200, { files });
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();

    // JSON 文件返回解析后的对象
    if (ext === '.json') {
      try {
        const json = JSON.parse(content);
        return sendJSON(res, 200, { content: json, type: 'json' });
      } catch (_) {
        // fallthrough: 当作纯文本返回
      }
    }

    // 其他文件返回纯文本
    sendJSON(res, 200, { content, type: ext === '.md' ? 'markdown' : 'text' });

  } catch (error) {
    sendError(res, 500, `读取文件失败: ${error.message}`);
  }
}

/**
 * GET /api/logs - SSE 日志流端点
 */
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: 'connected', state: currentState })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
}

// ==================== 路由分发 ====================

/**
 * 解析 URL 路径和查询参数
 *
 * @param {string} rawUrl - 原始 URL 字符串
 * @returns {{ pathname: string, searchParams: URLSearchParams }}
 */
function parseUrl(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost');
  return { pathname: url.pathname, searchParams: url.searchParams };
}

/**
 * API 路由处理
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 * @param {URLSearchParams} searchParams
 * @returns {boolean} 是否已处理
 */
function handleAPI(req, res, pathname, searchParams) {
  // GET /api/status
  if (pathname === '/api/status' && req.method === 'GET') {
    handleStatus(req, res);
    return true;
  }

  // POST /api/record/start
  if (pathname === '/api/record/start' && req.method === 'POST') {
    handleRecordStart(req, res);
    return true;
  }

  // POST /api/record/stop
  if (pathname === '/api/record/stop' && req.method === 'POST') {
    handleRecordStop(req, res);
    return true;
  }

  // POST /api/translate/start
  if (pathname === '/api/translate/start' && req.method === 'POST') {
    handleTranslateStart(req, res);
    return true;
  }

  // GET /api/runs
  if (pathname === '/api/runs' && req.method === 'GET') {
    handleGetRuns(req, res);
    return true;
  }

  // GET /api/runs/:runId/files
  const runFilesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/files$/);
  if (runFilesMatch && req.method === 'GET') {
    handleGetRunFiles(req, res, runFilesMatch[1]);
    return true;
  }

  // GET /api/runs/:runId/file?path=xxx
  const runFileMatch = pathname.match(/^\/api\/runs\/([^/]+)\/file$/);
  if (runFileMatch && req.method === 'GET') {
    const runId = runFileMatch[1];
    const filePath = searchParams.get('path');
    handleGetRunFile(req, res, runId, filePath);
    return true;
  }

  // GET /api/logs (SSE)
  if (pathname === '/api/logs' && req.method === 'GET') {
    handleSSE(req, res);
    return true;
  }

  return false;
}

/**
 * 静态文件服务
 *
 * @param {http.ServerResponse} res
 * @param {string} pathname
 */
function serveStatic(res, pathname) {
  // 默认路径映射到 index.html
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(STATIC_DIR, filePath);

  // 安全检查
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mimeType });
  res.end(content);
}

// ==================== 创建并导出服务 ====================

/**
 * 创建 Dashboard HTTP 服务器
 *
 * @param {number} [port] - 监听端口，默认 3000
 * @returns {Promise<http.Server>}
 */
export function createServer(port = DASHBOARD_PORT) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const { pathname, searchParams } = parseUrl(req.url);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      // API 路由
      if (pathname.startsWith('/api/')) {
        const handled = handleAPI(req, res, pathname, searchParams);
        if (!handled) {
          sendError(res, 404, `未知 API: ${pathname}`);
        }
        return;
      }

      // 静态文件
      serveStatic(res, pathname);
    });

    server.listen(port, () => {
      console.log(`Dashboard 服务已启动: http://localhost:${port}`);
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${port} 已被占用，请关闭占用进程或修改端口`);
      }
      reject(err);
    });
  });
}

export { DASHBOARD_PORT };

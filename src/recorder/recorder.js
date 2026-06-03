/**
 * recorder.js - 统一录制器核心类（完美快照模型 v2）
 *
 * Recorder 管理浏览器生命周期、事件回调、快照轮询和分文件存储。
 * 只负责采集原始数据，不做任何数据"理解"（diff 等预处理由 case_translate 模块完成）。
 *
 * 核心设计：
 * - 周期轮询（300ms）后台拍摄 AX 快照，缓存在内存，action 到达时直接使用缓存快照
 * - 每个 action 关联 preSnapshot 和 postSnapshot，物理上同一份文件不重复存储
 * - formStateDelta 由浏览器端在 pointerdown/keydown capture 阶段同步捕获，作为独立字段
 *
 * 输出文件结构：
 *   output/run_XXXX/
 *     meta.json                # 录制元信息 + 操作摘要
 *     recorder.log             # 录制日志
 *     snapshots/               # AX 快照文件（snapshot_000.txt ~ snapshot_NNN.txt）
 *     actions/                 # 操作数据文件（action_001.json ~ action_NNN.json）
 *
 * 命名约定：
 *   action N 的 preSnapshot  = snapshots/snapshot_{N-1}.txt
 *   action N 的 postSnapshot = snapshots/snapshot_{N}.txt
 *
 * 停止方式：
 *   主方式：用户关闭浏览器窗口
 *   备用方式：Ctrl+C
 *
 * 使用方式：
 *   import { Recorder } from './recorder.js';
 *   const recorder = new Recorder();
 *   await recorder.start('https://example.com');
 *   // ... 用户操作，关闭浏览器窗口停止 ...
 */

import { chromium, _electron as electron } from 'playwright';
import fs from 'fs';
import path from 'path';

import {
  USE_NATIVE_WINDOW_VIEWPORT,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  SLOW_MO,
  LAUNCH_TIMEOUT,
  NAVIGATION_TIMEOUT,
  WAIT_UNTIL,
  SCREENSHOT_ENABLED,
  SCREENSHOT_FORMAT,
  SCREENSHOT_QUALITY,
  SCREENSHOT_FULL_PAGE,
  SCREENSHOT_DELAY_MS,
  OUTPUT_BASE_DIR,
  SCREENSHOTS_SUBDIR,
  LOG_FILENAME,
  SNAPSHOTS_DATA_SUBDIR,
  ACTIONS_DATA_SUBDIR,
  META_FILENAME,
  SNAPSHOT_POLL_INTERVAL_MS,
  RECORDER_POST_NAV_INJECT_CHECK_DELAY_MS,
  SELENIUM_EXPORT_ENABLED,
} from '../utils/config.js';

import { createLogger } from '../utils/logger.js';
import { SeleniumIncrementalWriter } from '../selenium_export/selenium-incremental-writer.js';
import { buildInjectedScript } from './inject-script.js';
import { pruneSnapshot, snapshotToText } from './snapshot-utils.js';

// ==================== 输出目录工具函数 ====================

/**
 * 生成本次运行的时间戳标签
 * 格式: 2026-02-12T14-30-00（文件名安全）
 *
 * @returns {string}
 */
function generateRunTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * 创建本次运行的输出目录结构
 *
 * @param {string} baseDir - 输出根目录
 * @returns {{ runDir: string, screenshotDir: string, snapshotsDir: string, actionsDir: string, logFile: string }}
 */
function createOutputDirs(baseDir) {
  const runTimestamp = generateRunTimestamp();
  const runDir = path.join(baseDir, `run_${runTimestamp}`);
  const snapshotsDir = path.join(runDir, SNAPSHOTS_DATA_SUBDIR);
  const actionsDir = path.join(runDir, ACTIONS_DATA_SUBDIR);
  const screenshotDir = path.join(runDir, SCREENSHOTS_SUBDIR);

  // 创建数据子目录
  fs.mkdirSync(snapshotsDir, { recursive: true });
  fs.mkdirSync(actionsDir, { recursive: true });

  // 截图目录仅在截图功能开启时创建
  if (SCREENSHOT_ENABLED) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  return {
    runDir,
    screenshotDir,
    snapshotsDir,
    actionsDir,
    logFile: path.join(runDir, LOG_FILENAME),
  };
}

/**
 * 解析离线分发包中的 Playwright 浏览器目录（若存在）
 *
 * 查找顺序：
 * 1. 当前工作目录下的 ms-playwright（从 release 目录直接启动）
 * 2. 可执行文件同级目录下的 ms-playwright（pkg EXE 场景）
 *
 * @returns {string|null}
 */
function resolveBundledPlaywrightBrowsersPath() {
  const candidates = [
    path.join(process.cwd(), 'ms-playwright'),
    path.join(path.dirname(process.execPath || ''), 'ms-playwright'),
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {
      // ignore and continue
    }
  }

  return null;
}

/**
 * 解析离线分发包中的 Chromium 可执行文件（若存在）
 *
 * 查找顺序：
 * 1. 当前工作目录下的 chrome-win64/chrome.exe（从 release 目录直接启动）
 * 2. 可执行文件同级目录下的 chrome-win64/chrome.exe（pkg EXE 场景）
 *
 * @returns {string|null}
 */
function resolveBundledChromiumExecutablePath() {
  const candidates = [
    path.join(process.cwd(), 'chrome-win64', 'chrome.exe'),
    path.join(path.dirname(process.execPath || ''), 'chrome-win64', 'chrome.exe'),
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {
      // ignore and continue
    }
  }

  return null;
}

// ==================== Recorder 类 ====================

/**
 * 基于周期轮询 + 独立存储的浏览器操作录制器
 *
 * 核心特性：
 * - 后台周期轮询 AX 快照，缓存在内存
 * - action 到达时使用缓存快照，保证 preSnapshot 干净
 * - formStateDelta 作为独立字段，由浏览器端同步捕获
 * - 分文件存储：snapshots/ + actions/ + meta.json
 * - 只采集原始数据，diff 等预处理由翻译模块完成
 */
export class Recorder {
  /**
   * @param {Object} [options] - 初始化选项
   * @param {string} [options.outputBaseDir] - 输出根目录覆盖（可选）
   * @param {Function} [options.onLog] - 日志消息回调（可选，Dashboard 模式使用）
   *   签名: ({ level, message, timestamp, logLine }) => void
   * @param {boolean} [options.seleniumExportEnabled] - 是否增量写 Selenium 草稿；默认取 config.SELENIUM_EXPORT_ENABLED
   */
  constructor(options = {}) {
    /** @type {string} 输出根目录 */
    this.outputBaseDir = options.outputBaseDir || OUTPUT_BASE_DIR;

    /** @type {Function|undefined} 外部日志回调（透传给 logger） */
    this._onLogCallback = options.onLog;

    /** @type {import('playwright').Browser|null} 浏览器实例 */
    this.browser = null;

    /** @type {import('playwright').ElectronApplication|null} Electron 应用实例 */
    this.electronApp = null;

    /** @type {import('playwright').BrowserContext|null} 浏览器上下文 */
    this.context = null;

    /** @type {Map<string, import('playwright').Page>} 页面映射（URL → Page） */
    this.pageMap = new Map();

    /** @type {import('playwright').Page|null} 最近活跃的页面 */
    this.activePage = null;

    /** @type {number} 截图计数器 */
    this.screenshotCounter = 0;

    /** @type {boolean} 是否正在录制 */
    this.isRecording = false;

    /** @type {Object|null} 输出路径集合（start 时初始化） */
    this.outputPaths = null;

    /** @type {Object|null} 日志器（start 时初始化） */
    this.log = null;

    /** @type {string|null} 注入脚本字符串 */
    this.injectedScript = null;

    // ========== 完美快照模型 v2 新增 ==========

    /** @type {string|null} 最新轮询缓存的快照文本 */
    this._cachedSnapshot = null;

    /** @type {NodeJS.Timeout|null} 轮询定时器 */
    this._pollTimer = null;

    /** @type {number} 快照文件编号计数器（snapshot_000 = 初始快照，每次 action 递增） */
    this._snapshotIndex = 0;

    /** @type {number} 操作文件编号计数器（action_001 起步） */
    this._actionIndex = 0;

    /**
     * @type {Object|null} 最后一个待 postSnapshot 的 action 信息
     * 结构: { actionIndex, action }
     */
    this._pendingAction = null;

    /** @type {number} 录制开始时间戳 */
    this._recordStartTime = 0;

    /** @type {Array<Object>} 操作摘要列表（用于 meta.json） */
    this._actionSummaryList = [];

    /** @type {boolean} 是否正在执行 stop 流程（防止重入） */
    this._stopping = false;

    /**
     * 是否启用 Selenium（Driver4）草稿导出
     * @type {boolean}
     */
    this._seleniumExportEnabled =
      options.seleniumExportEnabled !== undefined
        ? Boolean(options.seleniumExportEnabled)
        : SELENIUM_EXPORT_ENABLED;

    /**
     * 草稿 Writer（start 时创建，stop/断开 时 finalize）
     * @type {SeleniumIncrementalWriter|null}
     */
    this._seleniumWriter = null;
  }

  /**
   * 若开启 Selenium 导出，则初始化草稿文件
   *
   * @param {string} initialUrl - 起始 URL（写入 d.open 占位）
   * @private
   */
  _initSeleniumExportIfNeeded(initialUrl) {
    if (!this._seleniumExportEnabled || !this.outputPaths) return;
    try {
      this._seleniumWriter = new SeleniumIncrementalWriter(this.outputPaths.runDir, { log: this.log });
      this._seleniumWriter.initDraft(initialUrl || '');
    } catch (error) {
      this.log.warn(`Selenium 草稿初始化失败（已忽略）: ${error.message}`);
      this._seleniumWriter = null;
    }
  }

  /**
   * 结束 Selenium 草稿（写 footer）
   *
   * @private
   */
  _finalizeSeleniumExportDraft() {
    if (!this._seleniumWriter) return;
    try {
      this._seleniumWriter.finalize();
    } catch (error) {
      if (this.log) this.log.warn(`Selenium 草稿收尾失败（已忽略）: ${error.message}`);
    }
    this._seleniumWriter = null;
  }

  // ==================== 公共方法 ====================

  /**
   * 启动录制器：打开浏览器，导航到目标 URL，开始监听用户操作
   *
   * @param {string} url - 目标页面 URL
   */
  async start(url) {
    // 初始化输出目录和日志
    this.outputPaths = createOutputDirs(this.outputBaseDir);
    this.log = createLogger(this.outputPaths.logFile, {
      onMessage: this._onLogCallback,
    });

    this._recordStartTime = Date.now();

    this.log.info('========== 录制器启动 ==========');
    this.log.info(`输出目录: ${this.outputPaths.runDir}`);
    this.log.info('完美快照模型 v2：周期轮询 + 独立存储 + 录制阶段预处理');

    const bundledBrowsersPath = resolveBundledPlaywrightBrowsersPath();
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH && bundledBrowsersPath) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsersPath;
      this.log.info(`已启用离线 Chromium 运行时: ${bundledBrowsersPath}`);
    }
    const bundledChromiumExecutablePath = resolveBundledChromiumExecutablePath();
    if (bundledChromiumExecutablePath) {
      this.log.info(`已启用本地 Chromium 可执行文件: ${bundledChromiumExecutablePath}`);
    }
    // #region agent log
    fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H10',location:'src/recorder/recorder.js:start:runtimeVersion',message:'recorder runtime version before launch',data:{nodeVersion:process.version,hasLocalChrome:!!bundledChromiumExecutablePath},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    try {
      // ---------- 启动浏览器 ----------
      this.log.info('启动 Chromium 浏览器...');
      const launchArgs = [];
      if (USE_NATIVE_WINDOW_VIEWPORT) {
        launchArgs.push('--start-maximized');
      }
      const launchOptions = {
        executablePath: bundledChromiumExecutablePath || undefined,
        headless: false,
        slowMo: SLOW_MO,
        timeout: LAUNCH_TIMEOUT,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        args: launchArgs,
      };

      // 使用本地 chrome-win64 时，Windows 某些权限/策略环境会导致沙箱拒绝访问可执行文件。
      // 关闭 Chromium 沙箱可规避 "Sandbox cannot access executable ... (0x5)" 启动失败。
      if (bundledChromiumExecutablePath) {
        launchOptions.chromiumSandbox = false;
        launchOptions.args.push('--no-sandbox');
        this.log.info(`本地 Chromium 启动参数: chromiumSandbox=false, ${launchOptions.args.join(', ')}`);
      }

      // #region agent log
      fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H4',location:'src/recorder/recorder.js:start:beforeLaunch',message:'before chromium.launch',data:{executablePath:launchOptions.executablePath||null,chromiumSandbox:launchOptions.chromiumSandbox,args:launchOptions.args||[],remainingMcpEnvKeys:Object.keys(process.env||{}).filter(k=>k.startsWith('PLAYWRIGHT_MCP_'))},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      this.browser = await chromium.launch(launchOptions);

      // ---------- 创建浏览器上下文 ----------
      this.log.info('创建浏览器上下文...');
      const contextOptions = USE_NATIVE_WINDOW_VIEWPORT
        ? { viewport: null }
        : { viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } };
      this.context = await this.browser.newContext(contextOptions);
      this.log.info(
        USE_NATIVE_WINDOW_VIEWPORT
          ? '浏览器视口模式: 原生窗口（viewport=null，启动后强制最大化）'
          : `浏览器视口模式: 固定 viewport (${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT})`,
      );

      // ---------- Context 级别：暴露回调函数 ----------
      await this.context.exposeFunction('__recordAction', (actionJson) => {
        this._onAction(actionJson);
      });

      // ---------- Context 级别：注入事件监听脚本 ----------
      this.injectedScript = buildInjectedScript();
      await this.context.addInitScript(this.injectedScript);
      this.log.info('事件捕获脚本已注入（Context 级别，含 formStateDelta 捕获）');

      // ---------- 监听新页面创建（新 Tab）----------
      this.context.on('page', (newPage) => {
        this.log.warn(`新 Tab 页已打开: ${newPage.url()}`);
        this._registerPage(newPage);
      });

      // ---------- 创建首个页面并导航 ----------
      this.log.info('创建浏览器页面...');
      const page = await this.context.newPage();
      this._registerPage(page);
      await this._maximizeBrowserWindowIfNeeded(page);

      this.log.info(`导航到: ${url}`);
      await page.goto(url, {
        waitUntil: WAIT_UNTIL,
        timeout: NAVIGATION_TIMEOUT,
      });

      const pageTitle = await page.title();
      this.log.info(`页面加载完成: ${pageTitle} (${url})`);

      // 确认首页脚本注入状态
      await this._ensureScriptInjected(page);

      // ---------- 拍摄初始快照（snapshot_000） ----------
      this.log.info('拍摄初始页面快照（snapshot_000）...');
      const initialSnapshot = await this._takeSnapshot();
      if (initialSnapshot) {
        this._saveSnapshot(initialSnapshot);
        this._cachedSnapshot = initialSnapshot;
        this.log.info('初始快照已保存');
      } else {
        this.log.warn('初始快照获取失败，录制继续但首个 action 可能缺少 preSnapshot');
      }

      // 必须在 snapshot_000 落盘之后再接受 action，且要尽快置 true：
      // start() 被 await 完成前用户即可在已导航的页面中操作；若 isRecording 仍为 false，_onAction 会直接丢弃。
      this.isRecording = true;
      this.log.info('录制已开始（isRecording=true），在浏览器中执行操作，关闭浏览器窗口停止录制');

      // ---------- 启动周期轮询 ----------
      this._startSnapshotPolling();

      // ---------- 监听浏览器断开连接（用户关闭浏览器窗口）----------
      this.browser.on('disconnected', () => {
        if (this.isRecording && !this._stopping) {
          this.log.info('检测到浏览器窗口已关闭，开始优雅结束...');
          // 浏览器已断开，无法再拍快照，直接用缓存完成收尾
          this._onBrowserDisconnected();
        }
      });

      try {
        const probe = await page.evaluate(() => ({
          injected: !!window.__recorderInjected,
          hasRecordAction: typeof window.__recordAction === 'function',
        }));
        this.log.info(
          `录制就绪诊断(主框架): __recorderInjected=${probe.injected} __recordAction=${probe.hasRecordAction}`,
        );
        if (!probe.injected || !probe.hasRecordAction) {
          this.log.warn(
            '主框架未检测到完整注入，点击可能无法生成 action；请查看控制台 [Recorder] 提示或尝试刷新页面后再录',
          );
        }
      } catch (e) {
        this.log.warn(`录制就绪诊断失败: ${e.message}`);
      }

      this._initSeleniumExportIfNeeded(url);

    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H4',location:'src/recorder/recorder.js:start:catch',message:'recorder start failed',data:{errorName:error?.name||'',errorMessage:error?.message||'',stackHead:(error?.stack||'').split('\\n').slice(0,6).join('\\n')},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      this.log.error('启动失败', error);
      await this._cleanup();
      throw error;
    }
  }

  /**
   * 启动 Electron EXE 录制：打开 Electron 应用首个窗口并开始监听用户操作
   *
   * @param {string} executablePath - Electron 打包 EXE 绝对路径
   * @param {string[]} [electronArgs=[]] - Electron 启动参数（可选）
   */
  async startElectron(executablePath, electronArgs = []) {
    // 初始化输出目录和日志
    this.outputPaths = createOutputDirs(this.outputBaseDir);
    this.log = createLogger(this.outputPaths.logFile, {
      onMessage: this._onLogCallback,
    });

    this._recordStartTime = Date.now();

    this.log.info('========== 录制器启动（Electron 模式） ==========');
    this.log.info(`输出目录: ${this.outputPaths.runDir}`);
    this.log.info(`目标 EXE: ${executablePath}`);

    try {
      // ---------- 启动 Electron ----------
      this.log.info('启动 Electron 应用...');
      this.electronApp = await electron.launch({
        executablePath,
        args: Array.isArray(electronArgs) ? electronArgs : [],
        timeout: LAUNCH_TIMEOUT,
      });

      // Electron 共享 BrowserContext
      this.context = this.electronApp.context();
      this.log.info('Electron BrowserContext 已创建');

      // ---------- Context 级别：暴露回调函数 ----------
      await this.context.exposeFunction('__recordAction', (actionJson) => {
        this._onAction(actionJson);
      });

      // ---------- Context 级别：注入事件监听脚本 ----------
      this.injectedScript = buildInjectedScript();
      await this.context.addInitScript(this.injectedScript);
      this.log.info('事件捕获脚本已注入（Context 级别，含 formStateDelta 捕获）');

      // ---------- 监听新窗口 ----------
      this.electronApp.on('window', (newPage) => {
        this.log.warn(`新 Electron 窗口已打开: ${newPage.url()}`);
        this._registerPage(newPage);
      });

      // ---------- 等待首个窗口 ----------
      this.log.info('等待 Electron 首个窗口...');
      const page = await this.electronApp.firstWindow();
      this._registerPage(page);

      const pageTitle = await page.title().catch(() => '');
      this.log.info(`首个窗口就绪: ${pageTitle || '(无标题)'} (${page.url()})`);

      // 双保险：确保当前页面脚本已注入
      await this._ensureScriptInjected(page);

      // ---------- 拍摄初始快照（snapshot_000） ----------
      this.log.info('拍摄初始页面快照（snapshot_000）...');
      const initialSnapshot = await this._takeSnapshot();
      if (initialSnapshot) {
        this._saveSnapshot(initialSnapshot);
        this._cachedSnapshot = initialSnapshot;
        this.log.info('初始快照已保存');
      } else {
        this.log.warn('初始快照获取失败，录制继续但首个 action 可能缺少 preSnapshot');
      }

      this.isRecording = true;
      this.log.info('录制已开始（isRecording=true），在 Electron 窗口中执行操作，关闭应用窗口停止录制');

      // ---------- 启动周期轮询 ----------
      this._startSnapshotPolling();

      // ---------- 监听 Electron 关闭 ----------
      this.electronApp.on('close', () => {
        if (this.isRecording && !this._stopping) {
          this.log.info('检测到 Electron 应用已关闭，开始优雅结束...');
          this._onBrowserDisconnected();
        }
      });

      try {
        const probe = await page.evaluate(() => ({
          injected: !!window.__recorderInjected,
          hasRecordAction: typeof window.__recordAction === 'function',
        }));
        this.log.info(
          `录制就绪诊断(主框架): __recorderInjected=${probe.injected} __recordAction=${probe.hasRecordAction}`,
        );
        if (!probe.injected || !probe.hasRecordAction) {
          this.log.warn(
            '主框架未检测到完整注入，点击可能无法生成 action；请查看控制台 [Recorder] 提示',
          );
        }
      } catch (e) {
        this.log.warn(`录制就绪诊断失败: ${e.message}`);
      }

      const electronStartUrl = page.url();
      this._initSeleniumExportIfNeeded(electronStartUrl);
    } catch (error) {
      this.log.error('启动失败', error);
      await this._cleanup();
      throw error;
    }
  }

  /**
   * 停止录制：停止轮询，补拍终态快照，保存 meta.json，关闭浏览器
   *
   * 执行顺序：
   * 1. 停止快照轮询
   * 2. 尝试拍摄终态快照（如果浏览器还活着）
   * 3. 为 pendingAction 补上 postSnapshot
   * 4. 保存 meta.json
   * 5. 关闭浏览器
   */
  async stop() {
    if (!this.isRecording || this._stopping) {
      if (this.log) this.log.warn('录制器未在运行中或已在停止中');
      return;
    }

    this._stopping = true;
    this.isRecording = false;
    this.log.info('========== 录制停止 ==========');

    // 1. 停止轮询
    this._stopSnapshotPolling();

    // 2. 尝试拍摄终态快照
    let finalSnapshot = this._cachedSnapshot;
    try {
      const freshSnapshot = await this._takeSnapshot();
      if (freshSnapshot) {
        finalSnapshot = freshSnapshot;
      }
    } catch (error) {
      this.log.warn(`终态快照拍摄失败，使用最后缓存: ${error.message}`);
    }

    // 3. 为 pendingAction 补上终态 postSnapshot
    if (this._pendingAction && finalSnapshot) {
      this._saveSnapshot(finalSnapshot);
      this.log.info(`终态快照已保存为 snapshot_${String(this._snapshotIndex - 1).padStart(3, '0')}`);
    } else if (this._pendingAction) {
      this.log.warn('最后一个操作缺少 postSnapshot（无可用快照）');
    }

    this.log.info(`共录制 ${this._actionIndex} 个操作`);
    if (this._actionIndex === 0) {
      this._logZeroActionsHint();
    }

    this._finalizeSeleniumExportDraft();

    // 4. 保存 meta.json
    this._saveMeta();

    // 5. 关闭浏览器
    await this._cleanup();

    this.log.info('录制器已停止');
    this.log.info('如需 AI 生成测试用例，请运行: node src/case_translate');
    this._stopping = false;
  }

  // ==================== 快照轮询 ====================

  /**
   * 启动周期性快照轮询
   * 每 SNAPSHOT_POLL_INTERVAL_MS 拍摄一次 AX 快照，缓存在 _cachedSnapshot
   *
   * @private
   */
  _startSnapshotPolling() {
    this.log.info(`启动快照轮询，间隔 ${SNAPSHOT_POLL_INTERVAL_MS}ms`);

    this._pollTimer = setInterval(async () => {
      if (!this.isRecording) return;

      try {
        const snapshot = await this._takeSnapshot();
        if (snapshot) {
          this._cachedSnapshot = snapshot;
        }
      } catch (error) {
        // 轮询失败静默忽略，保持上一次缓存
      }
    }, SNAPSHOT_POLL_INTERVAL_MS);
  }

  /**
   * 停止周期性快照轮询
   *
   * @private
   */
  _stopSnapshotPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      this.log.info('快照轮询已停止');
    }
  }

  // ==================== 快照拍摄 ====================

  /**
   * 获取当前活跃页面的 AX 快照（裁剪并格式化为文本）
   *
   * @returns {Promise<string|null>} 快照文本，失败返回 null
   * @private
   */
  async _takeSnapshot() {
    try {
      const page = this.activePage;
      if (!page) return null;

      const rawSnapshot = await page.accessibility.snapshot({
        interestingOnly: true,
      });

      if (!rawSnapshot) return null;

      const pruned = pruneSnapshot(rawSnapshot);
      if (!pruned) return null;

      return snapshotToText(pruned);
    } catch (error) {
      // 快照失败静默处理
      return null;
    }
  }

  // ==================== 分文件存储 ====================

  /**
   * 保存快照文本到 snapshots/snapshot_NNN.txt，并递增 _snapshotIndex
   *
   * @param {string} snapshotText - 快照文本
   * @returns {number} 保存时使用的快照编号
   * @private
   */
  _saveSnapshot(snapshotText) {
    const index = this._snapshotIndex;
    const filename = `snapshot_${String(index).padStart(3, '0')}.txt`;
    const filepath = path.join(this.outputPaths.snapshotsDir, filename);

    fs.writeFileSync(filepath, snapshotText, 'utf-8');
    this._snapshotIndex++;

    return index;
  }

  /**
   * 保存 action 数据到 actions/action_NNN.json
   *
   * @param {Object} action - 操作数据（含 formStateDelta，不含快照文本）
   * @param {number} actionIndex - 操作编号（1-based）
   * @private
   */
  _saveAction(action, actionIndex) {
    const filename = `action_${String(actionIndex).padStart(3, '0')}.json`;
    const filepath = path.join(this.outputPaths.actionsDir, filename);

    const actionData = {
      index: actionIndex,
      type: action.type,
      element: action.element,
      position: action.position,
      key: action.key || undefined,
      url: action.url,
      title: action.title,
      timestamp: action.timestamp,
      formStateDelta: action.formStateDelta || null,
    };

    fs.writeFileSync(filepath, JSON.stringify(actionData, null, 2), 'utf-8');
  }

  /**
   * 保存 meta.json（录制元信息 + 操作摘要）
   *
   * 吸收原手工测试用例.md 的全部信息：
   * - 录制时间范围、目标 URL、页面标题、页面数
   * - 操作摘要列表（每条操作的类型、描述、页面）
   * - 文件命名约定
   *
   * @private
   */
  _saveMeta() {
    const pageSet = new Set();
    for (const summary of this._actionSummaryList) {
      if (summary.page) pageSet.add(summary.page);
    }

    const firstSummary = this._actionSummaryList[0];
    const meta = {
      recordStartTime: new Date(this._recordStartTime).toISOString(),
      recordEndTime: new Date().toISOString(),
      totalActions: this._actionIndex,
      targetUrl: firstSummary?.url || '',
      startPageTitle: firstSummary?.page || '',
      pageCount: pageSet.size,
      snapshotPollIntervalMs: SNAPSHOT_POLL_INTERVAL_MS,
      convention: 'action_N: pre=snapshot_{N-1}, post=snapshot_{N}',
      actionSummary: this._actionSummaryList,
    };

    const metaFile = path.join(this.outputPaths.runDir, META_FILENAME);
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8');
    this.log.info(`meta.json 已保存: ${metaFile}`);
  }

  // ==================== 事件处理 ====================

  /**
   * 操作事件回调：由浏览器注入脚本通过 __recordAction 调用
   *
   * 混合策略（修复快照保存时机）：
   * - 第一个 action 到达时不保存快照（其 preSnapshot = snapshot_000，已在 start 时保存）
   * - 从第二个 action 开始，每次到达时保存 _cachedSnapshot：
   *   该快照 = post(前一个 action) = pre(当前 action)
   *   此时缓存经过若干轮询周期，已包含前一个 action 的渐进行为（打字、异步渲染）
   *   同时缓存在当前 action 的 click handler 之前拍摄，不含当前 action 的同步 DOM 效果
   * - stop 时保存终态快照 = post(最后一个 action)
   *
   * 命名约定不变：action_N: pre=snapshot_{N-1}, post=snapshot_{N}
   *
   * @param {string} actionJson - 操作数据的 JSON 字符串
   * @private
   */
  _onAction(actionJson) {
    if (!this.isRecording) return;

    try {
      const action = JSON.parse(actionJson);
      this._actionIndex++;
      const actionIndex = this._actionIndex;

      this.log.info(`[操作 #${actionIndex}] ${action.type}: ${this._describeAction(action)}`);

      // 清理冗余 DOM 字段
      if (action.element) {
        this._stripDOMContextFields(action.element);
      }

      // 混合策略：仅在有前一个 pending action 时才保存缓存快照
      // 这份快照 = post(前一个 action) = pre(当前 action)
      // 第一个 action 的 pre 是 snapshot_000（start 时已保存），不需要额外保存
      if (this._pendingAction && this._cachedSnapshot) {
        this._saveSnapshot(this._cachedSnapshot);
        this.log.info(`[操作 #${actionIndex}] 快照 snapshot_${String(this._snapshotIndex - 1).padStart(3, '0')} 已保存（post of #${this._pendingAction.actionIndex}, pre of #${actionIndex}）`);
      } else if (!this._pendingAction) {
        this.log.info(`[操作 #${actionIndex}] 首个操作，pre = snapshot_000（已保存）`);
      } else {
        this.log.warn(`[操作 #${actionIndex}] 无缓存快照可用`);
      }

      // 保存 action JSON
      this._saveAction(action, actionIndex);
      this.log.info(`[操作 #${actionIndex}] action_${String(actionIndex).padStart(3, '0')}.json 已保存`);

      if (this._seleniumWriter) {
        try {
          this._seleniumWriter.appendAction(actionIndex, action);
        } catch (error) {
          this.log.warn(`Selenium 草稿追加失败（已忽略）: ${error.message}`);
        }
      }

      // 记录操作摘要（用于 meta.json）
      this._actionSummaryList.push({
        index: actionIndex,
        type: action.type,
        desc: this._describeAction(action),
        page: action.title || '',
        url: action.url || '',
      });

      // 更新 pendingAction
      this._pendingAction = { actionIndex, action };

      // 调度截图
      if (SCREENSHOT_ENABLED) {
        this._scheduleScreenshot(action, actionIndex);
      }

    } catch (error) {
      this.log.error('处理操作事件失败', error);
    }
  }

  /**
   * 清理被快照取代的冗余 DOM 字段
   *
   * @param {Object} element - action.element 对象（原地修改）
   * @private
   */
  _stripDOMContextFields(element) {
    delete element.domContext;
    delete element.checkedState;
    delete element.classes;
    delete element.ariaLabel;
    delete element.role;
  }

  /**
   * 浏览器断开连接时的收尾处理（用户关闭了浏览器窗口）
   *
   * 此时无法再拍快照，直接用 _cachedSnapshot 完成收尾。
   *
   * @private
   */
  _onBrowserDisconnected() {
    if (this._stopping) return;
    this._stopping = true;
    this.isRecording = false;

    this.log.info('浏览器已断开，开始收尾...');

    // 停止轮询
    this._stopSnapshotPolling();

    // 用缓存快照作为终态
    if (this._pendingAction && this._cachedSnapshot) {
      this._saveSnapshot(this._cachedSnapshot);
      this.log.info(`终态快照已保存为 snapshot_${String(this._snapshotIndex - 1).padStart(3, '0')}`);
    }

    this.log.info(`共录制 ${this._actionIndex} 个操作`);
    if (this._actionIndex === 0) {
      this._logZeroActionsHint();
    }

    this._finalizeSeleniumExportDraft();

    // 保存 meta
    this._saveMeta();

    // 清理引用（浏览器已断开，不需要 close）
    this.browser = null;
    this.context = null;
    this.pageMap.clear();
    this.activePage = null;

    this.log.info('录制器已停止（浏览器关闭触发）');
    this.log.info('如需 AI 生成测试用例，请运行: node src/case_translate');
    this._stopping = false;
  }

  // ==================== 页面管理 ====================

  /**
   * 在原生窗口模式下，使用 CDP 显式最大化窗口，保证在 Windows 上稳定生效。
   * 某些环境下仅依赖 --start-maximized 不一定可靠。
   *
   * @param {import('playwright').Page} page
   * @private
   */
  async _maximizeBrowserWindowIfNeeded(page) {
    if (!USE_NATIVE_WINDOW_VIEWPORT) return;

    try {
      const cdpSession = await this.context.newCDPSession(page);
      const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
      if (windowId !== undefined) {
        await cdpSession.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'maximized' },
        });
        this.log.info('浏览器窗口已强制最大化（CDP）');
      }
    } catch (error) {
      this.log.warn(`强制最大化失败，继续使用当前窗口状态: ${error.message}`);
    }
  }

  /**
   * 注册页面：添加到映射表，设置监听器，跟踪活跃页面
   *
   * @param {import('playwright').Page} page
   * @private
   */
  _registerPage(page) {
    const updatePageMap = () => {
      try {
        const url = page.url();
        this.pageMap.set(url, page);
        this.activePage = page;
      } catch (e) {
        // 页面可能已关闭
      }
    };

    updatePageMap();

    // 监控浏览器 console 中的 [Recorder] 诊断信息
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[Recorder]')) {
        this.log.warn(`浏览器诊断: ${text}`);
      }
    });

    // 子 frame 导航时，确保脚本注入
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        updatePageMap();

        if (!this.isRecording) return;

        if (SCREENSHOT_ENABLED) {
          try {
            await page.waitForTimeout(SCREENSHOT_DELAY_MS);
            await this._takeScreenshot(page, 'navigation');
          } catch (err) {
            // 导航截图失败不中断录制
          }
        }
      } else {
        // 子框架（iframe）：确保脚本已注入
        if (!this.isRecording) return;
        try {
          await frame.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          const isInjected = await frame.evaluate(() => !!window.__recorderInjected).catch(() => false);
          if (!isInjected && this.injectedScript) {
            await frame.evaluate(this.injectedScript).catch(() => {});
            this.log.info(`iframe 脚本已注入: ${frame.url().substring(0, 80)}`);
          }
        } catch (e) {
          // frame 可能已关闭
        }
      }
    });

    // 页面关闭时清理
    page.on('close', () => {
      for (const [url, p] of this.pageMap.entries()) {
        if (p === page) {
          this.pageMap.delete(url);
        }
      }
      if (this.activePage === page) {
        const remainingPages = this.context ? this.context.pages() : [];
        this.activePage = remainingPages.length > 0 ? remainingPages[remainingPages.length - 1] : null;
      }
      const remaining = this.pageMap.size;
      this.log.info(`页面已关闭，剩余 ${remaining} 个页面`);
    });
  }

  /**
   * 未录制到任何操作时输出排障提示（SPA / iframe / 仅键盘等）
   *
   * @private
   */
  _logZeroActionsHint() {
    if (!this.log) return;
    this.log.warn('未采集到任何操作（totalActions=0）。请按下列顺序自查：');
    this.log.warn('  1) 是否有点击/双击/右键/Enter 等动作（纯 Tab 换焦、仅输入文字且不按 Enter 时，当前不会记为独立 action）');
    this.log.warn('  2) 若应用在 iframe 内：导航后会对所有 frame 尝试补注入；请等待页面稳定后再操作');
    this.log.warn('  3) 若浏览器控制台出现 [Recorder] __recordAction 不可用，该次操作未上报（常见于跨域 iframe 限制）');
  }

  /**
   * 向当前 Page 下所有可访问的 Frame 注入录制脚本（主文档 + 同域子 iframe）。
   * 仅对尚未设置 __recorderInjected 的 frame 执行，避免重复绑定监听器。
   *
   * @param {import('playwright').Page} page
   * @private
   */
  async _injectRecorderScriptIntoAllFrames(page) {
    const frames = page.frames();
    for (const frame of frames) {
      const url = frame.url();
      if (url === 'about:blank' || url.startsWith('chrome-extension:')) continue;

      let injected = false;
      try {
        injected = await frame.evaluate(() => !!window.__recorderInjected);
      } catch (_) {
        // frame 已销毁或暂不可用时跳过
        continue;
      }
      if (injected) continue;

      const isMain = frame === page.mainFrame();
      try {
        await frame.evaluate(this.injectedScript);
        if (this.log) {
          this.log.info(`录制脚本已补注入 frame: ${url.substring(0, 120)}${url.length > 120 ? '…' : ''}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (this.log) {
          this.log.warn(
            `录制脚本注入失败 (${isMain ? 'MAIN' : 'child'}) url=${url.substring(0, 100)}: ${msg}`,
          );
        }
        // 主文档注入失败必须抛出，避免静默无监听器、不产生 action
        if (isMain) {
          throw err;
        }
      }
    }
  }

  /**
   * 确保新页面中注入脚本已生效（双保险机制）
   *
   * @param {import('playwright').Page} page
   * @private
   */
  async _ensureScriptInjected(page) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

      const isInjected = await page.evaluate(() => !!window.__recorderInjected).catch(() => false);

      if (!isInjected) {
        this.log.warn(`新页面脚本未自动注入，正在手动注入: ${page.url()}`);

        try {
          await page.exposeFunction('__recordAction', (actionJson) => {
            this._onAction(actionJson);
          });
        } catch (e) {
          // context 级别已经暴露了，忽略
        }
      } else {
        this.log.info(`新页面脚本已自动注入: ${page.url()}`);
      }

      // 无论主文档是否已由 addInitScript 注入，都补全尚未注入的 frame（晚于主文档加载的 iframe 等）
      await this._injectRecorderScriptIntoAllFrames(page);

      if (!isInjected) {
        this.log.info(`手动注入完成（含子 frame）: ${page.url()}`);
      }
    } catch (error) {
      this.log.warn(`新页面脚本注入检查失败: ${error.message}`);
    }

    // 监听后续导航：每次导航后重新检查注入状态
    // 注意：不得在 !isRecording 时直接 return —— start() 完成前用户已可操作，且此时可能尚未置 isRecording；
    // 导航补注入必须在「录制尚未标记开始」阶段也能执行，否则 SPA 跳转后会丢子 frame 脚本。
    page.on('framenavigated', async (frame) => {
      if (frame !== page.mainFrame()) return;
      if (this._stopping) return;
      if (!this.context) return;

      try {
        await page.waitForTimeout(RECORDER_POST_NAV_INJECT_CHECK_DELAY_MS);
        const isInjectedAfterNav = await page.evaluate(() => !!window.__recorderInjected).catch(() => false);

        if (!isInjectedAfterNav) {
          this.log.warn(`页面导航后脚本丢失，重新注入（含子 frame）: ${page.url()}`);
        }
        // 主文档已注入时仍要补全晚加载的子 frame；主文档丢失时上面已打 WARN，此处统一补注入
        await this._injectRecorderScriptIntoAllFrames(page);
      } catch (e) {
        // 页面可能已关闭
      }
    });
  }

  // ==================== 截图 ====================

  /**
   * 调度操作截图
   *
   * @param {Object} action - 操作数据
   * @param {number} actionIndex - 操作序号
   * @private
   */
  _scheduleScreenshot(action, actionIndex) {
    setTimeout(async () => {
      if (!this.isRecording) return;

      try {
        const targetPage = this.pageMap.get(action.url) || this.activePage;
        if (targetPage) {
          await this._takeScreenshot(targetPage, `action_${actionIndex}_${action.type}`);
        }
      } catch (err) {
        // 截图失败不影响录制
      }
    }, SCREENSHOT_DELAY_MS);
  }

  /**
   * 截图并保存到磁盘
   *
   * @param {import('playwright').Page} page
   * @param {string} label - 截图标签
   * @returns {Promise<string|null>} 截图文件路径
   * @private
   */
  async _takeScreenshot(page, label) {
    try {
      this.screenshotCounter++;
      const filename = `${String(this.screenshotCounter).padStart(4, '0')}_${label}.${SCREENSHOT_FORMAT}`;
      const filepath = path.join(this.outputPaths.screenshotDir, filename);

      await page.screenshot({
        path: filepath,
        type: SCREENSHOT_FORMAT,
        quality: SCREENSHOT_QUALITY,
        fullPage: SCREENSHOT_FULL_PAGE,
      });

      return filepath;
    } catch (error) {
      this.log.warn(`截图失败 [${label}]: ${error.message}`);
      return null;
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 生成操作的简短描述（用于日志和 meta.json 摘要）
   *
   * @param {Object} action - 操作数据
   * @returns {string} 一行描述文本
   * @private
   */
  _describeAction(action) {
    const el = action.element || {};
    const identify = el.label || el.text || el.placeholder || el.name || el.id || el.xpath?.slice(0, 48) || '';

    switch (action.type) {
      case 'click':
        return `点击 <${el.tag}> "${identify}"`;
      case 'dblclick':
        return `双击 <${el.tag}> "${identify}"`;
      case 'rightclick':
        return `右键点击 <${el.tag}> "${identify}"`;
      case 'keypress':
        return `按键 [${action.key}] 在 <${el.tag}> (${identify})`;
      default:
        return JSON.stringify(action).slice(0, 80);
    }
  }

  /**
   * 清理资源：关闭浏览器上下文和浏览器
   *
   * @private
   */
  async _cleanup() {
    if (this.electronApp) {
      try {
        await this.electronApp.close();
        this.log.info('Electron 应用已关闭');
      } catch (err) {
        this.log.warn(`关闭 Electron 应用失败: ${err.message}`);
      }
      this.electronApp = null;
    }

    if (this.context) {
      try {
        await this.context.close();
        this.log.info('浏览器上下文已关闭');
      } catch (err) {
        this.log.warn(`关闭浏览器上下文失败: ${err.message}`);
      }
      this.context = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
        this.log.info('浏览器已关闭');
      } catch (err) {
        this.log.warn(`关闭浏览器失败: ${err.message}`);
      }
      this.browser = null;
    }

    this.pageMap.clear();
    this.activePage = null;
  }
}

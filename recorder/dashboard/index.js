/**
 * index.js - Dashboard 入口模块
 *
 * 启动 HTTP 服务并自动在系统浏览器中打开控制面板。
 *
 * 运行方式：
 *   node src/dashboard
 *
 * 功能：
 * - 启动 Dashboard HTTP 服务（默认端口 3000）
 * - 自动打开系统默认浏览器访问控制面板
 * - 不影响被测应用的 Playwright 浏览器实例
 */

import { exec } from 'child_process';

/** Dashboard HTTP 服务默认端口 */
const DASHBOARD_PORT = 3000;

// ==================== 打开系统浏览器 ====================

/**
 * 在系统默认浏览器中打开指定 URL
 *
 * @param {string} url - 要打开的 URL
 */
function openBrowser(url) {
  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.log(`请手动打开浏览器访问: ${url}`);
    }
  });
}

// ==================== 入口函数 ====================

/**
 * 启动 Dashboard
 *
 * @param {number} [port] - 服务端口，默认 3000
 */
async function run(port = DASHBOARD_PORT) {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H10',location:'src/dashboard/index.js:run:beforeImportServer',message:'dashboard runtime version before import server',data:{nodeVersion:process.version},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const { createServer } = await import('./server.js');
    const server = await createServer(port);
    const url = `http://localhost:${port}`;

    console.log('');
    console.log('='.repeat(50));
    console.log('  AI UI Recorder - Dashboard');
    console.log(`  访问地址: ${url}`);
    console.log('  按 Ctrl+C 关闭 Dashboard');
    console.log('='.repeat(50));
    console.log('');

    // 自动打开浏览器
    openBrowser(url);

    // 优雅退出
    process.on('SIGINT', () => {
      console.log('\nDashboard 正在关闭...');
      server.close(() => {
        console.log('Dashboard 已关闭');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Dashboard 启动失败:', error.message);
    process.exit(1);
  }
}

/**
 * 导出给统一入口调用
 *
 * @param {number} [port]
 */
export async function runDashboard(port = DASHBOARD_PORT) {
  await run(port);
}

/**
 * 判断当前模块是否被直接运行（而非被 import）
 *
 * @returns {boolean}
 */
function isMainModule() {
  try {
    return process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/src/dashboard/index.js');
  } catch (_) {
    return false;
  }
}

// ==================== 主程序入口 ====================

if (isMainModule()) {
  run();
}

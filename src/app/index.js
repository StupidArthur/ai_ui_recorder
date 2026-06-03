/**
 * index.js - 统一启动入口（用于打包 EXE）
 *
 * 说明：
 * - 默认启动 dashboard 模式，避免对外试用直接进入录制流程
 * - 保留 record / translate 两种模式，便于内部联调
 * - 不使用命令行参数控制，改用常量或环境变量
 */

import { TARGET_URL } from '../utils/config.js';

/** 运行模式：dashboard | record | translate */
const APP_MODE = (process.env.APP_MODE || 'dashboard').toLowerCase();

/**
 * 统一启动函数
 *
 * @param {string} mode - 运行模式
 */
export async function runApp(mode = 'dashboard') {
  // #region agent log
  fetch('http://127.0.0.1:7437/ingest/b6f22578-0783-4760-bc6b-7d2c7bfce5db',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb16c5'},body:JSON.stringify({sessionId:'fb16c5',runId:'pre-fix',hypothesisId:'H10',location:'src/app/index.js:runApp:entry',message:'app entry runtime version',data:{nodeVersion:process.version,appMode:mode},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (mode === 'dashboard') {
    const { runDashboard } = await import('../dashboard/index.js');
    await runDashboard();
    return;
  }

  if (mode === 'record') {
    const { runRecorder } = await import('../recorder/index.js');
    await runRecorder(TARGET_URL);
    return;
  }

  if (mode === 'translate') {
    const { runTranslate } = await import('../case_translate/index.js');
    await runTranslate(undefined);
    return;
  }

  throw new Error(`不支持的 APP_MODE: ${mode}（允许值: dashboard | record | translate）`);
}

// 主程序入口
runApp(APP_MODE).catch((error) => {
  console.error('应用启动失败:', error.message);
  process.exit(1);
});


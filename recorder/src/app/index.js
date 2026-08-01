/**
 * index.js - 统一启动入口（用于打包 EXE）
 *
 * 说明：
 * - 默认启动 dashboard 模式，避免对外试用直接进入录制流程
 * - 保留 record 模式，便于内部联调
 * - 不使用命令行参数控制，改用常量或环境变量
 */

import { TARGET_URL } from '../utils/config.js';

/** 运行模式：dashboard | record */
const APP_MODE = (process.env.APP_MODE || 'dashboard').toLowerCase();

/**
 * 统一启动函数
 *
 * @param {string} mode - 运行模式
 */
export async function runApp(mode = 'dashboard') {
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

  throw new Error(`不支持的 APP_MODE: ${mode}（允许值: dashboard | record）`);
}

// 主程序入口
runApp(APP_MODE).catch((error) => {
  console.error('应用启动失败:', error.message);
  process.exit(1);
});


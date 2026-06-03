/**
 * electron-cli.js - Electron EXE 录制命令行入口
 *
 * 用法（Windows PowerShell）：
 *   node src/recorder/electron-cli.js "C:\\path\\to\\your-electron-app.exe"
 *
 * 可选：
 *   node src/recorder/electron-cli.js "C:\\path\\app.exe" -- "--arg1" "--arg2=value"
 *
 * 说明：
 * - 第一个参数必须是 EXE 路径
 * - 若包含 "--" 分隔符，其后的参数透传给 Electron 应用
 */

import path from 'path';
import { Recorder } from './recorder.js';
import { EXIT_DELAY_MS } from '../utils/config.js';

/**
 * 解析命令行参数
 *
 * @returns {{ executablePath: string, electronArgs: string[] }}
 */
function parseCliArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    throw new Error(
      '缺少 EXE 路径。用法: node src/recorder/electron-cli.js "C:\\\\path\\\\to\\\\app.exe"',
    );
  }

  const separatorIndex = args.indexOf('--');
  const executablePath = path.resolve(args[0]);
  const electronArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];

  return { executablePath, electronArgs };
}

/**
 * 启动 Electron EXE 录制
 */
async function run() {
  try {
    const { executablePath, electronArgs } = parseCliArgs();
    const recorder = new Recorder();

    await recorder.startElectron(executablePath, electronArgs);

    // Electron 关闭后，等待收尾日志/文件写入后退出
    if (recorder.electronApp) {
      recorder.electronApp.on('close', () => {
        setTimeout(() => {
          console.log('录制完成，进程退出。');
          process.exit(0);
        }, EXIT_DELAY_MS);
      });
    }

    // Ctrl+C 备用停止方式
    let sigintCount = 0;
    process.on('SIGINT', async () => {
      sigintCount++;

      if (sigintCount === 1) {
        if (recorder.log) {
          recorder.log.info('收到 Ctrl+C 停止信号，正在保存数据并关闭 Electron...');
        }
        try {
          await recorder.stop();
        } catch (error) {
          if (recorder.log) {
            recorder.log.error('停止录制时出错', error);
          } else {
            console.error('停止录制时出错:', error.message);
          }
        }
        setTimeout(() => process.exit(0), EXIT_DELAY_MS);
      } else if (sigintCount === 2) {
        console.log('[WARN] 强制退出');
        process.exit(1);
      }
    });

    // 保持进程常驻
    setInterval(() => {}, 60000);
  } catch (error) {
    console.error(`录制启动失败: ${error.message}`);
    process.exit(1);
  }
}

run();


/**
 * index.js - 录制器入口模块
 *
 * 负责：
 * 1. 创建并启动 Recorder（完美快照模型 v2）
 * 2. 处理 SIGINT (Ctrl+C) 信号，作为备用停止方式
 * 3. 监听浏览器断开连接，自动退出进程
 *
 * 主停止方式：用户关闭浏览器窗口
 * 备用停止方式：Ctrl+C
 *
 * 录制完成后，如需 AI 生成测试用例，请运行:
 *   node src/case_translate
 *
 * 运行方式：
 *   node src/recorder
 */

import { Recorder } from './recorder.js';
import { EXIT_DELAY_MS, TARGET_URL } from '../utils/config.js';
import path from 'path';
import { fileURLToPath } from 'url';

// ==================== 入口函数 ====================

/**
 * 启动录制器
 *
 * @param {string} url - 要录制的目标页面 URL
 * @param {Object} [options] - 可选配置
 * @param {string} [options.outputBaseDir] - 输出根目录覆盖
 */
async function run(url, options = {}) {
  const recorder = new Recorder({
    outputBaseDir: options.outputBaseDir,
  });

  try {
    await recorder.start(url);

    // 监听浏览器断开连接 → 延迟退出进程（让收尾逻辑完成）
    recorder.browser.on('disconnected', () => {
      setTimeout(() => {
        console.log('录制完成，进程退出。');
        process.exit(0);
      }, EXIT_DELAY_MS);
    });

    // SIGINT 计数器：控制多次 Ctrl+C 的行为（备用停止方式）
    let sigintCount = 0;

    process.on('SIGINT', async () => {
      sigintCount++;

      if (sigintCount === 1) {
        // 第一次 Ctrl+C：正常停止
        recorder.log.info('收到 Ctrl+C 停止信号，正在保存数据并关闭浏览器...');
        try {
          await recorder.stop();
        } catch (error) {
          recorder.log.error('停止录制时出错', error);
        }
        recorder.log.info('进程退出');
        setTimeout(() => process.exit(0), EXIT_DELAY_MS);

      } else if (sigintCount === 2) {
        // 第二次 Ctrl+C：强制退出
        console.log('[WARN] 强制退出');
        process.exit(1);
      }
    });

    // 保持进程运行
    setInterval(() => {}, 60000);

  } catch (error) {
    if (recorder.log) {
      recorder.log.error('启动失败', error);
    } else {
      console.error('启动失败:', error);
    }
    process.exit(1);
  }
}

/**
 * 导出给统一入口调用
 *
 * @param {string} url
 * @param {Object} [options]
 */
export async function runRecorder(url, options = {}) {
  await run(url, options);
}

/**
 * 判断当前模块是否被直接运行（而非被 import）
 *
 * @returns {boolean}
 */
function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    // Node 在 argv[1] 传入相对路径时不规范化,且若 argv[1] 指向目录(无 .js 后缀)
    // 不会自动补 /index.js,需要兼容以下三种调用形式:
    //   - node src/recorder            (argv[1] = .../src/recorder)
    //   - node src/recorder.js         (argv[1] = .../src/recorder.js)
    //   - node src/recorder/index.js   (argv[1] = .../src/recorder/index.js)
    const self = fileURLToPath(import.meta.url).replace(/\\/g, '/');
    const resolved = path.resolve(process.argv[1]).replace(/\\/g, '/');
    if (resolved === self) return true;
    if (resolved + '.js' === self) return true;
    if (resolved + '/index.js' === self) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// ==================== 主程序入口 ====================

if (isMainModule()) {
  run(TARGET_URL).catch(e => console.error('run() failed:', e.message));
}

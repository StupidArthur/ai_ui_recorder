/**
 * logger.js - 日志模块
 *
 * 提供控制台 + 文件双输出的日志能力，支持可选的外部消息回调。
 * 日志文件在首次写入时自动创建，采用追加写入模式。
 *
 * 使用方式：
 *   import { createLogger } from '../utils/logger.js';
 *
 *   // 基础用法（命令行模式，与之前完全兼容）
 *   const log = createLogger('/path/to/recorder.log');
 *   log.info('录制开始');
 *
 *   // 带回调（Dashboard 模式，日志推送到 SSE）
 *   const log = createLogger('/path/to/recorder.log', {
 *     onMessage: ({ level, message, timestamp }) => broadcastLog(...)
 *   });
 */

import fs from 'fs';
import path from 'path';

/**
 * 创建日志器实例
 *
 * @param {string} logFilePath - 日志文件的完整路径
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.onMessage] - 日志消息回调，签名: ({ level, message, timestamp, logLine }) => void
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger(logFilePath, options = {}) {
  const { onMessage } = options;

  // 确保日志文件所在目录存在
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  /**
   * 格式化并输出一条日志
   *
   * @param {'INFO'|'WARN'|'ERROR'} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Error} [error] - 可选的错误对象，自动提取 stack
   */
  function write(level, message, error) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;

    if (error && error.stack) {
      logLine += `\n  ${error.stack}`;
    }

    // 控制台输出（根据级别使用不同方法）
    if (level === 'ERROR') {
      console.error(logLine);
    } else if (level === 'WARN') {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }

    // 文件追加写入
    try {
      fs.appendFileSync(logFilePath, logLine + '\n', 'utf-8');
    } catch (err) {
      // 日志写入失败不应中断主流程，仅控制台提示
      console.error(`[日志写入失败] ${err.message}`);
    }

    // 外部回调（Dashboard SSE 推送等）
    if (onMessage) {
      try {
        onMessage({ level, message, timestamp, logLine });
      } catch (_) {
        // 回调失败不应影响主流程
      }
    }
  }

  return {
    /**
     * 输出 INFO 级别日志
     * @param {string} message
     */
    info(message) {
      write('INFO', message);
    },

    /**
     * 输出 WARN 级别日志
     * @param {string} message
     * @param {Error} [error]
     */
    warn(message, error) {
      write('WARN', message, error);
    },

    /**
     * 输出 ERROR 级别日志
     * @param {string} message
     * @param {Error} [error]
     */
    error(message, error) {
      write('ERROR', message, error);
    },
  };
}

/**
 * selenium-incremental-writer.js - 录制过程中按条追加 Selenium 草稿 Python
 *
 * 失败只打日志，不抛出到录制主流程（由 Recorder try/catch 再包一层）。
 */

import fs from 'fs';
import path from 'path';

import { SELENIUM_DRAFT_FILENAME } from '../utils/config.js';
import {
  buildDraftHeader,
  buildDraftFooter,
} from './templates.js';
import { actionToDriver4Lines } from './action-to-driver4.js';
import { shortCommentFromAction } from './comment-from-action.js';

/**
 * 单条 action 对应的注释 + 代码块
 *
 * @param {number} actionIndex
 * @param {Object} action
 * @returns {string}
 */
export function formatDraftActionBlock(actionIndex, action) {
  const lines = [
    `    # ----- raw action index=${actionIndex} type=${action.type} -----`,
    `    # ${shortCommentFromAction(action)}`,
    actionToDriver4Lines({ ...action, index: actionIndex }, { indent: '    ' }),
    '',
  ];
  return lines.join('\n');
}

/**
 * 录制目录下增量写入草稿 py
 */
export class SeleniumIncrementalWriter {
  /**
   * @param {string} runDir - 本次 run 根目录
   * @param {Object} [options]
   * @param {Object} [options.log] - 可选 logger（含 warn/info）
   */
  constructor(runDir, options = {}) {
    /** @type {string} */
    this.runDir = runDir;
    /** @type {Object|undefined} */
    this.log = options.log;
    /** @type {string} */
    this.filePath = path.join(runDir, SELENIUM_DRAFT_FILENAME);
    /** @type {boolean} */
    this.initialized = false;
  }

  /**
   * 写入文件头（覆盖创建）
   *
   * @param {string} initialUrl
   */
  initDraft(initialUrl) {
    const header = buildDraftHeader(initialUrl);
    fs.writeFileSync(this.filePath, header, 'utf-8');
    this.initialized = true;
    if (this.log) this.log.info(`Selenium 草稿已初始化: ${this.filePath}`);
  }

  /**
   * 追加一条 action 对应的代码块
   *
   * @param {number} actionIndex - 1-based
   * @param {Object} action
   */
  appendAction(actionIndex, action) {
    if (!this.initialized) return;
    const block = formatDraftActionBlock(actionIndex, action);
    fs.appendFileSync(this.filePath, block, 'utf-8');
  }

  /**
   * 写入文件尾（闭合 main）
   */
  finalize() {
    if (!this.initialized) return;
    fs.appendFileSync(this.filePath, buildDraftFooter(), 'utf-8');
    this.initialized = false;
    if (this.log) this.log.info(`Selenium 草稿已收尾: ${this.filePath}`);
  }
}

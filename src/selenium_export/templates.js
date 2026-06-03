/**
 * templates.js - Selenium Python 脚本模板（Driver4 + XPath）
 *
 * 草稿与终稿共用头部/尾部结构；占位 URL、chromedriver 变量由调用方填入。
 */

import {
  SELENIUM_DRIVER4_IMPORT_LINE,
  SELENIUM_CHROMEDRIVER_VAR_NAME,
} from '../utils/config.js';

/** 草稿文件头警告（与计划一致：原始 action 无 merge 输入） */
export const DRAFT_WARNING_LINES = [
  '# 警告：本文件为录制过程增量草稿，基于「原始」action，未经 merge。',
  '# 两次点击之间的键盘输入在草稿中可能缺失；可靠自动化请以 step_0_selenium_from_recording.py（预处理+Phase1 后）为准。',
  '# designed by @yuzechao',
  '',
];

/** 终稿文件头说明 */
export const FINAL_WARNING_LINES = [
  '# 本脚本由录制数据经语义归并（merge）与 Phase1 结构化步骤生成，定位均为 XPath，调用 Driver4。',
  '# designed by @yuzechao',
  '',
];

/**
 * 草稿：文件头（含 main 骨架开始）
 *
 * @param {string} initialUrl - 起始 URL
 * @returns {string}
 */
export function buildDraftHeader(initialUrl) {
  const urlLit = JSON.stringify(initialUrl || '');
  const lines = [
    ...DRAFT_WARNING_LINES,
    SELENIUM_DRIVER4_IMPORT_LINE,
    '',
    `${SELENIUM_CHROMEDRIVER_VAR_NAME} = r"请填写本机 chromedriver 可执行文件路径"`,
    '',
    'def main():',
    '    d = Driver4()',
    `    d.open(${urlLit}, ${SELENIUM_CHROMEDRIVER_VAR_NAME})`,
    '',
    '    # ---------- 录制草稿（可能不完整） ----------',
    '',
  ];
  return lines.join('\n');
}

/**
 * 草稿：文件尾（闭合 main）
 *
 * @returns {string}
 */
export function buildDraftFooter() {
  return (
    '\n    d.quit()\n\n\n' +
    "if __name__ == '__main__':\n" +
    '    main()\n'
  );
}

/**
 * 终稿：文件头
 *
 * @param {string} initialUrl
 * @returns {string}
 */
export function buildFinalHeader(initialUrl) {
  const urlLit = JSON.stringify(initialUrl || '');
  const lines = [
    ...FINAL_WARNING_LINES,
    SELENIUM_DRIVER4_IMPORT_LINE,
    '',
    `${SELENIUM_CHROMEDRIVER_VAR_NAME} = r"请填写本机 chromedriver 可执行文件路径"`,
    '',
    'def main():',
    '    d = Driver4()',
    `    d.open(${urlLit}, ${SELENIUM_CHROMEDRIVER_VAR_NAME})`,
    '',
    '    # ---------- 结构化步骤对应操作（enriched） ----------',
    '',
  ];
  return lines.join('\n');
}

/**
 * 终稿：文件尾
 *
 * @returns {string}
 */
export function buildFinalFooter() {
  return buildDraftFooter();
}

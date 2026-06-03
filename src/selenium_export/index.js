/**
 * selenium_export - 录制侧 Selenium（Driver4 + XPath）脚本导出
 *
 * 对外导出增量草稿 Writer 与终稿再生函数。
 */

export { SeleniumIncrementalWriter, formatDraftActionBlock } from './selenium-incremental-writer.js';
export { regenerateFromStructured, resolveSourceActionIndices } from './regenerate-from-structured.js';
export { actionToDriver4Lines, pythonStringLiteral } from './action-to-driver4.js';
export { shortCommentFromAction } from './comment-from-action.js';

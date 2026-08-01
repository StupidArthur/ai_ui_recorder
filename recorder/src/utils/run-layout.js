/**
 * run-layout.js - 单次录制 run_* 目录布局（唯一路径来源）
 *
 * 布局：
 *   run_<timestamp>/
 *     meta.json                 # 录制元信息，也是下游翻译入口锚点
 *     record/                   # 录制原始数据
 *       actions/
 *       snapshots/
 *       screenshots/            # 可选
 *       recorder.log
 */

import fs from 'fs';
import path from 'path';

/** 录制元信息文件名（位于 run 根目录，翻译入口锚点） */
export const META_FILENAME = 'meta.json';

/** 截图子目录名（位于 record/ 下） */
export const SCREENSHOTS_SUBDIR = 'screenshots';

/** 录制数据根目录名（相对 runDir） */
export const RUN_RECORD_SUBDIR = 'record';

/** 录制：actions 子目录（相对 runDir） */
export const RECORD_ACTIONS_REL = `${RUN_RECORD_SUBDIR}/actions`;

/** 录制：snapshots 子目录（相对 runDir） */
export const RECORD_SNAPSHOTS_REL = `${RUN_RECORD_SUBDIR}/snapshots`;

/** 录制：截图子目录（相对 runDir） */
export const RECORD_SCREENSHOTS_REL = `${RUN_RECORD_SUBDIR}/${SCREENSHOTS_SUBDIR}`;

/** 录制：日志文件（相对 runDir） */
export const RECORD_LOG_REL = `${RUN_RECORD_SUBDIR}/recorder.log`;

/**
 * @param {string} runDir
 * @returns {string}
 */
export function getMetaPath(runDir) {
  return path.join(runDir, META_FILENAME);
}

/**
 * 录制阶段路径
 *
 * @param {string} runDir
 * @returns {{
 *   recordDir: string,
 *   actionsDir: string,
 *   snapshotsDir: string,
 *   screenshotsDir: string,
 *   recorderLog: string,
 * }}
 */
export function getRecordPaths(runDir) {
  const recordDir = path.join(runDir, RUN_RECORD_SUBDIR);
  return {
    recordDir,
    actionsDir: path.join(recordDir, 'actions'),
    snapshotsDir: path.join(recordDir, 'snapshots'),
    screenshotsDir: path.join(recordDir, SCREENSHOTS_SUBDIR),
    recorderLog: path.join(recordDir, 'recorder.log'),
  };
}

/**
 * 创建录制目录结构（record/actions、record/snapshots 等）
 *
 * @param {string} runDir
 * @param {{ screenshots?: boolean }} [options]
 */
export function ensureRecordLayout(runDir, options = {}) {
  const { screenshots = false } = options;
  const { actionsDir, snapshotsDir, screenshotsDir, recordDir } = getRecordPaths(runDir);
  fs.mkdirSync(recordDir, { recursive: true });
  fs.mkdirSync(actionsDir, { recursive: true });
  fs.mkdirSync(snapshotsDir, { recursive: true });
  if (screenshots) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
}

/**
 * Dashboard / API 可预览的相对路径（相对 runDir）
 */
export const DASHBOARD_PREVIEW_REL_PATHS = [
  META_FILENAME,
  RECORD_LOG_REL,
];

/**
 * run-layout.js - 单次录制 run_* 目录布局（唯一路径来源）
 *
 * 布局：
 *   run_<timestamp>/
 *     meta.json                 # 翻译入口锚点
 *     record/                   # 录制原始数据
 *       actions/
 *       snapshots/
 *       screenshots/            # 可选
 *       recorder.log
 *     translate/                # 翻译阶段全部产物
 *       logs/generate.log
 *       preprocess/{diffs,enriched,merged}
 *       phase1/{structured_steps.json,.xml,llm_raw_batches.xml,errors.json}
 *       phase2/cases.md
 *       phase4/agents.txt
 *       llm_audit/
 */

import fs from 'fs';
import path from 'path';

/** 录制元信息文件名（位于 run 根目录，翻译入口锚点） */
export const META_FILENAME = 'meta.json';

/** 截图子目录名（位于 record/ 下） */
export const SCREENSHOTS_SUBDIR = 'screenshots';

/** 录制数据根目录名（相对 runDir） */
export const RUN_RECORD_SUBDIR = 'record';

/** 翻译产物根目录名（相对 runDir） */
export const RUN_TRANSLATE_SUBDIR = 'translate';

/** 录制：actions 子目录（相对 runDir） */
export const RECORD_ACTIONS_REL = `${RUN_RECORD_SUBDIR}/actions`;

/** 录制：snapshots 子目录（相对 runDir） */
export const RECORD_SNAPSHOTS_REL = `${RUN_RECORD_SUBDIR}/snapshots`;

/** 录制：截图子目录（相对 runDir） */
export const RECORD_SCREENSHOTS_REL = `${RUN_RECORD_SUBDIR}/${SCREENSHOTS_SUBDIR}`;

/** 录制：日志文件（相对 runDir） */
export const RECORD_LOG_REL = `${RUN_RECORD_SUBDIR}/recorder.log`;

/** 翻译：generate 日志（相对 runDir） */
export const TRANSLATE_GENERATE_LOG_REL = `${RUN_TRANSLATE_SUBDIR}/logs/generate.log`;

/** 翻译：预处理根目录（相对 runDir） */
export const TRANSLATE_PREPROCESS_REL = `${RUN_TRANSLATE_SUBDIR}/preprocess`;

/** 翻译：Phase 1 目录（相对 runDir） */
export const TRANSLATE_PHASE1_REL = `${RUN_TRANSLATE_SUBDIR}/phase1`;

/** 翻译：Phase 1 主 JSON（相对 runDir） */
export const TRANSLATE_PHASE1_STEPS_JSON_REL = `${TRANSLATE_PHASE1_REL}/structured_steps.json`;

/** 翻译：Phase 1 XML 镜像（相对 runDir） */
export const TRANSLATE_PHASE1_STEPS_XML_REL = `${TRANSLATE_PHASE1_REL}/structured_steps.xml`;

/** 翻译：Phase 1 LLM 原始批次 XML（相对 runDir） */
export const TRANSLATE_PHASE1_LLM_RAW_XML_REL = `${TRANSLATE_PHASE1_REL}/llm_raw_batches.xml`;

/** 翻译：Phase 1 错误记录（相对 runDir） */
export const TRANSLATE_PHASE1_ERRORS_JSON_REL = `${TRANSLATE_PHASE1_REL}/errors.json`;

/** 翻译：Phase 2 用例 Markdown（相对 runDir，仅 LLM/程序补全 Case 正文） */
export const TRANSLATE_PHASE2_CASES_MD_REL = `${RUN_TRANSLATE_SUBDIR}/phase2/cases.md`;

/** 翻译：Phase 2 Case 覆盖核对表（相对 runDir，审计用，非 cases 正文） */
export const TRANSLATE_PHASE2_COVERAGE_MD_REL = `${RUN_TRANSLATE_SUBDIR}/phase2/coverage.md`;

/** 翻译：Phase 4 Agent 文本（相对 runDir） */
export const TRANSLATE_PHASE4_AGENTS_TXT_REL = `${RUN_TRANSLATE_SUBDIR}/phase4/agents.txt`;

/** 翻译：LLM 审计目录（相对 runDir） */
export const TRANSLATE_LLM_AUDIT_REL = `${RUN_TRANSLATE_SUBDIR}/llm_audit`;

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
 * 翻译阶段路径
 *
 * @param {string} runDir
 * @returns {{
 *   translateDir: string,
 *   generateLog: string,
 *   preprocessDir: string,
 *   diffsDir: string,
 *   enrichedDir: string,
 *   mergedDir: string,
 *   phase1Dir: string,
 *   structuredStepsJson: string,
 *   structuredStepsXml: string,
 *   llmRawXml: string,
 *   errorsJson: string,
 *   phase2Dir: string,
 *   casesMd: string,
 *   casesCoverageMd: string,
 *   phase4Dir: string,
 *   agentsTxt: string,
 *   llmAuditDir: string,
 * }}
 */
export function getTranslatePaths(runDir) {
  const translateDir = path.join(runDir, RUN_TRANSLATE_SUBDIR);
  const preprocessDir = path.join(translateDir, 'preprocess');
  const phase1Dir = path.join(translateDir, 'phase1');
  return {
    translateDir,
    generateLog: path.join(translateDir, 'logs', 'generate.log'),
    preprocessDir,
    diffsDir: path.join(preprocessDir, 'diffs'),
    enrichedDir: path.join(preprocessDir, 'enriched'),
    mergedDir: path.join(preprocessDir, 'merged'),
    phase1Dir,
    structuredStepsJson: path.join(phase1Dir, 'structured_steps.json'),
    structuredStepsXml: path.join(phase1Dir, 'structured_steps.xml'),
    llmRawXml: path.join(phase1Dir, 'llm_raw_batches.xml'),
    errorsJson: path.join(phase1Dir, 'errors.json'),
    phase2Dir: path.join(translateDir, 'phase2'),
    casesMd: path.join(translateDir, 'phase2', 'cases.md'),
    casesCoverageMd: path.join(translateDir, 'phase2', 'coverage.md'),
    phase4Dir: path.join(translateDir, 'phase4'),
    agentsTxt: path.join(translateDir, 'phase4', 'agents.txt'),
    llmAuditDir: path.join(translateDir, 'llm_audit'),
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
 * 创建翻译目录结构（各 phase 子目录与 logs）
 *
 * @param {string} runDir
 */
export function ensureTranslateLayout(runDir) {
  const p = getTranslatePaths(runDir);
  fs.mkdirSync(path.join(p.translateDir, 'logs'), { recursive: true });
  fs.mkdirSync(p.diffsDir, { recursive: true });
  fs.mkdirSync(p.enrichedDir, { recursive: true });
  fs.mkdirSync(p.mergedDir, { recursive: true });
  fs.mkdirSync(p.phase1Dir, { recursive: true });
  fs.mkdirSync(p.phase2Dir, { recursive: true });
  fs.mkdirSync(p.phase4Dir, { recursive: true });
  fs.mkdirSync(p.llmAuditDir, { recursive: true });
}

/**
 * Dashboard / API 可预览的相对路径（相对 runDir）
 */
export const DASHBOARD_PREVIEW_REL_PATHS = [
  META_FILENAME,
  RECORD_LOG_REL,
  TRANSLATE_GENERATE_LOG_REL,
  TRANSLATE_PHASE1_STEPS_JSON_REL,
  TRANSLATE_PHASE1_STEPS_XML_REL,
  TRANSLATE_PHASE1_LLM_RAW_XML_REL,
  TRANSLATE_PHASE2_CASES_MD_REL,
  TRANSLATE_PHASE2_COVERAGE_MD_REL,
  TRANSLATE_PHASE4_AGENTS_TXT_REL,
];

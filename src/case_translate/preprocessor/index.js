/**
 * preprocessor/index.js - 数据预处理编排入口
 *
 * 读取 recorder 输出的原始数据（meta.json、actions/、snapshots/），
 * 依次调用各预处理子模块完成语义归并、数据清洗和富化，
 * 将预处理结果写入 preprocessed/ 目录，供 AI 工作流使用。
 *
 * 预处理流程：
 * 1. 批量读取原始 action，执行语义归并（输入识别 + 双击去重 + 密码脱敏）
 *    → 归并报告写入 preprocessed/merged/merge_report.json
 * 2. 计算所有快照对的行级 diff → preprocessed/diffs/
 * 3. 对每个 action：
 *    a. 跳过已被归并标记为 skip 的 action
 *    b. 提取操作元素附近的快照上下文片段
 *    c. 计算与上一个 action 之间的 formState 变化
 *    d. 分类操作类型，生成 AI 分析提示（hints）
 *    e. 噪声检测：标记无意义的 action
 * 4. 将富化后的 action 数据写入 preprocessed/enriched/
 *
 * 使用方式：
 *   import { preprocess } from './preprocessor/index.js';
 *   const { enrichedActions } = await preprocess(runDir, { log });
 */

import fs from 'fs';
import path from 'path';

import {
  META_FILENAME,
  DIFFS_DATA_SUBDIR,
  ENRICHED_DATA_SUBDIR,
  MERGED_DATA_SUBDIR,
} from '../../utils/config.js';

import {
  ensureTranslateLayout,
  getRecordPaths,
  getTranslatePaths,
  RECORD_SNAPSHOTS_REL,
} from '../../utils/run-layout.js';

import { mergeActions, detectNoise } from './action-merge.js';
import { computeAllDiffs } from './snapshot-diff.js';
import { extractContextExcerpt } from './snapshot-context.js';
import { computeFormStateChanges, formatFormStateChanges } from './formState-diff.js';
import { classifyAction } from './action-classify.js';

// ==================== 核心入口函数 ====================

/**
 * 对一次录制的原始数据进行完整预处理
 *
 * @param {string} runDir - 录制输出目录路径（如 output/run_2026-02-15T06-08-43）
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器实例
 * @returns {Promise<Object>} 预处理结果
 * @returns {Array<Object>} returns.enrichedActions - 富化后的 action 数据数组
 * @returns {Object} returns.meta - 原始 meta 数据
 * @returns {string} returns.preprocessedDir - 预处理输出目录路径
 */
export async function preprocess(runDir, options = {}) {
  const { log } = options;

  if (log) log.info('========== 数据预处理开始 ==========');

  // ---------- 读取原始数据 ----------
  ensureTranslateLayout(runDir);

  const metaFile = path.join(runDir, META_FILENAME);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  const totalActions = meta.totalActions;

  const { snapshotsDir, actionsDir } = getRecordPaths(runDir);
  const { preprocessDir, diffsDir, enrichedDir, mergedDir } = getTranslatePaths(runDir);

  if (log) log.info(`原始数据: ${totalActions} 个操作, 快照目录: ${snapshotsDir}`);
  if (log) log.info(`预处理输出目录: ${preprocessDir}`);

  // ========== 第1步：批量读取原始 action + 语义归并 ==========
  if (log) log.info('[预处理 1/3] 批量读取 action + 语义归并...');

  const rawActions = readAllActions(actionsDir, totalActions, log);
  const { mergedActions, report: mergeReport } = mergeActions(rawActions, { log });

  // 保存归并报告
  const mergeReportFile = path.join(mergedDir, 'merge_report.json');
  fs.writeFileSync(mergeReportFile, JSON.stringify(mergeReport, null, 2), 'utf-8');
  if (log) log.info(`[预处理 1/3] 归并报告已保存: ${mergeReportFile}`);

  // ========== 第2步：计算所有 snapshot diff ==========
  if (log) log.info('[预处理 2/3] 计算快照 diff...');

  const snapshotFiles = fs.readdirSync(snapshotsDir).filter(f => f.startsWith('snapshot_') && f.endsWith('.txt'));
  const totalSnapshots = snapshotFiles.length;

  const { diffs } = computeAllDiffs(snapshotsDir, diffsDir, totalSnapshots, log);

  // ========== 第3步：逐条富化 action ==========
  if (log) log.info('[预处理 3/3] 逐条富化 action 数据...');

  const enrichedActions = [];
  let prevFormState = null;
  let noiseCount = 0;
  const totalMerged = mergedActions.length;

  for (let idx = 0; idx < totalMerged; idx++) {
    const action = mergedActions[idx];
    const i = action.index; // 原始序号（1-based）

    try {
      // 被双击去重标记的 action → 直接跳过，不进入 enrichedActions
      if (action.skip) {
        if (log) log.info(`  action ${i}/${totalActions} 已跳过 [${action.skip}]`);

        enrichedActions.push({
          index: i,
          type: action.type,
          element: action.element,
          skip: action.skip,
          snapshotDiff: null,
          preSnapshot: null,
          postSnapshot: null,
          contextExcerpt: null,
          formStateChanges: null,
          formStateChangeText: null,
          classification: { category: 'skipped', elementType: 'other', hints: [] },
        });

        // 更新 prevFormState（即使跳过也需要，保证后续 formState 差异计算正确）
        prevFormState = action.formStateDelta || prevFormState;
        continue;
      }

      // 读取对应的快照
      const preSnapshotFile = path.join(snapshotsDir, `snapshot_${String(i - 1).padStart(3, '0')}.txt`);
      const postSnapshotFile = path.join(snapshotsDir, `snapshot_${String(i).padStart(3, '0')}.txt`);

      const preSnapshot = fs.existsSync(preSnapshotFile) ? fs.readFileSync(preSnapshotFile, 'utf-8') : null;
      const postSnapshot = fs.existsSync(postSnapshotFile) ? fs.readFileSync(postSnapshotFile, 'utf-8') : null;

      // 获取 diff（已截断版本）
      const snapshotDiff = diffs.get(i) || '（diff 不可用）';

      // 提取上下文片段
      const contextExcerpt = preSnapshot && action.element
        ? extractContextExcerpt(preSnapshot, action.element)
        : null;

      // 计算 formState 变化
      const formStateChanges = computeFormStateChanges(prevFormState, action.formStateDelta);
      const formStateChangeText = formatFormStateChanges(formStateChanges);

      // 分类操作 + 生成 hints
      const classification = classifyAction(action, snapshotDiff, formStateChanges);

      // 噪声检测
      const isFirst = (idx === 0);
      const isLast = (idx === totalMerged - 1);
      const noiseResult = detectNoise(
        { ...action, snapshotDiff, formStateChanges },
        isFirst,
        isLast,
      );

      // 构建富化后的 action 对象
      const enriched = {
        index: i,
        // 原始 / 归并后的 action 字段
        type: action.type,
        originalType: action.originalType || undefined,
        inputValue: action.inputValue || undefined,
        element: action.element,
        key: action.key || undefined,
        url: action.url,
        title: action.title,
        timestamp: action.timestamp,
        formStateDelta: action.formStateDelta || null,
        // 预处理追加字段
        snapshotDiff,
        preSnapshot,
        postSnapshot,
        contextExcerpt,
        formStateChanges: formStateChanges.hasChanges ? formStateChanges : null,
        formStateChangeText,
        classification,
        // 噪声标记
        noise: noiseResult.isNoise || undefined,
        noiseReason: noiseResult.reason || undefined,
      };

      enrichedActions.push(enriched);

      // 如果被标记为噪声，追加到归并报告
      if (noiseResult.isNoise) {
        noiseCount++;
        mergeReport.details.push({
          index: i,
          rule: 'noise',
          reason: noiseResult.reason,
        });
      }

      // 保存富化后的 action 到文件
      const enrichedFile = path.join(enrichedDir, `enriched_${String(i).padStart(3, '0')}.json`);
      const enrichedForFile = {
        ...enriched,
        preSnapshot: preSnapshot ? `[见 ${RECORD_SNAPSHOTS_REL}/snapshot_${String(i - 1).padStart(3, '0')}.txt]` : null,
        postSnapshot: postSnapshot ? `[见 ${RECORD_SNAPSHOTS_REL}/snapshot_${String(i).padStart(3, '0')}.txt]` : null,
      };
      fs.writeFileSync(enrichedFile, JSON.stringify(enrichedForFile, null, 2), 'utf-8');

      // 更新 prevFormState
      prevFormState = action.formStateDelta || prevFormState;

      const statusTag = noiseResult.isNoise ? 'noise' : classification.category;
      if (log) log.info(`  action ${i}/${totalActions} 富化完成 [${statusTag}]`);

    } catch (error) {
      if (log) log.warn(`  action ${i}/${totalActions} 富化失败: ${error.message}`);

      enrichedActions.push({
        index: i,
        type: 'unknown',
        element: {},
        snapshotDiff: '（预处理失败）',
        preSnapshot: null,
        postSnapshot: null,
        contextExcerpt: null,
        formStateChanges: null,
        formStateChangeText: null,
        classification: { category: 'other', elementType: 'other', hints: [] },
      });
    }
  }

  // 更新归并报告（追加噪声统计）
  mergeReport.noiseMarked = noiseCount;
  fs.writeFileSync(mergeReportFile, JSON.stringify(mergeReport, null, 2), 'utf-8');

  if (log) {
    log.info(`========== 数据预处理完成：${enrichedActions.length} 条富化数据` +
      `（噪声 ${noiseCount} 条, skip ${mergeReport.dblclickDeduped} 条）==========`);
  }

  return {
    enrichedActions,
    meta,
    preprocessedDir: preprocessDir,
  };
}

// ==================== 内部工具函数 ====================

/**
 * 批量读取所有原始 action JSON 文件
 *
 * @param {string} actionsDir - actions/ 目录路径
 * @param {number} totalActions - 总 action 数量
 * @param {Object|null} log - 日志器
 * @returns {Array<Object>} 原始 action 对象数组
 */
function readAllActions(actionsDir, totalActions, log) {
  const actions = [];

  for (let i = 1; i <= totalActions; i++) {
    const actionFile = path.join(actionsDir, `action_${String(i).padStart(3, '0')}.json`);
    try {
      const action = JSON.parse(fs.readFileSync(actionFile, 'utf-8'));
      actions.push(action);
    } catch (error) {
      if (log) log.warn(`  读取 action ${i} 失败: ${error.message}`);
      // 填充最小数据，保持序号连续
      actions.push({
        index: i,
        type: 'unknown',
        element: {},
        formStateDelta: null,
        timestamp: 0,
      });
    }
  }

  return actions;
}

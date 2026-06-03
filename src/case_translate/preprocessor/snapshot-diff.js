/**
 * snapshot-diff.js - 快照差异计算模块
 *
 * 负责计算相邻快照对的行级 diff，并可选截断超长 diff 以节省 AI token。
 * 原逻辑从 recorder.js 迁移至此，属于翻译模块的数据预处理环节。
 *
 * 输出：
 *   preprocessed/diffs/diff_001.txt ~ diff_NNN.txt
 *
 * 使用方式：
 *   import { computeAllDiffs, computeDiff, truncateDiff } from './snapshot-diff.js';
 */

import fs from 'fs';
import path from 'path';
import { diffLines } from 'diff';

import { DIFF_TRUNCATE_THRESHOLD } from '../../utils/config.js';

// ==================== 核心函数 ====================

/**
 * 计算两段快照文本之间的行级差异
 *
 * @param {string} preText - 操作前的快照文本
 * @param {string} postText - 操作后的快照文本
 * @returns {string} 格式化的 diff 文本（仅包含 +/- 行）
 */
export function computeDiff(preText, postText) {
  const changes = diffLines(preText, postText);

  const result = [];
  let hasChange = false;

  for (const part of changes) {
    const lines = part.value.replace(/\n$/, '').split('\n');

    if (part.added) {
      hasChange = true;
      for (const line of lines) {
        result.push(`+ ${line}`);
      }
    } else if (part.removed) {
      hasChange = true;
      for (const line of lines) {
        result.push(`- ${line}`);
      }
    }
    // 未变化的行不输出，保持 diff 精简
  }

  if (!hasChange) {
    return '（preSnapshot 和 postSnapshot 完全相同，操作未引起可见的 UI 变化）';
  }

  return result.join('\n');
}

/**
 * 截断超长 diff 文本，保留首尾各一半
 *
 * 当 diff 文本超过 threshold 时，保留前半和后半，中间以省略标记连接，
 * 防止 AI 输入过长浪费 token。
 *
 * @param {string} diffText - 原始 diff 文本
 * @param {number} [threshold] - 截断阈值（字符数），默认使用配置值
 * @returns {string} 截断后的 diff 文本
 */
export function truncateDiff(diffText, threshold = DIFF_TRUNCATE_THRESHOLD) {
  if (!diffText || diffText.length <= threshold) {
    return diffText;
  }

  const half = Math.floor(threshold / 2);
  const head = diffText.slice(0, half);
  const tail = diffText.slice(-half);

  return `${head}\n\n... [diff 过长，已截断 ${diffText.length - threshold} 字符] ...\n\n${tail}`;
}

/**
 * 遍历所有快照对，计算行级 diff 并保存到 diffsDir
 *
 * @param {string} snapshotsDir - 快照目录路径（snapshots/）
 * @param {string} diffsDir - diff 输出目录路径（preprocessed/diffs/）
 * @param {number} totalSnapshots - 快照总数（包含 snapshot_000）
 * @param {Object} [log] - 可选日志器
 * @returns {{ diffs: Map<number, string> }} actionIndex → diff 文本 的映射
 */
export function computeAllDiffs(snapshotsDir, diffsDir, totalSnapshots, log = null) {
  const totalDiffs = totalSnapshots - 1;
  const diffs = new Map();

  if (totalDiffs <= 0) {
    if (log) log.warn('快照不足，无法计算 diff');
    return { diffs };
  }

  // 确保输出目录存在
  fs.mkdirSync(diffsDir, { recursive: true });

  if (log) log.info(`开始计算 ${totalDiffs} 个 snapshot diff...`);

  for (let i = 1; i <= totalDiffs; i++) {
    try {
      const preFile = path.join(snapshotsDir, `snapshot_${String(i - 1).padStart(3, '0')}.txt`);
      const postFile = path.join(snapshotsDir, `snapshot_${String(i).padStart(3, '0')}.txt`);

      const preText = fs.readFileSync(preFile, 'utf-8');
      const postText = fs.readFileSync(postFile, 'utf-8');

      const diffText = computeDiff(preText, postText);

      // 保存完整 diff 到文件
      const diffFilename = `diff_${String(i).padStart(3, '0')}.txt`;
      const diffFilepath = path.join(diffsDir, diffFilename);
      fs.writeFileSync(diffFilepath, diffText, 'utf-8');

      // 映射中存储截断后的版本（供 AI 使用）
      diffs.set(i, truncateDiff(diffText));
    } catch (error) {
      const msg = `diff_${String(i).padStart(3, '0')} 计算失败: ${error.message}`;
      if (log) log.warn(msg);
      diffs.set(i, '（diff 计算失败）');
    }
  }

  if (log) log.info(`${totalDiffs} 个 diff 计算完成`);
  return { diffs };
}

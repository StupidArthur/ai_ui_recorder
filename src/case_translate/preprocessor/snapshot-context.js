/**
 * snapshot-context.js - 快照上下文片段提取模块
 *
 * 从完整的 AX 快照文本中，根据被操作元素的特征（text/name/id 等），
 * 定位该元素在快照中的位置，提取其父节点及最近的兄弟节点，
 * 构成精简的 UI 上下文片段，供 AI 聚焦分析。
 *
 * 设计目的：
 * - 完整快照可能有数百行，AI 难以在其中定位关键信息
 * - 上下文片段只保留操作元素附近的结构，大幅减少 token 消耗
 * - 保留层级关系（缩进），帮助 AI 理解元素所在的 UI 区域
 *
 * 使用方式：
 *   import { extractContextExcerpt } from './snapshot-context.js';
 *   const excerpt = extractContextExcerpt(snapshotText, actionElement);
 */

import { CONTEXT_EXCERPT_MAX_SIBLINGS } from '../../utils/config.js';

// ==================== 核心函数 ====================

/**
 * 从快照文本中提取被操作元素附近的上下文片段
 *
 * 算法：
 * 1. 根据 element 的 text/label/name/id 在快照行中模糊匹配
 * 2. 找到匹配行后，向上回溯到父节点（缩进更小的行）
 * 3. 从父节点开始，向下收集最近 N 个同级兄弟节点
 * 4. 拼接为精简的上下文片段
 *
 * @param {string} snapshotText - 完整的 AX 快照文本（YAML 缩进格式）
 * @param {Object} element - action.element 对象，包含 text/label/name/id/tag 等字段
 * @param {number} [maxSiblings] - 最大兄弟节点数，默认使用配置值
 * @returns {string|null} 上下文片段文本，未找到匹配返回 null
 */
export function extractContextExcerpt(snapshotText, element, maxSiblings = CONTEXT_EXCERPT_MAX_SIBLINGS) {
  if (!snapshotText || !element) return null;

  const lines = snapshotText.split('\n');
  if (lines.length === 0) return null;

  // 构建搜索关键词列表（优先级从高到低）
  const keywords = buildSearchKeywords(element);
  if (keywords.length === 0) return null;

  // 在快照行中查找最佳匹配
  const matchIndex = findBestMatch(lines, keywords);
  if (matchIndex < 0) return null;

  // 获取匹配行的缩进深度
  const matchIndent = getIndent(lines[matchIndex]);

  // 向上回溯找父节点
  let parentIndex = -1;
  for (let i = matchIndex - 1; i >= 0; i--) {
    if (getIndent(lines[i]) < matchIndent && lines[i].trim()) {
      parentIndex = i;
      break;
    }
  }

  // 收集上下文行：父节点 + 父节点下的子节点（最多 maxSiblings 个同级）
  const excerptLines = [];
  const startIndex = parentIndex >= 0 ? parentIndex : matchIndex;
  const parentIndent = parentIndex >= 0 ? getIndent(lines[parentIndex]) : matchIndent;

  // 添加父节点
  if (parentIndex >= 0) {
    excerptLines.push(lines[parentIndex]);
  }

  // 从父节点的下一行开始，收集同级子节点
  let siblingCount = 0;
  let matchIncluded = false;

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineIndent = getIndent(line);

    // 缩进更小或相等的行 = 离开了父节点的范围
    if (lineIndent <= parentIndent && line.trim()) {
      break;
    }

    // 同级子节点（直接子节点）
    if (lineIndent === matchIndent) {
      siblingCount++;

      // 围绕匹配行收集：在匹配行附近的兄弟保留
      if (i === matchIndex) {
        matchIncluded = true;
        excerptLines.push(line + '  ← [操作目标]');
        // 收集该元素的子节点
        for (let j = i + 1; j < lines.length; j++) {
          if (getIndent(lines[j]) > matchIndent) {
            excerptLines.push(lines[j]);
          } else {
            break;
          }
        }
      } else if (Math.abs(i - matchIndex) <= maxSiblings) {
        excerptLines.push(line);
      }
    }
  }

  // 如果匹配行不是子节点层级（可能是更深层），直接收集匹配行周围
  if (!matchIncluded) {
    excerptLines.push(lines[matchIndex] + '  ← [操作目标]');
  }

  if (excerptLines.length === 0) return null;

  return excerptLines.join('\n');
}

// ==================== 内部工具函数 ====================

/**
 * 从 element 对象中提取搜索关键词列表（按匹配优先级排序）
 *
 * @param {Object} element - action.element 对象
 * @returns {string[]} 关键词列表
 */
function buildSearchKeywords(element) {
  const keywords = [];

  // 优先使用用户可见的文本/标签
  if (element.text) keywords.push(element.text.trim());
  if (element.label) keywords.push(element.label.trim());
  if (element.name) keywords.push(element.name.trim());
  if (element.placeholder) keywords.push(element.placeholder.trim());

  // ID 作为次级匹配
  if (element.id) keywords.push(element.id.trim());

  // 去除空字符串和过短关键词
  return keywords.filter(k => k && k.length >= 2);
}

/**
 * 在快照行中查找与关键词最匹配的行
 *
 * @param {string[]} lines - 快照文本的行数组
 * @param {string[]} keywords - 搜索关键词列表（按优先级排序）
 * @returns {number} 匹配的行索引，未找到返回 -1
 */
function findBestMatch(lines, keywords) {
  // 按关键词优先级逐个搜索
  for (const keyword of keywords) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(keyword)) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * 获取一行文本的缩进深度（前导空格数）
 *
 * @param {string} line - 文本行
 * @returns {number} 前导空格数
 */
function getIndent(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

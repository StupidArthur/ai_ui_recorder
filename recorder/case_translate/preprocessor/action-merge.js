/**
 * action-merge.js - 语义归并模块
 *
 * 对 recorder 输出的原始 action 序列进行语义级别的归并处理，
 * 在送入 diff 计算和 AI 翻译之前，提升每条 action 的语义完整性并减少噪声。
 *
 * 实现的归并规则：
 * 1. 输入识别（高价值）：将"点击输入框"重新识别为"在输入框中输入值"
 *    - 对比 action[i] 与 action[i+1] 的 formStateDelta，检测目标字段值变化
 *    - 将 type 从 "click" 改为 "input"，附加 inputValue 字段
 * 2. 双击去重（低优先级）：合并浏览器双击产生的冗余 click 事件
 *    - 浏览器双击依次触发 click → click → dblclick，仅保留 dblclick
 * 另外提供噪声检测函数 detectNoise()，供 preprocessor/index.js
 * 在 enrichment 阶段（diff 已计算后）调用标记无意义的 action。
 *
 * 使用方式：
 *   import { mergeActions, detectNoise } from './action-merge.js';
 *   const mergedActions = mergeActions(rawActions, { log });
 *   // ... 后续 diff 计算 + enrichment 循环中调用 detectNoise()
 */

import {
  DBLCLICK_TIME_THRESHOLD_MS,
} from '../../utils/config.js';

/**
 * 与 inject-script.js 中一致的 @id XPath 键（formStateDelta 的 key 为元素 xpath）
 *
 * @param {string} id - HTML id
 * @returns {string}
 */
function xpathStringLiteralForMatch(id) {
  const s = String(id);
  if (!s.includes("'")) return `'${s}'`;
  const parts = s.split("'");
  return `concat('${parts.join("', \"'\", '")}')`;
}

/**
 * 由 id 得到与录制端相同的 xpath 键
 *
 * @param {string} id
 * @returns {string}
 */
function xpathKeyFromId(id) {
  return `//*[@id=${xpathStringLiteralForMatch(id)}]`;
}

// ==================== 核心导出函数 ====================

/**
 * 对原始 action 数组进行语义归并
 *
 * 执行顺序：双击去重 → 输入识别
 * 不改变数组长度，仅修改 action 的 type / 附加字段 / skip 标记。
 *
 * @param {Array<Object>} rawActions - 从 action_NNN.json 读取的原始 action 对象数组
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.log] - 日志器实例
 * @returns {{ mergedActions: Array<Object>, report: Object }} 归并后的 action 数组和归并报告
 */
export function mergeActions(rawActions, options = {}) {
  const { log } = options;

  if (log) log.info('[语义归并] 开始处理...');

  // 浅拷贝，避免污染原始数据
  const actions = rawActions.map(a => ({ ...a }));

  // 归并报告
  const report = {
    totalOriginal: actions.length,
    inputRecognized: 0,
    dblclickDeduped: 0,
    details: [],
  };

  // 规则 3：双击去重（先执行，避免冗余 click 影响输入识别判断）
  deduplicateDoubleClicks(actions, report, log);

  // 规则 1：输入识别
  recognizeInputActions(actions, report, log);

  if (log) {
    log.info(`[语义归并] 完成: 输入识别 ${report.inputRecognized} 条, 双击去重 ${report.dblclickDeduped} 条`);
  }

  return { mergedActions: actions, report };
}

/**
 * 噪声检测：判断一条已富化的 action 是否为无意义噪声
 *
 * 需要在 diff 计算和 formState 差异计算完成后调用。
 * 仅标记，不删除。workflow 中根据 noise 标记跳过 AI 调用。
 *
 * @param {Object} enrichedAction - 富化后的 action 数据
 * @param {boolean} isFirst - 是否是第一条 action
 * @param {boolean} isLast - 是否是最后一条 action
 * @returns {{ isNoise: boolean, reason: string|null }} 噪声检测结果
 */
export function detectNoise(enrichedAction, isFirst, isLast) {
  // 首尾 action 不判噪声（可能有特殊含义：进入页面 / 结束操作）
  if (isFirst || isLast) {
    return { isNoise: false, reason: null };
  }

  // 已被标记为 skip 或已被识别为 input 的，不再判噪声
  if (enrichedAction.skip || enrichedAction.type === 'input') {
    return { isNoise: false, reason: null };
  }

  // 只对 click 类型判断噪声（keypress / dblclick / rightclick 通常有明确语义）
  if (enrichedAction.type !== 'click') {
    return { isNoise: false, reason: null };
  }

  // 条件 1：diff 为空或无变化
  const diffEmpty = isDiffEmpty(enrichedAction.snapshotDiff);
  if (!diffEmpty) {
    return { isNoise: false, reason: null };
  }

  // 条件 2：formState 无变化
  const formStateUnchanged = !enrichedAction.formStateChanges || !enrichedAction.formStateChanges.hasChanges;
  if (!formStateUnchanged) {
    return { isNoise: false, reason: null };
  }

  return {
    isNoise: true,
    reason: 'diff-empty + formState-unchanged',
  };
}

// ==================== 规则 1：输入识别 ====================

/**
 * 遍历 action 数组，识别"点击输入框"并重新标注为"输入"类型
 *
 * 算法：对于 action[i] 是点击 input/textarea（非 checkbox/radio）的情况，
 * 比较 action[i].formStateDelta 和 action[i+1].formStateDelta 中目标字段的值，
 * 若发生变化，说明用户在两次操作之间输入了文本。
 *
 * @param {Array<Object>} actions - action 数组（会被就地修改）
 * @param {Object} report - 归并报告（会被就地修改）
 * @param {Object|null} log - 日志器
 */
function recognizeInputActions(actions, report, log) {
  for (let i = 0; i < actions.length - 1; i++) {
    // 跳过已被双击去重标记的 action
    if (actions[i].skip) continue;

    const curr = actions[i];
    const next = actions[i + 1];

    // 必须是 click 类型
    if (curr.type !== 'click') continue;

    // 必须点击的是 input 或 textarea（排除 checkbox / radio）
    const tag = (curr.element?.tag || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') continue;

    const inputType = (curr.element?.type || '').toLowerCase();
    if (inputType === 'checkbox' || inputType === 'radio') continue;

    // 在 formStateDelta 中查找目标元素
    const formKey = findMatchingFormStateKey(curr.element, curr.formStateDelta);
    if (!formKey) continue;

    // 对比当前和下一个 action 的 formStateDelta 中该字段的值
    const prevValue = extractValue(curr.formStateDelta, formKey);
    const nextValue = extractValue(next.formStateDelta, formKey);

    // 值未变化或下一个 action 中该字段不存在 → 不是输入
    if (prevValue === nextValue || nextValue === null) continue;

    // 确认为输入操作
    curr.originalType = curr.type;
    curr.type = 'input';
    curr.inputValue = nextValue;

    report.inputRecognized++;
    report.details.push({
      index: curr.index,
      rule: 'input-recognize',
      from: curr.originalType,
      to: 'input',
      inputValue: curr.inputValue,
    });

    if (log) {
      log.info(`  action ${curr.index}: click → input "${nextValue}" (${formKey})`);
    }
  }
}

// ==================== 规则 3：双击去重 ====================

/**
 * 检测并标记双击事件产生的冗余 click
 *
 * 浏览器双击事件序列：click → click → dblclick（作用于同一元素）
 * 本函数向前扫描 dblclick 之前的 click，若满足时间阈值和元素匹配条件，
 * 则将冗余 click 标记为 skip。
 *
 * @param {Array<Object>} actions - action 数组（会被就地修改）
 * @param {Object} report - 归并报告（会被就地修改）
 * @param {Object|null} log - 日志器
 */
function deduplicateDoubleClicks(actions, report, log) {
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].type !== 'dblclick') continue;

    const dblclickAction = actions[i];
    const dblclickTime = dblclickAction.timestamp;
    const dblclickXpath = dblclickAction.element?.xpath;

    // 向前扫描最多 2 个位置
    for (let j = i - 1; j >= 0 && j >= i - 2; j--) {
      if (actions[j].type !== 'click') continue;
      if (actions[j].element?.xpath !== dblclickXpath) continue;
      if (dblclickTime - actions[j].timestamp > DBLCLICK_TIME_THRESHOLD_MS) continue;

      // 标记为冗余
      actions[j].skip = 'dblclick-dedup';

      report.dblclickDeduped++;
      report.details.push({
        index: actions[j].index,
        rule: 'dblclick-dedup',
        mergedInto: dblclickAction.index,
      });

      if (log) {
        log.info(`  action ${actions[j].index}: 双击去重 → 被 dblclick(action ${dblclickAction.index}) 合并`);
      }
    }
  }
}

// ==================== formStateDelta 键匹配（键为元素 xpath） ====================

/**
 * 在 formStateDelta 的 key 中查找与给定元素匹配的项
 *
 * 匹配优先级：
 * 1. element.xpath 精确匹配（与 inject 中 captureFormState 的键一致）
 * 2. 由 element.id 构造的 //*[@id=…] 与 key 精确匹配
 * 3. 模糊：任意 key 包含 element.id（兼容边界情况）
 *
 * @param {Object} element - action.element（含 xpath、id、name、tag）
 * @param {Object|null} formStateDelta
 * @returns {string|null} 匹配到的 key，未匹配返回 null
 */
function findMatchingFormStateKey(element, formStateDelta) {
  if (!formStateDelta || !element) return null;

  const keys = Object.keys(formStateDelta);
  if (keys.length === 0) return null;

  if (element.xpath && formStateDelta[element.xpath] !== undefined) {
    return element.xpath;
  }

  if (element.id) {
    const idKey = xpathKeyFromId(element.id);
    if (formStateDelta[idKey] !== undefined) return idKey;
  }

  if (element.id) {
    for (const key of keys) {
      if (key.includes(element.id)) return key;
    }
  }

  return null;
}

// ==================== 工具函数 ====================

/**
 * 从 formStateDelta 中提取指定 key（xpath）的 value 字段
 *
 * @param {Object|null} formStateDelta
 * @param {string} formKey - formStateDelta 的键（元素 xpath）
 * @returns {string|null}
 */
function extractValue(formStateDelta, formKey) {
  if (!formStateDelta || !formStateDelta[formKey]) return null;

  const entry = formStateDelta[formKey];
  // 优先取 value 字段
  if (entry.value !== undefined) return entry.value;

  return null;
}

/**
 * 判断 snapshot diff 是否为空（无实质变化）
 *
 * @param {string|null} diffText - snapshot diff 文本
 * @returns {boolean} diff 是否为空
 */
function isDiffEmpty(diffText) {
  if (!diffText) return true;
  if (diffText.includes('完全相同')) return true;
  if (diffText.trim() === '') return true;

  // diff 文本中没有 + 或 - 开头的行（排除 --- / +++ 头部标记）
  const lines = diffText.split('\n');
  const hasChanges = lines.some(line => {
    const trimmed = line.trimStart();
    return (trimmed.startsWith('+') && !trimmed.startsWith('+++')) ||
           (trimmed.startsWith('-') && !trimmed.startsWith('---'));
  });

  return !hasChanges;
}

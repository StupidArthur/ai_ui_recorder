/**
 * midscene/mapper.js - 结构化步骤映射为 Midscene flow
 */

/**
 * 将结构化步骤映射为 Midscene flow
 *
 * @param {Array<Object>} steps
 * @param {{ defaultSleepMs: number, enableIntervalSleep?: boolean, intervalSleepMinMs?: number, intervalSleepMaxMs?: number }} options
 * @returns {Array<Object>}
 */
export function mapStepsToFlow(steps, options) {
  const {
    defaultSleepMs,
    enableIntervalSleep = true,
    intervalSleepMinMs = 300,
    intervalSleepMaxMs = 5000,
  } = options;
  const flow = [];

  for (const step of steps || []) {
    if (!step || step.status === 'skip') continue;

    const description = sanitizeText(step.description);
    const key = sanitizeText(step.key);

    // 在当前步骤前插入“上一步完成 -> 本步骤完成”间隔等待
    // 该时间可反映前一次操作后的产品响应耗时。
    if (enableIntervalSleep) {
      const intervalMs = Number(step.intervalFromPreviousMs);
      if (Number.isFinite(intervalMs) && intervalMs >= intervalSleepMinMs) {
        const boundedSleep = Math.min(Math.max(intervalMs, intervalSleepMinMs), intervalSleepMaxMs);
        flow.push({ sleep: Math.round(boundedSleep) });
      }
    }

    // 对噪声项统一降级为轻量等待，减少脚本不稳定性
    if (step.status === 'noise') {
      flow.push({ sleep: defaultSleepMs });
      continue;
    }

    if (step.actionKind === 'doubleClick') {
      flow.push({ aiDoubleClick: description || '执行双击操作' });
      continue;
    }

    if (step.actionKind === 'keyPress' && key) {
      flow.push({ aiKeyboardPress: key });
      continue;
    }

    if (step.actionKind === 'sleep') {
      const ms = Number.isFinite(step.sleepMs) ? step.sleepMs : defaultSleepMs;
      flow.push({ sleep: ms > 0 ? ms : defaultSleepMs });
      continue;
    }

    // 默认降级为 ai 自然语言执行指令
    flow.push({ ai: description || sanitizeText(step.uiChange) || '执行当前步骤操作' });
  }

  return flow;
}

/**
 * 清理文本
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}


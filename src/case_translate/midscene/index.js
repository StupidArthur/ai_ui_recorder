/**
 * midscene/index.js - Step JSON -> Midscene YAML 转换入口
 */

import fs from 'fs';
import path from 'path';

import {
  MIDSCENE_NO_ASSERT_FILENAME,
  MIDSCENE_TASK_NAME,
  MIDSCENE_DEFAULT_SLEEP_MS,
  MIDSCENE_ENABLE_INTERVAL_SLEEP,
  MIDSCENE_INTERVAL_SLEEP_MIN_MS,
  MIDSCENE_INTERVAL_SLEEP_MAX_MS,
} from '../../utils/config.js';

import { mapStepsToFlow } from './mapper.js';
import { renderMidsceneYaml } from './yaml-emitter.js';

/**
 * 生成 Midscene YAML（默认不写 assert）
 *
 * @param {string} runDir
 * @param {Array<Object>} structuredSteps
 * @param {Object} [options]
 * @param {Object} [options.log]
 * @returns {{ noAssertFile: string }}
 */
export function generateMidsceneYaml(runDir, structuredSteps, options = {}) {
  const { log } = options;
  const noAssertFile = path.join(runDir, MIDSCENE_NO_ASSERT_FILENAME);

  const webUrl = resolveWebUrl(structuredSteps);
  const noAssertFlow = mapStepsToFlow(structuredSteps, {
    defaultSleepMs: MIDSCENE_DEFAULT_SLEEP_MS,
    enableIntervalSleep: MIDSCENE_ENABLE_INTERVAL_SLEEP,
    intervalSleepMinMs: MIDSCENE_INTERVAL_SLEEP_MIN_MS,
    intervalSleepMaxMs: MIDSCENE_INTERVAL_SLEEP_MAX_MS,
  });

  const noAssertYaml = renderMidsceneYaml({
    webUrl,
    taskName: MIDSCENE_TASK_NAME,
    flow: noAssertFlow,
  });

  fs.writeFileSync(noAssertFile, noAssertYaml, 'utf-8');

  if (log) {
    log.info(`[Phase 3] Midscene YAML 已保存（no_assert）: ${noAssertFile}`);
  }

  return { noAssertFile };
}

/**
 * 从结构化步骤中解析目标 URL
 *
 * @param {Array<Object>} steps
 * @returns {string}
 */
function resolveWebUrl(steps) {
  for (const step of steps || []) {
    if (step && typeof step.url === 'string' && step.url.trim()) {
      return step.url.trim();
    }
  }
  return '';
}


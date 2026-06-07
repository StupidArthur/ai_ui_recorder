# Phase 2 测试用例归纳拆块方案（重生成）

## 1. 目标
- 解决 Phase 2 在大输入下中断的问题。
- 将“整份 `AI_steps.md` 一次调用”改为“按场景分块多次调用 + 程序合并”。
- 在失败时可定位错误（而不是只看到“正在归纳测试用例...”）。

## 2. 问题确认（基于当前日志）
- `generate.log` 显示 Phase 1 完成并保存 `AI_steps.md`，最后停在：`[Phase 2] 正在归纳测试用例...`。
- `recorder.log` 显示录制完整结束，共 83 操作、快照与 `meta.json` 正常落盘。
- 结论：录制链路正常，问题位于 Phase 2 首次模型调用（高概率为上下文过长或调用异常未记录）。

## 3. 总体改造

### 3.1 新流程
1) 读取步骤数据（优先结构化富化数据；其次 `AI_steps.md`）
2) 自动切分 chunk（按 URL/iframe/时间/步数/token）
3) 对每个 chunk 单独调用 LLM 生成测试用例 JSON
4) 程序合并与去重，输出最终 `testcases_merged.json` / `TESTCASES.md`

### 3.2 关键原则
- 单次调用永不超预算（token/字符阈值）
- 每条输出用例必须带 `coveredActionIndices`
- 单块失败不拖垮全局（可配置 fail-fast）

## 4. 分块策略（未知步骤可用）

### 4.1 强切分（优先）
满足任一条件即切块：
- URL 规范化后变化（建议比 pathname + 关键 query）
- 主内容“列表壳页”与“iframe 页面”互切
- 显式导航事件（goto/navigation）

### 4.2 弱切分（辅助）
- 相邻操作时间差 > `idleGapMs`（如 45s）
- 当前块步数超过 `maxActionsPerChunk`（如 22）

### 4.3 兜底切分（必须）
- 当前块摘要字符数超过 `maxChunkChars`（如 12000）时，按“完整步骤边界”切断。
- 可设置跨块重叠 1~2 步，避免上下文断裂。

### 4.4 碎块合并
- 若相邻两块 URL 相同且步数都小于 `smallChunkMaxActions`（如 4），则合并。

## 5. 每块输入规范
- 不直接喂全量 `AI_steps.md`。
- 每步仅保留：
  - 操作编号
  - 页面（TPT/App）
  - 类型（form-input/toggle/other）
  - 描述（1~2句）
  - UI 变化（短）
- 删除长“依据”段落。

## 6. 每块输出规范（JSON）
```json
{
  "chunkId": "chunk-03",
  "testCases": [
    {
      "localId": "TC-01",
      "title": "...",
      "preconditions": ["..."],
      "steps": ["..."],
      "expected": ["..."],
      "coveredActionIndices": [12, 13, 14]
    }
  ]
}
```

约束：
- 每块最多输出 8~10 条。
- 必须仅依据本块步骤，不得编造未出现页面。

## 7. 合并策略
1) 按 chunk 顺序拼接
2) 全局编号 `TC-001...`
3) 去重：`coveredActionIndices` 相同/高重叠合并
4) 依赖说明：后续块用例在 `preconditions` 明确依赖前序成果

## 8. 观测与错误处理（必须实现）
- 每次 LLM 调用前后记录：
  - `chunkId`
  - prompt 字符数 / 预估 token
  - 耗时
  - 成功/失败
- `try/catch` 记录：
  - message
  - code / HTTP status
  - response 摘要
- 单块失败落盘：`chunk-xx.failed.json`

## 9. 推荐配置（首版）
```yaml
chunking:
  maxActionsPerChunk: 22
  maxChunkChars: 12000
  idleGapMs: 45000
  smallChunkMaxActions: 4
  overlapSteps: 1
llm:
  maxTestCasesPerChunk: 8
  continueOnChunkError: true
```

## 10. 实施计划（M1~M6）
- M1：实现步骤摘要抽取（剥离“依据”）
- M2：实现自动切分器（强/弱/兜底/合并）
- M3：Phase 2 改为 chunk 循环调用 + JSON 校验
- M4：实现合并器与最终导出
- M5：补齐日志、失败落盘、重试机制
- M6（可选）：增加 Pass 0 轻量分段（极简时间线先分场景）

## 11. 验收标准
- 80+ 步录制下，Phase 2 不再静默中断。
- 日志可定位到具体失败 chunk 与错误原因。
- 最终测试用例可回溯到操作序号（`coveredActionIndices`）。

## 12. 本次样例映射（可选手工首版）
- S1: 1-8 登录与进入 Agent
- S2: 9-16 新建 Agent
- S3: 17-32 配置与微调前段
- S4: 33-37 导航与进入闭环
- S5: 38-64 多 Tab 选表与确认
- S6: 65-70 提交与启用
- S7: 71-79 结果与推理
- S8: 80-83 返回与收尾

---
文档用途：作为 `case_translate` Phase 2 改造的实施依据。

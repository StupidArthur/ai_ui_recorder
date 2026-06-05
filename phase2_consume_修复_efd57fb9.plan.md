---
name: Phase2 consume 修复
overview: Phase 2 的 `lastIndex` 锚定逻辑会将 consume 强行扩展到 LLM 正文最后提到的步骤，导致中间未写入的步骤被误标"已消费"而永久丢失。修复方案：**以 `consumeStepCount` 为准推进 cursor**；`lastIndex` 仅做一致性校验与审计；兜底介入时输出双结果并在 Dashboard 明确提示。
todos:
  - id: fix-lastindex
    content: 修改 case-markdown-renderer.js：lastIndex 只做校验警告，不覆盖 consumeStepCount
    status: pending
  - id: dual-output-fallback
    content: 兜底介入时输出双结果（cases.md + cases_fallback.md）并在 Dashboard 明确提示
    status: pending
  - id: strict-fallback-trigger
    content: 采用严格模式判定兜底：所有 status=normal 步骤必须在主流程正文中被引用
    status: pending
  - id: fallback-logging-ui
    content: 补充兜底日志格式与 Dashboard 展示（fallbackApplied、缺失 index 列表）
    status: pending
isProject: false
---

# Phase 2 consume 锚定逻辑修复

> 评审意见已合并自 [`idea1.md`](idea1.md)

## 根因（已用 llm_audit 验证）

**证据**：`release1/output/run_2026-06-04T11-39-58/translate/llm_audit/call_0015.json`（Phase 2 轮次 2，窗口 index 6~25）

LLM 实际返回：

- 正文只写了 `[步骤 20]` ~ `[步骤 25]`（跳过 6~19）
- meta：`<case_meta consumeStepCount="6" lastIndex="25"/>`

程序逻辑（[`case-markdown-renderer.js`](src/case_translate/phase2/case-markdown-renderer.js) 47-58 行）：

```
rawConsume=6 → safeConsume=6 → tail index=11
但 lastIndex=25, pos=19 → anchoredConsume=20
→ 强制 safeConsume=20
→ coveredActionIndices = [6..25]（6~19 被记为已消费，正文未写）
→ 终局补全误判「已消费」→ 6~19 丢失或错位补全
```

**核心矛盾**：`consumeStepCount=6` 是 LLM 的消费意图（应推进 cursor 6 步）；`lastIndex=25` 是正文末尾引用，**不能**覆盖 consume 来推进游标。

## 明确不做的事

- **不**在 `clampWindowConsume` 中增加最小消费比例（见 idea1.md）：短 Case（2~3 步）合法，强制最小消费会降低用例质量。
- **不**改变滑动窗口机制：`windowSlim = slimAll.slice(cursor, cursor + phaseWindowSize)` 保持不变；消费过少本身不是问题，问题是 **consume 被 lastIndex 错误放大**。

## 修改方案 A：lastIndex 降级为校验项

**主改文件**：[`src/case_translate/phase2/case-markdown-renderer.js`](src/case_translate/phase2/case-markdown-renderer.js)

将 `lastIndex` 从「强制覆盖 consume」改为「一致性校验 + 写入 clampReason / llm_audit problems」：

```js
if (Number.isInteger(rawLastIndex) && rawLastIndex > 0 && winLen > 0) {
  const pos = indices.indexOf(rawLastIndex);
  const tailAtConsume = indices[safeConsume - 1];
  if (pos < 0) {
    clampReason = (clampReason ? clampReason + '; ' : '') +
      `lastIndex=${rawLastIndex} 不在本窗 index 列表，忽略`;
  } else if (tailAtConsume !== rawLastIndex) {
    clampReason = (clampReason ? clampReason + '; ' : '') +
      `lastIndex=${rawLastIndex} 与 consumeStepCount=${safeConsume}(→index ${tailAtConsume}) 不一致，以 consumeStepCount 为准`;
    // 不再 safeConsume = pos + 1
  }
}
```

### lastIndex 设计意图（修复后保留的价值）

- **原意**：当 LLM 正文从步骤 9 写起但 meta 写 consume=1 时，用 lastIndex 锚定真实消费步数。
- **问题场景**：LLM 正文跳步写（6~19 未写却 lastIndex=25）时，锚定会把 cursor 推过未写段落。
- **修复后**：仍以 `consumeStepCount` 推进 cursor；`lastIndex` 不一致时记入 audit，供内测排查，**不**改 consume。

## 效果预期（修正窗口滑动描述）

窗口固定 `phaseWindowSize=20`，`cursor += consumed`：

| 轮次 | cursor | 窗口 index 范围 | 轮次 2 修复后 consume | 新 cursor |
|------|--------|-----------------|----------------------|-----------|
| 1 | 0 | 1~20 | 5 | 5 |
| 2 | 5 | 6~25 | **6**（不再锚定为 20） | **11** |
| 3 | 11 | **12~31** | … | … |

| 项 | 修复前 | 修复后 |
|----|--------|--------|
| 轮次 2 consume | rawConsume=6 被锚定为 20 | rawConsume=6 → safeConsume=6 |
| coveredActionIndices | [6..25] | [6..11] |
| 下一轮窗口 | cursor 到 25 之后 | cursor=11，窗口 **12~31** |
| 步骤 6~19 | 丢失或末尾补全 | 进入后续轮次由 LLM 重新归纳 |
| 终局兜底 | 常触发且用户无感知 | 仅当严格模式仍缺步时触发，且双文件 + Dashboard 提示 |

## 修改方案 B：兜底「可感知 + 双结果」

已确认：**Dashboard + 文件**；兜底文件为**完整兜底文档**。

### 产物

| 文件 | 内容 |
|------|------|
| `translate/phase2/cases.md` | 仅主流程 LLM 归纳结果（不含兜底段） |
| `translate/phase2/cases_fallback.md` | 仅程序补全内容（完整可读） |
| `translate/phase2/coverage.md` | 覆盖核对表（已有） |

### 兜底触发条件：严格模式（idea1.md 建议）

Phase 2 全部轮次结束后：

```javascript
const allNormalSteps = steps.filter(s => s.status === 'normal' || !s.status);
const mentioned = extractMentionedStepIndices(allCasesMarkdown); // 仅扫 cases.md 主流程正文
const uncovered = allNormalSteps.filter(s => !mentioned.has(s.index));
const fallbackApplied = uncovered.length > 0;
```

- `fallbackApplied === true` → 生成 `cases_fallback.md`，**不**写入 `cases.md`
- `workflow.js` 每个 `caseBlocks` 项保留 `coveredActionIndices`，供 audit；兜底判定以 **正文 index 引用** 为准（与 `coverage.md` 一致）

### 日志格式

```
[WARN] [Phase 2] 主流程未完整覆盖，兜底介入：缺失 index 6,7,8,...,19（共 14 步）
[INFO] [Phase 2] 主结果: translate/phase2/cases.md
[WARN] [Phase 2] 兜底结果: translate/phase2/cases_fallback.md
```

写入 `llm_audit/summary.json` 扩展字段（可选）：

```json
{
  "phase2FallbackApplied": true,
  "phase2FallbackIndices": [6, 7, 8],
  "phase2FallbackFile": "translate/phase2/cases_fallback.md"
}
```

### Dashboard 展示

翻译完成 SSE / `broadcastStateChange` payload 增加：

```json
{
  "message": "AI 翻译完成（⚠ 本次触发 Phase 2 兜底补全）",
  "casesFile": "translate/phase2/cases.md",
  "casesFallbackFile": "translate/phase2/cases_fallback.md",
  "fallbackApplied": true,
  "fallbackMissingIndices": [6, 7, 8]
}
```

- 文件列表 API 白名单增加 `cases_fallback.md`
- 前端：若 `fallbackApplied`，状态区黄色提示 + 文件 Tab 显示「主结果 / 兜底结果」

### 代码落点

- [`src/case_translate/phase2/case-markdown-renderer.js`](src/case_translate/phase2/case-markdown-renderer.js) — lastIndex 修复
- [`src/case_translate/phase2/cases-document-appendix.js`](src/case_translate/phase2/cases-document-appendix.js) — 严格模式兜底判定；主/兜底 Markdown 分离渲染
- [`src/case_translate/workflow.js`](src/case_translate/workflow.js) — 双文件写出；返回 fallback 元信息
- [`src/utils/run-layout.js`](src/utils/run-layout.js) — `cases_fallback.md` 路径常量
- [`src/utils/config.js`](src/utils/config.js) — 导出常量；Dashboard 预览白名单
- [`src/dashboard/server.js`](src/dashboard/server.js) + [`src/dashboard/static/index.html`](src/dashboard/static/index.html) — 完成态提示与预览

## 验证方法

对 `run_2026-06-04T11-39-58` 重跑翻译：

1. `call_0015`：`consumeStepCount=6`，**无** lastIndex 锚定到 20
2. 轮次 3 窗口为 index **12~31**（日志可核对）
3. `cases.md` 中步骤 6~19 出现在登录 Case 之后（或由后续 LLM Case 覆盖，而非末尾堆补全）
4. 若仍有缺步：`cases_fallback.md` 存在且 `cases.md` 不含兜底段；Dashboard 有 ⚠ 提示
5. 若无缺步：不生成 `cases_fallback.md`（或仅一行「未触发兜底」说明）

## 与 todo.md 的关系

- todo.md「问题 1」中 **方案 A（最小消费比例）** 与 **方案 B（强制全窗消费）** 均**不采纳**（与 idea1.md 一致）
- todo.md 中「cursor 未强制最小消费」**不是 bug**；真正 bug 是 **lastIndex 覆盖 consume**
- 实施本计划后，应回写 todo.md 标记问题 1 已修复并更正根因描述

# Phase2 consume 修复计划评审意见

> 针对 `phase2_consume_修复_efd57fb9.plan.md` 的评审

---

## ✅ 计划文件的优点

1. **根因分析准确**：`lastIndex` 锚定逻辑确实是问题根源
2. **修复范围精准**：只改 `case-markdown-renderer.js` 一个文件，风险可控
3. **兜底方案完整**：主结果和兜底结果分离，清晰可追溯
4. **验证方法明确**：提供了具体的检查点

---

## ⚠️ 需要确认的问题

### 问题 1：根因假设需要验证

计划文件假设：
> LLM 返回 `consumeStepCount="6" lastIndex="25"`

但没有提供实际的 LLM 原始返回。

**建议**：检查 `llm_audit` 或 `llm_raw_batches.xml` 中的实际 LLM 返回，确认根因。

### 问题 2：`lastIndex` 存在的意义

计划文件直接禁用了 `lastIndex` 的覆盖功能，但没有讨论：
- `lastIndex` 最初设计的目的是什么？
- 是否有其他场景需要 `lastIndex`？

**建议**：在修复前确认 `lastIndex` 的设计意图，避免引入新问题。

---

## 🔧 改进建议

### 建议 1：兜底方案的触发条件需要明确

计划文件说"若触发兜底（存在遗漏 index 被补全）"，但没有明确如何判断"存在遗漏 index"。

**推荐方案：严格模式**

规则：所有 `status=normal` 的步骤都必须被引用，否则触发兜底。

```javascript
// Phase 2 完成后
const allNormalSteps = steps.filter(s => s.status === 'normal');
const allCoveredIndices = new Set();

// 收集所有被引用的 index
for (const caseBlock of caseBlocks) {
  for (const idx of caseBlock.coveredActionIndices || []) {
    allCoveredIndices.add(idx);
  }
}

// 找出未覆盖的 normal 步骤
const uncoveredNormalSteps = allNormalSteps.filter(s => !allCoveredIndices.has(s.index));

// 触发条件
const fallbackApplied = uncoveredNormalSteps.length > 0;
```

**优点**：
- 逻辑清晰，易于理解和维护
- 确保所有有效步骤都被覆盖
- 符合"证据驱动"的设计原则

### 建议 2：补充日志和监控细节

计划文件提到"运行日志与 Dashboard 状态中明确标记 `fallbackApplied=true`"，但没有详细说明：
- 日志格式是什么？
- Dashboard 如何展示？

**建议**：在计划文件中补充具体的日志格式和 Dashboard 展示方案。

---

## ❌ 计划文件中的错误

### 错误：窗口滑动逻辑描述错误

计划文件效果预期表格中说：
> 步骤 12-25 进入下一轮重新归纳

**这是错误的！**

#### 正确的窗口滑动逻辑

根据 `workflow.js:497-498`：
```javascript
const windowSlim = slimAll.slice(cursor, cursor + phaseWindowSize);
```

窗口大小固定为 `phaseWindowSize`（默认 20），从 `cursor` 开始取。

#### 正确的窗口滑动过程

| 轮次 | cursor | 窗口范围 | 消费步数 | 新 cursor |
|------|--------|----------|----------|-----------|
| 1 | 0 | index 1-20 | 5 | 5 |
| 2 | 5 | index 6-25 | 6（修复后） | 11 |
| 3 | 11 | **index 12-31** | ... | ... |

#### 修正后的效果预期表格

| 项 | 修复前 | 修复后 |
|----|--------|--------|
| 轮次 2 consume | rawConsume=6 被锚定为 20 | rawConsume=6 → safeConsume=6 |
| coveredActionIndices | [6..25] | [6..11] |
| 下一轮窗口 | 从 25 之后开始（步骤 26） | 从 cursor=11 之后开始（**步骤 12-31**） |
| 步骤 12-25 | 步骤 12-19 永久丢失 | **步骤 12-31 进入下一轮重新归纳** |
| 终局补全 | 步骤 6-19 被补全到末尾 | 无需补全 |

---

## 📋 评审总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 根因分析 | ⭐⭐⭐⭐ | 准确，但需要验证 LLM 实际返回 |
| 修复方案 | ⭐⭐⭐⭐⭐ | 精准、风险可控 |
| 兜底方案 | ⭐⭐⭐⭐ | 完整，但触发条件需明确 |
| 效果预期 | ⭐⭐⭐ | 窗口滑动逻辑描述有误，需修正 |

---

## 🎯 建议的行动计划

1. **验证根因**：检查 `llm_audit` 确认 LLM 实际返回
2. **明确触发条件**：采用严格模式，所有 `status=normal` 的步骤必须被覆盖
3. **修正效果预期**：修正窗口滑动逻辑的描述
4. **补充日志细节**：具体的日志格式和 Dashboard 展示

---

## 💡 关于消费过少的说明

消费过少**不是问题**，原因：
- 有些 case 本身步骤就很少（比如只有 2-3 步）
- 如果强制最小消费比例，会导致这些简单 case 被强制合并到更大的窗口中
- 反而会降低用例质量

因此，**不建议**在 `clampWindowConsume` 中增加最小消费比例约束。

# AI UI Recorder 待修复问题清单

> 基于 `release1/output/run_2026-06-04T11-39-58` 的分析结果

---

## 问题 1：Phase 2 步骤覆盖不完整（严重） — ✅ 已修复

> 修复时间：2026-06-05
> 修复方案：见 `phase2_consume_修复_efd57fb9.plan.md`

### 根因（修正后）

LLM 返回 `consumeStepCount="6" lastIndex="25"`，程序在 `case-markdown-renderer.js:47-58` 的 lastIndex 锚定逻辑错误地将 consume 从 6 扩大为 20，导致步骤 6-19 被标记为"已消费"但正文未写，最终永久丢失。

### 修复内容

1. **lastIndex 锚定修复**：`case-markdown-renderer.js` — lastIndex 只做校验警告，不覆盖 consumeStepCount
2. **Prompt 优化**：`steps-2-cases-skill.md` — 明确"不要消费所有步骤"，在业务闭环处截断
3. **兜底机制**：严格模式判定 + 双文件输出（cases.md + cases_fallback.md）

### 验证结果

修复后 Phase 2 消费行为：
- 轮次 1：5 步（1..5）— 登录 ✅
- 轮次 2：14 步（6..19）— 偏好设置完整流程 ✅
- 轮次 3：14 步（20..33）— 专家模式 + Agent 管理 ✅
- 轮次 4：5 步（34..38）— Agent 列表操作 ✅

**兜底触发：否** — 所有 38 个步骤均被 LLM 主流程覆盖 ✅

LLM 现在正确理解"必须从窗口第一个步骤开始"的约束，不再跳过开头步骤。

### 出问题的地方

| 文件 | 行号 | 问题描述 |
|------|------|----------|
| `src/case_translate/workflow.js` | 574, 580 | 直接使用 LLM 指定的 consume 值推进光标，没有强制最小消费步数 |
| `src/case_translate/phase2/case-markdown-renderer.js` | 20-26, 42-45 | 从 LLM 返回中提取 consumeStepCount，没有校验合理性 |
| `src/case_translate/xml-parse-utils.js` | 62-77 | `clampWindowConsume` 函数只做范围钳制（1-窗口长度），不强制最小消费步数 |
| `src/case_translate/workflow.js` | 598 | `appendFinalSupplementalCase` 补全机制只追加到末尾，不关心业务顺序 |

### 数据流分析

```
LLM 返回: <case_meta consumeStepCount="5"/>
    ↓
parsePhase2MarkdownResponse() 提取 rawConsume=5
    ↓
clampWindowConsume(5, 20) → safeConsume=5 (在 1-20 范围内，不钳制)
    ↓
workflow.js: cursor += 5 (只推进 5 步)
    ↓
步骤 6-19 被跳过
    ↓
终局补全: appendFinalSupplementalCase() 把步骤 6-19 追加到最后
    ↓
数据找回，但位置不对！
```

### 导致的效果

1. **测试用例结构异常**：
   ```
   测试用例 1：用户登录并进入工作台      ← 步骤 1-5
   测试用例 2：专家Agent选择与智能问数   ← 步骤 20-25（跳过了 6-19）
   测试用例 3：创建AI控制类Agent        ← 步骤 26-33
   测试用例 4：Agent 列表进入与返回操作  ← 步骤 34-38
   测试用例 5：未覆盖步骤（程序补全）    ← 步骤 6-19（位置错误！）
   ```

2. **业务逻辑割裂**：
   - 步骤 6-19 是「偏好设置」相关操作
   - 应该在步骤 5（登录成功）之后
   - 实际被放在了最后，与登录流程分离

3. **测试用例可读性差**：
   - 操作顺序不符合实际业务流程
   - 测试执行时难以按用例顺序操作

4. **用例分组不合理**：
   - 偏好设置流程被单独放在"未覆盖步骤"
   - 没有形成独立的业务用例

### 修改建议

#### 方案 A：强制最小消费步数（推荐）

修改 `src/case_translate/xml-parse-utils.js` 的 `clampWindowConsume` 函数：

```javascript
export function clampWindowConsume(rawConsume, windowLength, options = {}) {
  const winLen = Math.max(1, Math.floor(Number(windowLength)) || 1);
  const parsed = Number(rawConsume);
  const hasNum = Number.isFinite(parsed);
  const raw = hasNum ? Math.trunc(parsed) : null;

  // 新增：最小消费比例（默认 50%）
  const minConsumeRatio = options.minConsumeRatio || 0.5;
  const minConsume = Math.max(1, Math.floor(winLen * minConsumeRatio));

  let clampReason = null;
  if (!hasNum || raw <= 0) {
    clampReason = 'zero-consume-clamped';
  } else if (raw > winLen) {
    clampReason = 'over-consume-clamped';
  } else if (raw < minConsume) {
    clampReason = `under-min-consume-clamped (min=${minConsume})`;
  }

  // 强制至少消费 minConsume 步
  const safeConsume = Math.max(minConsume, Math.min(hasNum ? raw : minConsume, winLen));
  return { safeConsume, rawConsume: raw, clampReason };
}
```

#### 方案 B：优化 Prompt 约束

修改 `src/case_translate/prompts/md/steps-2-cases-skill.md`，在 Prompt 中明确要求：

```markdown
## 重要约束
1. 你必须消费窗口中的所有步骤，不允许跳过任何步骤
2. 如果窗口中有多个业务场景，必须为每个场景生成独立的测试用例
3. consumeStepCount 必须等于窗口中的步骤总数
```

#### 方案 C：优化补全机制

修改 `src/case_translate/phase2/cases-document-appendix.js` 的 `appendFinalSupplementalCase` 函数：

- 不再简单追加到末尾
- 根据步骤的业务语义，插入到正确的位置
- 或者在补全时生成独立的业务用例，而不是"未覆盖步骤"

### 优先级

**高优先级** - 这个问题直接影响测试用例的质量和可用性，建议优先修复。

### 验证方法

修复后，用同一份录制数据重新运行翻译，检查：
1. 步骤 6-19 是否出现在正确的位置（步骤 5 之后）
2. 测试用例的业务逻辑是否连贯
3. 是否还有"未覆盖步骤（程序补全）"部分

---

## 问题 2：步骤描述重复/冗余（待分析）

*待补充详细分析*

---

## 问题 3：UI 变化描述不一致（待分析）

*待补充详细分析*

---

## 问题 4：Phase 2 窗口消费异常（待分析）

*待补充详细分析*

---

## 问题 5：测试用例分组不够合理（待分析）

*待补充详细分析*

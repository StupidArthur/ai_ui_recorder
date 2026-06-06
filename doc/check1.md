# translate_platform_design.md 第二轮评审意见（check1）

> **评审对象**：`doc/translate_platform_design.md`（合并版）
> **评审人**：AI 助手
> **日期**：2026-06-06
> **前序**：`doc/check.md`（第一轮，针对 recording_data_spec.md + python_translate_design.md）
> **结论摘要**：第一轮意见基本已吸收，契约层扎实。本轮聚焦「Python 实现与现网 v0 真实数据的对齐」，共 7 条，其中 #1~#4 为开工前必须澄清项。

---

## 0. 第一轮意见的落实情况（已解决）

| check.md 意见 | 本文档落实位置 | 状态 |
|---------------|----------------|------|
| 两份文档合并成一份 | 文档头 supersede 范围 | ✅ |
| v0/v1 格式矛盾 | §3.7 过渡策略 + adapter.py + validate.py 双模式 | ✅ |
| lastIndex 不覆盖 consumeStepCount | §6.1 代码示例 | ✅ |
| 兜底双文件（cases/fallback/coverage 分离） | §4.3 + §6.2 | ✅ |
| diff 依赖统一 | §2.3 明确只用 difflib | ✅（但见 #1） |
| ai_client.py 草稿去留 | §5.2「合并并取代」 | ✅ |
| 路径常量与 run-layout.js 对齐 | §3.6 | ✅ |
| Dashboard 共存期职责 | §1.4 | ✅ |
| formState 绝对快照语义澄清 | §3.3 | ✅ |
| 回归 fixture run | §7.1 | ✅ |

---

## 1. diff 算法不等价，威胁「逐行一致」核心验收（必须修，高优先级）

**问题**：

- 现网 Node 用 `diff` 包的 `diffLines`（Myers 行 diff）：

```29:36:src/case_translate/preprocessor/snapshot-diff.js
export function computeDiff(preText, postText) {
  const changes = diffLines(preText, postText);
  ...
    const lines = part.value.replace(/\n$/, '').split('\n');
```

- 本文档 §5.3 用 `difflib.SequenceMatcher`。两者算法不同（`SequenceMatcher` 有 `autojunk` 启发式、opcode 分块逻辑不同），对同一对快照很可能产出**不同的 +/- 行顺序与分块**。

**自相矛盾**：§5.3 / §7.2 写「逐行一致」作为验收标准，而 §8.1 又把「difflib 与 Node diff 微小差异」列为高风险 —— 同一件事既当验收又当风险，口径不一致。

**建议**（二选一并统一全文口径）：
- 方案 A：Python 端移植等价 Myers 行 diff（或选用与 `jsdiff` 行为一致的库），坚持「逐行一致」。
- 方案 B：把 §7.2 验收从「逐行一致」降级为「**变更行集合一致**（忽略分块/顺序）」，并在 §5.3、§8.1 同步措辞。

**附带遗漏**：§5.3 未包含 `truncateDiff`（首尾各半截断，`DIFF_TRUNCATE_THRESHOLD`）。现网喂给 LLM 的是**截断后**的 diff，Python 不实现会导致 Phase1 输入与 Node 不同，间接影响 structured_steps 对齐。

---

## 2. v0 formState 含 `ariaSelected`，adapter / v1 schema 未覆盖（必须修）

**问题**：现网 v0 的 `formStateDelta` 节点值里出现 `ariaSelected`（如登录页「密码登录」tab 节点），但：
- §3.3 的 v1.0 formState schema 只定义了 `value / checked / selectedIndex`；
- §3.7 `adapt_action_v0_to_v1` 未处理 `ariaSelected`。

**后果**：preprocess 的 form_state diff 会丢失 ARIA 维度的变化，与 Node 不一致。

**建议**：
- 在 §3.3 v1.0 formState schema 显式纳入 `ariaSelected`（§3.10 已预留 ARIA，但主体 schema 没列，需对齐）；
- 或在 adapter 与 models.py 中明确「保留未知键」（formState 值用宽松 dict，不丢字段）。

---

## 3. v0 actionSummary 无 timestamp，但 model 设为必填（必须修）

**问题**：
- §5.1 `ActionSummaryItem.timestamp: int` 为**必填**；
- 现网 v0 的 `meta.json.actionSummary` 项**没有 timestamp**（只有 index/type/desc/page/url）；
- §3.7 `adapt_meta_v0_to_v1` 仅用注释写「从 action 文件推导」，**未实现**。

**后果**：Pydantic 校验 v0 meta 直接失败。

**建议**（二选一）：
- `ActionSummaryItem.timestamp: Optional[int] = None`；
- 或在 `adapt_meta_v0_to_v1` 真正从对应 `action_NNN.json` 回填 timestamp（推荐，保持字段完整）。

---

## 4. 密码脱敏判定条件不可靠（必须修，安全相关）

**问题**：§3.7 `adapt_action_v0_to_v1` 以 `element.inputType == "password"` 决定是否脱敏**整个 formState**。但：
- formState 是**全页面快照**，password 字段未必是当前操作元素；
- 现网 v0 中明文密码（如 `pass64` 字段）位于 formState 内，而当前 `element` 可能是别的控件 → 此时不会触发脱敏，**明文泄漏**。

**后果**：§3.9 安全约束「v0 由 adapter 脱敏」无法兑现。

**建议**：脱敏改为**逐 formState 节点判断**（依据 snapshot 中的 password 语义标记、xpath/字段名命名约定，或值形态启发式），而非只看当前 `element.inputType`。

---

## 5. Phase 1 历史上下文窗口未对齐（建议修）

**问题**：§5.7 写了 `batch_size=3` 与「按 index 对齐」，但未说明现网 Phase 1 向 user prompt 注入的**历史上下文窗口**（最近若干条已生成 step）。

**后果**：双端 LLM 输入不同，`structured_steps` 确定性字段难以严格对齐（§7.2 / §7.3 验收）。

**建议**：§5.7 补充与 Node 对齐的上下文窗口常量（如 `EVIDENCE_CONTEXT_WINDOW_SIZE`），并在 §6 对齐要点中列入。

---

## 6. 标题编号重复（文档体例）

**问题**：存在两个 `## 8`：
- `## 8. 风险与缓解`
- `## 8. 实施计划`

**建议**：实施计划改 `## 9`，附录顺延 `## 10`，并同步目录/交叉引用。

---

## 7. 文档状态与评审流程冲突（文档体例）

**问题**：文档头标注「**状态：评审通过，可开工**」，但本轮 #1~#4 仍有未定项；`check.md` 流程也要求合并后再修订一版才开工。

**建议**：状态先改为「**评审中 / 待修订**」，待 #1~#4 澄清并落文后再标「可开工」。

---

## 8. 处理优先级建议

| 优先级 | 条目 | 性质 |
|--------|------|------|
| P0（开工前必须） | #1 diff 等价性、#2 ariaSelected、#3 timestamp、#4 密码脱敏 | 影响能否跑通现网 v0 + 双端一致 |
| P1（开工前最好） | #5 Phase1 上下文窗口 | 影响 structured_steps 对齐验收 |
| P2（随手改） | #6 编号、#7 状态标注 | 文档体例 |

**总评**：方向与契约层已可信，核心待办是让 adapter / schema / diff 与现网 v0 真实字段严丝合缝。修完 P0 即具备开工条件。

# 设计文档评审清单（check.md）

> **评审对象**：`doc/recording_data_spec.md`、`doc/python_translate_design.md`  
> **评审日期**：2026-06-06  
> **评审结论**：架构方向正确（Node 录制 + Python 翻译 + 文件契约解耦），但两份文档存在**关键矛盾**与**现网数据 gap**，实施前必须先对齐。  
> **行动项（高优先级）**：将上述两份设计文档**合并为一份**权威设计文档，并据此修订后再开工。

---

## 0. 必须先做：合并两份设计文档

### 0.1 为什么要合并

当前两份文档职责重叠、读者需要来回跳转，且存在**互相矛盾**的表述：

| 文档 | 主要内容 | 问题 |
|------|----------|------|
| `recording_data_spec.md` | 录制数据格式 v1.0、校验规则 | 定义的是**目标格式**，与现网 recorder 产出不一致 |
| `python_translate_design.md` | Python 翻译包架构、模块映射、实施计划 | 声明「录制端零改动」，却又要求按 v1.0 消费 |

合并后应形成**单一真相源**，建议新文档名（任选其一）：

- `doc/translate_platform_design.md`（推荐），或
- `doc/recording_and_translate_design.md`

### 0.2 合并后建议结构（目录大纲）

```text
1. 背景与目标（含非目标：不删 Node translate、不做 Web Server 等）
2. 总体架构（Node 录制 / Python 翻译 / 文件契约 / 共存验证）
3. 录制数据契约（原 recording_data_spec 全文或精简版）
   3.1 目录与命名
   3.2 meta.json / action / snapshot / log / 截图
   3.3 校验规则（必须 / 建议）
   3.4 安全与扩展
   3.5 v0（现网）与 v1.0（目标）差异与过渡策略  ← 必须新增一节
4. 翻译产物契约（引用 run_directory_layout.md：cases.md、cases_fallback.md、coverage.md 等）
5. Python 包设计（原 python_translate_design：目录、models、各 phase、workflow）
6. 与 Node 版对齐要点（lastIndex、兜底双文件、Phase2 边界 case）
7. 测试与验收（单元测试、双端一致性、fixture run 列表）
8. 风险与缓解
9. 实施计划
10. 附录：Node → Python 函数映射表
```

### 0.3 合并时要删/改的重叠内容

- 删除「录制端零改动」的绝对表述，改为**分阶段**说明（见下文 §1.1）。
- `recording_data_spec` 中「translate/ 本规范不约束」保留，但合并文档应**链接** `run_directory_layout.md` 中 translate 产物树，避免 Python 再硬编码路径。
- 旧文档 `design.md` / `translate_design.md` 中与录制数据、翻译管线冲突的章节，在合并文档开头注明 **supersede 范围**（不必立刻删旧 doc，但合并 doc 应写清优先级）。

### 0.4 合并完成验收

- [ ] 仓库内仅**一份**「录制 + Python 翻译」主设计文档（旧两份可保留为历史或标记 deprecated）。
- [ ] 文档内**无**「零改动」与「必须 formatVersion=1.0」同时成立而未解释的矛盾。
- [ ] v0/v1 过渡策略有独立小节且与 Python `validate_recording` 设计一致。
- [ ] Phase 2 `lastIndex` / 兜底双文件行为与当前 Node 实现一致（见 §2.3、§2.4）。

---

## 1. 总体评价

| 维度 | 评价 |
|------|------|
| 架构选型 | **通过**：录制留 Node，翻译用 Python，通过 `run_*` 文件契约解耦，与之前讨论的混合方案一致 |
| `recording_data_spec.md` | **良好**：结构完整、可校验、可演进；字段设计比现网更清晰 |
| `python_translate_design.md` | **良好**：模块映射细、测试策略务实、风险表诚实；需补 v0 兼容与 Phase2 语义 |
| 文档一致性 | **不通过**：见 §1.1、§2.1，合并前不宜直接开工 |

---

## 2. 关键问题（必须处理）

### 2.1 「录制端零改动」与 v1.0 规范互相矛盾

`python_translate_design.md` §1.2 写：

> 录制端零改动：Node.js 录制器继续按 `recording_data_spec.md` v1.0 产出数据

**现网 recorder 并未按 v1.0 产出。** 以 `release1/output/run_2026-06-04T11-39-58` 为例：

| 项目 | spec v1.0 要求 | 当前实际 |
|------|----------------|----------|
| `formatVersion` | 必填 `"1.0"` | **无** |
| `totalSnapshots` | 必填 | **无** |
| `actionSummary` | `elementTag` + `elementDesc` + `pageTitle` + `timestamp` | `desc` + `page` + `url`，**无 timestamp** |
| `pages` | 可选数组 | 仅有 `pageCount` |
| `convention` | 删除 | **仍有** |
| action 页面标题 | `pageTitle` | 字段名 **`title`** |
| 表单状态 | `formState` | 字段名 **`formStateDelta`** |
| element 类型 | `inputType` | 字段名 **`type`**（与 action.type 易混） |
| element | 无 `href`/`title` | **仍有** |

若 Python 严格按 spec §7「缺 formatVersion 则拒绝」，**现有 `data_check/`、`release1/output/` 下所有 run 均无法处理**。

**必须在合并文档中二选一写死（推荐 A）：**

| 方案 | 说明 |
|------|------|
| **A（推荐）** | Python 支持 **v0（现网）+ v1.0** 双模式，`validate_recording()` 内 adapter；录制端后续再升 v1.0 |
| **B** | 先改 Node 录制器产出 v1.0，Python 只认 v1.0（录制有小改动，不能称「零改动」） |

---

### 2.2 `formStateDelta` → `formState` 语义需在 spec 中写清

spec 称改名为「操作瞬间的**绝对**状态快照」。这与现网 pointerdown 捕获的全页表单快照一致，但预处理器会用**上一条 action 的状态**计算 `formStateChanges`（相邻差分）。

**合并文档应补充**：字段存绝对快照；**步骤间变化由翻译端对比上一条计算**，避免 implementer 误以为录制端输出 delta。

---

### 2.3 Phase 2：`lastIndex` 行为必须与已修复 Node 一致

现网曾出现：`consumeStepCount=6` 但 `lastIndex=25`，旧逻辑将 consume 锚定为 20，导致步骤 6–19 丢失。

**当前 Node 正确语义**（`case-markdown-renderer.js`）：

- **以 `consumeStepCount` 推进 cursor**
- `lastIndex` **仅校验 + 写入 audit/warn**，**不得**覆盖 consume

Python `phase2.py` 若 port 旧 lastIndex 锚定逻辑，会复现同类 bug。合并文档 §6 必须写明，并纳入集成测试（`llm_audit/call_0015` 类场景）。

---

### 2.4 Phase 2 兜底与双文件（已与 Node 对齐，Python 必须 port）

当前 Node 行为（`workflow.js`）：

- 主结果：`translate/phase2/cases.md`（**不含**程序补全段）
- 兜底：`translate/phase2/cases_fallback.md`（仅当严格模式仍有未覆盖 index）
- 核对：`translate/phase2/coverage.md`
- Dashboard：`fallbackApplied`、缺失 index 列表可感知

Python 设计已描述该流程，合并文档时保留，并列为**验收必测项**（含「未触发兜底」与「触发兜底」两种 run）。

---

## 3. `recording_data_spec.md` 专项意见

### 3.1 做得好的

- 目录与 `run_directory_layout.md` 的 `record/` 一致
- 快照 `totalActions + 1` 公式与 pre/post 映射清晰
- 校验分必须/建议，翻译入口可执行
- 安全（密码脱敏、token 可选剥离）与扩展预留合理
- `translate/` 不约束内部格式，利于 Python 独立演进

### 3.2 需澄清或修正

| # | 项 | 建议 |
|---|-----|------|
| 1 | `actionSummary[].timestamp` 必填 | 现网 summary **无 timestamp**（仅在 action 文件）；改为必填则录制要改，或改为建议/从 action 推导 |
| 2 | action `type` 枚举 | 仅列 DOM 事件；**语义归并后的 type（如 input）** 属于 preprocessor，不应与 raw action 枚举混为一谈 |
| 3 | 截图命名 | 与 `recorder.js` 实际命名核对；不一致则标「目标格式」或改 recorder |
| 4 | 与旧文档关系 | 合并 doc 声明 supersede `design.md` 中录制数据相关描述 |

---

## 4. `python_translate_design.md` 专项意见

### 4.1 做得好的

- 非目标清晰（不删 Node、不做 API）
- Pydantic 契约层、Prompt 读 Node 的 `prompts/md/`（单一真相源）
- 双端测试只比确定性字段，不比 LLM 自由文本
- 风险表（LLM 非确定性、diff/XML 差异）诚实
- 函数映射表 + 分阶段实施计划可执行

### 4.2 需补强或修正

| # | 项 | 建议 |
|---|-----|------|
| 1 | `RecordingData.validate` | 数据流图提到但 models 未落地；合并 doc 补 `validate_recording(run_dir)`、v0/v1 分支、失败错误结构 |
| 2 | 已有 `src/case_translate/ai_client.py` | 说明合并进 `client.py` 或废弃，避免重复实现 |
| 3 | 入口风格 | 项目约定：主 API 用函数参数（如 `translate(run_dir)`），`__main__` 内调用；CLI 可选 |
| 4 | diff 依赖 | `pyproject.toml` 写 `diff-match-patch` 但示例用 `difflib`，应统一；验收标准：**与 Node `+/-` 行格式一致** |
| 5 | 翻译产物路径 | 引用 `run-layout.js` 常量，勿在 Python 再硬编码一套 |
| 6 | Dashboard / trial | 共存期写明：Dashboard 仍调 **Node translate**；Python 用于开发/对比/CI |
| 7 | 工期 | 8 天可搭骨架；**preprocess 数值级一致 + Phase2 边界** 建议单独留回归 run 集（见 §5） |

### 4.3 Phase 2 Python 必须 port 的 Node 逻辑（清单）

合并文档 §6 应包含，实现时逐项勾选：

- [ ] `clampWindowConsume`（不强制最小消费比例）
- [ ] `lastIndex` 不覆盖 `consumeStepCount`
- [ ] `normalizeCaseMarkdownToGlobalIndices`（窗内 1/2/3 → 全局 index）
- [ ] `isRedundantCaseBlock`（跳过重复 Case）
- [ ] 严格模式兜底 + `cases_fallback.md` 与 `cases.md` 分离
- [ ] `coverage.md` 仅基于主流程正文统计

---

## 5. 测试与验收建议

### 5.1 Fixture run（至少）

| run | 用途 |
|-----|------|
| `run_2026-06-04T11-39-58` | 主回归：38 步、Phase2 四轮 consume、兜底未触发、cases 顺序 1→38 |
| （待补）一条易触发兜底的 run | 验证 `cases_fallback.md` + Dashboard ⚠ |

### 5.2 双端一致性（Python vs Node）

- **必须一致**：preprocess 后 merge 报告字段、diff 文本格式（或明确允许 diff 的宽松比较）、`structured_steps` 的 `index/status/actionKind/target`（非 LLM 自由文本）
- **不要求一致**：`description` / `uiChange` / Case 正文（LLM 非确定性）

### 5.3 合并文档完成后的文档验收

- [ ] 新人只读**一份**合并 doc 即可理解录制契约 + Python 包 + 验收标准
- [ ] `todo.md` 问题 1 根因描述与合并 doc 一致（lastIndex 锚定，非「cursor 未强制最小消费」）

---

## 6. 建议实施顺序（给实现同学）

```text
1. 合并 recording_data_spec + python_translate_design → 单一设计 doc（含 v0/v1 策略）
2. Python Phase 0：validate_recording + 读取现网 data_check/run_*（可先不调 LLM）
3. 录制 v1.0：与 adapter 并行（小改 Node 或 Python 读旧字段）
4. preprocess 与 Node 逐模块 diff 测试
5. Phase 1/2/4 + audit，Phase 2 按 §4.3 清单 port
6. 端到端：同一 run，对比 Node 与 Python 关键字段与产物路径
```

---

## 7. 一句话结论

- **规划质量**：高于平均；混合架构（Node 录 + Python 译）选对了。  
- **最大坑**：「录制零改动」与 **v1.0 spec** 不兼容现网数据——合并文档时必须写清 **v0/v1 过渡**。  
- **第二大坑**：Python Phase 2 必须按**已修复 Node 语义**实现，不能 port 旧 lastIndex 锚定。  
- **文档行动**：**先合并两份设计为一份**，再按本 check 清单改一版，然后开工。

---

## 8. 附录：相关文件索引

| 文件 | 说明 |
|------|------|
| `doc/recording_data_spec.md` | 待合并：录制数据 v1.0 |
| `doc/python_translate_design.md` | 待合并：Python 翻译设计 |
| `doc/run_directory_layout.md` | translate 产物路径权威来源 |
| `doc/design.md` / `doc/translate_design.md` | 旧总设，部分章节将被合并 doc supersede |
| `src/utils/run-layout.js` | 路径常量 |
| `src/case_translate/phase2/case-markdown-renderer.js` | Phase2 consume / lastIndex |
| `src/case_translate/workflow.js` | 兜底双文件、strict 判定 |
| `src/case_translate/ai_client.py` | 已有 Python 客户端草稿，需决策去留 |
| `phase2_consume_修复_efd57fb9.plan.md` | Phase2 修复计划（与 §2.3、§2.4 一致） |

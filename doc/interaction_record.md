# 交互记录

## 2026-06-04 交互：run 目录结构重组

### 操作概述
- 新增 `src/utils/run-layout.js` 作为 run 路径唯一来源。
- **record/**：actions、snapshots、screenshots、recorder.log。
- **translate/**：logs、preprocess、phase1、phase2、phase4、llm_audit。
- 产物重命名：`AI_cases.md` → `translate/phase2/cases.md`，`case_4_agents.txt` → `translate/phase4/agents.txt`，Phase1 文件迁入 `translate/phase1/` 并缩短文件名。
- 文档：`doc/run_directory_layout.md`。
- **不兼容旧平铺布局**；`release1/output` 下既有 run 需重新录制/翻译后才会是新结构。

---

## 2026-06-04 交互：release1 录制数据翻译调试

### 操作概述
- 对 `release1/output/run_2026-06-03T07-11-48` 跑完整 XML/Markdown 翻译管线（约 177s，LLM audit 0 问题）。
- **修复** `maxSlidingWindowRounds`：当 `total < windowSize` 且每轮 consume 较小时，原 `ceil(total/window)*2` 仅 2 轮导致 Phase 2 后半段落入「剩余步骤兜底」。
- **修复** `parsePhase2MarkdownResponse`：用 `lastIndex` 锚定 `consumeStepCount`，避免模型跳过窗口前缀却用大 `lastIndex` 导致游标与正文错位、重复 Case。
- 同步 `release1/prompts/md/*-skill.md`；新增 `scripts/run-translate-on-meta.mjs` 便于对指定 meta 重跑。

---

## 2026-02-12 交互 #1

### 原始需求
- 查看 `recorder.js`，找出问题并改进

### 结构化需求
1. 审查现有 `recorder.js` 代码，识别功能缺陷和设计问题
2. 分析模块功能、特性和设计逻辑
3. 基于用户关注点（多Tab支持、录制信息充分性、关键操作节点、等待期页面变化），全面重构为新模块

### 用户关注点
1. **多Tab页支持**：URL跳转新Tab能否录制？切回原Tab能否继续录制？新Tab是否最大化？
2. **录制信息充分性**：记录的信息是否足够LLM理解业务意图？
3. **关键操作节点**：click、input、Enter、Tab、Escape、hover、drag 的覆盖情况
4. **页面被动变化**：用户等待期间的UI变化（弹窗、通知、数据加载）是否被记录？

### 操作概述

#### 发现的问题
- **致命**：Playwright `Page` 不支持 `click`/`input` DOM 事件，事件监听器完全无效，录制功能不工作
- **严重**：`framenavigated` 监听器重复注册；截图 quality 参数因未指定 jpeg 格式而失效；截图全存内存有 OOM 风险；数据仅最后保存有丢失风险
- **设计**：构造函数属性未完整初始化；URL硬编码；输出文件散落；keepAlive日志噪音

#### 重构方案
将原 `recorder.js` 拆分为5个独立模块，从零实现：

| 模块 | 功能 |
|------|------|
| `src/config.js` | 所有配置常量，含事件捕获开关 |
| `src/logger.js` | 控制台+文件双输出日志 |
| `src/inject-script.js` | 浏览器注入脚本生成器（DOM事件监听+选择器+MutationObserver） |
| `src/recorder.js` | 录制器核心类（Context级API管理多页面、增量保存、截图写磁盘） |
| `src/main.js` | 入口模块（AI加载、启动录制、信号处理） |

#### 关键改进
- 使用 `context.exposeFunction` + `context.addInitScript` 替代无效的 `page.on('click')`
- Context 级别 viewport 设置，新Tab自动最大化
- 注入脚本提取十余个元素属性 + 关联label + CSS选择器
- 支持 click/dblclick/change/keydown(Enter/Tab/Escape)/hover(可选)/drag(可选)
- MutationObserver 检测页面被动变化（弹窗、通知、数据加载）
- 操作增量保存为 JSON，截图直接写磁盘
- 统一输出目录 `output/run_{timestamp}/`

---

## 2026-02-12 交互 #2

### 原始需求
- Ctrl+C 后进程退出太快，AI 生成测试用例来不及完成
- 录制和 AI 生成应该拆成两个独立模块

### 结构化需求
1. 修复 Ctrl+C 信号处理，防止 AI 调用被中断
2. 将录制与 AI 生成解耦为两个独立模块，通过 actions.json 文件交互

### 操作概述

#### 架构变更
将原来的"录制 + AI 生成一体"拆分为两个独立模块：

| 模块 | 入口 | 职责 |
|------|------|------|
| 录制模块 | `node src/main.js` | 捕获操作 → 保存 actions.json + 截图 + 备用测试用例 → 退出 |
| AI 生成模块 | `node src/generate.js` | 读取 actions.json → 调用 AI → 输出 AI_测试用例.md |

#### 具体改动
- **`src/recorder.js`**: 移除全部 AI 依赖（aiModule 参数、_generateTestCase 方法），stop() 只做保存+关浏览器
- **`src/main.js`**: 移除 AI 加载/测试逻辑，精简为纯录制入口；简化 SIGINT 处理（1次停止，2次强制退出）
- **新建 `src/generate.js`**: 独立 AI 入口，自动查找最近录制的 actions.json，AI 结果写入独立文件 `AI_测试用例.md`
- **文档更新**: 设计文档、用户手册、交互记录同步更新

---

## 2026-02-12 交互 #3

### 原始需求
- 新 Tab 页操作无法录制，经排查为 popup 页面的 CDP 绑定问题
- 用户决定暂不支持新 Tab 录制

### 操作概述

#### 改动
- **`src/recorder.js`**: 移除对新 Tab 的脚本注入和页面注册；`context.on('page')` 改为仅输出警告，提示用户关闭新 Tab 或在原 Tab 继续操作
- **`doc/user_manual.md`**: 将「多 Tab 操作」改为「使用限制：仅支持单 Tab 录制」，明确新 Tab 内操作不会被录制
- **`doc/design.md`**: 架构描述由「多 Tab 跟踪」改为「单 Tab 录制（新 Tab 不支持）」

---

## 2026-02-12 交互 #4

### 原始需求
- AI 生成的测试用例中，偏好设置页面的操作描述几乎全错（开关名称、模式名称张冠李戴）
- 原因是 actions.json 中元素的 text / ariaLabel 等语义信息为空，LLM 只能从 class / selector 去猜测
- 不应依赖截图，应保留 DOM 树信息
- 向上采集"有意义容器"的 DOM 子树，而非仅采集相邻节点
- AI Prompt 中严禁猜测，无依据则标注"信息不足"

### 结构化需求
1. **inject-script.js** — `getElementInfo` 增加 DOM 上下文采集：
   - 新增 `findMeaningfulContainer(el)`：从操作元素向上遍历（最多 8 层），找到 textContent 长度合理、outerHTML 不超过 2000 字符的容器
   - 新增 `getDomContext(el)`：返回容器的 tag、class、textContent、截断后的 outerHTML
   - 新增 `checkedState`：识别 Ant Design Switch / 原生 checkbox / radio 的开关状态
   - 将 `domContext` 和 `checkedState` 写入每条 action 的 element 对象
2. **ai-module.js** — 重写 Prompt：
   - System Prompt 明确"严禁猜测"规则，给出语义信息优先级（text > label > domContext > checkedState > id > classes）
   - 从 classes / selector 推测业务含义属于违规
   - 无依据时输出"信息不足，无法确定其业务含义"
   - 温度从 0.7 降至 0.3，减少随意性；max_tokens 从 2000 提至 4000
   - User Prompt 增加数据字段说明，强调 domContext 的使用方式
   - 序列化时完全排除截图字段，保留 domContext

### 操作概述
- **`src/inject-script.js`**: 新增 `findMeaningfulContainer`、`getDomContext` 函数；`getElementInfo` 返回值增加 `checkedState`、`domContext` 两个字段
- **`ai-module.js`**: 将原先的单个 prompt 字符串拆分为 `buildSystemPrompt()` 和 `buildUserPrompt(actions)` 两个函数；System Prompt 包含四条核心规则；temperature=0.3，max_tokens=4000
- **文档**: 设计文档、需求文档、用户手册同步更新

---

## 2026-02-12 交互 #5

### 原始需求
- 当前 AI 输出的 `AI_测试用例.md` 质量不错，但名字应改为 `AI_steps.md`
- 输出需要进一步抽象：
  1. 每个步骤精简为一行：步骤号 | 操作 | 预期结果（依据信息不出现，仅保留在过程文件用于追溯）
  2. 将连续步骤归纳为用例（操作集/Case），如"用户登录"、"偏好设置"
- 依据文件仍需保留，作为产品迭代排查的依据

### 结构化需求
1. **一次 AI 调用生成两部分内容**，用分隔符拆分后保存为两个文件：
   - `AI_steps.md` — 干净的测试步骤（Case 分组 + Markdown 表格，只有步骤/操作/预期结果）
   - `AI_evidence.md` — 详细依据（每步引用 actions.json 字段，用于追溯排查）
2. Prompt 增加「步骤归纳为用例」规则（规则四），要求 AI 识别业务意图并分组
3. max_tokens 提升至 8000（两部分输出需要更大空间）

### 操作概述
- **`ai-module.js`**: System Prompt 新增规则四（步骤归纳为用例）和规则五（双部分输出格式）；导出分隔符常量 `AI_OUTPUT_SEPARATOR`；max_tokens 4000→8000
- **`src/generate.js`**: 文件名由 `AI_测试用例.md` 改为 `AI_steps.md` + `AI_evidence.md`；新增 `splitAIResponse()` 函数拆分 AI 响应；新增 `cleanMarkdownFence()` 函数清理 LLM 输出的代码围栏；降级处理：AI 未输出分隔符时整个响应作为 steps
- **文档**: 设计文档、需求文档、用户手册、交互记录同步更新

---

## 2026-02-12 交互 #6

### 原始需求
- AI_steps.md 中 Case 2~5 本质上是同一个偏好设置弹窗内的操作（打开 → 操作 → 关闭），应归为一个 Case
- 根因：一次 AI 调用同时生成 evidence + steps，AI 注意力被分散，归纳质量差
- 应改为多次 AI 调用的流水线：先生成 evidence，再用 evidence 生成 steps

### 结构化需求
1. **ai-module.js** 从单个 `generateTestCaseWithAI()` 拆为两个独立函数：
   - `generateEvidence(actions)` — 第1步：逐条翻译操作 + 依据，不做分组
   - `generateSteps(evidence)` — 第2步：基于 evidence 文本归纳 Case + 步骤表格
2. **generate.js** 改为两步流水线调用，Evidence 先落盘再进第2步
3. 移除上一版的分隔符拆分逻辑（不再需要）

### 操作概述
- **`ai-module.js`**: 完全重写。拆为 `generateEvidence()` 和 `generateSteps()` 两个导出函数，各自有独立的 system/user prompt。Evidence 阶段 temperature=0.2 追求准确，Steps 阶段 temperature=0.3 允许归纳灵活性。Steps 的 prompt 增加 Case 归纳规则（同一弹窗内操作归为一个 Case）。移除 `AI_OUTPUT_SEPARATOR` 分隔符。
- **`src/generate.js`**: 完全重写。改为两步流水线：先调 `generateEvidence()` 并立即保存 `AI_evidence.md`，再调 `generateSteps(evidence)` 保存 `AI_steps.md`。移除 `splitAIResponse()` 函数。
- **文档**: 设计文档（流水线架构图 + Case 归纳规则）、用户手册（生成过程改为两步说明）、交互记录同步更新

---

## 2026-02-12 交互 #7

### 原始需求
- AI 生成步骤质量仍不理想，从另一个维度优化：增强录制时采集的信息
- 引入 Chrome DevTools Protocol (CDP) 的 Accessibility Tree，获取浏览器计算后的标准化语义信息
- 不影响原有录制功能，新建独立模块

### 结构化需求
1. 新建 `src/cdp-recorder.js`：`CDPEnhancedRecorder` 继承 `IntentBasedRecorder`
2. 为每个 page 创建 CDP Session，启用 `Accessibility.enable()`
3. 操作回调中异步查询 `Accessibility.getPartialAXTree`，获取：
   - `ax.role`（标准化角色）、`ax.name`（计算后名称）、`ax.checked/expanded/selected`（状态）
   - `axAncestors`（语义层面的祖先链，如所在分组/对话框）
4. CDP 查询失败时静默降级为基础 DOM 信息
5. 新建 `src/cdp-main.js` 作为 CDP 模式入口
6. AI prompt 适配新增的 `ax` / `axAncestors` 字段，优先级最高

### 操作概述
- **`src/config.js`**: 新增 `CDP_ACCESSIBILITY_ENABLED`、`CDP_QUERY_TIMEOUT_MS`、`CDP_AX_ANCESTORS_MAX_DEPTH` 三个配置项
- **新建 `src/cdp-recorder.js`**: `CDPEnhancedRecorder` 类，继承 `IntentBasedRecorder`，override `_onAction` / `_registerPage` / `_cleanup`；新增 `_setupCDPSession` / `_enrichWithAccessibility` / `_doAXQuery` / `_buildAncestorChain` 等方法
- **新建 `src/cdp-main.js`**: CDP 增强录制入口，与 `main.js` 结构一致，使用 `CDPEnhancedRecorder`
- **`ai-module.js`**: Evidence prompt 语义信息优先级调整：`ax` > `axAncestors` > `text/label` > `domContext` > `checkedState`；user prompt 数据字段说明新增 ax 相关字段
- **原有文件不受影响**: `main.js`、`recorder.js`、`inject-script.js` 无任何改动
- **文档**: 设计文档新增 cdp-recorder 模块说明、用户手册新增 CDP 模式启动方式和配置项

---

## 2026-02-12 交互 #8

### 原始需求
- 两种模式的信息不应混合在一起喂给 LLM，CDP 模式下 DOM 层面的冗余字段（domContext、checkedState、classes 等）是噪音

### 操作概述
- **`src/cdp-recorder.js`**: 新增 `_stripRedundantDOMFields()` 方法，在 CDP AX 查询成功后，从 element 中删除 `domContext`、`checkedState`、`classes`、`ariaLabel`、`role` 五个被 ax 取代的字段。CDP 查询失败降级时保留全部 DOM 字段
- **`ai-module.js`**: Evidence prompt 的"规则二"从"优先级列表"改为"模式A/B"两套独立规则。模式A（ax 存在）直接使用 ax 字段；模式B（ax 不存在）使用 DOM 字段。明确标注两种模式字段互斥，LLM 不需要做优先级判断

---

## 2026-02-12 交互 9

### 原始需求
用户认可"完整 snapshot"思路（类似 TRAE + Chrome DevTools MCP 的方式），要求实施：用 `page.accessibility.snapshot()` 获取整页无障碍树替代逐元素 CDP 查询。

### 结构化需求
1. 删除 `cdp-recorder.js`（逐元素 CDP 查询），新建 `snapshot-recorder.js`（整页快照）
2. 删除 `cdp-main.js`，新建 `snapshot-main.js`
3. `config.js` 清理旧 CDP 配置，新增 Snapshot 配置
4. `ai-module.js` prompt 从 `element.ax` 适配为 `pageSnapshot`
5. 文档同步更新

### 操作概述
- **删除** `src/cdp-recorder.js`、`src/cdp-main.js`
- **新建 `src/snapshot-recorder.js`**:
  - `SnapshotRecorder` 类继承 `IntentBasedRecorder`
  - 每次操作后调用 `page.accessibility.snapshot({ interestingOnly: true })` 获取整页 AX 树
  - `pruneSnapshot()` 裁剪（限深度、移除 none/generic 等空节点）
  - `snapshotToText()` 转 YAML 缩进文本，比 JSON 更节省 token
  - 快照文本保存为 `action.pageSnapshot`
  - `_stripDOMContextFields()` 移除被快照取代的冗余 DOM 字段
- **新建 `src/snapshot-main.js`**: Snapshot 录制入口
- **`src/config.js`**: `CDP_*` → `SNAPSHOT_ENABLED`, `SNAPSHOT_MAX_DEPTH=8`, `SNAPSHOT_DELAY_MS=300`
- **`ai-module.js`**: Evidence prompt 模式A 从"CDP AX 字段"改为"pageSnapshot 整页快照"，说明 YAML 格式和使用方法
- **文档更新**: `design.md`, `user_manual.md`, `interaction_record.md`

---

## 2026-02-14 交互 #10

### 原始需求
- 执行架构重构与快照重构计划
- 按分组目录结构重新组织代码（utils/、recorder/、case_translate/）
- 合并 IntentBasedRecorder 和 SnapshotRecorder 为统一 Recorder 类
- 实现 pre/post 双快照模型
- 简化注入脚本为纯物理动作监听
- 重构 AI 用例翻译为逐条 evidence 生成 + 滑动窗口 + 中断恢复

### 结构化需求
1. 创建新目录结构 src/utils/、src/recorder/、src/case_translate/
2. 移动并精简 config.js → src/utils/config.js（去掉 SNAPSHOT_ENABLED、SNAPSHOT_DELAY_MS、CAPTURE_EVENTS、HOVER_DELAY_MS、MUTATION_DEBOUNCE_MS，新增 EVIDENCE_CONTEXT_WINDOW_SIZE）
3. 移动 logger.js → src/utils/logger.js（无功能变更）
4. 提取快照纯函数 → src/recorder/snapshot-utils.js（pruneSnapshot、snapshotToText）
5. 重写注入脚本 → src/recorder/inject-script.js（仅 click/dblclick/contextmenu/keydown，精简 getElementInfo 为轻量字段）
6. 合并录制器 → src/recorder/recorder.js（统一 Recorder 类，始终 Snapshot 模式，pre/post 双快照，pendingActions 队列，stop() 补拍终态快照）
7. 合并入口 → src/recorder/index.js（node src/recorder 启动）
8. 重构 AI 客户端 → src/case_translate/ai-client.js（逐条 generateSingleEvidence API，generateSteps 不变）
9. 重写 AI 入口 → src/case_translate/index.js（逐条生成 evidence + 增量保存 + 滑动窗口上下文 + 中断恢复 + 两步流水线）
10. 删除所有旧文件
11. 更新文档

### 操作概述

#### 新增文件
| 文件 | 职责 |
|------|------|
| `src/utils/config.js` | 全局配置常量（精简版） |
| `src/utils/logger.js` | 日志模块（无变更） |
| `src/recorder/snapshot-utils.js` | 快照裁剪和格式化纯函数 |
| `src/recorder/inject-script.js` | 纯物理动作注入脚本（click/dblclick/contextmenu/keydown） |
| `src/recorder/recorder.js` | 统一 Recorder 类（pre/post 双快照） |
| `src/recorder/index.js` | 录制入口 |
| `src/case_translate/ai-client.js` | OpenAI SDK + 逐条 evidence API |
| `src/case_translate/index.js` | AI 用例翻译入口（增量 + 中断恢复） |

#### 删除文件
- `recorder.js`（根目录旧版）
- `test-ai-module.js`（根目录）
- `ai-module.js`（根目录）
- `src/snapshot-recorder.js`
- `src/snapshot-main.js`
- `src/main.js`
- `src/recorder.js`
- `src/generate.js`
- `src/inject-script.js`
- `src/config.js`
- `src/logger.js`

#### 关键架构变更
- **录制器合并**：IntentBasedRecorder + SnapshotRecorder → 统一 Recorder 类，始终运行 Snapshot 模式
- **双快照模型**：物理动作到达时拍快照，作为前序 pending 的 postSnapshot + 当前的 preSnapshot；stop() 补拍终态
- **纯物理动作**：去掉 change/hover/drag/MutationObserver/getDomContext/checkedState，只保留 click/dblclick/contextmenu/keydown
- **轻量元素信息**：getElementInfo 只保留 tag/id/name/type/text/label/placeholder/title/href/xpath（主定位），冗余 DOM 字段由快照取代
- **逐条 AI 分析**：每条 action 单独调 AI（含 preSnapshot/postSnapshot/滑动窗口上下文），增量保存 evidence，支持中断恢复
- **文档全面更新**：设计文档、需求文档、用户手册均按新架构重写

---

### 交互 5 - 2026-02-15

#### 原始需求
1. LLM 分析"专家模式"点击时判断为"无 UI 变化"，但快照 diff 明确有变化，是 LLM 没分析出来
2. 最后一条 action 缺少 postSnapshot，因为 Ctrl+C 退出时浏览器被提前关闭

#### 结构化需求
1. **预计算 Snapshot Diff**：在发送给 LLM 前，代码层面计算 preSnapshot→postSnapshot 的行级差异，让 LLM 直接看到变化，不再依赖其自行比对
2. **修复 Ctrl+C 终态快照丢失**：Playwright 默认 handleSIGINT=true 会自动关闭浏览器，与 stop() 竞争导致快照获取失败

#### 操作概述

##### Bug 修复：Ctrl+C 终态快照丢失
- 修改 `src/recorder/recorder.js`，在 `chromium.launch()` 中设置 `handleSIGINT: false`、`handleSIGTERM: false`、`handleSIGHUP: false`
- 由我们自己的 stop() 控制关闭顺序：先补拍快照 → 再关浏览器

##### 功能增强：预计算 Snapshot Diff
- 安装 `diff` npm 包
- 在 `src/case_translate/ai-client.js` 中新增 `computeSnapshotDiff()` 函数，使用 diffLines 算法计算行级差异
- 修改 `buildSingleEvidenceUserPrompt()`，在 prompt 最前面插入 `★ Snapshot Diff` 段落（+/- 格式），完整快照降级为参考上下文
- 修改 `buildSingleEvidenceSystemPrompt()`，强调 LLM 必须优先阅读预计算好的 Diff 段落
- 更新 `doc/design.md` 中 AI Prompt 策略相关章节

---

## 2026-02-15 交互 #6

### 原始需求
1. 设计"理论层面尽可能完美"的快照方案，解决 preSnapshot 可能被当前操作同步效果污染的竞态问题
2. 重新设计数据存储结构：从单一 actions.json 改为分文件存储（meta.json + snapshots/ + actions/ + diffs/），零冗余
3. diff 在录制阶段预计算，AI 翻译阶段直接使用
4. 停止录制方式从 Ctrl+C 改为关闭浏览器窗口
5. 手工测试用例.md 的信息合并到 meta.json，不再单独生成
6. AI 输出文件改名：AI_evidence.md → AI_steps.md，AI_steps.md → AI_cases.md

### 结构化需求

#### 完美快照模型 v2
1. **周期轮询**：Node.js 每 300ms 拍摄 AX 快照缓存到内存，action 到达时直接使用缓存快照
2. **formStateDelta**：浏览器端在 pointerdown/keydown capture 阶段同步捕获所有表单精确值，作为 action 的独立字段
3. **不合并 formStateDelta 和快照**：AX 树和 DOM 的匹配不可靠，独立存储更干净
4. **录制结束后预计算 diff**：遍历所有 snapshot 对计算行级差异

#### 数据存储重构
1. 从 `actions.json` 单文件改为 `snapshots/` + `actions/` + `diffs/` 分目录
2. 命名约定：action N 的 pre = snapshot_{N-1}，post = snapshot_{N}，diff = diff_{N}
3. meta.json 包含原手工测试用例的全部信息（录制时间、URL、操作摘要等）

#### AI 文件名变更
1. AI_evidence.md（逐条操作依据）→ AI_steps.md
2. AI_steps.md（归纳的 Case 表格）→ AI_cases.md

### 操作概述

#### 修改文件
| 文件 | 改动 |
|------|------|
| `src/utils/config.js` | 新增 SNAPSHOT_POLL_INTERVAL_MS、子目录常量、META_FILENAME；移除 ACTIONS_FILENAME、TESTCASE_FILENAME；AI_EVIDENCE_FILENAME → AI_STEPS_FILENAME、AI_STEPS_FILENAME → AI_CASES_FILENAME |
| `src/recorder/inject-script.js` | 新增 captureFormState() 函数、pointerdown capture 监听器；所有 sendAction 携带 formStateDelta |
| `src/recorder/recorder.js` | 完全重写：周期轮询 + 分文件存储 + _computeAndSaveDiffs + _saveMeta + 浏览器关闭检测；移除 _generateFallbackTestCase、_saveActionsIncremental |
| `src/recorder/index.js` | 新增浏览器断开连接自动退出；更新停止方式说明 |
| `src/case_translate/index.js` | 改为读取 meta.json + actions/ + diffs/ + snapshots/；文件名变量更新 |
| `src/case_translate/ai-client.js` | 移除 computeSnapshotDiff()（diff 已预计算）；移除 diff 依赖；新增 formStateDelta 段落到 prompt |
| `doc/design.md` | 完整重写：完美快照模型 v2 架构、三层快照、分文件存储、事件策略 |
| `doc/user_manual.md` | 更新停止方式（关闭浏览器）、文件结构、配置说明 |
| `README.md` | 更新核心特性、项目结构、流水线说明 |

---

## 交互记录 #7

### 时间
2026-02-15（续）

### 原始需求
修复快照保存时机问题：录制时渐进行为（如打字）被错误归属到下一个 action 的 diff 中。

### 结构化需求
1. **问题诊断**：当前 `_onAction()` 在每个 action 到达时立即保存 `_cachedSnapshot`，导致 `postSnapshot(N)` 不包含 action N 之后的渐进行为（如打字），而是被归入 `diff(N, N+1)`
2. **修复方案**：采用"混合策略"——将快照保存推迟到下一个 action 到达时，第一个 action 不保存快照（其 pre = snapshot_000 已在 start 时保存）
3. **清理**：删除调试分析文件 `debug_file.txt`
4. **文档更新**：在 design.md 中补充混合策略的时序说明

### 操作概述

#### 修改文件
| 文件 | 改动 |
|------|------|
| `src/recorder/recorder.js` | `_onAction()` 中的快照保存逻辑从"每次 action 到达保存"改为"仅在 pendingAction 存在时保存"（即从第二个 action 开始保存），修正了渐进行为归属错误 |
| `doc/design.md` | 层次3 说明从"action 到达时处理"更新为"混合策略"，加入时序图和问题解决对照表 |
| `doc/interaction_record.md` | 新增本次交互记录 |

#### 删除文件
| 文件 | 原因 |
|------|------|
| `output/run_2026-02-15T05-32-01/debug_file.txt` | 调试分析文件，问题已修复，不需要保留 |

---

## 交互记录 #8

### 时间
2026-02-15（续）

### 原始需求
实现一个 Web 控制面板（Dashboard），替代命令行操作，支持在浏览器中完成录制控制、AI 翻译、实时日志查看和结果查阅。

### 结构化需求
1. **录制控制**：在界面上配置目标 URL，点击开始/停止录制
2. **AI 翻译**：一键启动翻译，可选择特定录制记录或自动使用最近一次
3. **实时控制台**：通过 SSE 推送实时日志到浏览器
4. **结果查阅**：浏览录制历史列表，查看 meta.json、AI_steps.md、AI_cases.md 等文件
5. **向后兼容**：不影响原有命令行操作方式

### 操作概述

#### 修改文件
| 文件 | 改动 |
|------|------|
| `src/utils/logger.js` | `createLogger` 新增可选 `onMessage` 回调参数，每条日志触发回调（Dashboard SSE 推送） |
| `src/recorder/recorder.js` | 构造函数新增 `onLog` 回调选项，透传给 logger |
| `src/case_translate/index.js` | `generate()` 改为 export function，移除 `process.exit()`，新增 `onLog` 回调选项；命令行入口在 `__main__` 中处理退出 |
| `package.json` | 新增 `dashboard`、`record`、`translate` scripts |
| `README.md` | 新增 Dashboard 使用说明、项目结构中添加 dashboard 目录 |
| `doc/user_manual.md` | 新增"方式一：Dashboard"使用说明、FAQ 补充 |

#### 新增文件
| 文件 | 说明 |
|------|------|
| `src/dashboard/index.js` | Dashboard 入口，启动 HTTP 服务并自动打开浏览器 |
| `src/dashboard/server.js` | HTTP 服务 + RESTful API 路由（status/record/translate/runs/file）+ SSE 日志广播 |
| `src/dashboard/static/index.html` | 单页面前端（操作栏 + 实时控制台 + 录制历史 + 文件预览 + Markdown 渲染）|

---

## 交互记录 #9 — 2026-02-15

### 原始需求
设计文档写得不好，关键内容缺失，边角信息过多。按录制和翻译两条主线重写。

### 结构化需求
1. **重写 `doc/design.md`**，以两条主线（录制 + 翻译）为骨架
2. 录制部分：快照时机定义（间隙归属原则）→ 保证快照干净（轮询 + 延迟保存 + formStateDelta）→ 数据源选择（AX 树 vs DOM）与预处理（裁剪/格式化/diff 预计算）
3. 翻译部分：单条翻译的输入构成（diff + formStateDelta + 快照 + 滑动窗口上下文）→ Prompt 设计思路 → 步骤到用例集的归纳规则 → 两步流水线的设计理由
4. 附带真实数据示例，删除边角内容

### 操作概述

| 文件 | 改动 |
|------|------|
| `doc/design.md` | 完全重写，以"快照时机 → 快照干净性 → 数据预处理 → 单条翻译 → 用例归纳"为主线 |

---

## 交互记录 #10 — 2026-02-15

### 原始需求
翻译管线架构重构：diff 计算等预处理逻辑应从 recorder 迁移到 translate 模块，建立独立的预处理器、Prompt 模板和工作流模块。

### 结构化需求
1. **recorder 瘦身**：移除 diff 计算逻辑，简化 stop 流程为"停止轮询 → 终态快照 → meta → 关闭浏览器"
2. **新建 preprocessor/ 子模块**：snapshot-diff / snapshot-context / formState-diff / action-classify / index
3. **新建 prompts/ 子模块**：step-analysis / case-generation
4. **ai-client.js 瘦身**：退化为纯 SDK 封装（callChat + cleanMarkdownFence）
5. **新建 workflow.js**：管理 Phase 1 + Phase 2 两阶段 AI 流水线
6. **重写 index.js**：纯入口，查找 meta → 调用 preprocessor → 调用 workflow
7. **更新 config.js**：新增预处理相关配置常量
8. **更新设计文档**：反映新的三阶段管线架构

### 操作概述

#### 修改文件
| 文件 | 改动 |
|------|------|
| `src/recorder/recorder.js` | 移除 diff 计算，移除 diffLines 导入，简化 stop 流程，更新 convention |
| `src/utils/config.js` | 新增 PREPROCESSED_SUBDIR、ENRICHED_DATA_SUBDIR、DIFF_TRUNCATE_THRESHOLD 等预处理常量 |
| `src/case_translate/ai-client.js` | 完全重写为纯 SDK 封装 |
| `src/case_translate/index.js` | 完全重写为纯入口 |
| `doc/design.md` | 更新管线架构、预处理器章节、Prompt 设计、目录结构、模块依赖图 |

#### 新增文件
| 文件 | 职责 |
|------|------|
| `src/case_translate/preprocessor/index.js` | 预处理编排入口 |
| `src/case_translate/preprocessor/snapshot-diff.js` | 快照 diff 计算 + 截断 |
| `src/case_translate/preprocessor/snapshot-context.js` | 上下文片段提取 |
| `src/case_translate/preprocessor/formState-diff.js` | 表单状态增量计算 |
| `src/case_translate/preprocessor/action-classify.js` | 操作分类 + hints |
| `src/case_translate/prompts/step-analysis.js` | Phase 1 提示词模板 |
| `src/case_translate/prompts/case-generation.js` | Phase 2 提示词模板 |
| `src/case_translate/workflow.js` | AI 工作流编排 |

---

## 交互记录 #11 — 2026-02-15

### 原始需求
为 translate（case_translate）模块单独出一份详细设计文档。

### 操作概述
| 文件 | 改动 |
|------|------|
| `doc/translate_design.md` | 新建翻译模块详细设计文档，共 10 章：模块定位、整体架构、入口模块、预处理模块（含 4 个子模块详设）、Prompt 模板模块、AI 客户端、工作流模块（含 Phase 1/2 详细流程）、数据流全景、配置参数、错误处理 |

---

## 交互记录 #12 — 2026-02-15

### 原始需求
讨论并实现语义归并（Semantic Compression）功能。由方向性设计讨论引出，对当前系统最有价值的增强（相关理念已融合进 `doc/design.md` 与 `doc/translate_design.md`）。

### 结构化需求
1. 在 preprocessor 中新增 `action-merge.js` 模块，实现三条语义归并规则：
   - 规则1（输入识别）：将"点击输入框"识别为"在输入框中输入文本"，输入值从下一个 action 的 formStateDelta 提取
   - 规则2（噪声标记）：diff 为空且 formState 无变化的 click → 标记 noise，AI 跳过
   - 规则3（双击去重）：浏览器双击产生的冗余 click → 标记 skip
2. 密码类输入自动脱敏（替换为 [MASKED]）
3. 归并报告保存到 preprocessed/merged/merge_report.json
4. workflow Phase 1 跳过 noise/skip action，写入占位符保持编号对齐
5. Prompt 支持新的 input 类型和 inputValue 字段

### 操作概述
| 文件 | 改动 |
|------|------|
| `src/utils/config.js` | 新增 MERGED_DATA_SUBDIR、DBLCLICK_TIME_THRESHOLD_MS、PASSWORD_MASK 常量 |
| `src/case_translate/preprocessor/action-merge.js` | 新建语义归并模块：mergeActions()（输入识别+双击去重+密码脱敏）+ detectNoise()（噪声检测） |
| `src/case_translate/preprocessor/index.js` | 重构为三步流水线：批量读取 action → 语义归并 → diff 计算 → 逐条富化（含噪声检测），保存 merge_report.json |
| `src/case_translate/preprocessor/action-classify.js` | 新增 input 类型支持，generateHints 增加 inputValue 参数 |
| `src/case_translate/prompts/step-analysis.js` | System Prompt 增加规则三（输入操作识别），User Prompt 增加输入识别信息区块 |
| `src/case_translate/workflow.js` | Phase 1 循环增加 skip/noise 检测，跳过时写占位符，噪声不计入滑动窗口 |
| `doc/translate_design.md` | 新增 4.7 语义归并章节、更新目录结构和依赖图、更新 enrichedAction 数据结构 |
| `doc/design.md` | 更新管线图和预处理器工作表，增加归并和噪声检测步骤 |
| `doc/requirements.md` | 新增 FR-058~FR-062（语义归并 + 噪声检测 + 归并报告） |
| `doc/user_manual.md` | 更新生成过程说明、输出目录结构、配置参数表 |

---

## 交互记录 #13 — 2026-02-15

### 时间
2026-02-15 21:25:50

### 原始需求
阅读目录下所有的文档和代码，帮我重新写一份详细、全面、深入浅出的设计文档。

### 结构化需求
1. 通读 `doc/` 下全部文档与 `src/` 下核心实现，确保设计描述与现有代码一致
2. 产出一份“系统级总设计文档”，覆盖：系统目标与边界、端到端管线、录制（完美快照模型 v2）、预处理（语义归并/差异/上下文/分类/噪声）、AI 两阶段工作流（可恢复）、Dashboard（API+SSE+文件查阅）、配置与调参、调试与排障、限制与路线图
3. 输出方式：新增 `doc/design_v2.md`（后续已重命名为 `doc/design.md`，旧版 `doc/design.md` 已删除）

### 操作概述
1. 阅读并梳理现有文档：`README.md`、`doc/design.md`、`doc/requirements.md`、`doc/user_manual.md`、`doc/translate_design.md`、`doc/snapshot_timing_design.md`、`doc/todo_list.md`
2. 阅读并对齐核心代码实现：`src/recorder/*`、`src/case_translate/*`（含 preprocessor/prompts/workflow）、`src/dashboard/*`、`src/utils/*`
3. 新增总设计文档：`doc/design_v2.md`（系统级、详细、可解释、面向落地与排障；后续已重命名为 `doc/design.md`）

---

## 交互记录 #14 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- “你写得非常好，按照你写的这个内容。帮我改写 readme，原来的 readme 可以直接删掉。甚至你觉得 OK 的话，直接把这一份当成 readme 也可以。”

### 结构化需求
1. 基于最新的“系统总设”（`doc/design.md`）与现有实现，重写项目首页 `README.md`
2. 旧版 `README.md` 不保留（允许整体替换/视为删除重建）
3. README 的定位更偏“项目首页”：突出系统定位与核心优势，给出可直接执行的 Windows 运行步骤，并把深度细节链接到 `doc/` 文档

### 本次操作概述
- 将 `README.md` **整体重写**为更标准的项目首页结构：
  - 项目定位（Evidence-Driven）
  - 核心能力亮点（完美快照模型 v2、零冗余、预处理、两阶段 AI、Dashboard）
  - Windows/PowerShell 下的快速开始（优先使用 `npm run dashboard/record/translate`）
  - AI 配置位置说明（`src/case_translate/ai-client.js`）
  - 输出目录与关键命名约定（action/snapshot/diff 对齐）
  - 文档入口链接（requirements/design_v2/user_manual/translate_design/interaction_record）
  - 保留署名 `designed by @yuzechao`

---

## 交互记录 #15 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- “既然你做的是总入口式的文档。你就一起把这里引用到的文档，都按照咱们新的思路，完全改一遍吧。”

### 结构化需求
1. 对 `README.md` 引用到的文档进行整体重写，使其在“新的思路”下形成一致的文档体系：
   - `doc/requirements.md`：从 FR 列表式改为“能力清单 + 验收标准 + 边界/非目标”
   - `doc/design.md`：总设收敛为系统级关键决策/数据契约/排障路径，细节下沉
   - `doc/translate_design.md`：围绕 enrichedAction 证据包、预处理与可恢复工作流重写
   - `doc/user_manual.md`：Windows-first，Dashboard/命令行并列同等详细
2. 确保四份文档在术语、文件名、目录结构、数据契约（N action → N+1 snapshot）等方面完全一致
3. 同步在交互记录中记录本次重写行为

### 本次操作概述
- **整体重写**并统一口径的文档包括：
  - `doc/requirements.md`：改为“目标/范围/数据契约/能力与验收/非功能/路线图”的结构
  - `doc/design.md`：改为“总设收敛版 v2.1”，只保留系统级关键决策与排障路径，并明确细节下沉至 `doc/translate_design.md`
  - `doc/translate_design.md`：改为“翻译子系统重写版 v2.1”，强调证据优先、预处理证据计算、两阶段工作流与恢复策略
  - `doc/user_manual.md`：改为“Windows 用户手册重写版”，`npm run dashboard/record/translate` 为主入口，包含中断恢复与证据链排障顺序

---

## 交互记录 #16 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- 清理 `doc/`：旧的 `design.md` 用不到就删掉；把 v2 总设命名为 `design.md`；其他单点详设文档按需引用并改写/重写，不必要的直接删掉，让 `doc/` 变干净。

### 结构化需求
1. 删除旧版 `doc/design.md`
2. 将总设文档从 `doc/design_v2.md` “落位”为 `doc/design.md`（统一入口命名）
3. 清理 `doc/` 目录：把历史/方向性文档移出主入口层级（归档或删除），避免根目录堆积
4. 更新全仓引用，确保不再引用不存在的文档路径

### 本次操作概述
- **总设落位**：
  - 删除旧版 `doc/design.md`
  - 将 `doc/design_v2.md` 重命名落位为 `doc/design.md`，并删除 `doc/design_v2.md`
  - 更新 `README.md`、`doc/requirements.md`、`doc/user_manual.md`、`doc/translate_design.md` 中对 `doc/design_v2.md` 的引用为 `doc/design.md`
- **doc 清理与归档**：
  - 删除 `doc/archive/` 下的归档文档（仅保留“有用且被入口引用”的文档）
  - 在 `doc/design.md` 中增加“路线图与归档文档”引用区块（`doc/todo_list.md` + 归档文档）
  - 同步修正 `doc/interaction_record.md` 内对归档文档路径的引用

---

## 交互记录 #17 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- 不需要“归档文档”。所有文档都必须有用；没用就删掉。
- 关于快照时机：希望保留为 `design` 的引用文档，按“多方案对比/逐步推进”方式成文，说明为什么选择当前方案。

### 结构化需求
1. 将快照时机设计文档从“归档”提升为 `doc/` 根目录的正式补充设计文档
2. 重写文档内容：列出多个快照时机方案、优缺点、方案演进与最终选择（完美快照模型 v2）
3. 删除 `doc/archive/` 下的归档文档，并移除所有对归档路径的引用
4. 更新 `doc/design.md` 与 `README.md` 的文档入口与引用关系

### 本次操作概述
- 新增并重写：`doc/snapshot_timing_design.md`（方案演进与取舍，解释为什么选择“周期轮询 + 混合策略保存”）
- 删除：`doc/archive/snapshot_timing_design.md`、`doc/archive/Web_Operation_to_TestCase_Design.md`
- 更新引用：
  - `doc/design.md`：把附录中的“归档文档”改为“补充设计文档”，并引用 `doc/snapshot_timing_design.md`
  - `README.md`：文档入口新增 `doc/snapshot_timing_design.md`，移除 `doc/archive/`
  - `doc/interaction_record.md`：移除对已删除归档路径的引用/描述

---

## 交互记录 #18 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- 询问本项目是否具备专利申请的可行性
- 要求按照"方向 A：证据驱动的 Web 用户操作录制与智能测试用例生成方法"撰写专利交底书

### 结构化需求
1. 分析项目的技术创新点，评估专利可行性（新颖性、创造性、实用性）
2. 确定专利方向：全链路方案（录制 + 预处理 + AI 翻译）
3. 撰写完整的专利交底书，包含：技术领域、背景技术、发明目的、技术方案、有益效果、具体实施方式、附图说明、权利要求书建议稿、摘要

### 本次操作概述
- 新增：`doc/patent_disclosure.md` — 完整的专利交底书
  - 发明名称：一种基于证据驱动的 Web 用户操作录制与智能测试用例生成方法及系统
  - 核心创新点：
    1. 周期轮询快照 + 混合策略保存（解决快照竞态问题）
    2. 双通道证据采集（异步 AX 快照 + 同步 formStateDelta）
    3. 预处理构建结构化证据包 + 约束型 AI 推理
    4. 录制与翻译的文件系统解耦
    5. 语义归并消除逐字符监听
    6. 增量写盘 + 中断恢复
  - 包含 1 项独立权利要求（方法）、7 项从属权利要求、1 项系统权利要求

---

## 交互记录 #19 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- 评审 `doc/patent_disclosure.md` 的质量
- 对不够好的地方进行修改与优化，使其更符合“专利交底书/可授权”的表达方式

### 结构化需求
1. 检查交底书的专利化表达：术语一致性、避免过度绑定具体实现、避免工程变量名/代码符号
2. 强化技术方案的通用性描述（不限定具体框架/语言），同时保持可实施性
3. 重写权利要求建议稿，使其更接近正式权利要求的句式与结构
4. 清理容易引发审查意见的表述（如 token、实现变量名、S1/S2 步骤引用等）

### 本次操作概述
- 更新：`doc/patent_disclosure.md`
  - 新增“术语与数据对象定义”小节，明确 action/snapshot/formStateDelta/enrichedAction/间隙归属原则等概念
  - 将 Playwright/Node.js/内部变量名等实现绑定表述替换为通用技术表述（受控浏览器、宿主端进程、快照缓存单元等）
  - 将“token”类工程术语替换为“提示词输入长度/计算资源消耗”等更通用的专利文本用语
  - 重写权利要求：方法独立权利要求 + 从属权利要求 + 系统权利要求，修正系统权利要求中对 S1/S2 等步骤编号的引用错误

---

## 交互记录 #20 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- 试用版保护方案继续推进
- 明确要求：大模型 URL 和密钥改为配置文件方式，并且 EXE 运行时也要能找到该配置

### 结构化需求
1. 将 AI 客户端的硬编码密钥/URL 移除，改为运行时读取本地配置文件
2. 配置文件路径需兼容开发环境与 EXE：优先运行目录，支持可执行文件目录兜底
3. 保留环境变量兜底能力，避免配置文件缺失时不可恢复
4. 提供示例配置模板，并将真实本地配置加入 Git 忽略
5. 更新 README，说明新的 AI 配置方式与查找顺序

### 本次操作概述
- 新增：`src/utils/ai-config.js`
  - 实现 AI 配置加载器，查找顺序：
    1. `process.cwd()/config/ai.local.json`
    2. `dirname(process.execPath)/config/ai.local.json`
    3. 环境变量 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`
  - 增加字段校验与缺失提示，避免静默失败
- 更新：`src/case_translate/ai-client.js`
  - 移除硬编码 `API_KEY/BASE_URL/MODEL_NAME`
  - 改为通过 `loadAIClientConfig()` 在运行时读取配置
- 新增：`config/ai.local.example.json`
  - 提供可复制模板，指导用户填写 `baseUrl/apiKey/model`
- 新增：`.gitignore`
  - 忽略 `config/ai.local.json`（本地敏感配置）
  - 保留 `config/ai.local.example.json` 可入库
- 更新：`README.md`
  - AI 配置章节改为“外置配置文件 + EXE 兼容查找顺序 + 环境变量兜底”

---

## 交互记录 #21 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- 在“AI 配置外置化”基础上继续推进
- 关注点：尽量不影响原有开发方式，同时支持后续单文件 EXE 试用构建

### 结构化需求
1. 增加统一应用入口，供 EXE 打包使用（默认 dashboard）
2. 保持原有 `dashboard/record/translate` 入口兼容，避免影响调试
3. 增加 Windows 下单文件 EXE 构建脚本
4. 追加构建依赖与文档说明，形成可执行的最小发布链路

### 本次操作概述
- 更新入口模块：
  - `src/dashboard/index.js`：导出 `runDashboard()`，并加主模块判定，避免被 import 时自动执行
  - `src/recorder/index.js`：导出 `runRecorder()`，并加主模块判定
  - `src/case_translate/index.js`：新增导出 `runTranslate()`
- 新增统一入口：`src/app/index.js`
  - 默认 `APP_MODE=dashboard`
  - 支持 `dashboard | record | translate` 三模式
- 新增构建链路：
  - `build/esbuild.config.mjs`：生成 `dist/app.bundle.cjs`
  - `scripts/build-trial.ps1`：Windows 一键构建 `release/ai-ui-recorder-trial.exe`
  - `package.json`：新增 `app`、`build:bundle`、`build:trial` 脚本，并新增 `esbuild/pkg` 开发依赖
- 更新配套：
  - `.gitignore`：新增 `dist/`、`release/`
  - `README.md`：新增 EXE 构建说明与分发提示

---

## 交互记录 #22 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- 执行 `npm run build:trial` 时，`scripts/build-trial.ps1` 报错：字符串缺少终止符
- 需要直接修复脚本

### 结构化需求
1. 排查 PowerShell 构建脚本中的字符串解析问题
2. 修复引发编码/引号歧义的输出内容
3. 保持脚本功能不变（清理 → bundle → pkg 打包）

### 本次操作概述
- 更新：`scripts/build-trial.ps1`
  - 将中文 `Write-Host` 文案统一替换为英文 ASCII 文本
  - 保留原有 3 步构建流程与输出路径
  - 避免在 Windows PowerShell 编码环境下触发“字符串缺少终止符”解析错误

---

## 交互记录 #23 — 2026-02-17

### 时间
2026-02-17

### 原始需求
- EXE 运行时报错：`TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of URL. Received undefined`
- 堆栈指向 `fileURLToPath(import.meta.url)`，因 pkg 打包的 CJS 中 `import.meta.url` 为 undefined

### 结构化需求
1. 修复 `src/dashboard/server.js` 中 `STATIC_DIR` 的初始化逻辑，在 pkg 环境下使用 `process.execPath` 兜底
2. 修复 `src/case_translate/index.js` 中 `isMainModule()` 对 `import.meta.url` 的依赖，避免 undefined 传入 `fileURLToPath`
3. 构建脚本增加 `static` 与 `config` 模板的拷贝，确保 EXE 运行时能正确加载静态资源与配置

### 本次操作概述
- 更新：`src/dashboard/server.js`
  - `STATIC_DIR` 改为 try/catch：正常环境用 `fileURLToPath(import.meta.url)`，pkg 环境用 `path.dirname(process.execPath) + '/static'`
- 更新：`src/case_translate/index.js`
  - `isMainModule()` 增加 `import.meta?.url` 判空，避免 `fileURLToPath(undefined)` 抛错
- 更新：`scripts/build-trial.ps1`
  - 新增第 4 步：拷贝 `src/dashboard/static` → `release/static`，创建 `release/config/` 并拷贝 `ai.local.example.json`
  - 更新成功提示，说明需将 `config/ai.local.json` 放入 `release/config/`

---

## 交互记录 #24 — 2026-02-26

### 时间
2026-02-26

### 原始需求
- 查看当前打包方式与 AI URL/KEY 管控方式
- 评估“自建中转，向试用方分发中转地址，后续可关停”的可行性
- 要求给出 Go 实现，并升级为“中转 + 流式前端问答验证页”，且独立放在 `tool` 目录

### 结构化需求
1. 明确现有试用版 EXE 的打包链路与 AI 配置读取方式
2. 新增独立 Go 中转工具（不耦合主业务）
3. 实现 OpenAI 兼容转发接口，支持主工程通过配置切换接入
4. 增加基础管控能力：总开关、trial key 鉴权、key+IP 限流
5. 增加内嵌前端流式问答页，用于验证中转成功与模型可回答
6. 更新需求/设计/手册文档，补齐接入与排障说明

### 本次操作概述
（该次操作记录已被移除，相关功能不再需要）

---

## 交互记录 #25 — 2026-02-26

### 时间
2026-02-26 13:12:16

### 原始需求
- EXE 计划分发到没有安装 Node 和 Chrome 的空白 Windows 系统，确认打包方式是否需要调整
- 方案选择：A（离线包方案）

### 结构化需求
1. 调整 `build:trial`，让发布包内包含可离线运行的 Chromium 运行时
2. 运行时优先识别并使用发布目录中的浏览器运行时，避免依赖目标机预装 Chrome
3. 更新说明文档，明确“必须分发整个 release 目录”

### 本次操作概述
- 更新 `scripts/build-trial.ps1`：
  - 新增离线 Chromium 准备步骤：在 `release/ms-playwright` 下安装 Playwright Chromium
  - 构建步骤由 `4` 步扩展为 `5` 步，并在失败时中止构建
  - 构建成功提示补充离线分发说明（`exe + ms-playwright`）
- 更新 `src/recorder/recorder.js`：
  - 新增 `resolveBundledPlaywrightBrowsersPath()`，自动探测 `ms-playwright` 目录
  - 在 `start()` 前置设置 `PLAYWRIGHT_BROWSERS_PATH`（仅在未显式配置且目录存在时生效）
- 更新文档：
  - `README.md`：补充 `release/ms-playwright` 产物与离线分发要求
  - `doc/user_manual.md`：新增“试用版离线 EXE 分发（空白 Windows 推荐）”章节

---

## 交互记录 #26 — 2026-02-26

### 时间
2026-02-26 13:16:49

### 原始需求
- 打包阶段下载离线运行时过慢
- 本地已有离线包：`D:\chrome_download\chrome-win64.zip`
- 希望打包时直接使用本地离线包

### 结构化需求
1. `build:trial` 优先使用本地 Chromium zip，避免网络下载
2. 若本地 zip 不存在，自动回退到 `playwright install chromium`
3. 运行时支持从 `release/chrome-win64/chrome.exe` 直接启动 Chromium
4. 文档补充本地离线包使用方式

### 本次操作概述
- 更新 `scripts/build-trial.ps1`：
  - 新增本地 zip 优先策略：默认读取 `D:\chrome_download\chrome-win64.zip`
  - 支持环境变量 `LOCAL_CHROME_ZIP` 覆盖路径
  - 本地 zip 可用时直接解压到 `release/chrome-win64/`；不可用时回退在线安装 `release/ms-playwright/`
- 更新 `src/recorder/recorder.js`：
  - 新增 `resolveBundledChromiumExecutablePath()`，自动探测 `chrome-win64/chrome.exe`
  - `chromium.launch()` 增加 `executablePath`，优先使用本地解压的 Chromium 可执行文件
- 更新文档：
  - `README.md`：补充“本地 zip 优先 + 在线下载回退”说明
  - `doc/user_manual.md`：补充 `LOCAL_CHROME_ZIP` 配置示例

---

## 交互记录 #27 — 2026-02-26

### 时间
2026-02-26 13:31:55

### 原始需求
- 反馈 EXE 启动 Dashboard 后崩溃
- 报错栈指向 `playwright-core/lib/mcpBundleImpl/index.js`
- 关键错误：`TypeError: Invalid host defined options`

### 结构化需求
1. 定位 EXE 运行时崩溃的根因
2. 提供不依赖目标机环境配置的稳定修复
3. 保持现有离线打包与运行方式不变

### 本次操作概述
- 更新 `src/recorder/recorder.js`：
  - 新增 `clearPlaywrightMcpEnvVars()`，在启动浏览器前清理全部 `PLAYWRIGHT_MCP_*` 环境变量
  - 目的：隔离外部环境注入的 MCP Host/Origin 配置，避免 Playwright 解析时报 `Invalid host defined options`
  - 保留日志提示：若发生清理，会记录清理数量，便于排障

---

## 交互记录 #28 — 2026-02-26

### 时间
2026-02-26 13:37:36

### 原始需求
- 追加打包改动：`release/config` 下默认直接创建 `ai.local.json`
- 不需要 `ai.local.example.json`
- 配置内容为中转地址（已移除中转工具）

### 结构化需求
1. 修改 `build:trial`，在构建产物中自动生成 `release/config/ai.local.json`
2. 停止复制 `ai.local.example.json`
3. 文档同步更新为“默认已生成可用配置”

### 本次操作概述
- 更新 `scripts/build-trial.ps1`：
  - 删除 `ai.local.example.json` 拷贝逻辑
  - 新增 Here-String 写入 `release/config/ai.local.json`
  - 默认内容：
    - `baseUrl: http://10.30.70.77:8787/v1`
    - `apiKey: trial_demo_key_001`
    - `model: Qwen/Qwen3-VL-235B-A22B-Instruct`
  - 构建成功提示改为“已生成 trial 默认配置”
- 更新文档：
  - `README.md`：EXE 构建说明改为“打包自动生成 `release/config/ai.local.json`”
  - `doc/user_manual.md`：离线分发清单中明确 `config/` 为自动生成配置

---

## 交互记录 #29 — 2026-02-26

### 时间
2026-02-26 13:50:43

### 原始需求
- 运行 `ai-ui-recorder-trial.exe` 时报错：`AI 配置文件解析失败 ... Unexpected token ﻿ in JSON at position 0`

### 结构化需求
1. 修复 `ai.local.json` 含 BOM 时的运行时解析失败
2. 保证已分发包中的 BOM 文件也能被程序兼容读取

### 本次操作概述
- 更新 `src/utils/ai-config.js`：
  - 在 `JSON.parse` 前新增 BOM 清理逻辑：`raw.replace(/^\uFEFF/, '')`
  - 使配置加载器兼容 Windows 下带 BOM 的 UTF-8 JSON 文件
  - 避免 EXE 启动阶段因配置文件编码问题崩溃

---

## 交互记录 #30 — 2026-02-26

### 时间
2026-02-26（续）

### 原始需求
- 用户再次反馈：点击「开始录制」后仍报 `Invalid host defined options`（mcpBundleImpl）

### 结构化需求
1. 根因：`PLAYWRIGHT_MCP_*` 在 **模块加载时** 被 mcpBundleImpl 读取，recorder.start() 内清理已太晚
2. 需在**任何 Playwright 相关模块导入之前**清除环境变量

### 本次操作概述
- 新增 `src/app/bootstrap.js`：
  - 仅做一件事：清除全部 `PLAYWRIGHT_MCP_*` 环境变量
  - 无其他依赖，保证最先执行
- 更新 `src/app/index.js`：首行 `import './bootstrap.js'`
- 更新 `src/dashboard/index.js`：首行 `import '../app/bootstrap.js'`
- 保证 EXE 与 `npm run dashboard` 两种启动方式下，bootstrap 均在 Recorder/Playwright 加载前执行

---

## 交互记录 #31 — 2026-02-26

### 时间
2026-02-26（续）

### 原始需求
- 用户反馈在最新包中仍复现 `Invalid host defined options`

### 结构化需求
1. 强化“先清理环境变量，再加载 Playwright 依赖”的执行顺序
2. 避免任何静态 import 在清理前触发 `playwright-core` 模块初始化

### 本次操作概述
- 重构 `src/app/index.js`：
  - 移除对 `dashboard/recorder/translate` 的静态导入
  - 新增 `clearPlaywrightMcpEnvVarsEarly()` 并在 `runApp()` 一开始执行
  - 改为按模式 `await import(...)` 动态加载目标模块
- 重构 `src/dashboard/index.js`：
  - 移除 `createServer` 静态导入
  - 新增 `clearPlaywrightMcpEnvVarsEarly()` 并在 `run()` 一开始执行
  - 改为 `await import('./server.js')` 动态加载服务模块
- 目标：确保 `PLAYWRIGHT_MCP_*` 清理动作严格早于 Playwright 相关模块加载

---

## 交互记录 #32 — 2026-02-26

### 时间
2026-02-26 14:32:29

### 原始需求
- 用户反馈仍报 `Invalid host defined options`
- 补充观察：报错栈路径显示 `C:\snapshot\...`

### 结构化需求
1. 说明 `C:\snapshot\...` 的含义，避免误判为访问真实 C 盘
2. 继续排查启动即崩溃路径，确保 Dashboard 启动不触发 Playwright 初始化
3. 将 `server.js` 中对 Recorder/translate 的静态导入改为按需动态加载

### 本次操作概述
- 说明结论：
  - `C:\snapshot\...` 是 pkg 打包后的虚拟文件系统路径，不是读取本机真实 C 盘目录
- 更新 `src/dashboard/server.js`：
  - 移除顶层 `Recorder` 与 `generate` 静态导入
  - 新增 `ensureRecorderModuleLoaded()` 与 `ensureTranslateModuleLoaded()` 延迟加载函数
  - 在 `handleRecordStart` 内按需加载 Recorder
  - 在 `handleTranslateStart` 内按需加载 translate
- 目标：Dashboard 启动阶段不再提前触发 Playwright 模块链加载

---

## 交互记录 #33 — 2026-02-26

### 时间
2026-02-26 14:35:28

### 原始需求
- 用户反馈录制启动失败：`Failed to fetch`
- 日志显示已使用本地 `release/chrome-win64/chrome.exe`

### 结构化需求
1. 解释 `C:\snapshot\...` 含义（pkg 虚拟路径）
2. 定位本地 Chromium 启动失败根因
3. 修复 Windows 沙箱导致的 `chrome.exe` 启动拒绝访问问题

### 本次操作概述
- 通过本地命令验证 `release/chrome-win64/chrome.exe --version`，复现错误：
  - `Sandbox cannot access executable ... 拒绝访问 (0x5)`
- 更新 `src/recorder/recorder.js`：
  - 将 `chromium.launch` 参数改为 `launchOptions` 可扩展对象
  - 当检测到本地 `chrome-win64/chrome.exe` 时自动设置：
    - `chromiumSandbox = false`
    - `args = ['--no-sandbox']`
  - 增加日志提示本地 Chromium 的无沙箱启动参数
- 目标：规避 Windows 权限/策略环境下沙箱访问可执行文件失败导致的录制启动异常

---

## 交互记录 #34 — 2026-02-26

### 时间
2026-02-26（续）

### 原始需求
- 用户在 Debug 模式下继续复现问题，要求基于运行证据推进排障

### 结构化需求
1. 在无法读取 `debug-fb16c5.log` 的情况下，补充“控制台可见”埋点，继续收集运行证据
2. 验证环境变量清理逻辑是否存在大小写遗漏（Windows 环境变量大小写不敏感）
3. 记录清理前/清理后的 `playwright_mcp` 相关键集合

### 本次操作概述
- 更新 `src/app/index.js`：
  - 新增控制台埋点：打印 `playwright_mcp`（大小写不敏感）键集合、exact 删除结果、清理后残留键集合
- 更新 `src/dashboard/index.js`：
  - 新增同类控制台埋点，验证 dashboard 启动链路中的清理效果
- 更新 `src/recorder/recorder.js`：
  - 在录制器启动时增加 `playwright_mcp` 相关键（大小写不敏感）快照日志
- 目的：为下一轮假设判定提供终端直接可见的运行证据

---

## 交互记录 #35 — 2026-03-23

### 原始需求
- 实现 Phase 2「Case 滑窗分片」：固定窗口（默认 20 条有效步骤）、每窗只归纳 1 个 Case、步骤瘦身、合并输出 `AI_cases.md`

### 实现概述
- 新增 `src/case_translate/phase2/slim-step-for-case.js`：Phase 2 专用瘦身（含 `routeKey`、`gapTag`、`assertText` 截断）
- 新增 `src/case_translate/phase2/case-window-segmenter.js`：仅 `status=normal` 参与窗口，`noise/skip` 不占额度
- 新增 `src/case_translate/phase2/case-markdown-renderer.js`：解析单窗 JSON、合并为 Markdown
- 更新 `src/case_translate/prompts/case-generation.js`：单窗 JSON 输出协议
- 更新 `src/case_translate/workflow.js`：Phase 2 循环调用与写盘
- `src/utils/config.js`：新增 `PHASE2_CASE_WINDOW_STEPS`、`PHASE2_GAP_TAG_LONG_GAP_MS`、`PHASE2_ASSERT_TEXT_MAX_CHARS`、`PHASE2_CASE_WINDOW_MAX_TOKENS`
- 文档：`doc/translate_design.md`、`doc/design.md`、`doc/requirements.md`、`doc/user_manual.md`

---

## 交互记录 #36 — 2026-03-23（Selenium 导出 + 只录 XPath）

### 原始需求
- 按计划实现：录制过程生成 Python Selenium（**Driver4**），**只录 XPath**；低侵入；Tab 专项不实现；终稿依赖 enriched + Phase1 `step_2`。

### 实现概述
- **`src/recorder/inject-script.js`**：`getElementInfo` 仅落盘 `element.xpath`；`captureFormState` 以 xpath 为键；移除 CSS `selector`。
- **`src/case_translate/preprocessor/action-merge.js`**：`formStateDelta` 匹配与双击去重改为 **xpath**；id 兜底键与注入侧 `//*[@id=…]` 一致。
- **`src/utils/config.js`**：`SELENIUM_EXPORT_ENABLED`、`SELENIUM_DRAFT_FILENAME`、`SELENIUM_FINAL_FILENAME`、`SELENIUM_CHROMEDRIVER_VAR_NAME`、`SELENIUM_DRIVER4_IMPORT_LINE`。
- **`src/selenium_export/`**：`templates.js`、`action-to-driver4.js`、`selenium-incremental-writer.js`、`regenerate-from-structured.js`、`comment-from-action.js`、`index.js`。
- **`src/recorder/recorder.js`**：`seleniumExportEnabled` / 配置开关；`_onAction` 追加草稿；`stop` / `_onBrowserDisconnected` 收尾。
- **`src/case_translate/workflow.js`**：Phase1 完成后若开关开启则 `regenerateFromStructured`；结构化步骤支持可选 **`sourceActionIndices`**。
- **文档**：`doc/design.md`、`doc/user_manual.md`、`doc/requirements.md`、`doc/translate_design.md`、`doc/interaction_record.md`。

---

## 交互记录 #37 — 2026-03-23（Selenium：仅 Driver4 open/click/set_value + 短 XPath）

### 原始需求
- 导出 Python 时对 **Driver4** 仅使用 `open`、`click`、`set_value` 三个对外能力（`open` 在模板中；逐条映射只用 `click`/`set_value`）。
- **XPath** 尽可能短且稳定：减少 `div[1]/div[1]/…` 长链，优先 `id` / `name` / `data-testid` / `placeholder`、页面内**唯一**的短文本、`//*[@id=…]` 等祖先锚点 + 相对路径，最后才兜底绝对路径。

### 实现概述
- **`src/recorder/inject-script.js`**：重写 `getXPath`（`xpathMatchCount`、`segmentForNode`、`relativePathFromAncestor`、`getXPathAbsolute`、`getShortTextForXPath`）；`formStateDelta` 仍与 `element.xpath` 同源生成。
- **`src/selenium_export/action-to-driver4.js`**：`click` 一律 `d.click`（去掉 `click_xy`）；`dblclick`/`rightclick` 降级为 `d.click` 并附注释；`keypress` 仅 TODO。
- **文档**：本文件本条记录。

---

## 交互记录 #38 — 2026-03-24（Dashboard 前端与当前产物同步）

### 原始需求
- 录制与翻译已经迭代多个版本，Dashboard 前端可查看文件仍是旧集合（如 `AI_steps.md`），需要同步到当前版本产物。

### 实现概述
- **`src/dashboard/server.js`**：
  - `/api/status` 新增 `seleniumExportEnabled`，用于前端显示 Selenium 导出开关状态。
  - `/api/runs` 新增运行产物标记：`hasStepErrors`、`hasMidscene`、`hasPreprocessLog`、`hasGenerateLog`、`hasSeleniumDraft`、`hasSeleniumFinal`。
- **`src/dashboard/static/index.html`**：
  - 文件按钮从旧的 `AI_steps.md` 调整为当前主产物：
    - `step_2_structured_steps.json`
    - `step_2_structured_steps.errors.json`
    - `AI_cases.md`
    - `step_4_midscene_no_assert.yaml`
    - `step_0_selenium_draft.py`
    - `step_0_selenium_from_recording.py`
    - `recorder.log` / `preprocess.log` / `generate.log`
  - 录制历史徽章新增：`step-errors`、`midscene`、`selenium`。
  - 初始化时显示 Selenium 导出开关状态日志（已开启/未开启）。

---

## 交互记录 #39 — 2026-03-24（Phase2 改为“前缀消费滑窗”）

### 原始需求
- 当前 Phase2 固定窗策略把 20 条步骤强行归纳成 1 个 case；期望改为：每轮最多看 20 条，但只消费首段（如 7 条），再“后 13 + 新 7”继续归纳。

### 实现概述
- **`src/case_translate/workflow.js`**：
  - 去掉 `chunkIntoFixedWindows` 的整窗分块流程，改为 `while (cursor < slimAll.length)` 的**滑动消费循环**。
  - 每轮窗口：`slimAll.slice(cursor, cursor + PHASE2_CASE_WINDOW_STEPS)`。
  - 解析模型返回后按 `consumeStepCount`（或覆盖步数）推进 `cursor`，实现“消费几步就滑出几步”。
- **`src/case_translate/prompts/case-generation.js`**：
  - 把硬规则从“必须覆盖整窗”改为“必须覆盖窗口 index 列表的前缀连续子数组”。
  - 新增输出字段 `consumeStepCount`。
- **`src/case_translate/phase2/case-markdown-renderer.js`**：
  - `parseSingleCaseJsonResponse` 支持并返回 `consumeStepCount`。
  - 校验 `coveredActionIndices` 必须为当前窗口 `expectedIndices` 的前缀；不合法时回退到 `consumeStepCount`/`steps.length` 推导。

---

## 2026-06-03 交互 — Phase 1 basis 自愈 + Phase 4 本地兜底

### 问题
- Phase 1：LLM 返回 `basis: ""`（空字符串）导致字段验证失败，触发整批 fallback
- Phase 4：MiniMax 输出含思考过程/Markdown，JSON 解析失败，Agent TXT 几乎为空

### 修复
- **`workflow.js`**：新增 `deriveBasisFromEvidence()`，在局部自愈阶段用 snapshotDiff / formState / hints 补全 basis
- **`ai-client.js`**：增强 `cleanMarkdownFence`，新增 `parseJsonFromLlmReply()` 统一 JSON 提取
- **`agent-txt-generator.js`**：LLM 失败 → JSON 修复重试 → 本地 1:1 确定性渲染兜底（不丢步骤）
- **`prompts/agent-txt.js`**：System Prompt 明确要求只输出 JSON、禁止思考过程

---

## 2026-06-03 — Prompt 独立为 Markdown

- 所有 LLM Prompt 正文迁至 `src/case_translate/prompts/md/*.md`
- JSON Schema 迁至 `src/case_translate/prompts/schema/*.json`
- 新增 `prompts/loader.js` 负责读取与 `{{占位符}}` 替换
- `*.js` 入口改为薄封装；EXE 打包时复制 `prompts/` 到 `release/prompts/`

---

## 2026-06-03 交互 — Phase 1 confidence 自愈 + 批次 JSON 容错

### 问题
- MiniMax 在 JSON Schema 模式下常省略 `confidence`（undefined），导致字段验证失败 → 整批 fallback
- 部分批次 JSON 解析失败

### 修复
- **`applyPartialAutoHeal()`**：抽取统一自愈；补全 `confidence`（`deriveConfidenceFromEvidence`）、`inputText`/`key`
- **`parseBatchLlmJson()`**：复用 `parseJsonFromLlmReply`，兼容思考标签/Markdown 包裹
- **`tryRepairBatchStructuredReply()`**：批次 JSON 解析失败时 LLM 修复重试
- 批次遗漏 index 检测；错误日志去重

### 验证（run_2026-06-03T07-11-48）
- Phase 1：`normal: 19, noise: 1, errors: 0`（修复前 fallback: 19）
- Phase 2/3/4 均成功；Agent TXT 8 个逻辑步骤

---

## 2026-06-03 — System Prompt LangGPT 9 维重构 + Schema 合并

### 变更
- 全部 **System** md（Phase 1/2/4 主调用 + repair + 遗留 step-analysis）按 `langgpt_standard.md` 重写为 9 维度：Role / Profile / Background / Goals / Constraints / Skills / Workflows / Output Format / Initialization
- Phase 1、Phase 4 的 JSON 字段表与示例合并进各 System 的 **Output Format** 章节
- **`workflow.js`**：移除 Phase 1 的 `response_format.json_schema` 传参（MiniMax 等模型不支持或效果差）
- **`step-structured.js` / `agent-txt.js`**：移除 Schema 导出；`prompts/schema/` 已删除，契约仅以 System md 为准
- 更新 `prompts/总纲.md`、`prompts/README.md`

---

## 2026-06-03 — 移除 JSON repair LLM

- 删除 `phase1-batch-repair-system.md`、`phase4-agent-txt-repair-system.md` 及 repair 调用链
- Phase 1 解析失败：fallback 步骤 + `llm_audit` 标记
- Phase 4 解析失败：本地 1:1 兜底（保留）

---

## 2026-06-03 — 删除 Phase 1 遗留逐条分析 Prompt

- 删除 `phase1-step-analysis-system.md`、`step-analysis.js`（旧版逐条 Markdown 分析，`workflow` 从未引用）
- `prompts/md/` 现为每 Phase 一份 System：`phase1-structured` / `phase2-case-window` / `phase4-agent-txt`

---

## 2026-06-03 — 翻译开始前 LLM 探活

- `ai-client.js` 新增 `pingLlm()`：user 发送「你好」，`LLM_PING_TIMEOUT_MS`（默认 3s）内无有效回复则失败
- `config.js`：`LLM_PING_FAIL_MESSAGE` =「LLM 调用出错，请确认 config 或者网络。」
- Dashboard：`/api/translate/start` 探活通过后再进入 `TRANSLATING` 并返回 200；失败返回 503，界面不卡住
- CLI / `generate()`：预处理前先探活；Dashboard 传 `skipLlmPing: true` 避免重复

---

## 2026-06-03 — build:trial 打包

- 执行 `npm run build:trial` → **`release/`** 为唯一分发目录（exe + chrome-win64 + prompts + config）
- **约定**：仅使用 `release/`；`release1/` 为历史本地目录，不参与打包、Agent 不再自动同步

---

## 2026-06-03 — Skill Prompt 重命名（3 份精华）

| 旧名 | 新名 |
|------|------|
| `phase1-structured-system.md` | `snapshots-2-steps-skill.md` |
| `phase2-case-window-system.md` | `steps-2-cases-skill.md` |
| `phase4-agent-txt-system.md` | `case-4-agents-skill.md` |

- 去掉文件名中的 `phase*`、`-system`；统一 `-skill` 后缀，与产物链 `snapshots → step_2 → cases → case_4_agents` 对齐
- 更新 `step-structured.js`、`case-generation.js`、`agent-txt.js`、`loader.js`、`prompts/README.md`、`总纲.md`

---

## 2026-06-03 — User Prompt 内嵌代码

- 删除 `prompts/md/*-user.md`（6 个）
- User 拼接逻辑迁入 `step-structured.js`、`case-generation.js`、`agent-txt.js`、`step-analysis.js`
- `md/` 仅保留 System Prompt；`loader.js` 只读 System

---

## 2026-06-03 — 删除 prompts/schema

- 移除 `prompts/schema/*.json` 及 `loader.loadPromptSchema`
- 打包脚本不再复制 `prompts/schema`
- JSON 契约仅以各 System md 的 Output Format 为准

---

## 2026-06-03 — 关闭 LLM 自愈 + 全量审计落盘

### 变更
- **`LLM_AUTO_HEAL_ENABLED = false`**（`config.js`）：关闭 `applyPartialAutoHeal` 及 normalize 阶段的证据补全
- 新增 **`llm-audit.js`**：每次 LLM 调用写入 `run_*/llm_audit/call_XXXX.json`（完整 messages + raw 回复 + outcome）
- 跑完生成 **`llm_audit/index.json`**、**`problems.json`**、**`summary.json`**，便于定位有问题的输入输出对
- Phase 1/2/4 及 repair 调用均接入审计

---

## 2026-06-04 — 移除 Selenium / Midscene 导出模块

### 背景
- `src/selenium_export/`、`src/case_translate/midscene/` 已无调用方；`workflow.js` 未接入；默认长期关闭。

### 删除
- 目录 `src/selenium_export/`（6 个 JS 文件）
- 目录 `src/case_translate/midscene/`（3 个 JS 文件）
- `src/utils/driver4.py`、`src/utils/step_0_selenium_from_recording.py`
- `doc/todo.txt`（仅含 Selenium 优化待办）

### 代码清理
- `config.js`：移除 `MIDSCENE_*`、`SELENIUM_*` 常量
- `recorder.js`：移除 Selenium 草稿增量写入逻辑
- `workflow.js`：移除仅服务于 Selenium 终稿的 `sourceActionIndices` 字段

### 保留
- 录制侧 `inject-script.js` 仍采集 `element.xpath`（证据字段，与导出无关）

### 文档
- 同步更新 `design.md`、`user_manual.md`、`requirements.md`

---

## 2026-06-04 — 移除 action.position（点击坐标）

### 背景
- `position: { x, y }` 主要为已删除的 Selenium `click_xy` 服务；Phase1 LLM 输入与主证据链不依赖。

### 变更
- `inject-script.js`：click/dblclick/rightclick 不再上报坐标
- `recorder.js`：`action_*.json` 不再写入 `position`
- `preprocessor/index.js`：enriched 不再携带 `position`
- 文档：`requirements.md`、`translate_design.md`

---

## 2026-06-04 — 翻译管线去 JSON 化（Phase 1/2/4）

### 背景
- Phase 1 强制 JSON 导致 `JSON.parse` 频繁失败；架构上 Phase 4 终稿本就为纯文本，不应保留 JSON 中间契约。

### 实现
- **Phase 1**：`snapshots-2-steps-skill.md` 改为 XML（action/observation）；`phase1/xml-step-extractor.js` 宽松正则 + 按 `actionBatch[].index` 锚定；`workflow.js` 接入。
- **Phase 2**：`steps-2-cases-skill.md` 改为 Markdown + `<case_meta/>`；User 纯文本；`parsePhase2MarkdownResponse`；`clampWindowConsume` 防死循环。
- **Phase 4**：`case-4-agents-skill.md` 改为 `<agent_chunk>` XML；`phase4/xml-agent-chunk-parser.js`；`agent-txt-generator.js` 移除 `parseJsonFromLlmReply`。
- **共用**：`xml-parse-utils.js`（预处理、ReDoS 预检、consume 钳制、轮次保险丝）；`format-step-plain-text.js`。
- **配置**：`config.js` 新增 XML 正则上界与 `SLIDING_WINDOW_MAX_ROUND_MULTIPLIER`。

### 文档
- `prompts/总纲.md`、`doc/interaction_record.md`（本条）

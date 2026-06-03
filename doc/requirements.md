# 需求文档（重写）— AI UI Recorder

版本：v2（文档重写版）  
更新时间：2026-02-17  

> 本文档回答三个问题：**系统要解决什么问题**、**系统必须具备哪些能力（含验收标准）**、**哪些明确不做/下一阶段再做**。  
> 设计细节与“为什么这样做”请看：`doc/design.md`；翻译子系统细节请看：`doc/translate_design.md`；部署与运行请看：`doc/user_manual.md`。

---

## 1. 背景与目标

### 1.1 背景

手工测试的关键痛点不在“写表格”，而在于：

- **操作发生时的上下文难追溯**：只凭记忆/截图很难证明“当时页面是什么样”。
- **从物理动作到语义步骤的转换成本高**：录到 click/Enter 不等于得到“输入用户名/打开设置弹窗/关闭对话框”。
- **LLM 容易凭空补全**：没有证据链时，模型会“猜”，用例就会错。

### 1.2 系统目标（必须做到）

- **录制真实操作**：在真实 Chromium 浏览器里手动操作即可录制（无插件、无侵入）。
- **构建证据链**：每条操作都能回答：
  - 操作前页面是什么样？
  - 操作后页面发生了什么变化？
- **可调试、可恢复**：所有关键中间产物落盘；AI 生成增量写盘，支持中断恢复。
- **稳定采集，延后理解**：录制阶段只采集稳定原始数据；理解/归纳在翻译阶段完成。

---

## 2. 系统范围（Scope）

### 2.1 in-scope（当前版本）

系统由三条主链路构成：

- **录制（Recorder）**：采集原始数据（actions + snapshots + meta）。
- **预处理（Preprocessor）**：把原始数据变成 LLM 最容易消费的“证据包”（diff / 上下文 / 表单增量 / 分类 / 语义归并）。
- **翻译（Workflow）**：两阶段 AI 流水线（逐条分析 → 归纳用例）。

并提供 **Dashboard** 用于免命令行操作（录制/翻译/日志/结果查阅）。

可选能力（配置开启）：**Selenium 脚本导出**（Python 调用项目内 `Driver4`，定位统一为录制侧 **`element.xpath`**；草稿在录制中增量落盘，终稿在翻译 Phase1 后依赖 `enriched/` + `step_2` 生成）。

### 2.2 out-of-scope（明确不做/当前不承诺）

- 不承诺覆盖全部交互：hover/drag、用户等待期间的“被动变化”检测暂不实现（列入下一阶段）。
- 不承诺在 ARIA 语义很差的页面上也能“完美理解业务含义”：当证据不足时必须**保守输出**（标注信息不足）。
- 不承诺把录制阶段直接变成“业务语义动作录制器”：录制只采集物理动作与证据，语义在翻译阶段形成。

---

## 3. 数据契约（必须稳定）

### 3.1 每次运行的输出目录

每次录制生成一个独立目录：

```
output/run_<timestamp>/
  meta.json
  recorder.log
  snapshots/
  actions/
  preprocessed/         # 翻译阶段产出
  step_2_structured_steps.json
  step_2_structured_steps.errors.json
  AI_cases.md           # 翻译阶段产出
  step_4_midscene_no_assert.yaml
  generate.log          # 翻译阶段产出
  step_0_selenium_draft.py           # 可选：Selenium 草稿（录制）
  step_0_selenium_from_recording.py  # 可选：Selenium 终稿（Phase1 后）
```

### 3.2 关键命名约定（验收必须通过）

设本次录制总操作数为 \(N\)：

- **快照数 = N + 1**
- `action_N` 的：
  - `preSnapshot` 对应 `snapshots/snapshot_{N-1}.txt`
  - `postSnapshot` 对应 `snapshots/snapshot_{N}.txt`
- `diff_N` 表示 `snapshot_{N-1} → snapshot_{N}`
- 相邻操作共享中间快照：`post(N) === pre(N+1)`（零冗余）

> 上述约定是系统“可解释/可排障”的根基：任何一步都能定位证据文件。

---

## 4. 能力清单与验收标准（当前版本）

> 写法约定：每条能力包含**用户价值**与**可验证的验收标准**。

### 4.1 录制：浏览器与生命周期

- **能力**：启动非 headless 的 Chromium，用户可直接交互录制。
  - **验收**：执行录制后自动弹出 Chromium；用户可手动操作页面；控制台/日志出现“录制已开始”。

- **能力**：支持原生窗口视口模式与固定 viewport 模式切换，并可配置窗口尺寸与慢动作延迟（便于观测/截图）。
  - **验收**：
    - `USE_NATIVE_WINDOW_VIEWPORT=true` 时，录制使用浏览器真实可视区（`context.viewport=null`），避免因浏览器导航栏导致底部内容被裁切。
    - `USE_NATIVE_WINDOW_VIEWPORT=false` 时，使用 `VIEWPORT_WIDTH/VIEWPORT_HEIGHT` 固定 viewport。
    - `SLOW_MO` 修改后生效。

- **能力**：导航到指定 URL 开始录制（Dashboard 可覆盖）。
  - **验收**：URL 生效来源明确：
    - 命令行：`src/utils/config.js` 的 `TARGET_URL`
    - Dashboard：界面输入优先生效

- **能力**：停止方式明确且可用。
  - **验收**：
    - 主方式：关闭浏览器窗口后，进程自动完成收尾并退出
    - 备用方式：Ctrl+C 触发 stop 流程；再次 Ctrl+C 可强制退出（不要求产物完整）

### 4.2 录制：多页面（多 Tab）

- **能力**：新 Tab 打开后能被纳入录制（事件脚本在 Context 级注入）。
  - **验收**：打开新 Tab 后，在新 Tab 的 click/按键等动作能生成新的 `actions/action_*.json`，且 action 中包含 `url/title` 以区分页面。

- **能力**：切回已有 Tab 后继续录制。
  - **验收**：跨 Tab 操作不会导致 recorder 退出或停止写入。

> 说明：多 Tab 的语义理解质量上限仍受证据质量影响；当页面语义弱时，AI 必须保守输出。

### 4.2.1 录制：Electron EXE（DOM 层）

- **能力**：支持通过命令行传入 Electron 打包 EXE 路径进行录制（复用 Recorder 数据契约）。
  - **验收**：
    - 执行 `node src/recorder/electron-cli.js "<exe路径>"` 可启动目标 EXE 并开始录制。
    - 关闭 Electron 窗口后，能完成收尾并输出 `meta.json`、`actions/`、`snapshots/`。
    - 支持通过 `--` 透传启动参数给 Electron 应用。

### 4.3 录制：可捕获的物理动作（稳定采集层）

- **能力**：捕获鼠标动作：单击、双击、右键点击。
  - **验收**：每次动作产生一个 `actions/action_NNN.json`；action 中包含 `type`、`element`、`position`、`timestamp`、`url/title`。

- **能力**：捕获关键按键：Enter / Tab / Escape / Space。
  - **验收**：按键动作产生 action，`type` 为键盘类，且 `key` 字段包含按键名。

### 4.4 录制：证据采集（完美快照模型 v2）

- **能力**：后台周期轮询整页 Accessibility Snapshot（AX Tree），缓存为“干净快照”来源。
  - **验收**：快照轮询间隔由 `SNAPSHOT_POLL_INTERVAL_MS` 控制；录制目录存在 `snapshots/snapshot_000.txt ... snapshot_NNN.txt`。

- **能力**：每条 action 都有稳定的 pre/post 对应关系（零冗余）。
  - **验收**：对任意 action \(i\)，都能找到 `snapshot_{i-1}` 与 `snapshot_{i}`；且 action 数为 \(N\) 时快照数为 \(N+1\)。

- **能力**：同步捕获 `formStateDelta`，用于精确表单值证据。
  - **验收**：每条 action 文件包含 `formStateDelta`（至少为对象）；输入场景可观测到 value/checked 等字段变化。

- **能力**：快照裁剪与文本化，降低体积并提升可读性。
  - **验收**：快照文本为 YAML 风格缩进结构；深度受 `SNAPSHOT_MAX_DEPTH` 控制。

### 4.5 翻译：预处理（证据包构建层）

- **能力**：对相邻快照对计算行级 diff，并对超长 diff 截断（保留首尾）。
  - **验收**：输出 `preprocessed/diffs/diff_NNN.txt`；截断阈值受 `DIFF_TRUNCATE_THRESHOLD` 控制；文件版保留完整 diff、内存版可截断。

- **能力**：提取操作元素上下文片段（让 LLM 快速定位区域）。
  - **验收**：`preprocessed/enriched/enriched_NNN.json` 中包含 `contextExcerpt`，并在目标行带“操作目标”标记。

- **能力**：计算相邻 action 的 `formStateDelta` 增量，形成可读的变化文本。
  - **验收**：enriched 数据包含 `formStateChanges` 与 `formStateChangeText`；无变化时为空/缺省且不误报。

- **能力**：语义归并（Semantic Compression）提升输入质量并节省 token。
  - **验收**：
    - **输入识别**：典型序列“click 输入框 → … → 下一次动作”可把 click 归并为 input，并提取 `inputValue`（密码脱敏为 `[MASKED]`）
    - **双击去重**：双击产生的冗余 click 标记为 `skip`，不进入 AI 调用
    - **噪声过滤**：diff 为空且表单增量为空的 click 标记为 `noise`，AI 跳过但编号对齐
    - 归并报告写入 `preprocessed/merged/merge_report.json`

- **能力**：操作分类与 hints（把“该关注什么”显式告诉 LLM）。
  - **验收**：enriched 数据包含 `classification`（含 `category/elementType/hints`）。

### 4.6 翻译：AI 三阶段流水线（结构化最终形态）

- **能力**：Phase 1 逐条生成结构化步骤 `step_2_structured_steps.json`，并记录异常修复轨迹 `step_2_structured_steps.errors.json`。
  - **验收**：即使单条模型输出非严格 JSON，也能通过修复/兜底继续流程，不阻塞整批翻译。
  - **验收**：每条结构化步骤包含与上一条步骤的时间间隔（毫秒），用于表达上一步操作后的响应时长特征。

- **能力**：Phase 2 基于结构化步骤归纳输出 `AI_cases.md`（Case 分组 + 表格）。
  - **验收**：`AI_cases.md` 存在并包含一个或多个 Case；表格列至少包含“步骤/操作/UI 变化”。
  - **验收**：Phase 2 按配置固定窗口（默认 20 条有效步骤）分窗调用；`noise/skip` 等不占窗口额度；`step_2_structured_steps.json` 原始内容不因 Phase 2 被改写。

- **能力**：Phase 3 生成 Midscene 可执行 YAML（默认不写 assert）。
  - **验收**：
    - 产出 `step_4_midscene_no_assert.yaml`
    - YAML 关键字仅使用动作执行相关项（如 `ai`、`aiDoubleClick`、`aiKeyboardPress`、`sleep`），不生成 `aiAssert`
    - 根据相邻步骤间隔自动插入 `sleep`（受最小/最大阈值约束）。

- **能力**：严禁猜测（Evidence-Driven 输出约束）。
  - **验收**：当 diff/formState/context 都不足以支持业务语义时，文本必须明确标注“信息不足”，不得从 selector/class 反推业务含义。

### 4.6.1 独立翻译启动器（EXE）

- **能力**：提供独立翻译启动器，目标机无 Node 环境也可执行翻译。
  - **验收**：
    - 启动器与 `output/` 目录同级放置时，默认翻译 `output/` 下最新 `run_*`。
    - 支持命令行参数指定 `output/` 下目录名（如 `run_2026-...`）作为翻译目标。
    - 启动器可读取同级 `ai.local.json` 作为 AI 配置来源。

### 4.7 Dashboard（免命令行的一站式控制）

- **能力**：提供 Web UI 完成录制/翻译/日志/产物查阅。
  - **验收**：
    - `npm run dashboard` 后可访问 `http://localhost:3000`
    - 能开始/停止录制、启动翻译
    - 能查阅 run 列表与文件内容
    - 能看到实时日志流（SSE）

---

## 5. 非功能性要求（质量门槛）

- **配置集中**：所有可调参数集中在 `src/utils/config.js`，避免散落魔法数字。
- **模块解耦**：录制与翻译仅通过文件系统交互；翻译内部再解耦（preprocessor / prompts / workflow / ai-client）。
- **过程文件可用**：关键中间产物必须落盘（preprocessed、logs、steps/cases），便于复现与排障。
- **失败可继续**：单条 AI 调用失败不应中断整条 Phase 1（写入 fallback 并继续）。

---

## 6. 下一阶段（候选能力）

- **被动变化检测**：用户等待期间的页面变化（通知/弹窗/数据加载）独立记录（避免“变化被归属到下一次动作”）。
- **hover**：有意义悬停（防抖）。
- **drag**：拖拽起点/终点的稳定证据采集。

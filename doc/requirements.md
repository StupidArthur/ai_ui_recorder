# 产品需求与验收基线

## 1. 产品范围

本产品只包含两个交付工具：Node.js 录制端和 Go/Wails 翻译端。旧 Node 翻译链、Python 翻译服务和 Web 平台不属于当前范围。

## 2. 录制端需求

- 在真实 Chromium 或 Electron 应用中采集用户交互。
- 每次录制创建独立 `run_*` 目录。
- `N` 个 action 必须形成 `N+1` 个快照。
- action 必须保存稳定编号、类型、时间戳、目标元素和必要的输入/按键信息。
- 录制结束必须写入 `meta.json` 和 `record/recorder.log`。
- 录制过程不依赖 LLM，也不产生业务语义测试用例。
- 不把密码、API Key 等秘密明文写入可读产物。

## 3. 翻译端需求

- 在调用模型前验证录制数据契约。
- 支持从录制根目录发现和选择 `run_*`。
- 左侧列表准确显示已翻译状态，标题统一为 `TPT`。
- 模型配置集中管理，默认支持 MiniMax-M3 不思考模式。
- `key` 等关键操作字段必须贯穿 action、结构化步骤、Prompt 和最终产物。
- Phase 3 生成可供执行 Agent 使用的文本。
- Phase 4 按 Case 输出 Markdown 表格，操作与结果分列；没有结果时允许空白。
- 翻译完成后默认渲染 Phase 4，缺失时回退 Phase 3。
- 任一关键输出写盘失败时不得显示翻译成功。

## 4. 数据契约验收

有效输入必须满足：

1. `meta.json` 可解析且声明了正操作数。
2. `action_001...action_N` 连续存在，内部 `index` 与文件编号相同。
3. 每个 action 具有有效 `type` 与非零 `timestamp`。
4. action 时间戳不逆序。
5. `snapshot_000...snapshot_N` 连续存在且非空。

无效输入必须给出清晰错误，不允许静默降级。

## 5. 输出验收

- `translate/phase1/structured_steps.json`：结构化步骤完整且编号稳定。
- `translate/phase2/case_slices.json`：每个切片消费步数大于零，覆盖全部有效步骤。
- `translate/phase3/agents.txt`：保留必要的操作目标、文本、按键和验证信息。
- `translate/phase4/cases.md`：每个 Case 有独立表格，包含序号、操作、结果三列。
- `translate/llm_audit/`：记录模型调用结果，但不包含 API Key。

## 6. 发布验收

- Node 核心文件通过语法检查，录制 bundle 构建成功。
- Go 单元测试通过，前端生产构建成功。
- Wails EXE 能启动，文件名、界面版本和 Windows VersionInfo 一致。
- 生成物、依赖目录、真实 API Key 和用户录制数据不进入 Git。

# Go/Wails 翻译端设计

## 1. 目标

翻译端把 Node.js 录制端产生的物理操作和页面证据转换成两种产物：

- `translate/phase3/agents.txt`：供下游 Agent 执行的步骤文本。
- `translate/phase4/cases.md`：供人阅读和记录执行结果的 Markdown Case 表格。

翻译端不录制浏览器、不修改原始操作，也不把模型输出直接当作可信数据落盘。

## 2. 工程结构

```text
recorder/translate_gui/
  app.go                    Wails 后端 API
  record_validation.go      上下游契约校验
  preprocess*.go            动作合并、快照 diff、证据富化
  phase1_extract.go         结构化步骤
  phase2_slice.go           Case 切分
  phase3_agent.go           Agent 文本
  phase4_human.go           Markdown Case 表格
  workflow.go               工作流编排
  model_registry.go         模型能力和默认参数
  frontend/                 React 界面
```

实际文件名以源码为准；阶段职责不应跨层混合。

## 3. 输入校验

翻译开始前校验：

- `meta.json` 可解析且操作数大于零。
- `action_001...action_N` 全部存在，文件编号与 `index` 一致。
- action 具有有效 `type` 和 `timestamp`，时间戳不逆序。
- `snapshot_000...snapshot_N` 全部存在且非空。

任一条件失败都应返回可定位的错误，不允许用空快照继续翻译。

## 4. 证据预处理

预处理将每个操作与前后快照关联，生成模型可消费的证据包：

- 操作类型、目标元素、文本与按键。
- 操作前后 AX 快照差异。
- 表单状态变化。
- 上下文片段与动作分类。
- 合并后的来源 action 编号。
- 与前一个有效步骤的时间间隔。

`key`、输入类型和来源编号必须贯穿完整链路，避免 Prompt 或最终用例丢失关键操作信息。

## 5. 四阶段输出

### Phase 1：结构化步骤

模型结合动作证据生成标准字段。程序负责解析、规范化、编号和兜底，并将模型调用写入审计记录。

### Phase 2：Case 切分

按业务连续性将结构化步骤分组。`consume` 必须大于零并受剩余步骤数约束，避免滑窗死循环或覆盖遗漏。

### Phase 3：Agent 文本

面向执行器输出紧凑步骤。不是每个动作都必须单独带结果；多个动作可以共享后续统一结果。

### Phase 4：Case 表格

Phase 4 不重新发明用例语义，而是把已结构化的步骤按 Case 渲染：

```markdown
## Case 1：登录系统

| 序号 | 操作 | 结果（录制实况 / 预期基线） |
|---:|---|---|
| 1 | 输入用户名 | |
| 2 | 点击登录 | 进入系统首页 |
```

结果列来自录制中可验证的实际变化；没有结果时留空。该表既可作为测试用例，也可作为人工执行记录。

## 6. 模型配置

模型差异集中在 `model_registry.go`，包括 Base URL、模型名、是否关闭思考、是否拆分 reasoning 等。当前默认模型为 MiniMax-M3 不思考模式。

API Key 只从用户配置或环境读取：

- 不写入源码。
- 不写入测试夹具。
- 不输出到日志或模型审计文件。

## 7. 前端行为

- 左侧列表根据翻译产物判断“已翻译”。
- 录制标题统一显示为 `TPT`。
- 选择已翻译记录时默认打开 Phase 4 `cases.md`；不存在时回退到 Phase 3 `agents.txt`。
- Markdown 使用 GFM 渲染，Case 表格应直接可读。

## 8. 验证

```powershell
cd recorder/translate_gui
go test ./...

cd frontend
npm run build
```

真实模型集成测试通过 `integration` build tag 和临时环境变量启用，默认测试不得访问外部模型。

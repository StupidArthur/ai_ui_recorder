# Go/Wails 翻译端设计

## 1. 目标

翻译端把 Node.js 录制端产生的物理操作和页面证据转换成三种同源产物：

- `translate/phase3/agents.txt`：供下游 Agent 执行的步骤文本。
- `translate/phase3/runnable_case.md`：供 web-ui-case-debugger 调试的录制生成版。
- `translate/phase3/cases.md`：供人阅读和记录执行结果的 Markdown Case 表格。

翻译端不录制浏览器、不修改原始操作，也不把模型输出直接当作可信数据落盘。

## 2. 工程结构

```text
translate_gui/
  app.go                    Wails 后端 API
  record_validation.go      上下游契约校验
  preprocess*.go            动作合并、快照 diff、证据富化
  phase1_extract.go         结构化步骤
  phase2_slice.go           Case 切分
  phase3_agent.go           兼容 Agent 文本
  phase3_runnable.go        debugger Markdown
  phase3_human.go           Markdown Case 表格
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

## 5. 三阶段输出

### Phase 1：结构化步骤

模型结合动作证据生成标准字段。程序负责解析、规范化、编号和兜底，并将模型调用写入审计记录。

### Phase 2：Case 切分

按业务连续性将结构化步骤分组。`consume` 必须大于零并受剩余步骤数约束，避免滑窗死循环或覆盖遗漏。

### Phase 3：格式化产物

Phase 3 不调用模型，使用同一组 Step 和 Case 确定性生成多种格式：

- `agents.txt` 保留紧凑执行文本，并保留现有有效信息。
- `runnable_case.md` 将操作和预期就近分离，明确标记“录制生成版”，作为 debugger 的输入。
- `cases.md` 输出供人阅读的操作/结果表格。

格式化阶段不重新发明用例语义。缺少结果时不生成断言，缺少输入或唯一定位依据时交由下游调试确认。

翻译开始时写入 `translate/attempt.json`，所有必需产物和审计文件写入成功后才写入 `translate/completed.json` 并发送完成进度。这样失败后留下的部分产物不会被误判为本次翻译成功。

```markdown
## Case 1：登录系统

| 序号 | 操作 | 结果（录制实况 / 预期基线） |
|---:|---|---|
| 1 | 输入用户名 | |
| 2 | 点击登录 | 进入系统首页 |
```

结果列来自录制中可验证的实际变化；没有结果时留空。该表既可作为测试用例，也可作为人工执行记录。

## 6. 模型配置

模型调用遵循标准 OpenAI 接口协议，支持两种可切换的协议：

- `chat_completions`：`POST {baseUrl}/chat/completions`
- `responses`：`POST {baseUrl}/responses`

界面可保存多个命名配置档，统一存放在用户系统目录 `~/.ui_translator/ai.local.json`，其中 `active` 记录当前选用档，下次启动自动加载。协议、Base URL、模型名均由用户填写，不再维护厂商硬编码注册表。

推理控制使用标准参数：Chat Completions 发 `reasoning_effort`，Responses 发 `reasoning.effort`。

API Key 只从用户配置读取：

- 不写入源码。
- 不写入测试夹具。
- 不输出到日志或模型审计文件。
- 配置档列表接口不回传 key 明文。

## 7. 前端行为

- 左侧列表根据翻译产物判断“已翻译”。
- 录制标题统一显示为 `TPT`。
- 选择已翻译记录时默认打开 `phase3/runnable_case.md`，依次回退到新 `phase3/cases.md`、历史 `phase4/cases.md` 和 `phase3/agents.txt`。
- Markdown 使用 GFM 渲染，Case 表格应直接可读。

## 8. 验证

```powershell
cd translate_gui
go test ./...

cd frontend
npm run build
```

真实模型集成测试通过 `integration` build tag 和临时环境变量启用，默认测试不得访问外部模型。

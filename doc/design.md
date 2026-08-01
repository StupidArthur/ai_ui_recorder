# AI UI Recorder 总体设计

## 1. 架构边界

系统由两个独立桌面工具组成：

| 工具 | 技术 | 职责 |
|---|---|---|
| 录制端 | Node.js + Playwright | 启动浏览器、采集操作、保存快照与元信息 |
| 翻译端 | Go + Wails + React | 校验录制数据、预处理证据、调用模型、渲染测试用例 |

录制端必须保持确定性，不依赖 LLM。翻译端只读取录制产物，不反向修改原始 `record/` 数据。

## 2. 数据契约

单次录制目录：

```text
run_<timestamp>/
  meta.json
  record/
    actions/action_001.json
    snapshots/snapshot_000.txt
    snapshots/snapshot_001.txt
    recorder.log
  translate/                 # 翻译端创建
```

对于第 `N` 个操作：

- `action_N` 描述真实用户操作。
- `snapshot_{N-1}` 是操作前页面状态。
- `snapshot_N` 是操作后页面状态。
- `N` 个操作必须对应 `N+1` 个快照。

翻译前必须校验操作编号、快照完整性和时间戳顺序。契约不完整时终止翻译，禁止静默错位。

## 3. 录制端

### 3.1 核心模块

- `recorder/src/recorder/`：Playwright 生命周期、页面注入、操作收集和快照轮询。
- `recorder/src/dashboard/`：开始/停止录制、SSE 日志、录制历史和原始文件预览。
- `recorder/src/utils/`：路径布局、配置和日志。
- `recorder/scripts/`：Node 录制端打包和诊断。

### 3.2 快照模型

录制端后台周期性获取 AX 快照。操作到达时，把上一个稳定快照与本次操作绑定；下一稳定状态成为对应的 post snapshot。录制结束时为最后一个 pending action 补终态快照。

### 3.3 数据安全

密码输入可以保留“发生了输入”以及字段身份，但不得把密码明文写入日志、Prompt 或可读测试用例。API Key 不属于录制数据。

## 4. 翻译端

翻译端位于 `recorder/translate_gui/`，内部流程：

1. 校验 `meta.json`、actions 和 snapshots。
2. 合并噪声动作，计算前后快照差异与表单变化。
3. Phase 1：生成结构化步骤。
4. Phase 2：按连续业务范围切分 Case。
5. Phase 3：生成可执行的 Agent 文本。
6. Phase 4：把结构化步骤渲染为 Markdown Case 表格。

Phase 4 的“结果”列表示录制中观察到的实际结果，同时可作为后续回归测试的预期基线。没有独立结果的步骤保持空白。

## 5. 错误边界

- 录制失败：保留已落盘证据和日志，不生成伪造动作。
- 数据契约失败：翻译端明确报错并停止。
- 单次模型输出异常：记录审计信息，按工作流规则重试或使用受控兜底。
- 输出写盘失败：整体翻译标记失败，不显示“已完成”。

## 6. 版本与发布

- Node 录制端版本来自 `recorder/package.json`。
- Go 翻译端版本同时写入前端显示、`frontend/package.json`、`wails.json` 和 Windows VersionInfo。
- EXE、`dist/`、`release/`、`output/` 与依赖目录不提交到 Git。
- 每次发布前至少执行 Node 语法/构建检查、`go test ./...`、前端生产构建和 Wails 打包检查。


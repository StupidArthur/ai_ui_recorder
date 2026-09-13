# AI UI Recorder

本仓库只维护两条产品主线：

1. `recorder/`：Node.js + Playwright 录制端，采集用户操作、AX 快照和表单状态。
2. `translate_gui/`：Go + Wails 翻译端，读取录制目录并生成 Agent 执行文本和人类可读 Case 表格。

两者只通过 `output/run_*/` 文件目录交互。录制端不调用模型，翻译端不控制浏览器。

## 快速开始

### Node.js 录制端

```powershell
cd recorder
npm install
npx playwright install chromium
npm run dashboard
```

Dashboard 默认地址为 `http://localhost:3000`。也可以直接运行：

```powershell
npm run record
```

录制端可用的打包命令：

```powershell
npm run build:trial
```

### Go/Wails 翻译端

```powershell
cd translate_gui
go test ./...
wails dev
```

生产打包：

```powershell
wails build -clean
```

翻译模型、Base URL 和 API Key 在翻译工具界面配置。API Key 不应写入源码或提交到 Git。

## 数据流

```text
Node.js 录制
  -> output/run_<timestamp>/meta.json
  -> output/run_<timestamp>/record/actions/action_N.json
  -> output/run_<timestamp>/record/snapshots/snapshot_N.txt
  -> Go/Wails 翻译
  -> output/run_<timestamp>/translate/phase3/agents.txt
  -> output/run_<timestamp>/translate/phase3/runnable_case.md
  -> output/run_<timestamp>/translate/phase3/cases.md
```

核心契约是：`action_N` 的操作前状态为 `snapshot_{N-1}`，操作后状态为 `snapshot_N`。

## 目录结构

```text
recorder/                 Node.js + Playwright 录制模块
translate_gui/            Go + Wails 翻译模块
doc/                      设计、数据契约和使用文档
dev-skill/                开发流程说明
on_delete/                已停用模块和临时文件的可恢复归档
output/, ana_data/        录制输出和分析数据
release/                  发布产物
```

录制与翻译是当前维护的产品模块。`on_delete/` 是隔离归档区，不参与构建或运行，也尚未做物理删除；其中包括旧模型调试脚本。

## 文档入口

- [总体设计](design.md)
- [录制数据规范](recording_data_spec.md)
- [翻译端设计](translate_design.md)
- [使用手册](user_manual.md)
- [运行目录布局](run_directory_layout.md)
- [快照时序设计](snapshot_timing_design.md)

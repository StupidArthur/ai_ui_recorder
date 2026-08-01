# AI UI Recorder

本仓库只维护两条产品主线：

1. `recorder/`：Node.js + Playwright 录制端，采集用户操作、AX 快照和表单状态。
2. `recorder/translate_gui/`：Go + Wails 翻译端，读取录制目录并生成 Agent 执行文本和人类可读 Case 表格。

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
npm run build:electron-recorder
npm run build:trial
```

### Go/Wails 翻译端

```powershell
cd recorder/translate_gui
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
  -> output/run_<timestamp>/translate/phase4/cases.md
```

核心契约是：`action_N` 的操作前状态为 `snapshot_{N-1}`，操作后状态为 `snapshot_N`。

## 目录结构

```text
recorder/
  src/recorder/          Node.js 录制核心
  src/dashboard/         录制控制与历史查看
  src/utils/             录制配置、日志和目录布局
  translate_gui/         Go/Wails 翻译工具
  scripts/               录制端构建与诊断脚本
doc/
  recording_data_spec.md 上下游数据契约
  design.md              总体设计
  translate_design.md    Go 翻译端设计
  user_manual.md         使用手册
```

旧 Node 翻译链和 Python/FastAPI 翻译服务已经移除，不再作为兼容入口维护。

## 文档入口

- [总体设计](design.md)
- [录制数据规范](recording_data_spec.md)
- [翻译端设计](translate_design.md)
- [使用手册](user_manual.md)
- [运行目录布局](run_directory_layout.md)
- [快照时序设计](snapshot_timing_design.md)

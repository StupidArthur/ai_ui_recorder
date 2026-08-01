# 使用手册

## 1. 录制端

### 1.1 开发环境

要求 Node.js 18 或更高版本。

```powershell
cd recorder
npm install
npx playwright install chromium
npm run dashboard
```

浏览器访问 `http://localhost:3000`，填写目标 URL 后开始录制。关闭被录制浏览器窗口或点击“停止录制”完成落盘。

直接启动录制器：

```powershell
npm run record
```

### 1.2 打包

普通浏览器录制包：

```powershell
npm run build:trial
```

Electron 应用录制包：

```powershell
npm run build:electron-recorder
```

分发离线录制包时，EXE 必须和构建脚本准备的 Chromium 目录一起复制。

## 2. 翻译端

### 2.1 开发环境

要求 Go、Wails CLI、Node.js 和 WebView2 Runtime。

```powershell
cd recorder/translate_gui
wails dev
```

### 2.2 使用流程

1. 在界面选择录制输出根目录，通常是 `recorder/output` 或打包程序旁的 `output`。
2. 从左侧选择一个 `run_*` 记录。
3. 选择模型并填写 Base URL、API Key 等配置。
4. 点击翻译并等待四个阶段完成。
5. 翻译完成后，右侧默认显示 Phase 4 Case 表格；也可切换查看 Phase 3 Agent 文本和中间产物。

### 2.3 生产打包

```powershell
cd recorder/translate_gui
wails build -clean
```

产物位于 `recorder/translate_gui/build/bin/`。

## 3. 输出说明

```text
run_<timestamp>/
  meta.json
  record/
    actions/
    snapshots/
    screenshots/        # 可选
    recorder.log
  translate/
    logs/generate.log
    preprocess/
    phase1/structured_steps.json
    phase2/case_slices.json
    phase3/agents.txt
    phase4/cases.md
    llm_audit/
```

需要交给执行 Agent 时使用 `phase3/agents.txt`；需要人工阅读、评审或记录测试结果时使用 `phase4/cases.md`。

## 4. 常见问题

### 没有录制到操作

- 确认页面已经完成加载。
- 查看 `record/recorder.log` 中的注入诊断。
- 跨域 iframe 或特殊浏览器控件可能无法被普通页面脚本捕获。

### 翻译端提示缺少 action 或 snapshot

录制数据不满足 `N` 个 action 对应 `N+1` 个 snapshot 的契约。不要手工补空文件，应重新录制或根据日志定位录制中断原因。

### API Key、网络或模型失败

- 检查 Base URL 和模型名称。
- 确认 API Key 有效且网络可访问模型服务。
- 查看 `translate/logs/generate.log` 和 `translate/llm_audit/`。
- API Key 不应出现在日志、截图或提交记录中。

### 密码为什么不显示

密码明文不应进入 Agent 文本或 Case。用例应表达“在密码框输入有效密码”，而不是记录具体密码内容。

## 5. 开发验证

Node 录制端：

```powershell
cd recorder
node --check src/recorder/recorder.js
npm run build:bundle
```

Go 翻译端：

```powershell
cd recorder/translate_gui
go test ./...

cd frontend
npm run build
```


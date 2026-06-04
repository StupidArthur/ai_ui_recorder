# 用户手册（重写）— AI UI Recorder（Windows）

更新时间：2026-03-24  

> 本手册面向“直接使用”与“一线排障”。系统设计与原理见：`doc/design.md`；翻译细节见：`doc/translate_design.md`；能力与验收见：`doc/requirements.md`。

---

## 1. 环境要求

- **Node.js**：>= 18
- **操作系统**：Windows 10+
- **网络**：
  - 录制：能访问目标网站即可
  - 翻译：需要能访问 OpenAI 兼容 API（仅影响翻译，不影响录制）

> 若使用 `build:trial` 产出的离线 EXE 包（`release/`），目标机可不安装 Node.js 与 Chrome。

---

## 2. 安装与初始化

在项目根目录执行（PowerShell）：

```powershell
npm install
```

首次使用需安装 Playwright 的 Chromium：

```powershell
npx playwright install chromium
```

### 2.1 试用版离线 EXE 分发（空白 Windows 推荐）

构建：

```powershell
npm run build:trial
```

分发与运行：

1. 将整个 `release/` 目录复制到目标机（不要只复制 `exe`）
2. 确认目录中包含：
   - `ai-ui-recorder-trial.exe`
   - `chrome-win64/`（优先，本地离线 zip 解压）
   - 或 `ms-playwright/`（回退，构建时在线下载）
   - `static/`
   - `config/`（打包已自动生成 `ai.local.json`）
3. 在 `release/` 目录中直接运行 `ai-ui-recorder-trial.exe`

构建提速说明（可选）：

- 若本机已有离线包 `D:\chrome_download\chrome-win64.zip`，`build:trial` 会优先使用，不再在线下载
- 可通过环境变量覆盖路径：

```powershell
$env:LOCAL_CHROME_ZIP = "D:\your\path\chrome-win64.zip"
npm run build:trial
```

### 2.2 Electron 录制启动器 EXE（目标机无需 Node）

构建：

```powershell
npm run build:electron-recorder
```

构建产物：

- `release/electron-recorder-launcher.exe`

使用（目标机可不安装 Node.js）：

```powershell
.\release\electron-recorder-launcher.exe "C:\path\to\your-electron-app.exe"
```

透传 Electron 启动参数（`--` 后参数原样透传）：

```powershell
.\release\electron-recorder-launcher.exe "C:\path\app.exe" -- "--arg1" "--arg2=value"
```

说明：
- 该启动器会拉起目标 Electron EXE 并进入录制流程，输出仍写入 `output/run_*/`。
- 录制范围为 Electron 渲染进程中的 DOM 交互；原生系统控件不在当前采集范围。

### 2.3 独立翻译启动器 EXE（目标机无需 Node）

构建：

```powershell
npm run build:translate-standalone
```

构建产物：

- `release/translate-standalone.exe`

部署约定（关键）：

- 将 `translate-standalone.exe` 放在 `output/` 同级目录
- 将 `ai.local.json` 放在 `translate-standalone.exe` 同级目录

示例结构：

```text
<your_dir>/
  translate-standalone.exe
  ai.local.json
  output/
    run_2026-03-09T12-30-07/
      meta.json
      ...
```

运行：

```powershell
.\translate-standalone.exe
```

默认行为：

- 自动翻译 `output/` 下最新的 `run_*` 目录

指定目录（命令行参数传 run 目录名）：

```powershell
.\translate-standalone.exe run_2026-03-09T12-30-07
```

---

## 3. 配置说明（最常改的两处）

### 3.1 配置录制目标 URL

命令行录制时，编辑 `src/utils/config.js`：

```js
export const TARGET_URL = 'http://your-target-website.com';
```

> 使用 Dashboard 录制时，可在 UI 内直接填写 URL，优先生效。

### 3.2 配置浏览器窗口/视口模式（解决底部内容缺失）

编辑 `src/utils/config.js`：

- `USE_NATIVE_WINDOW_VIEWPORT=true`（默认，推荐）  
  使用原生窗口可视区（`context.viewport=null`），避免地址栏/标签栏占高导致底部内容被裁切。
- `USE_NATIVE_WINDOW_VIEWPORT=false`  
  切换为固定 viewport 模式，使用 `VIEWPORT_WIDTH/VIEWPORT_HEIGHT`。

### 3.3 配置 AI（仅翻译需要）

推荐使用本地配置文件：

1. 复制模板：`config/ai.local.example.json` → `config/ai.local.json`
2. 填写字段：
   - `baseUrl`
   - `apiKey`
   - `model`

运行时查找顺序：

1. `运行目录/config/ai.local.json`
2. `可执行文件目录/config/ai.local.json`
3. 环境变量 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（兜底）

> 录制阶段不依赖 AI；只有翻译阶段依赖可用的 OpenAI 兼容接口。

## 4. 使用方式一：Dashboard（与命令行同等支持）

### 4.1 启动 Dashboard

```powershell
npm run dashboard
```

访问 `http://localhost:3000`。

### 4.2 开始录制

1. 在页面中填写目标 URL（可覆盖 `TARGET_URL`）
2. 点击“开始录制”
3. 在弹出的 Chromium 浏览器中进行真实操作（点击/按键/右键/双击等）

### 4.3 停止录制（推荐）

- **推荐**：关闭 Chromium 浏览器窗口（系统会自动收尾并退出）
- **备选**：在启动 Dashboard 的终端按 Ctrl+C（不建议作为常规方式）

### 4.3.1 何时开始操作（避免 totalActions=0）

浏览器弹出后，请等到 **`recorder.log` 中出现**「**初始快照已保存**」以及「**录制就绪诊断(主框架)**」且 `__recordAction=true` **之后**再点击页面。  
在此之前若已点击，可能因尚未开始接受 action 而被丢弃（启动阶段与快照拍摄存在极短窗口）。

### 4.4 启动 AI 翻译

在 Dashboard 中点击“AI 翻译”：

- 默认会翻译最近一次录制
- 翻译产物会写入对应 run 目录

### 4.5 查看结果与证据链文件

在 Dashboard 中可查看：

- `meta.json`（录制摘要与索引）
- `step_2_structured_steps.json`（Phase 1：结构化步骤主文件）
- `step_2_structured_steps.errors.json`（Phase 1：JSON 修复/兜底记录）
- `AI_cases.md`（Phase 2：归纳后的用例表格）
- `case_4_agents.txt`（Phase 4：Agent 文本用例）
- `preprocessed/`（预处理过程证据：diff/enriched/merge_report）
- `recorder.log` / `generate.log` / `preprocess.log`（日志）

---

## 5. 使用方式二：命令行（与 Dashboard 并列同等推荐）

### 5.1 录制

确保已配置 `TARGET_URL`（见 3.1），然后执行：

```powershell
npm run record
```

录制开始后：

- Chromium 自动打开并导航到目标 URL
- 你在浏览器中进行操作
- **关闭浏览器窗口**即可停止并完成收尾

> Recorder 使用“完美快照模型 v2”：轮询 AX 快照 + 同步捕获 `formStateDelta`，并按 `N action → N+1 snapshot` 的约定落盘。

### 5.2 翻译（生成测试用例）

确保已配置 AI（见 3.2），然后执行：

```powershell
npm run translate
```

默认行为：

- 自动查找 `output/` 下最新的 `run_*` 目录里的 `meta.json`
- 先做预处理，产出 `preprocessed/`
- 再执行 AI 翻译流水线：
  - Phase 1：生成 `step_2_structured_steps.json`
  - Phase 2：生成 `AI_cases.md`（按固定窗口多次归纳后合并；窗口大小等见 `src/utils/config.js` 中 `PHASE2_*`）
  - Phase 4：生成 `case_4_agents.txt`

独立入口（无需 Node 的 EXE 对应源码入口）：

```powershell
npm run translate:standalone
npm run translate:standalone -- run_2026-03-09T12-30-07
```

### 5.2.1 录制 Electron 打包 EXE（命令行传路径）

当你要录制 Electron 应用（而非普通网页 URL）时，执行：

```powershell
node src/recorder/electron-cli.js "C:\path\to\your-electron-app.exe"
```

或使用 npm 脚本：

```powershell
npm run record:electron -- "C:\path\to\your-electron-app.exe"
```

若需要给 Electron 应用透传启动参数（`--` 后面的参数会原样透传）：

```powershell
node src/recorder/electron-cli.js "C:\path\app.exe" -- "--arg1" "--arg2=value"
```

说明：
- 该模式录制的是 Electron 渲染进程中的 DOM 交互。
- 原生系统菜单、非 DOM 原生控件不在当前录制范围内。

### 5.3 失败容错与重跑（重要）

如果 Phase 1 某条操作模型输出非严格 JSON：

- 工作流会自动尝试修复
- 修复失败会自动写入兜底结构化步骤，不会阻塞后续流程
- 详细记录见 `step_2_structured_steps.errors.json`

若你希望“从头重新生成”：

- 删除对应 run 目录下以下文件后再运行：
  - `step_2_structured_steps.json`
  - `step_2_structured_steps.errors.json`
  - `AI_cases.md`
  - `case_4_agents.txt`

---

## 6. 输出目录与文件说明（你应该会读这些）

每次录制在 `output/` 下生成一个 `run_时间戳/`：

```
output/
  run_2026-02-15T06-08-43/
    meta.json
    recorder.log
    snapshots/
      snapshot_000.txt
      snapshot_001.txt
      ...
    actions/
      action_001.json
      action_002.json
      ...
    preprocessed/
      merged/merge_report.json
      diffs/diff_001.txt ...
      enriched/enriched_001.json ...
    step_2_structured_steps.json
    step_2_structured_steps.errors.json
    AI_cases.md
    case_4_agents.txt
    generate.log
```

关键命名约定（排障必用）：

- `action_N`: pre=`snapshot_{N-1}`，post=`snapshot_{N}`
- `diff_N`: `snapshot_{N-1} → snapshot_{N}`
- `N action → N+1 snapshot`，且 `post(N) === pre(N+1)`（零冗余）

---

## 7. 常见问题（FAQ）与排障

### 7.1 浏览器启动失败 / 页面打不开

- 确认已安装 Chromium：`npx playwright install chromium`
- 检查网络能否访问目标 URL
- 如导航超时，可在 `src/utils/config.js` 调大：
  - `NAVIGATION_TIMEOUT`
  - `LAUNCH_TIMEOUT`

### 7.2 没有捕获到任何操作（meta.json 的 totalActions=0）

按顺序排查：

1. 是否使用了正确入口（推荐 `npm run record` / `npm run dashboard`）
2. 查看 `recorder.log` 是否有 “事件捕获脚本已注入”
3. 查看 `actions/` 是否有 `action_*.json` 文件生成
4. **是否实际产生了可录制动作**：当前仅采集 **点击 / 双击 / 右键 / Enter 键**；纯 Tab 换焦、仅输入文字且不按 Enter，不会产生 `action_*.json`
5. **SPA 路由跳转后**：若日志出现「页面导航后脚本丢失，重新注入」，请等待页面加载稳定后再操作；录制器会对主页面及**可访问的子 iframe** 尝试补注入（见 `RECORDER_POST_NAV_INJECT_CHECK_DELAY_MS`）
6. **跨域 iframe**：若页面控制台出现 `[Recorder] __recordAction 不可用`，该次交互无法回传到录制器（浏览器同源策略限制）

### 7.3 AI 翻译失败

1. 检查 `config/ai.local.json` 的 `baseUrl/apiKey/model` 是否正确
2. 确认 AI 服务可访问（网络/权限/配额）
3. 看 `generate.log` 获取错误栈与失败位置

### 7.4 AI 输出质量不理想（最常见）

强烈建议按证据链自底向上排查：

1. `snapshots/`：AX 快照是否能读到关键控件语义？
2. `preprocessed/diffs/`：diff 是否正确反映变化？
3. `preprocessed/enriched/`：
   - `contextExcerpt` 是否把目标区域定位出来？
   - `formStateChangeText` 是否准确？
   - `classification.hints` 是否合理？
4. `step_2_structured_steps.json`：`basis` 是否引用了有效证据，`description/uiChange` 是否可执行

### 7.6 Dashboard 端口 3000 被占用

修改 `src/dashboard/server.js` 中的 `DASHBOARD_PORT` 常量，或关闭占用该端口的进程。

---

designed by @yuzechao


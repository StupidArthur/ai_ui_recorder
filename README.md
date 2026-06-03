# AI UI Recorder（证据驱动的 UI 操作录制与中文测试用例生成）

> 在真实 Chromium 浏览器中录制你的每一步操作，把它转换为**可追溯、可解释的证据链**（pre/post 快照 + diff + 表单增量 + 上下文），再由 AI 生成高质量的中文手工测试用例。

## 你能得到什么

- **无侵入录制**：无需插件/无需改造被测系统，在真实浏览器里手工操作即可。
- **完美快照模型 v2**：后台轮询 AX 快照（Accessibility Tree）+ 同步捕获 `formStateDelta`，让每条操作都回答“操作前是什么样 / 操作后变成什么样”。
- **零冗余、强可调试**：`N` 个操作对应 `N+1` 个快照；任意一步都能定位到证据文件（快照/差异/富化数据）。
- **预处理为 LLM 准备最优输入**：语义归并（click→input、双击去重、密码脱敏、噪声过滤）+ diff + 上下文片段 + 分类 hints。
- **AI 两阶段流水线**：Phase 1 逐条分析并增量写盘（可中断恢复）→ Phase 2 归纳 Case 输出用例表格。
- **Dashboard 一站式**：录制/翻译/实时日志/结果查阅全在 Web UI 完成。

## 快速开始（Windows / PowerShell）

### 1) 安装

```powershell
npm install
npx playwright install chromium
```

### 2) 启动 Dashboard（推荐）

```powershell
npm run dashboard
```

访问 `http://localhost:3000`，你可以：

- 配置目标 URL → **开始录制** → 在浏览器中操作 → **关闭浏览器窗口停止**
- 一键 **AI 翻译**
- 实时查看日志、浏览输出文件（`meta.json` / `AI_steps.md` / `AI_cases.md` 等）

### 3) 命令行方式（备选）

- **录制**：修改 `src/utils/config.js` 的 `TARGET_URL`，然后运行：

```powershell
npm run record
```

- **AI 翻译**：先配置 AI API（见下一节），再运行：

```powershell
npm run translate
```

### 4) 试用版 EXE 构建（Windows）

```powershell
npm install
npm run build:trial
```

构建产物：

- `release/ai-ui-recorder-trial.exe`
- `release/chrome-win64/`（优先：本地离线包 `D:\chrome_download\chrome-win64.zip` 解压得到）
- 或 `release/ms-playwright/`（回退：构建时在线下载）

说明：

- EXE 默认按 `dashboard` 模式启动（可用环境变量 `APP_MODE` 切到 `record` / `translate`）
- 试用分发请**整个 `release/` 目录一起拷贝**（不是只拷贝 EXE）
- 打包时优先使用本地 `D:\chrome_download\chrome-win64.zip`（可用环境变量 `LOCAL_CHROME_ZIP` 覆盖）
- 目标机无需预装 Node.js / Chrome；`release/chrome-win64` 或 `release/ms-playwright` 任一存在即可
- 打包时会自动生成 `release/config/ai.local.json`（trial 默认配置），可按需手动修改

## AI 配置（仅翻译需要）

创建本地配置文件（推荐）：

1. 复制模板：`config/ai.local.example.json` → `config/ai.local.json`
2. 填写以下字段：
   - `baseUrl`
   - `apiKey`
   - `model`

运行时查找顺序（兼容开发 + EXE）：

1. `运行目录/config/ai.local.json`
2. `可执行文件目录/config/ai.local.json`
3. 环境变量 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（兜底）

> `config/ai.local.json` 已加入 `.gitignore`，不会进入代码仓库。  
> 录制功能不依赖 AI；只有生成 `AI_steps.md` / `AI_cases.md` 时才需要可用的 OpenAI 兼容 API。

## Go 试用中转工具（可选）

为“试用用户没有模型账号”的场景，仓库内提供独立中转工具：

- 目录：`tool/ai-proxy-go`
- 能力：`/v1/chat/completions` 转发 + 内嵌流式问答验证页（`/`）
- 管控：总开关、trial key 白名单、key+IP 限流

快速使用（PowerShell）：

```powershell
cd tool/ai-proxy-go
Copy-Item config/proxy.local.example.json config/proxy.local.json
go run ./cmd/server
```

主工程接入时，将 `config/ai.local.json` 的 `baseUrl` 指向：

- `http://127.0.0.1:8787/v1`

## 产物与目录结构（每次录制一个 run 目录）

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
    AI_steps.md
    AI_cases.md
    generate.log
```

关键命名约定（系统可解释性的根基）：

- `action_N`: `preSnapshot = snapshot_{N-1}`，`postSnapshot = snapshot_{N}`
- `diff_N`: `snapshot_{N-1} → snapshot_{N}`
- 相邻操作共享中间快照：`post(N) === pre(N+1)`（零冗余）

## 文档入口（建议从这里读）

- **需求文档**：`doc/requirements.md`
- **系统总设计（推荐）**：`doc/design.md`
- **翻译子系统专篇**：`doc/translate_design.md`
- **部署与运行手册**：`doc/user_manual.md`
- **交互记录**：`doc/interaction_record.md`
- **路线图 / 待办清单**：`doc/todo_list.md`
- **快照时机设计（方案演进与取舍）**：`doc/snapshot_timing_design.md`

## 已知限制（当前阶段）

- **AI 依赖外部服务**：需要可用的 OpenAI 兼容 API（不影响录制，仅影响翻译）
- **AX 语义质量取决于被测系统**：ARIA 标注差会降低“理解上限”，系统会更保守输出
- **被动变化 / hover / drag**：目前未实现（见 `doc/design.md` 的路线图）

<p align="right"><sub>designed by @yuzechao</sub></p>

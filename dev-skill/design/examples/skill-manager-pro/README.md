# 案例：skill-manager-pro

本案例是 [轻量化高颜值桌面工具开发方法论](../../SKILL.md) 的标准实现样板。一个用于管理多 AI 编码助手（Claude Code / Codex / OpenCode / MiMo Code）全局 skill 的桌面工具。

> 案例项目源码位于仓库同级目录 `skill-manager-pro/`，本文件不复制代码，只做**结构映射**与**关键文件指引**，便于对照方法论各章节学习。

## 成果指标

| 指标 | 实测 | 红线 | 结论 |
|------|------|------|------|
| exe 体积 | 11.16 MB | ≤ 15 MB | 达标 |
| 前端打包 | ~1.5 MB（dist） | ≤ 2 MB | 达标 |
| 后端测试 | 14 项通过 | 核心逻辑必有测试 | 达标 |
| 技术栈 | Wails v2 + Go + React 18 + TS + Shadcn UI | 不可偏离 | 达标 |
| 设计风格 | Notion 式浅色简约 | 不可偏离 | 达标 |

## 目录结构与章节映射

```
skill-manager-pro/
├── main.go                 ← [后端架构] 窗口配置 1180×780，白色背景
├── app.go                  ← [后端架构] App struct + Wails 绑定方法
├── agents.go               ← [后端架构] 四个 agent 路径定义
├── skillManager.go         ← [后端架构] 核心业务逻辑（可独立测试）
├── skillManager_test.go    ← [工程质量] 单元测试，t.TempDir() 隔离
├── go.mod / go.sum
└── frontend/
    ├── src/
    │   ├── App.tsx                 ← [前端架构] 顶层组合 + 状态上提
    │   ├── main.tsx                ← [前端架构] ToastProvider 包裹入口
    │   ├── style.css               ← [设计规范] 全局 Token + 字体栈
    │   ├── components/
    │   │   ├── ui/                 ← [前端组件] Shadcn 组件（复制进项目）
    │   │   │   ├── button.tsx
    │   │   │   ├── card.tsx
    │   │   │   ├── dialog.tsx
    │   │   │   ├── alert-dialog.tsx
    │   │   │   ├── badge.tsx
    │   │   │   ├── scroll-area.tsx
    │   │   │   ├── separator.tsx
    │   │   │   └── tooltip.tsx
    │   │   ├── Sidebar.tsx         ← [前端组件] 模式2：侧边栏导航
    │   │   ├── SkillCard.tsx       ← [前端组件] 列表卡片 + hover 三件套
    │   │   ├── SkillDetailDialog.tsx ← [前端组件] 模式1：列表+详情弹窗
    │   │   └── Toast.tsx           ← [组件片段] 自建轻量 Toast
    │   └── lib/
    │       ├── api.ts              ← [前端架构] API 封装层
    │       └── utils.ts            ← [前端架构] cn() 等工具
    ├── tailwind.config.js          ← [设计规范] CSS 变量映射
    ├── components.json             ← [前端组件] Shadcn 配置
    └── vite.config.ts              ← [前端架构] @/* 路径别名
```

## 关键文件指引

### 后端

- **[skillManager.go](../../../skill-manager-pro/skillManager.go)** — 核心业务逻辑：列出 / 安装 / 卸载 / 导出 skill。纯函数 + 路径参数，不依赖 Wails runtime，因此可独立单测。对照 [后端架构模式](../../backend-patterns.md) 的"业务逻辑与绑定分离"。
- **[app.go](../../../skill-manager-pro/app.go)** — Wails 绑定层：把 skillManager 的能力包装成前端可调方法，处理跨平台（`explorer` / `open` 分支）和文件选择对话框。对照 [后端架构模式](../../backend-patterns.md) 的"App struct 暴露方法"。
- **[main.go](../../../skill-manager-pro/main.go)** — 窗口配置：1180×780、白色背景、无默认菜单。对照 [后端架构模式](../../backend-patterns.md) 的 main.go 模板。
- **[skillManager_test.go](../../../skill-manager-pro/skillManager_test.go)** — 14 项单元测试，全部用 `t.TempDir()` 隔离文件系统。对照 [工程质量标准](../../quality-standards.md) 的测试规范。

### 前端

- **[App.tsx](../../../skill-manager-pro/frontend/src/App.tsx)** — 顶层组合：`ToastProvider` 包裹、状态上提、三态渲染（未就绪/加载/空/列表）。对照 [前端架构模式](../../frontend-patterns.md) 和 [组件片段 §7](../component-snippets.md#7-顶层-app-组合骨架)。
- **[lib/api.ts](../../../skill-manager-pro/frontend/src/lib/api.ts)** — API 收口层：组件只依赖 `api` 对象，不直接 import wailsjs。对照 [组件片段 §6](../component-snippets.md#6-api-封装层)。
- **[components/Toast.tsx](../../../skill-manager-pro/frontend/src/components/Toast.tsx)** — 36 行自建 Toast，Context + Provider + hook 三件套。对照 [组件片段 §1](../component-snippets.md#1-toast-通知自建轻量版)。
- **[components/SkillCard.tsx](../../../skill-manager-pro/frontend/src/components/SkillCard.tsx)** — 列表卡片，hover 三件套（边框变色 + 阴影 + 微上移）。对照 [组件片段 §5](../component-snippets.md#5-列表卡片可点击)。
- **[components/SkillDetailDialog.tsx](../../../skill-manager-pro/frontend/src/components/SkillDetailDialog.tsx)** — 详情弹窗：ScrollArea 包裹长内容 + 底部操作栏 `border-t` 分隔。对照 [前端组件使用方法](../../frontend-components.md#dialog-弹窗规范)。
- **[style.css](../../../skill-manager-pro/frontend/src/style.css)** — 全局 Token 定义（HSL CSS 变量）+ 系统原生字体栈。对照 [设计规范](../../design-system.md)。

## 方法论验证点

本案例验证了方法论的核心命题：

1. **体积命题**：Wails 借系统 WebView2，11.16MB 即可承载完整 React + Shadcn 界面，远低于 Electron 同类方案的 97MB。
2. **可测命题**：skillManager.go 不依赖 Wails runtime，14 项测试纯 Go 跑通，证明"业务逻辑与绑定分离"可行。
3. **标准化命题**：前端从零到可用，全部组件来自固定清单（[前端组件使用方法](../../frontend-components.md)），无临时造轮子。
4. **设计命题**：暖灰底 + 深炭灰文字 + 单色强调的 Token 体系，通过 CSS 变量全局联动，换强调色只改一个变量。

## 已知问题（供后续工具借鉴）

- **WebView2 多实例冲突**：同时跑多个 Wails 应用可能抢同一 user data 目录，报 `8000ffff`。生产构建单实例运行无此问题，开发期 `wails dev` 避免多开。处理方式见 [工程质量标准](../../quality-standards.md#常见问题)。

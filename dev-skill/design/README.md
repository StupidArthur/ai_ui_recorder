# 开发技术路线选型

本技能是**技术选型顾问 + 开发规范库**。当用户要开发桌面 GUI 工具、B/S 网站、CLI 工具时调用。先判断开发类型，必要时引导 Go/Python 选型，再路由到对应技术栈与规范。

## 子目录职责总览

| 子目录 | 管什么 | 何时去看 |
|--------|--------|----------|
| [shared/](shared/) | 共享前端层（GUI + B/S 通用：React + Shadcn + Notion 风） | 带界面的场景都要先看 |
| [gui-tool/](gui-tool/) | 桌面 GUI 工具（固定 Wails + Go） | 开发桌面应用时 |
| [bs-web/](bs-web/) | B/S 网站后端（Go / Python 选型） | 开发 Web 应用时 |
| [cli-tool/](cli-tool/) | CLI 工具（Go / Python 选型） | 开发命令行工具时 |
| [examples/](examples/) | 完整案例参考 | 需要样板实现时 |

## 第一步：判断开发类型

收到开发需求时，先确认用户要开发什么：

| 类型 | 特征 | 前端 | 后端选型 |
|------|------|------|---------|
| 桌面 GUI 工具 | 带界面的桌面应用 | Wails 内嵌 | 固定 Go |
| B/S 网站 | 前后端分离的 Web 应用 | 独立部署 | Go 或 Python |
| CLI 工具 | 命令行，无界面 | 无 | Go 或 Python |

## 第二步：选型决策树

```
用户要开发什么？
├─ 桌面 GUI 工具
│   → 固定 Wails + Go + 共享前端（无选型，轻量好看的前端只有这条路）
│   → 见 gui-tool/
├─ CLI 工具（Go or Python？）
│   ├─ Go：单文件分发、无依赖、并发/运维 → cli-tool/go.md
│   └─ Python：AI/数据、快速脚本 → cli-tool/python.md
└─ B/S 网站（前端用共享层，后端 Go or Python？）
    ├─ Go：高并发、单二进制 → bs-web/go-backend.md
    └─ Python：FastAPI、AI集成、自动文档 → bs-web/python-backend.md
```

CLI 和 B/S 后端需要与用户沟通 Go 还是 Python，选型维度见各场景的 stack.md。

## 共享前端层（GUI + B/S 通用）

带界面的场景（GUI 工具、B/S 网站）共用同一套前端规范：

- [共享前端技术栈](shared/frontend-stack.md) — React 18 + TS + Shadcn UI + Tailwind v3 + Vite
- [设计规范](shared/design-system.md) — Notion 式浅色简约 Token 体系
- [前端组件使用方法](shared/frontend-components.md) — 组件清单、用法、组合模式
- [前端架构模式](shared/frontend-patterns.md) — 分层、状态管理、API 封装原则
- [组件代码片段](shared/component-snippets.md) — 即用组件实现

## 场景层

### 桌面 GUI 工具（固定 Wails + Go）
- [GUI 技术栈](gui-tool/stack.md) — Wails v2 + Go，禁用项，环境要求
- [Wails 后端模式](gui-tool/wails-backend.md) — Go 分层、绑定、测试、前端衔接
- [GUI 质量标准](gui-tool/quality.md) — 体积红线 ≤15MB、构建、交付清单

### CLI 工具（Go 或 Python）
- [CLI 选型](cli-tool/stack.md) — Go vs Python 维度对比
- [Go CLI](cli-tool/go.md) — cobra 技术栈
- [Python CLI](cli-tool/python.md) — typer + httpx + pyinstaller

### B/S 网站（前端共享层 + 后端 Go 或 Python）
- [B/S 选型](bs-web/stack.md) — 后端 Go vs Python + 前端 fetch 封装
- [Go 后端](bs-web/go-backend.md) — gin 技术栈
- [Python 后端](bs-web/python-backend.md) — FastAPI + httpx

## 案例参考
- [完整案例：skill-manager-pro](examples/skill-manager-pro/) — GUI 工具的标准实现样板

## 核心原则
1. **选型先行**：先判断类型、引导选型，再写代码
2. **前端共享**：带界面场景共用一套 React + Shadcn + Notion 规范
3. **后端分层**：业务逻辑与框架解耦，可独立测试
4. **质量达标**：GUI 体积 ≤15MB；测试纪律遵循 [dev-discipline](../dev-discipline/testing.md)

## 强制约束
此技能为强制标准。一旦用户选择调用本技能：
- 技术栈不可偏离各场景规定（GUI 必须 Wails+Go；前端必须 React+Shadcn+Notion 风）
- CLI / B-S 后端的 Go/Python 选型须与用户沟通确认，不擅自决定
- GUI 工具体积不可超红线（≤15MB）
- 测试纪律遵循 [测试纪律](../testing.md)，本技能只提供各技术栈的测试工具与运行命令

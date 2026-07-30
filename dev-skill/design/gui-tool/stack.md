# GUI 工具技术栈

桌面 GUI 工具的固定技术栈：**Wails v2 + Go**，前端复用 [共享前端栈](../shared/frontend-stack.md)。

## 固定技术栈

| 层 | 技术 | 版本要求 | 作用 |
|----|------|---------|------|
| 桌面壳 | **Wails v2** | ≥ v2.10 | 借用系统 WebView，不自带浏览器 |
| 后端语言 | **Go** | ≥ 1.21 | 编译型，单二进制，并发强 |
| 前端 | 见共享前端栈 | — | React + Shadcn |

## 为什么 GUI 工具固定 Go（无选型）

GUI 工具要"轻量 + 高颜值"，Wails 是当前唯一同时满足这两点的方案，而 Wails 要求后端用 Go。因此 GUI 场景**没有 Go/Python 选型**，固定 Go。

### 为什么是 Wails 而不是 Electron
- Wails 借用系统 WebView2，打包 ~11MB；Electron 自带 Chromium，打包 ~97MB
- 同样的 Web 前端，Wails 体积是 Electron 的 1/9
- Wails 自动生成 Go-JS 绑定，无需手写 IPC

### 为什么是 Go 而不是 Node/Python
- Go 静态编译，产物是独立二进制，无解释器包袱
- Go 并发模型（goroutine）适合未来高并发场景
- Go 编译产物小（运行时 ~8MB），Python 打包 ≥30MB

## 禁止使用的技术

| 技术 | 禁止原因 |
|------|---------|
| Electron | 自带 Chromium，体积 ≥90MB，违反体积优先原则 |
| PyQt / PySide | 体积 ≥80MB，UI 风格老旧，违反轻量+高颜值原则 |
| Tauri | 技术栈正确但需 Rust 工具链，环境搭建成本高，非本技能标准 |
| Tkinter | UI 过于老旧，违反高颜值原则 |
| 原生 Win32 / Cocoa | 开发效率低，跨平台困难 |

## 环境要求

开发环境必须具备：
- Go ≥ 1.21
- Node.js ≥ 18
- GCC（Windows 用 TDM-GCC，macOS 用 Xcode CLT，Linux 用 gcc）
- WebView2 Runtime（Windows 11 自带，Windows 10 多数自带）

验证环境：`wails doctor` 应全部通过。

## 下一步

- 后端分层与 Wails 绑定：[Wails 后端模式](wails-backend.md)
- 质量标准与体积红线：[GUI 质量标准](quality.md)

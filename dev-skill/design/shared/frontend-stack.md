# 共享前端技术栈

本章节定义**所有带界面场景**（桌面 GUI 工具、B/S 网站）共用的前端技术栈。CLI 工具不涉及前端，不引用本章节。

## 固定前端技术栈

| 层 | 技术 | 版本要求 | 作用 |
|----|------|---------|------|
| 前端框架 | **React 18** | ≥ 18.2 | 组件化视图 |
| 类型系统 | **TypeScript** | ≥ 5.0 | 类型安全 |
| UI 组件库 | **Shadcn UI** | 最新 | Notion 风组件，复制即用 |
| 样式引擎 | **Tailwind CSS v3** | ≥ 3.4 | 原子化 CSS |
| 底层原语 | **Radix UI** | 随 Shadcn | 无障碍、键盘交互 |
| 图标 | **lucide-react** | 最新 | 轻量图标库 |
| 构建工具 | **Vite** | ≥ 5.0 | 开发热刷新、生产打包 |

## 选型理由

### 为什么是 React + Shadcn 而不是 Vue/AntD
- React 生态最大，类型安全最好
- Shadcn 组件代码复制进项目，完全可控，契合 Notion 风
- AntD 是企业中后台风，与 Notion 简约风气质相反

### 为什么是 Tailwind 而不是 CSS-in-JS
- 零运行时开销，打包体积小
- 与 Shadcn 组件天然配合（Shadcn 基于 Tailwind）
- CSS 变量驱动主题，换强调色只改一个变量

## 禁止使用的前端技术

| 技术 | 禁止原因 |
|------|---------|
| Ant Design | 企业中后台风，与 Notion 简约风气质相反 |
| Material UI | Google Material 风，与 Notion 气质不符 |
| CSS-in-JS（styled-components 等） | 运行时开销，体积大 |
| jQuery | 与 React 组件化范式冲突 |

## 与场景的关系

无论哪种带界面场景，前端本身的组件、设计、架构规范完全一致：

- **桌面 GUI 工具**：前端打包后由 Wails 内嵌，后端固定 Go，见 [gui-tool/stack.md](../gui-tool/stack.md)
- **B/S 网站**：前端独立部署，后端 Go 或 Python，见 [bs-web/stack.md](../bs-web/stack.md)

配套规范（所有带界面场景通用）：
- [设计规范](design-system.md)
- [前端组件使用方法](frontend-components.md)
- [前端架构模式](frontend-patterns.md)
- [组件代码片段](component-snippets.md)

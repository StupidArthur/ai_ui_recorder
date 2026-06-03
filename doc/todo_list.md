# 待办清单 — 架构重构与管线优化

> 产生背景：基于对"用户行为 vs 软件响应"交互模型的讨论，重构代码架构、快照时机和 AI 翻译管线。
> 详细设计见：`doc/design.md`

---

## 一阶段：架构重构与双快照模型（已完成）

| # | 模块 | 任务 | 状态 |
|---|------|------|------|
| 1 | 目录结构 | 创建 src/utils/、src/recorder/、src/case_translate/ | ✅ 完成 |
| 2 | utils | config.js 精简 + logger.js 迁移 | ✅ 完成 |
| 3 | recorder | snapshot-utils.js 纯函数提取 | ✅ 完成 |
| 4 | recorder | inject-script.js 纯物理动作重写 | ✅ 完成 |
| 5 | recorder | recorder.js 统一 Recorder 类（pre/post 双快照） | ✅ 完成 |
| 6 | recorder | index.js 录制入口 | ✅ 完成 |
| 7 | case_translate | ai-client.js 逐条 evidence API | ✅ 完成 |
| 8 | case_translate | index.js 翻译入口（增量 + 中断恢复） | ✅ 完成 |
| 9 | 清理 | 删除所有旧文件 | ✅ 完成 |
| 10 | 验证 | 模块加载验证 | ✅ 完成 |
| 11 | 文档 | 设计文档、需求文档、用户手册、交互记录更新 | ✅ 完成 |

### 一阶段核心改动

- **录制器合并**：IntentBasedRecorder + SnapshotRecorder → 统一 Recorder 类
- **双快照模型**：周期轮询 + 延迟保存，保证 preSnapshot 干净、postSnapshot 完整
- **纯物理动作**：只保留 click/dblclick/contextmenu/keydown
- **轻量元素信息**：getElementInfo 精简为 10 个核心字段
- **逐条 AI 分析**：每条 action 单独调 AI + 滑动窗口上下文 + 增量保存 + 中断恢复

---

## 二阶段：翻译管线重构（已完成）

| # | 模块 | 任务 | 状态 |
|---|------|------|------|
| 1 | recorder | 移除 diff 计算逻辑，简化 stop 流程 | ✅ 完成 |
| 2 | config | 新增预处理相关配置常量 | ✅ 完成 |
| 3 | preprocessor | 新建 preprocessor/ 子模块（snapshot-diff / snapshot-context / formState-diff / action-classify / index） | ✅ 完成 |
| 4 | prompts | 新建 prompts/ 子模块（step-analysis / case-generation） | ✅ 完成 |
| 5 | ai-client | 退化为纯 SDK 封装（callChat + cleanMarkdownFence） | ✅ 完成 |
| 6 | workflow | 新建 workflow.js（Phase 1 + Phase 2 两阶段编排） | ✅ 完成 |
| 7 | index | 重写为纯入口（查找 meta → 预处理 → 工作流） | ✅ 完成 |
| 8 | 文档 | 设计文档、需求文档、用户手册、README、交互记录全部更新 | ✅ 完成 |

### 二阶段核心改动

- **录制器瘦身**：diff 等预处理从录制器迁移到翻译模块，录制器只采集原始数据
- **预处理器**：独立 preprocessor/ 模块，负责 diff + 上下文提取 + 表单增量 + 操作分类
- **Prompt 模板独立**：prompts/ 子模块，Prompt 与工作流解耦
- **工作流模块**：workflow.js 管理两阶段 AI 调用编排
- **AI 客户端纯化**：ai-client.js 退化为纯 SDK 封装

---

## 三阶段（待实现）

| # | 模块 | 任务 | 状态 |
|---|------|------|------|
| i1 | snapshot-utils.js | 快照智能清洗（空 text 过滤、switch 名称关联、generic 语义提升） | 待开始 |
| i2 | recorder | MutationObserver 页面被动变化检测 | 待开始 |
| i3 | recorder | hover 悬停事件（防抖） | 待开始 |
| i4 | recorder | drag 拖拽事件 | 待开始 |

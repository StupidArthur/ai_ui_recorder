# 设计规范

本技能的设计风格为 **Notion 式浅色简约**，所有工具必须遵循此规范。核心是"克制、留白、内容优先"。

## 设计 Token 体系

所有颜色用 HSL CSS 变量定义在全局样式 `:root`，换主题/换强调色只改变量。

### 完整 Token 定义

```css
:root {
  /* 背景 */
  --background: 40 14% 98%;        /* 暖灰底，不死白 */
  --foreground: 30 9% 20%;         /* 深炭灰文字，不用纯黑 */

  /* 卡片/弹层 */
  --card: 0 0% 100%;               /* 纯白卡片 */
  --card-foreground: 30 9% 20%;
  --popover: 0 0% 100%;
  --popover-foreground: 30 9% 20%;

  /* 主色（强调色，随场景动态变化） */
  --primary: 16 64% 60%;           /* 默认珊瑚橙，可被 JS 动态替换 */
  --primary-foreground: 0 0% 100%;

  /* 次级 */
  --secondary: 40 14% 94%;
  --secondary-foreground: 30 9% 20%;

  /* 弱化文字 */
  --muted: 40 12% 93%;
  --muted-foreground: 30 5% 45%;   /* 次要文字 */

  /* 强调（同 primary） */
  --accent: 16 64% 60%;
  --accent-foreground: 0 0% 100%;

  /* 危险/成功 */
  --destructive: 4 64% 51%;
  --destructive-foreground: 0 0% 100%;

  /* 边框/输入/聚焦环 */
  --border: 40 12% 90%;
  --input: 40 12% 90%;
  --ring: 16 64% 60%;              /* 聚焦环同主色 */

  /* 圆角 */
  --radius: 0.5rem;                /* 8px 基准 */
}
```

### 配色原则

| Token | 值 | 设计意图 |
|-------|-----|---------|
| background | 暖灰 `#f7f6f3` | 带暖调，比冷灰有温度 |
| foreground | 深炭灰 `#37352f` | 不用纯黑，对比柔和 |
| primary | 珊瑚橙 `#d97757` | 默认强调色，可动态替换 |
| border | 浅暖灰 `#e9e8e4` | 极淡，不抢戏 |

### 动态强调色机制

强调色应随上下文动态变化。实现方式：JS 修改 CSS 变量，全局联动。

```typescript
// 切换上下文时，改一个变量，全局联动
document.documentElement.style.setProperty('--primary', accentColor)
document.documentElement.style.setProperty('--ring', accentColor)
document.documentElement.style.setProperty('--accent', accentColor)
```

## 字体规范

### 字体栈（零外部依赖，全用系统字体）

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
             "PingFang SC", "Microsoft YaHei", sans-serif;

/* 等宽（路径、代码） */
font-family: "SF Mono", "JetBrains Mono", "Consolas", monospace;
```

| 平台 | UI 字体 | 等宽字体 |
|------|---------|---------|
| macOS | San Francisco | SF Mono |
| Windows | Segoe UI | Consolas |
| 中文 | 苹方 / 微软雅黑 | — |

**禁止引入外部字体**（Google Fonts 等），保证零网络依赖、零体积开销。

## 质感规范

### 圆角分层

| 用途 | 圆角 | Tailwind 类 |
|------|------|------------|
| 弹窗 | 12px | `rounded-xl` |
| 卡片/容器 | 8px | `rounded-lg` |
| 按钮/输入框 | 6px | `rounded-md` |
| 小标签 | 4px | `rounded-sm` |

### 阴影分层

```css
/* 微浮起（hover） */
--shadow-sm: 0 1px 2px rgba(15, 15, 15, 0.04);

/* 卡片默认 */
--shadow-md: 0 1px 3px rgba(15, 15, 15, 0.06), 0 1px 2px rgba(15, 15, 15, 0.04);

/* 弹窗 */
--shadow-lg: 0 8px 24px rgba(15, 15, 15, 0.1), 0 2px 6px rgba(15, 15, 15, 0.06);
```

阴影一律用 `rgba(15,15,15,...)`，极淡，营造浮起感而不突兀。

### 动效规范

| 场景 | 时长 | 缓动 |
|------|------|------|
| hover 反馈 | 150ms | ease |
| 主题切换 | 250ms | ease |
| 弹窗出现 | 180ms | ease（scale 0.97→1） |
| Toast | 300ms | ease |

所有交互过渡用 `transition-all duration-150` 或 `duration-200`，顺滑但不拖沓。

## 布局规范

### 标准三栏布局

```
┌─────────┬───────────────────────┐
│ 侧边栏   │  顶栏（标题 + 操作）    │
│ 248px   │  ─────────────────    │
│         │  内容区（弹性）         │
└─────────┴───────────────────────┘
```

- 侧边栏固定宽度 248px，`flex-shrink-0`
- 主区域 `flex-1`，`min-w-0` 防溢出
- 内容区可滚动：`overflow-y-auto`

### 间距规范

| 用途 | 值 |
|------|-----|
| 页面内边距 | 28px (`px-7`) |
| 卡片间距 | 14px (`gap-3.5`) |
| 组件内边距 | 16px (`p-4`) |
| 元素间距 | 8-10px (`gap-2 / gap-2.5`) |

## 内容优先原则

1. **UI 不抢戏**：视觉权重永远低于内容
2. **留白**：宁可多留白，不要堆砌信息
3. **克制色彩**：大面积用中性色，强调色只用于关键操作和当前状态
4. **弱化装饰**：不用渐变背景、不用花哨图标、不用强阴影

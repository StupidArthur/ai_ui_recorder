# 前端组件使用方法

本章节定义 Shadcn UI 组件的使用规范。不只是"有哪些组件"，而是"每个组件怎么用、何时用、怎么组合"。

## 组件清单与用途

### 基础组件（每个工具必备）

| 组件 | 用途 | 何时用 | 添加命令 |
|------|------|--------|---------|
| `Button` | 操作按钮 | 所有可点击操作 | `npx shadcn@latest add button` |
| `Card` | 信息卡片容器 | 列表项、信息块 | `npx shadcn@latest add card` |
| `Badge` | 状态标签 | 计数、状态标记 | `npx shadcn@latest add badge` |
| `Input` | 文本输入 | 搜索框、表单 | `npx shadcn@latest add input` |
| `Separator` | 分隔线 | 区块分隔 | `npx shadcn@latest add separator` |

### 反馈组件

| 组件 | 用途 | 何时用 | 添加命令 |
|------|------|--------|---------|
| `Dialog` | 模态弹窗 | 详情查看、表单编辑 | `npx shadcn@latest add dialog` |
| `AlertDialog` | 确认弹窗 | 危险操作前确认 | `npx shadcn@latest add alert-dialog` |
| `Tooltip` | 悬浮提示 | 图标按钮说明 | `npx shadcn@latest add tooltip` |
| `ScrollArea` | 滚动区域 | 长列表、长内容 | `npx shadcn@latest add scroll-area` |

### 进阶组件（按需添加）

| 组件 | 用途 | 何时用 |
|------|------|--------|
| `Tabs` | 标签页切换 | 同区域多视图 |
| `Select` | 下拉选择 | 选项较多时 |
| `Checkbox` | 复选 | 多选设置 |
| `Switch` | 开关 | 布尔设置 |
| `Progress` | 进度条 | 异步操作进度 |
| `DropdownMenu` | 下拉菜单 | 更多操作 |
| `Command` | 命令面板 | ⌘K 搜索（工具类应用强烈推荐） |
| `DataTable` | 数据表格 | 列表数据展示（基于 TanStack Table） |

## 组件使用规范

### Button 按钮规范

```tsx
import { Button } from "@/components/ui/button"
import { RefreshCw, Upload } from "lucide-react"

// 主操作（强调色填充）
<Button size="sm" onClick={handleInstall}>
  <Upload className="w-4 h-4 mr-1.5" /> 安装 ZIP
</Button>

// 次操作（描边）
<Button variant="outline" size="sm" onClick={handleRefresh}>
  <RefreshCw className="w-4 h-4 mr-1.5" /> 刷新
</Button>

// 危险操作（红色）
<Button variant="destructive" size="sm" onClick={handleDelete}>
  <Trash2 className="w-4 h-4 mr-1.5" /> 卸载
</Button>
```

**规范**：
- 主操作用默认 variant（primary 填充）
- 次操作用 `variant="outline"`
- 危险操作用 `variant="destructive"`
- 图标统一用 `lucide-react`，尺寸 `w-4 h-4`，与文字间距 `mr-1.5`
- 工具栏按钮统一 `size="sm"`

### Card 卡片规范

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"

// 列表项卡片（可点击）
<div
  onClick={handleClick}
  className="bg-card border border-border rounded-lg p-4 cursor-pointer transition-all duration-200 hover:border-[hsl(var(--ring))] hover:shadow-md hover:-translate-y-px"
>
  <div className="text-[14.5px] font-semibold">{title}</div>
  <div className="text-[12.5px] text-muted-foreground line-clamp-3">{description}</div>
  <div className="flex justify-between text-[11.5px] text-muted-foreground/70 pt-2 border-t border-border">
    <span className="font-mono">{meta1}</span>
    <span>{meta2}</span>
  </div>
</div>
```

**规范**：
- 可点击卡片用 div + hover 效果（不用 Card 组件包裹，更灵活）
- hover 三件套：`hover:border-[hsl(var(--ring))]` + `hover:shadow-md` + `hover:-translate-y-px`
- 卡片底部用 `border-t` 分隔元信息
- 长文本用 `line-clamp-3` 截断

### Dialog 弹窗规范

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
  <DialogContent className="max-w-[620px] max-h-[84vh] flex flex-col">
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
    {/* 内容区用 ScrollArea 包裹 */}
    <ScrollArea className="flex-1 max-h-[52vh] pr-2">
      {/* 详情内容 */}
    </ScrollArea>
    {/* 底部操作栏 */}
    <div className="flex items-center gap-2 pt-4 border-t border-border">
      <Button variant="outline" size="sm">次要操作</Button>
      <div className="flex-1" />
      <Button variant="destructive" size="sm">危险操作</Button>
    </div>
  </DialogContent>
</Dialog>
```

**规范**：
- 弹窗内容超长时，内容区用 `ScrollArea` 包裹，设 `max-h-[52vh]`
- 底部操作栏用 `border-t` 分隔，左侧放次要操作，`flex-1` 撑开，右侧放主/危险操作
- 关闭逻辑：`onOpenChange={(o) => !o && onClose()}`

### AlertDialog 确认弹窗规范

```tsx
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"

<AlertDialog open={open} onOpenChange={setOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>确认卸载</AlertDialogTitle>
      <AlertDialogDescription>
        确定要卸载「{name}」吗？此操作不可撤销。
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction onClick={handleConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
        确认卸载
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**规范**：
- 危险确认用 AlertDialog（比原生 confirm 更美观一致）
- 确认按钮若是危险操作，覆盖样式为 destructive 色

### Toast 通知规范

```tsx
// 自建轻量 Toast（见 examples/component-snippets.md）
const toast = useToast()
toast('操作成功', 'success')
toast('出错了', 'error')
toast('提示信息', 'info')
```

**规范**：
- 成功用绿色 `#2f9e6f`，错误用红色 `#d44333`，信息用深炭灰 `#37352f`
- 3.2 秒自动消失
- 固定底部居中

## 组合模式

### 模式 1：列表 + 详情弹窗

最常用的工具模式：左侧/网格展示列表，点击弹出详情。

```
网格卡片列表 ──click──▶ Dialog 详情弹窗
                          ├─ 头部：标题 + 描述
                          ├─ 内容：ScrollArea 滚动
                          └─ 底部：操作按钮栏
```

### 模式 2：侧边栏导航 + 主内容区

```
Sidebar（固定 248px）──select──▶ 主内容区（弹性）
  ├─ 导航项列表                    ├─ 顶栏（标题 + 操作按钮）
  └─ 底部状态信息                  └─ 内容（列表/表单/空状态）
```

### 模式 3：空状态处理

任何列表都要处理三种空状态：

```tsx
{!ready ? (
  <EmptyState icon="◆" title="欢迎使用" desc="选择一个项目开始" />
) : loading ? (
  <div className="text-center py-16 text-muted-foreground">加载中…</div>
) : list.length === 0 ? (
  <EmptyState icon="∅" title="暂无数据" desc="点击添加按钮创建" />
) : (
  <div className="grid">{/* 列表 */}</div>
)}
```

## 图标使用规范

- 统一用 `lucide-react`，不混用其他图标库
- 图标尺寸：按钮内 `w-4 h-4`，标题旁 `w-5 h-5`
- 图标与文字间距：`mr-1.5`（按钮内）或 `mr-2`（标题旁）
- 图标在文字左侧

```tsx
import { Upload, RefreshCw, Trash2, FolderOpen, Download } from "lucide-react"
```

## 响应式网格

列表用自适应网格，最小列宽 280px：

```tsx
<div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
  {items.map(item => <Card key={item.id} />)}
</div>
```

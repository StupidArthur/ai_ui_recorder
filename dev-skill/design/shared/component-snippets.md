# 组件代码片段

本文件提供常用组件的**完整即用实现**，可直接复制到新应用中。与 [前端组件使用方法](frontend-components.md) 互补：那里讲"怎么用、何时用"，这里给"完整代码怎么写"。

本文件只收录**跨场景通用的纯前端片段**（GUI 工具和 B/S 网站都能用）。涉及后端衔接的片段（API 封装层、顶层 App 骨架）因场景而异，见各场景文档。

所有片段遵循 [设计规范](design-system.md) 的 Token 体系，颜色一律用 CSS 变量，不写死色值（Toast 语义色除外）。

---

## 1. Toast 通知（自建轻量版）

Shadcn 官方 Toast 依赖较重，轻量应用用这个 36 行的 Context 版本即可。被 [前端组件使用方法](frontend-components.md#toast-通知规范) 引用。

```tsx
// src/components/Toast.tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

type ToastType = 'info' | 'success' | 'error'
interface ToastState { message: string; type: ToastType; visible: boolean }

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'info', visible: false })

  const show = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type, visible: true })
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3200)
  }, [])

  // 语义色：成功绿 / 错误红 / 信息深炭灰
  const bg = toast.type === 'success' ? 'bg-[#2f9e6f]'
    : toast.type === 'error' ? 'bg-[#d44333]'
    : 'bg-[#37352f]'

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-lg text-white text-[13px] shadow-lg transition-all duration-300 z-[200] max-w-[80vw] break-words ${bg} ${toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5 pointer-events-none'}`}>
        {toast.message}
      </div>
    </ToastContext.Provider>
  )
}
```

**接入方式**：在 `main.tsx` 用 `ToastProvider` 包裹 `<App />`，任意子组件 `const toast = useToast()` 后调用 `toast('消息', 'success')`。

---

## 2. EmptyState 空状态

列表三态（未就绪 / 加载中 / 空）的统一空状态组件。

```tsx
// src/components/EmptyState.tsx
export function EmptyState({ icon, title, desc }: { icon: string; title: string; desc?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-[40px] leading-none mb-3 text-muted-foreground/40">{icon}</div>
      <div className="text-[15px] font-semibold text-muted-foreground">{title}</div>
      {desc && <div className="text-[12.5px] text-muted-foreground/60 mt-1">{desc}</div>}
    </div>
  )
}
```

**使用**：

```tsx
{!ready ? (
  <EmptyState icon="◆" title="欢迎使用" desc="从左侧选择一个分类开始" />
) : loading ? (
  <div className="text-center py-16 text-[13px] text-muted-foreground">加载中…</div>
) : list.length === 0 ? (
  <EmptyState icon="∅" title="暂无数据" desc="点击右上角按钮添加" />
) : (
  <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
    {list.map(item => <Card key={item.id} />)}
  </div>
)}
```

---

## 3. ConfirmDialog 危险确认封装

把 AlertDialog 封成一行调用的确认弹窗，避免每次写一堆样板。

```tsx
// src/components/ConfirmDialog.tsx
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  desc: string
  confirmText?: string
  onConfirm: () => void
}

export function ConfirmDialog({ open, onOpenChange, title, desc, confirmText = '确认', onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

**使用**：

```tsx
<ConfirmDialog
  open={confirmOpen}
  onOpenChange={setConfirmOpen}
  title="确认卸载"
  desc={`确定要卸载「${name}」吗？此操作不可撤销。`}
  confirmText="确认卸载"
  onConfirm={handleUninstall}
/>
```

---

## 4. Sidebar 侧边栏导航项

侧边栏导航项的统一样式，含选中态、计数 Badge。

```tsx
// 侧边栏导航项片段
import { Badge } from '@/components/ui/badge'

function NavItem({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[13.5px] transition-colors text-left ${
        active ? 'bg-[hsl(var(--accent))] text-foreground font-medium' : 'text-muted-foreground hover:bg-[hsl(var(--accent))]/60 hover:text-foreground'
      }`}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="ml-2 h-5 min-w-[20px] px-1.5 text-[11px]">{count}</Badge>
      )}
    </button>
  )
}
```

**规范**：选中态用 `bg-[hsl(var(--accent))]`（浅强调底），不用主强调色填充，保持 Notion 式克制。

---

## 5. 列表卡片（可点击）

网格列表的标准卡片，hover 三件套 + 底部元信息分隔。

```tsx
function ListCard({ title, desc, meta1, meta2, onClick }: {
  title: string; desc: string; meta1?: string; meta2?: string; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-lg p-4 cursor-pointer transition-all duration-200 hover:border-[hsl(var(--ring))] hover:shadow-md hover:-translate-y-px"
    >
      <div className="text-[14.5px] font-semibold text-foreground">{title}</div>
      <div className="text-[12.5px] text-muted-foreground line-clamp-3 mt-1">{desc}</div>
      {(meta1 || meta2) && (
        <div className="flex justify-between text-[11.5px] text-muted-foreground/70 pt-2 mt-2 border-t border-border">
          <span className="font-mono">{meta1}</span>
          <span>{meta2}</span>
        </div>
      )}
    </div>
  )
}
```

**规范**：可点击卡片用 `div` 而非 `Card` 组件包裹，hover 三件套缺一不可（边框变色 + 阴影 + 微上移）。

---

## 6. API 封装层（场景特定）

API 封装层的实现依赖后端形态，不在本共享文件中给出。按场景查阅：

- **桌面 GUI 工具**（Wails 绑定）：见 [gui-tool/wails-backend.md](../gui-tool/wails-backend.md#api-封装层wails-版)
- **B/S 网站**（fetch REST）：见 [bs-web/python-backend.md](../bs-web/python-backend.md#前端-api-封装层) 或 [bs-web/go-backend.md](../bs-web/go-backend.md#前端-api-封装层)

调用契约统一为 `api.xxx()` 返回 Promise，组件代码跨场景无需改动。

---

## 7. 顶层 App 组合骨架（场景特定）

顶层骨架涉及后端调用方式，按场景查阅：

- **桌面 GUI 工具**：见 [gui-tool/wails-backend.md](../gui-tool/wails-backend.md#顶层-app-骨架)
- **B/S 网站**：B/S 场景前端独立部署，骨架与 GUI 一致，仅 `api` 实现不同，参照上方 API 封装层

通用原则不变：`ToastProvider` 必须在最外层，`useToast` 只能在 Provider 内的子组件用。

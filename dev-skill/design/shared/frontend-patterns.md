# 前端架构模式

本章节定义前端的标准目录结构、状态管理、API 封装和组件分层。适用于所有带界面场景（GUI 工具、B/S 网站）。

## 标准目录结构

```
src/
├── lib/                    工具与封装层
│   ├── utils.ts            cn() 等通用工具
│   └── api.ts              后端调用的统一封装（见下）
├── components/
│   ├── ui/                 Shadcn 组件（复制进来的，不手改核心逻辑）
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   └── dialog.tsx
│   └── [业务组件].tsx       业务组件（Sidebar、SkillCard 等）
├── App.tsx                 主应用（状态 + 布局编排）
├── main.tsx                React 入口
└── style.css               全局样式 + 设计 Token
```

### 分层原则

| 层 | 职责 | 不可做 |
|----|------|--------|
| `lib/` | 纯工具、API 封装 | 不含 UI |
| `components/ui/` | 通用 UI 组件 | 不含业务逻辑 |
| `components/` | 业务组件 | 只管展示和交互，不直接调后端 |
| `App.tsx` | 状态管理 + 布局编排 | 调用 api 层，不直接调底层绑定/fetch |

## API 封装层（必须）

**原则**：所有后端调用必须经过 `lib/api.ts` 统一封装，前端组件不直接调底层（Wails 绑定 / fetch / axios）。

**为什么**：后端方法改名、增删、换实现、换协议时，只改 `api.ts` 一处，前端组件无感。

### 使用方式（跨场景统一）

```typescript
// 业务组件里只 import api，不直接 import 底层
import { api, type Agent } from '@/lib/api'

const agents = await api.getAgents()
```

### 各场景的具体实现

API 封装层的**调用契约**跨场景一致（都是 `api.xxx()` 返回 Promise），但**底层实现**不同：

- **桌面 GUI 工具**：封装 Wails 生成的 Go 绑定 → 见 [gui-tool/wails-backend.md](../gui-tool/wails-backend.md)
- **B/S 网站**：封装 fetch 调用后端 REST API → 见 [bs-web/python-backend.md](../bs-web/python-backend.md) 或 [bs-web/go-backend.md](../bs-web/go-backend.md)

## 状态管理

### 轻量应用（推荐）：useState + useCallback

大多数轻量应用不需要全局状态库，用 React 原生 hooks 足够。

```typescript
function App() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)

  const loadSkills = useCallback(async () => {
    if (!currentAgent) return
    setLoading(true)
    try {
      const res = await api.listSkills(currentAgent.id)
      setSkills(res.skills || [])
    } finally {
      setLoading(false)
    }
  }, [currentAgent])

  useEffect(() => {
    if (currentAgent) loadSkills()
  }, [currentAgent, loadSkills])
}
```

### 中型应用（按需）：Zustand

当状态跨多层组件共享、或状态逻辑复杂时，引入 Zustand（轻量，不用 Provider）。

```typescript
// store/useAppStore.ts
import { create } from 'zustand'

interface AppState {
  agents: Agent[]
  currentAgent: Agent | null
  setCurrentAgent: (a: Agent) => void
}

export const useAppStore = create<AppState>((set) => ({
  agents: [],
  currentAgent: null,
  setCurrentAgent: (a) => set({ currentAgent: a }),
}))
```

**不推荐 Redux**——对轻量应用过重。不推荐 Context 做高频状态——性能差。

## 组件设计原则

### 1. 业务组件只管展示和交互

```tsx
// ✅ 正确：组件只接收 props 和回调
function SkillCard({ skill, onClick }: { skill: Skill; onClick: (dir: string) => void }) {
  return <div onClick={() => onClick(skill.dir)}>...</div>
}

// ❌ 错误：组件内部直接调 API
function SkillCard({ skill }) {
  const handleDelete = async () => {
    await api.uninstallSkill(skill.dir)  // 不要在展示组件里调 API
  }
}
```

### 2. 状态上提，事件下传

```tsx
// App 持有状态，通过 props 传给子组件，子组件通过回调通知
<App>
  <Sidebar agents={agents} onSelect={selectAgent} />
  <SkillGrid skills={skills} onItemClick={setDetailDir} />
  <SkillDetailDialog dir={detailDir} onClose={...} onChanged={loadSkills} />
</App>
```

### 3. 弹窗状态由父组件控制

```tsx
const [detailDir, setDetailDir] = useState<string | null>(null)

// 打开
<SkillCard onClick={setDetailDir} />

// 弹窗
<SkillDetailDialog dir={detailDir} onClose={() => setDetailDir(null)} onChanged={loadSkills} />
```

## 路径别名（必须配置）

`tsconfig.json` 和 `vite.config.ts` 都要配置 `@/*` 别名：

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

```typescript
// vite.config.ts
import path from 'path'
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
```

## 全局样式入口

`main.tsx` 引入 `style.css`，`style.css` 包含 Tailwind 指令 + 设计 Token：

```typescript
// main.tsx
import './style.css'
```

```css
/* style.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root { /* 设计 Token，见 design-system.md */ }
  body { @apply bg-background text-foreground; }
}
```

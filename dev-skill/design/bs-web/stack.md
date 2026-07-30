# B/S 网站选型

B/S 架构 = 前端独立部署 + 后端 REST API。前端固定用 [共享前端层](../shared/frontend-stack.md)，后端在 Go 和 Python 之间选型。

## 前端

前端技术栈、设计、组件、架构全部复用共享层，无额外选型：

- [共享前端技术栈](../shared/frontend-stack.md)
- [设计规范](../shared/design-system.md)
- [前端组件使用方法](../shared/frontend-components.md)
- [前端架构模式](../shared/frontend-patterns.md)

## 后端选型

| 维度 | Go (gin) | Python (FastAPI) |
|------|----------|------------------|
| 并发 | goroutine 天生并发 | async/await（FastAPI 原生支持） |
| 性能 | 高吞吐 | 中高（async 场景够用） |
| 开发速度 | 稍慢，静态类型 | 快，FastAPI 自动生成 OpenAPI 文档 |
| 生态 | 云原生 / 微服务 | AI / 数据 / 科学计算 |
| 部署 | 单二进制，简单 | 容器 / 虚拟环境 |
| API 文档 | 需 swag 注解 | 自动生成 Swagger / ReDoc |

### 推荐

- **选 Go (gin)**：高并发、微服务、单二进制部署、性能优先
- **选 Python (FastAPI)**：AI 集成、快速开发、数据密集、需要自动 API 文档

### 选定后

- Go：见 [Go 后端（gin）](go-backend.md)
- Python：见 [Python 后端（FastAPI）](python-backend.md)

## API 设计原则

- HTTP 接口必须符合 **RESTful** 标准，具备 **OpenAPI** 文档。
- 接口须**对 AI Agent 友好**：路径与参数语义清晰、响应结构一致、错误信息可解析，便于 LLM 理解和调用。
- FastAPI 自动生成 Swagger/ReDoc；Go(gin) 需配合 swag 注解生成。

## 前端 API 封装层（fetch 版）

B/S 场景的 [前端 API 封装层](../shared/frontend-patterns.md#api-封装层必须) 实现为封装 fetch 调用后端 REST API。与后端语言无关，Go 和 Python 后端通用。

```ts
// src/lib/api.ts
export type Agent = { id: string; name: string }
export type Skill = { name: string; description: string; dir: string }

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText)
    throw new Error(msg)
  }
  return resp.json() as Promise<T>
}

export const api = {
  getAgents: () => request<Agent[]>('/api/agents'),
  listSkills: (agentId: string) => request<Skill[]>(`/api/agents/${agentId}/skills`),
  installFromZip: (agentId: string, zipPath: string) =>
    request<{ success: boolean; error?: string }>('/api/install', {
      method: 'POST',
      body: JSON.stringify({ agentId, zipPath }),
    }),
}
```

**规范**：
- 组件永远 `import { api } from '@/lib/api'`，不直接调 fetch
- `BASE` 通过环境变量 `VITE_API_BASE` 配置，开发/生产不同后端地址
- 统一错误处理在 `request` 里，业务组件只 catch 做 Toast

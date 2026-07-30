# Python 后端（FastAPI）

B/S 网站后端选用 Python 时的技术栈与规范。适用于：AI 集成、快速开发、数据密集、需要自动 API 文档的场景。

## 技术栈

| 库 | 作用 |
|-----|------|
| **FastAPI** | Web 框架（async、自动 OpenAPI 文档） |
| **httpx** | HTTP 客户端（调外部 API） |
| uvicorn | ASGI 服务器 |

## 项目结构

```
myapi/
├── main.py              入口（FastAPI app）
├── routers/             路由
│   ├── agents.py
│   └── skills.py
├── services/            核心业务逻辑（可独立测试）
│   └── skill.py
├── models/              数据结构（Pydantic）
│   └── schemas.py
├── requirements.txt
└── pyproject.toml
```

**分层原则**：`routers/` 只管请求解析和响应，业务逻辑放 `services/`，不依赖 FastAPI，保证可独立 pytest。

## FastAPI 路由模板

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import agents, skills

app = FastAPI(title="工具 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境改为前端域名
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router, prefix="/api")
app.include_router(skills.router, prefix="/api")
```

```python
# routers/skills.py
from fastapi import APIRouter, HTTPException
from services.skill import list_skills

router = APIRouter()

@router.get("/agents/{agent_id}/skills")
async def get_skills(agent_id: str):
    try:
        return await list_skills(agent_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

```python
# models/schemas.py
from pydantic import BaseModel

class Skill(BaseModel):
    name: str
    description: str
    dir: str
```

## 自动 API 文档

FastAPI 自动生成交互式文档，无需额外配置：
- Swagger UI：`http://localhost:8000/docs`
- ReDoc：`http://localhost:8000/redoc`

## 部署

```bash
# 开发
uvicorn main:app --reload --port 8000

# 生产（gunicorn + uvicorn worker）
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app
```

通常用容器（Docker）部署。

## 测试

核心逻辑放 `services/`，不依赖 FastAPI，用 pytest 测试：

```bash
pytest -v
```

前端衔接见 [B/S 选型的 fetch 封装](stack.md#前端-api-封装层fetch-版)。

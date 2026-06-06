# recorder_translate_server 设计方案

## 背景

Python 翻译工具（`record_translate/`）已完成 CLI 版本和 EXE 打包。本模块将其包装为 Web 服务，让用户通过浏览器上传录制包即可翻译，不需要安装 Python 或命令行操作。

## 架构

```
用户浏览器
  │  上传录制 zip
  ▼
FastAPI 服务（recorder_translate_server/）
  │  解压 → validate → preprocess → LLM 翻译
  │  SSE 实时推送进度
  ▼
下载翻译结果 zip
```

## 目录结构

```
recorder_translate_server/
├── README.md                  # 本文档
├── pyproject.toml
├── config/
│   └── ai.yaml                # LLM 配置
├── server/
│   ├── __init__.py
│   ├── __main__.py            # uvicorn 启动入口
│   ├── app.py                 # FastAPI 应用 + 路由
│   ├── jobs.py                # 任务管理（内存 dict）
│   └── static/
│       └── index.html         # 前端页面（上传 + 进度 + 下载）
└── uploads/                   # 临时上传目录（运行时自动创建）
```

## API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 前端页面 |
| POST | `/api/upload` | 上传录制 zip，返回 job_id |
| GET | `/api/jobs/{job_id}` | 查询任务状态 |
| GET | `/api/jobs/{job_id}/stream` | SSE 实时进度 |
| GET | `/api/jobs/{job_id}/download` | 下载翻译结果 zip |
| GET | `/api/jobs` | 列出所有任务 |

### POST /api/upload

- 接收 `multipart/form-data`，字段名 `file`，内容为录制目录的 zip
- 服务端解压到 `uploads/{job_id}/`
- 返回 `{ "job_id": "xxx", "status": "queued" }`

### GET /api/jobs/{job_id}/stream (SSE)

推送事件：

```
data: {"type": "progress", "phase": "preprocess", "message": "正在预处理..."}

data: {"type": "progress", "phase": "phase1", "message": "[Phase 1] 正在处理批次 1~3..."}

data: {"type": "complete", "message": "翻译完成", "cases_count": 6}

data: {"type": "error", "message": "翻译失败: ..."}
```

### GET /api/jobs/{job_id}/download

返回翻译结果的 zip 文件，包含 `translate/` 目录下所有产物。

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| Web 框架 | FastAPI | 原生 async、SSE 支持、自动 OpenAPI 文档 |
| ASGI 服务器 | uvicorn | FastAPI 标配 |
| 任务存储 | 内存 dict | 单机场景，不需要 Redis |
| 文件上传 | python-multipart | FastAPI 依赖 |
| zip 处理 | 标准库 zipfile | 无需额外依赖 |

## 复用

直接 `import` 现有的 `record_translate` 包：

- `record_translate.validate.validate_recording`
- `record_translate.preprocess.preprocess`
- `record_translate.workflow.run_workflow`
- `record_translate.client.LLMClient`

## 前端页面

单页面，三个区域：

1. **上传区**：拖拽或点击上传 zip
2. **进度区**：显示实时日志（SSE）
3. **结果区**：翻译完成后显示下载按钮 + 用例预览

## 实现步骤

1. 创建目录结构 + pyproject.toml
2. 实现 `jobs.py`（任务管理）
3. 实现 `app.py`（路由 + 翻译逻辑）
4. 实现 `static/index.html`（前端）
5. 实现 `__main__.py`（启动入口）
6. 端到端测试

## 验证方法

1. `python -m server` 启动服务
2. 浏览器打开 `http://localhost:8000`
3. 上传 `data_check/run_2026-06-04T11-39-58` 的 zip
4. 观察实时进度
5. 下载翻译结果

# recorder_translate_server 设计方案

> 版本：v3（合并三方评审 + FIFO 队列 + 步骤级进度）
> 更新时间：2026-06-06

## 背景

Python 翻译工具（`record_translate/`）已完成 CLI 版本和 EXE 打包。本模块将其包装为 Web 服务，让用户通过浏览器上传录制包即可翻译，不需要安装 Python 或命令行操作。

用户上传的原始录制数据和翻译结果都是平台的数据资产，**在服务端永久保留**，不自动清理。

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

### 并发与生命周期

```mermaid
graph TB
  subgraph Client[浏览器]
    UI[静态页面 index.html]
  end

  subgraph Server[FastAPI 单进程]
    LB[uvicorn --workers 1]
    API[路由层]
    Queue[FIFO 队列 按上传时间排序]
    Disp[dispatcher 调度器]
    subgraph Workers[asyncio.Task N=1]
      W1[job 1: running step 7/12]
    end
    WaitQ[job 2: queued 前面1个]
    WaitQ2[job 3: queued 前面2个]
    Store[内存 Jobs dict]
    Janitor[内存清理协程 每5分钟]
    Uploads[uploads/{uuid}/]
    Results[results/{uuid}.zip]
  end

  subgraph LLM
    API2[LLM Provider]
  end

  UI -->|upload zip| LB
  LB --> API
  API -->|入队| Queue
  Queue -->|FIFO 出队| Disp
  Disp -->|有空位→启动| W1
  Disp -->|满→等待| WaitQ & WaitQ2
  W1 -->|run_in_executor → run_workflow| API2
  W1 -->|SSE 步骤级进度| API
  WaitQ & WaitQ2 -->|SSE 队列位置| API
  API -->|stream| UI
  W1 -->|write zip| Results
  UI -->|download| Results
  Janitor -->|清理内存记录| Store
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
│   ├── jobs.py                # 任务管理（内存 dict + 清理协程）
│   ├── zip_utils.py           # 安全解压工具
│   └── static/
│       └── index.html         # 前端页面（上传 + 进度 + 下载）
├── uploads/                   # 原始录制包（永久保留，按 job_id 分目录）
└── results/                   # 翻译结果 zip（永久保留）
```

## 核心设计

### 1. 任务状态与数据模型

```python
class JobStatus(str, Enum):
    QUEUED = "queued"       # 排队等待中
    RUNNING = "running"     # 翻译中
    COMPLETED = "completed" # 完成
    FAILED = "failed"       # 失败
    CANCELLED = "cancelled" # 用户取消

@dataclass
class Job:
    id: str                          # uuid4，服务端生成
    status: JobStatus
    message: str                     # 当前进度描述
    error: str | None
    upload_path: Path
    result_zip_path: Path | None
    created_at: datetime             # 上传时间，用于 FIFO 排序
    updated_at: datetime
    last_event: dict | None          # SSE 断线重放用
    cancelled: bool = False          # 取消信号
    task: asyncio.Task | None = None # asyncio.Task 引用，用于取消
    # 步骤级进度
    total_steps: int = 0             # 预处理后计算出的总步骤数
    current_step: int = 0            # 当前执行到第几步
    current_phase: str = ""          # 当前阶段：preprocess / phase1 / phase2 / phase4
```

### 2. FIFO 队列与并发控制

用显式 FIFO 队列替代 Semaphore，确保按上传时间顺序执行：

```python
MAX_CONCURRENT_JOBS = 1                # LLM 无并发能力，同时只跑 1 个翻译任务
running_jobs: dict[str, Job] = {}      # 正在执行的任务
job_queue: collections.deque[str] = collections.deque()  # 排队中的 job_id，按上传时间排列

async def dispatcher():
    """调度器：持续检查队列，有空位就启动下一个任务"""
    while True:
        await asyncio.sleep(1)
        if len(running_jobs) >= MAX_CONCURRENT_JOBS:
            continue
        if not job_queue:
            continue
        # 从队列头部取出最早上传的任务
        job_id = job_queue.popleft()
        job = jobs.get(job_id)
        if not job or job.cancelled:
            continue
        # 启动翻译任务
        job.status = JobStatus.RUNNING
        job.task = asyncio.create_task(_execute_job(job))
        running_jobs[job_id] = job

async def _execute_job(job: Job):
    """执行翻译，完成后从 running_jobs 移除，触发调度器启动下一个"""
    try:
        await _do_translate(job)
    except Exception as e:
        job.status = JobStatus.FAILED
        job.error = str(e)
    finally:
        running_jobs.pop(job.id, None)
        job.updated_at = datetime.now()
        _push_event(job, {"type": "done", "status": job.status.value})

def get_queue_position(job_id: str) -> tuple[int, int]:
    """返回 (前面还有几个任务, 队列总任务数)"""
    queue_list = list(job_queue)
    total = len(queue_list)
    if job_id not in queue_list:
        return (0, total)
    idx = queue_list.index(job_id)
    return (idx, total)
```

用户上传后，前端可以实时看到：`"排队中（前面还有 2 个任务）"`；当调度器取出该任务时，状态变为 `running`。

### 3. CPU 密集操作隔离

`preprocess` 和 diff 计算是同步 CPU 操作，必须放到线程池，否则阻塞事件循环：

```python
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)

# 在路由/任务中
enriched, meta = await asyncio.get_running_loop().run_in_executor(
    executor,
    lambda: preprocess(run_dir)
)
```

> 注：`run_workflow` 内部若有纯 async 的 LLM 调用可直接 await，但 CPU 密集部分必须用 `run_in_executor`。

### 4. 安全解压

防止路径穿越、zip bomb、GBK 编码问题、macOS 垃圾文件：

```python
MAX_UPLOAD_SIZE_MB = 200
MAX_EXTRACT_SIZE_MB = 500

def safe_extract(zip_path: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            # 统一路径分隔符
            safe_name = member.replace('\\', '/')
            # 过滤危险路径
            if safe_name.startswith('/') or '..' in safe_name:
                continue
            # 跳过 macOS 垃圾文件
            if safe_name.startswith('__MACOSX/') or safe_name.endswith('.DS_Store'):
                continue
            # GBK 编码 fallback
            try:
                info = zf.getinfo(member)
            except UnicodeEncodeError:
                member_bytes = member.encode('cp437')
                safe_name = member_bytes.decode('gbk').replace('\\', '/')
                info = zf.getinfo(member)
            info.filename = safe_name
            zf.extract(info, target_dir)

    # 解压后递归查找 meta.json，确定真正的 run_dir
    return _find_run_dir(target_dir)

def _find_run_dir(root: Path) -> Path:
    """递归查找 meta.json 所在目录，兼容用户的奇怪打包习惯"""
    for meta in root.rglob("meta.json"):
        return meta.parent
    raise ValueError("zip 中未找到 meta.json")
```

### 5. 数据持久化与内存清理

**原始数据和翻译结果永久保留**，不在服务端自动删除。上传的录制包和翻译产物是平台的数据资产，需要持久存储。

内存中的 job 记录定期清理（已完成/失败的任务从内存移除，但文件保留在磁盘上）：

```python
MEMORY_TTL_HOURS = 24       # 已完成任务在内存中保留的时间（用于查询和 SSE）
CLEANUP_INTERVAL_SEC = 300   # 清理间隔（5 分钟）

async def janitor_loop():
    """后台清理协程：清理内存记录，磁盘文件永久保留"""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SEC)
        now = datetime.now()
        expired = [
            job for job in jobs.values()
            if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)
            and (now - job.updated_at).total_seconds() > MEMORY_TTL_HOURS * 3600
        ]
        for job in expired:
            del jobs[job.id]  # 仅从内存移除，磁盘文件不动
```

目录结构（磁盘上永久保留）：

```
uploads/
├── {job_id_1}/          # 原始录制包解压内容
│   ├── meta.json
│   └── record/
├── {job_id_2}/
└── ...

results/
├── {job_id_1}.zip       # 翻译结果 zip
├── {job_id_2}.zip
└── ...
```

### 6. 任务取消

```python
@app.delete("/api/jobs/{job_id}")
async def cancel_job(job_id: str):
    job = jobs.get(job_id)
    if not job or job.status not in (JobStatus.QUEUED, JobStatus.RUNNING):
        raise HTTPException(400, "任务不存在或无法取消")
    job.cancelled = True
    if job.task:
        job.task.cancel()
    job.status = JobStatus.CANCELLED
    return {"status": "cancelled"}

# 在翻译循环中插入取消检查点
if job.cancelled:
    raise JobCancelledError()

# 全局超时保护（10 分钟）
await asyncio.wait_for(run_workflow(...), timeout=600)
```

### 7. SSE 进度推送（步骤级）

每个任务维护一个 `asyncio.Queue`，翻译过程中实时推送步骤级进度：

```python
@dataclass
class Job:
    # ... 其他字段 ...
    event_queue: asyncio.Queue  # SSE 事件队列

def _push_event(job: Job, event: dict):
    """向 job 的 SSE 队列推送事件（非阻塞）"""
    job.last_event = event
    try:
        job.event_queue.put_nowait(event)
    except asyncio.QueueFull:
        pass  # 丢弃旧事件，保证最新状态可达

@app.get("/api/jobs/{job_id}/stream")
async def stream(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404)

    async def event_generator():
        # 断线重放：立即推送最后一条事件
        if job.last_event:
            yield f"data: {json.dumps(job.last_event)}\n\n"

        # 排队状态：定时推送队列位置
        if job.status == JobStatus.QUEUED:
            while job.status == JobStatus.QUEUED:
                ahead, total = get_queue_position(job_id)
                yield f"data: {json.dumps({'type': 'queued', 'ahead': ahead, 'total': total})}\n\n"
                await asyncio.sleep(3)

        # 执行中：实时推送步骤进度
        while job.status == JobStatus.RUNNING:
            event = await job.event_queue.get()
            yield f"data: {json.dumps(event)}\n\n"

        # 推送最终状态
        yield f"data: {json.dumps({'type': 'done', 'status': job.status.value})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

翻译过程中的进度事件格式：

```jsonc
// 排队中
{"type": "queued", "ahead": 2, "total": 3}

// 预处理阶段
{"type": "progress", "phase": "preprocess", "message": "正在预处理...", "step": 0, "total_steps": 0}

// Phase 1：每处理一个批次推送一次
{"type": "progress", "phase": "phase1", "message": "[Phase 1] 批次 2/5", "step": 3, "total_steps": 12}

// Phase 2：每处理一个窗口推送一次
{"type": "progress", "phase": "phase2", "message": "[Phase 2] 窗口 3/8 (37%)", "step": 7, "total_steps": 12}

// Phase 4
{"type": "progress", "phase": "phase4", "message": "[Phase 4] 生成 agents.txt", "step": 11, "total_steps": 12}

// 完成
{"type": "complete", "message": "翻译完成", "step": 12, "total_steps": 12}

// 失败
{"type": "error", "message": "翻译失败: ..."}
```

前端据此渲染：`"正在翻译：Phase 2 窗口 3/8 — 总进度 7/12 (58%)"`

### 8. 下载产物白名单

排除审计日志和中间文件，只给用户需要的：

```python
RESULT_WHITELIST = [
    "translate/phase1/structured_steps.json",
    "translate/phase2/cases.md",
    "translate/phase2/cases_fallback.md",
    "translate/phase2/coverage.md",
    "translate/phase4/agents.txt",
    # 明确不包含：llm_audit/、preprocess/、record/、meta.json
]

def create_result_zip(run_dir: Path, job_id: str) -> Path:
    result_path = Path("results") / f"{job_id}.zip"
    with zipfile.ZipFile(result_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for pattern in RESULT_WHITELIST:
            for f in run_dir.glob(pattern):
                arcname = f.relative_to(run_dir)
                zf.write(f, arcname)
    return result_path
```

## API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 前端页面 |
| POST | `/api/upload` | 上传录制 zip，返回 job_id |
| GET | `/api/jobs/{job_id}` | 查询任务状态 |
| GET | `/api/jobs/{job_id}/stream` | SSE 实时进度 |
| GET | `/api/jobs/{job_id}/download` | 下载翻译结果 zip |
| DELETE | `/api/jobs/{job_id}` | 取消任务 |
| GET | `/api/jobs` | 列出所有任务 |

### POST /api/upload

- 接收 `multipart/form-data`，字段名 `file`，内容为录制目录的 zip
- 检查 `Content-Length`，超过 `MAX_UPLOAD_SIZE_MB` 返回 413
- 服务端安全解压到 `uploads/{uuid}/`
- 预处理后计算 `total_steps`，加入 FIFO 队列
- 若当前无任务在执行，立即开始；否则排队
- 返回 `{ "job_id": "xxx", "status": "queued", "queue_ahead": 2, "total_steps": 12 }`

### GET /api/jobs/{job_id}

返回任务详情，含步骤级进度和队列位置：

```jsonc
{
  "job_id": "xxx",
  "status": "running",          // queued / running / completed / failed / cancelled
  "created_at": "2026-06-06T10:30:00",
  "total_steps": 12,
  "current_step": 7,
  "current_phase": "phase2",
  "message": "[Phase 2] 窗口 3/8",
  // 仅 queued 状态时有值
  "queue_ahead": 0,
  "queue_total": 0,
  // 仅 failed 状态时有值
  "error": null
}
```

### GET /api/jobs/{job_id}/stream (SSE)

排队阶段每 3 秒推送队列位置，执行阶段实时推送步骤进度：

```
data: {"type": "queued", "ahead": 2, "total": 3}

data: {"type": "progress", "phase": "phase1", "message": "[Phase 1] 批次 2/5", "step": 3, "total_steps": 12}

data: {"type": "progress", "phase": "phase2", "message": "[Phase 2] 窗口 3/8 (37%)", "step": 7, "total_steps": 12}

data: {"type": "complete", "message": "翻译完成", "step": 12, "total_steps": 12}

data: {"type": "error", "message": "翻译失败: ..."}
```

断线重连时立即重放最后一条事件，避免前端白屏等待。

### GET /api/jobs/{job_id}/download

返回翻译结果的 zip 文件，仅包含白名单内的产物（不含 `llm_audit/`、`preprocess/`、`record/`）。

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| Web 框架 | FastAPI | 原生 async、SSE 支持、自动 OpenAPI 文档 |
| ASGI 服务器 | uvicorn | FastAPI 标配，`--workers 1` 显式单进程 |
| 任务存储 | 内存 dict | 单机场景，重启丢任务可接受（重跑一次） |
| 文件上传 | python-multipart | FastAPI 依赖 |
| zip 处理 | 标准库 zipfile | 无需额外依赖 |
| 线程池 | concurrent.futures | 隔离 CPU 密集操作 |

## 复用

直接 `import` 现有的 `record_translate` 包：

- `record_translate.validate.validate_recording`
- `record_translate.preprocess.preprocess`
- `record_translate.workflow.run_workflow`
- `record_translate.client.LLMClient`

## 前端页面

单页面，三个区域：

1. **上传区**：拖拽或点击上传 zip（显示大小限制提示）
2. **进度区**：显示实时进度（SSE），区分三种状态：
   - **排队中**：`"排队中（前面还有 2 个任务）"` + 轮播动画
   - **执行中**：总进度条 `7/12 (58%)` + 当前阶段 `Phase 2 窗口 3/8` + 实时日志（同时只有 1 个任务在执行）
   - **完成/失败**：最终状态 + 错误信息（如有）
3. **结果区**：翻译完成后显示下载按钮 + 用例预览（使用 marked.js 渲染 Markdown）

## 实现步骤

1. 创建目录结构 + pyproject.toml
2. 实现 `zip_utils.py`（安全解压 + run_dir 查找）
3. 实现 `jobs.py`（任务管理 + 清理协程 + 并发控制）
4. 实现 `app.py`（路由 + 翻译逻辑 + SSE + 取消）
5. 实现 `static/index.html`（前端）
6. 实现 `__main__.py`（启动入口）
7. 端到端测试

## 验证方法

1. `python -m server` 启动服务
2. 浏览器打开 `http://localhost:8000`
3. 上传 `data_check/run_2026-06-04T11-39-58` 的 zip
4. 观察排队状态 → 执行进度（步骤级） → 完成
5. 下载翻译结果
6. 同时上传 3 个 zip，验证只有 1 个在执行、其余排队、FIFO 顺序和队列位置显示正确
7. 测试取消功能（排队中/执行中）
8. 测试 SSE 断线重连

## 不做的事情（第一版）

以下特性在单机内网场景下暂不需要，后续根据实际使用情况再考虑：

- 身份认证 / OAuth / API Key
- Prometheus 指标 / OpenTelemetry
- Docker / k8s 部署
- 持久化（SQLite / Redis）
- 多 worker 支持
- 双轨一致性对比测试（JS 版已标注 [不再维护]）

## 评审记录

- `idea_by_minimax-m3.md` — 15 项评审，P0 五项（状态机/并发/校验/沙箱/auth）有价值，后半段过度设计
- `idea_by_gemini.md` — 3 项评审，全部命中实 bug（zip 安全/TTL/阻塞事件循环）
- `idea_by_deepseek-v4-pro.md` — 5 项评审，聚焦翻译语义正确性（产物边界/跨平台/进度体验），务实

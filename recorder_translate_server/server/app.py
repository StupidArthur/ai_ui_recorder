"""FastAPI 应用：路由 + SSE 进度流 + 静态前端托管 + SPA fallback。

worker 不走 run_workflow，而是直接调用 validate / preprocess / run_phase1/2/4
以便精确控制 step offset 并重新计算 total_steps。
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from recorder_translate_server.backend.audit import LlmAudit
from recorder_translate_server.backend.config import PHASE1_BATCH_SIZE, PHASE2_WINDOW_SIZE, PHASE4_WINDOW_SIZE
from recorder_translate_server.backend.preprocess import preprocess
from recorder_translate_server.backend.validate import validate_recording
from recorder_translate_server.backend.workflow import run_workflow
from recorder_translate_server.backend.xml_parse import max_sliding_window_rounds

from . import jobs as J
from .llm import build_client
from .result_zip import RESULT_WHITELIST, create_result_zip
from .web_progress import make_callback
from .zip_utils import MAX_EXTRACT_SIZE_MB, MAX_UPLOAD_SIZE_MB, safe_extract

log = logging.getLogger("recorder_translate_server")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)

# ==================== 路径 ====================

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
RESULT_DIR = BASE_DIR / "results"
DIST_DIR = BASE_DIR / "frontend" / "dist"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULT_DIR.mkdir(parents=True, exist_ok=True)

# ==================== App ====================

executor = ThreadPoolExecutor(max_workers=4)
app = FastAPI(
    title="Recorder Translate Server",
    version="0.1.0",
    description="Web UI for translating UI recordings into Chinese test cases.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 生命周期 ====================


@app.on_event("startup")
async def _startup() -> None:
    asyncio.create_task(_dispatcher_loop())
    asyncio.create_task(_janitor_loop())


async def _dispatcher_loop() -> None:
    """持续检查队列，有空位就启动下一个 job。"""
    while True:
        await asyncio.sleep(J.QUEUE_TICK_SEC)
        while len(J.running_jobs) < J.MAX_CONCURRENT_JOBS and J.job_queue:
            jid = J.job_queue.popleft()
            job = J.jobs.get(jid)
            if not job or job.cancelled:
                continue
            job.status = J.JobStatus.RUNNING
            job.updated_at = datetime.now()
            job.task = asyncio.create_task(_execute_job(job))
            J.running_jobs[jid] = job


async def _janitor_loop() -> None:
    """清理内存中过期的已完成/失败/取消记录（磁盘文件不动）。"""
    while True:
        await asyncio.sleep(J.CLEANUP_INTERVAL_SEC)
        now = datetime.now()
        for jid in list(J.jobs.keys()):
            job = J.jobs.get(jid)
            if not job:
                continue
            if job.status in (
                J.JobStatus.COMPLETED,
                J.JobStatus.FAILED,
                J.JobStatus.CANCELLED,
            ) and (now - job.updated_at).total_seconds() > J.MEMORY_TTL_HOURS * 3600:
                J.jobs.pop(jid, None)
                log.info(f"[janitor] removed job {jid} from memory (files on disk retained)")


# ==================== Worker ====================


async def _execute_job(job: J.Job) -> None:
    """跑一次翻译 pipeline。"""
    try:
        await asyncio.wait_for(_run_pipeline(job), timeout=J.JOB_TIMEOUT_SEC)
        if not job.cancelled:
            job.status = J.JobStatus.COMPLETED
    except asyncio.CancelledError:
        job.status = J.JobStatus.CANCELLED
    except Exception as e:
        log.exception(f"[job {job.id}] failed")
        if not job.cancelled:
            job.status = J.JobStatus.FAILED
            job.error = str(e)
    finally:
        J.running_jobs.pop(job.id, None)
        job.updated_at = datetime.now()
        J._push_event(
            job,
            {
                "type": "done",
                "status": job.status.value,
                "step": job.current_step,
                "total_steps": job.total_steps,
                "message": job.message,
                "error": job.error,
            },
        )


async def _run_pipeline(job: J.Job) -> None:
    loop = asyncio.get_running_loop()

    # ---- preprocess 阶段（CPU 密集，放 executor）----
    J._push_event(
        job,
        {
            "type": "progress",
            "phase": "preprocess",
            "step": 0,
            "total_steps": 0,
            "message": "校验与预处理中...",
        },
    )
    meta, raw_actions, _fmt = await loop.run_in_executor(
        executor, validate_recording, job.upload_path
    )
    enriched = await loop.run_in_executor(
        executor, lambda: preprocess(job.upload_path, meta, raw_actions, log)
    )

    # ---- 构造 LLM 客户端和 audit ----
    client = build_client()
    audit = LlmAudit(job.upload_path, client, log)

    # 委托给 run_workflow 跑 phase 1/2/4（它会发 progress 事件）
    cb = make_callback(job)
    try:
        await run_workflow(
            job.upload_path,
            enriched,
            phase1_batch_size=PHASE1_BATCH_SIZE,
            phase2_window_size=PHASE2_WINDOW_SIZE,
            client=client,
            log_instance=log,
            progress_callback=cb,
        )
    finally:
        audit.finalize()

    # ---- 打包结果 ----
    J._push_event(
        job,
        {
            "type": "progress",
            "phase": "finalize",
            "step": job.current_step,
            "total_steps": job.total_steps,
            "message": "打包结果中...",
        },
    )
    out = RESULT_DIR / f"{job.id}.zip"
    create_result_zip(job.upload_path, out)
    job.result_zip_path = out


# ==================== 路由 ====================


@app.post("/api/upload")
async def upload(request: Request, file: UploadFile) -> dict:
    """接收 zip，解压，创建 job 入队。"""
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(413, f"上传文件超过 {MAX_UPLOAD_SIZE_MB}MB")

    # 写到临时 zip 文件
    job_tmp_id = f"upload-{datetime.now().timestamp():.0f}"
    raw_zip = UPLOAD_DIR / f"{job_tmp_id}.zip"
    with raw_zip.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)

    # 解压到独立目录
    extract_dir = UPLOAD_DIR / job_tmp_id
    try:
        run_dir = safe_extract(raw_zip, extract_dir)
    except ValueError as e:
        shutil.rmtree(extract_dir, ignore_errors=True)
        raw_zip.unlink(missing_ok=True)
        raise HTTPException(400, str(e))
    finally:
        raw_zip.unlink(missing_ok=True)

    job = J.create_job(upload_path=run_dir)
    ahead, total = J.get_queue_position(job.id)
    return {
        "job_id": job.id,
        "status": job.status.value,
        "queue_ahead": ahead,
        "queue_total": total,
        "total_steps": job.total_steps,
        "current_step": job.current_step,
    }


@app.get("/api/jobs")
async def list_jobs() -> list[dict]:
    out = [J.job_to_view(j) for j in J.jobs.values()]
    out.sort(key=lambda d: d["created_at"])
    return out


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    job = J.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job 不存在")
    return J.job_to_view(job)


@app.delete("/api/jobs/{job_id}")
async def cancel_job(job_id: str) -> dict:
    job = J.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job 不存在")
    if job.status not in (J.JobStatus.QUEUED, J.JobStatus.RUNNING):
        raise HTTPException(400, "任务不在可取消状态")
    J.cancel(job)
    job.status = J.JobStatus.CANCELLED
    job.updated_at = datetime.now()
    J._push_event(
        job, {"type": "done", "status": job.status.value, "error": job.error}
    )
    return {"status": "cancelled"}


@app.get("/api/jobs/{job_id}/stream")
async def stream(job_id: str, request: Request) -> StreamingResponse:
    job = J.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job 不存在")
    return StreamingResponse(
        _event_gen(job, request), media_type="text/event-stream"
    )


@app.get("/api/jobs/{job_id}/download")
async def download(job_id: str) -> FileResponse:
    job = J.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job 不存在")
    if job.status == J.JobStatus.CANCELLED:
        raise HTTPException(410, "任务已取消")
    if job.status != J.JobStatus.COMPLETED or not job.result_zip_path:
        raise HTTPException(409, "任务尚未完成")
    return FileResponse(
        job.result_zip_path,
        filename=f"translate-result-{job_id}.zip",
        media_type="application/zip",
    )


@app.get("/api/jobs/{job_id}/file")
async def get_result_file(job_id: str, p: str) -> FileResponse:
    """结果预览接口，p 必须在白名单内。"""
    job = J.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job 不存在")
    if p not in RESULT_WHITELIST:
        raise HTTPException(400, "文件不在白名单内")
    fp = job.upload_path / p
    if not fp.exists():
        raise HTTPException(404, "文件不存在")
    if p.endswith(".md"):
        media = "text/markdown; charset=utf-8"
    elif p.endswith(".json"):
        media = "application/json; charset=utf-8"
    else:
        media = "text/plain; charset=utf-8"
    return FileResponse(fp, media_type=media)


# ==================== SSE ====================


async def _event_gen(job: J.Job, request: Request):
    # 断线重连：先重放最后一条事件
    if job.last_event:
        yield f"data: {json.dumps(job.last_event, ensure_ascii=False)}\n\n"

    while True:
        if await request.is_disconnected():
            return
        if job.status == J.JobStatus.QUEUED:
            ahead, total = J.get_queue_position(job.id)
            ev = {"type": "queued", "ahead": ahead, "total": total}
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            try:
                await asyncio.wait_for(job.event_queue.get(), timeout=3.0)
                # 抢占到了真实事件：replay last_event 一次（不入队）
                if job.last_event:
                    yield f"data: {json.dumps(job.last_event, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                pass
        elif job.status == J.JobStatus.RUNNING:
            try:
                ev = await asyncio.wait_for(job.event_queue.get(), timeout=15.0)
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
        else:
            # 终态：推 done 后关闭
            yield f"data: {json.dumps({'type': 'done', 'status': job.status.value, 'error': job.error}, ensure_ascii=False)}\n\n"
            return


# ==================== 健康检查 ====================


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


# ==================== 静态前端托管 + SPA fallback ====================

# 必须放在所有 /api/* 路由之后
if (DIST_DIR / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=DIST_DIR / "assets"),
        name="assets",
    )


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    if full_path.startswith(("api/", "assets/")):
        raise HTTPException(404)
    if not (DIST_DIR / "index.html").exists():
        return {
            "hint": "前端未构建。请先 `cd recorder_translate_server/frontend && pnpm build`，"
            "或开发模式启动 `pnpm dev` 访问 http://localhost:5173"
        }
    return FileResponse(DIST_DIR / "index.html", media_type="text/html")


# ==================== uvicorn entry ====================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "recorder_translate_server.server.app:app",
        host="127.0.0.1",
        port=8000,
        workers=1,
    )

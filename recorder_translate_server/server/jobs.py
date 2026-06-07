"""任务管理：Job 数据类、FIFO 队列、辅助函数。

dispatcher 和 janitor 协程在 app.py 中实现（避免循环导入）。
"""

from __future__ import annotations

import asyncio
import collections
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

# ==================== 常量 ====================

MAX_CONCURRENT_JOBS = 1
JOB_TIMEOUT_SEC = 600
EVENT_QUEUE_MAX = 1024
MEMORY_TTL_HOURS = 24
CLEANUP_INTERVAL_SEC = 300
QUEUE_TICK_SEC = 1


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# ==================== Job ====================


@dataclass
class Job:
    id: str
    status: JobStatus
    upload_path: Path
    created_at: datetime
    updated_at: datetime
    message: str = ""
    error: Optional[str] = None
    current_phase: str = ""
    current_step: int = 0
    total_steps: int = 0
    cancelled: bool = False
    result_zip_path: Optional[Path] = None
    task: Optional[asyncio.Task] = None
    event_queue: asyncio.Queue = field(
        default_factory=lambda: asyncio.Queue(maxsize=EVENT_QUEUE_MAX)
    )
    last_event: Optional[dict] = None


# ==================== 全局状态 ====================

jobs: dict[str, Job] = {}
job_queue: collections.deque[str] = collections.deque()
running_jobs: dict[str, Job] = {}


# ==================== 辅助函数 ====================


def create_job(upload_path: Path) -> Job:
    """创建新 job，加入 FIFO 队列。"""
    jid = uuid.uuid4().hex
    now = datetime.now()
    job = Job(
        id=jid,
        status=JobStatus.QUEUED,
        upload_path=upload_path,
        created_at=now,
        updated_at=now,
    )
    jobs[jid] = job
    job_queue.append(jid)
    return job


def get_queue_position(job_id: str) -> tuple[int, int]:
    """返回 (前面还有几个任务, 队列总任务数)。"""
    arr = list(job_queue)
    total = len(arr)
    if job_id not in arr:
        return (0, total)
    return (arr.index(job_id), total)


def cancel(job: Job) -> None:
    """设置取消标志并尝试取消 asyncio task。"""
    job.cancelled = True
    if job.task and not job.task.done():
        job.task.cancel()


def _push_event(job: Job, event: dict) -> None:
    """向 job 的 SSE 事件队列推送（非阻塞）；同时更新 last_event。"""
    job.last_event = event
    try:
        job.event_queue.put_nowait(event)
    except asyncio.QueueFull:
        # 队列满则丢弃新事件（最新状态已在 job 属性上）
        pass


def job_to_view(job: Job) -> dict:
    """序列化 Job 为 API 返回视图。"""
    ahead, qtotal = (
        get_queue_position(job.id) if job.status == JobStatus.QUEUED else (0, 0)
    )
    return {
        "job_id": job.id,
        "status": job.status.value,
        "created_at": job.created_at.isoformat(timespec="seconds"),
        "updated_at": job.updated_at.isoformat(timespec="seconds"),
        "current_phase": job.current_phase,
        "current_step": job.current_step,
        "total_steps": job.total_steps,
        "message": job.message,
        "queue_ahead": ahead,
        "queue_total": qtotal,
        "error": job.error,
    }

"""progress 回调包装：把 record_translate 的回调桥接到 Job 的 SSE 事件队列。"""

from __future__ import annotations

from typing import Callable

from . import jobs as J


def make_callback(job: J.Job) -> Callable[[str, int, int, str], None]:
    """
    构造一个同步 callback，把事件推到 job 的 event_queue 并更新 job 字段。

    record_translate 的 callback 签名：(phase, in_step, in_total, message)
    """

    def _cb(phase: str, in_step: int, _in_total: int, message: str) -> None:
        # workflow 已经把 offset 加到 in_step 上，所以这里直接用
        job.current_phase = phase
        job.current_step = in_step
        # total 也由 workflow 控制，不读 _in_total
        # （但保留 _in_total 参数以兼容 record_translate 签名）
        job.message = message
        event = {
            "type": "progress",
            "phase": phase,
            "step": in_step,
            "total_steps": job.total_steps,
            "message": message,
        }
        J._push_event(job, event)

    return _cb

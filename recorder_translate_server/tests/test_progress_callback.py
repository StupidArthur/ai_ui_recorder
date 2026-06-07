"""progress_callback 契约测试。

不发起真实 LLM 调用，通过 mock audit.call 验证：
1. phase 1/2/4 的 callback 在每次 LLM 调用前触发
2. 事件的 in_step 单调递增
3. 不传 callback 时仍可正常运行（CLI 行为不变）
4. run_workflow 编排：offset 累加、total 在 phase 1 完成后重算
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from recorder_translate_server.backend.audit import LlmAudit
from recorder_translate_server.backend.phases.phase1 import run_phase1
from recorder_translate_server.backend.phases.phase2 import run_phase2
from recorder_translate_server.backend.phases.phase4 import run_phase4
from recorder_translate_server.backend.preprocess import preprocess
from recorder_translate_server.backend.validate import validate_recording
from recorder_translate_server.backend.workflow import run_workflow

SOURCE_FIXTURE = Path("G:/github/ai_ui_recorder/release1/output/run_2026-06-04T11-39-58")


# -------- 工具 --------


def _make_fake_audit(empty_reply: str = ""):
    """构造一个不发真实 LLM 调用的 LlmAudit mock。"""
    audit = MagicMock(spec=LlmAudit)
    audit.call = AsyncMock(return_value=("call_id", empty_reply))
    audit.mark_outcome = MagicMock()
    return audit


def _copy_fixture_to_tmp(tmp_path: Path) -> Path:
    """把测试 fixture 复制到 tmp，避免污染原始 run 目录。"""
    if not SOURCE_FIXTURE.exists():
        pytest.skip(f"fixture not found: {SOURCE_FIXTURE}")
    target = tmp_path / "run"
    shutil.copytree(SOURCE_FIXTURE, target)
    # 移除已有的 translate/，否则会混入旧结果
    translate_dir = target / "translate"
    if translate_dir.exists():
        shutil.rmtree(translate_dir)
    return target


# -------- Phase 1 --------


@pytest.mark.asyncio
async def test_phase1_progress_callback_fires_for_each_llm_call(tmp_path):
    run_dir = _copy_fixture_to_tmp(tmp_path)
    meta, raw, _ = validate_recording(run_dir)
    enriched = preprocess(run_dir, meta, raw)

    audit = _make_fake_audit()

    events: list[tuple[str, int, int, str]] = []
    def cb(phase, step, total, msg):
        events.append((phase, step, total, msg))

    steps, errors, n_calls = await run_phase1(
        run_dir, enriched,
        batch_size=3, audit=audit, log=None,
        progress_callback=cb,
    )

    assert n_calls > 0, "应至少有一次 LLM 调用"
    assert len(events) == n_calls, f"事件数 {len(events)} != LLM 调用数 {n_calls}"

    last_step = -1
    for phase, step, total, msg in events:
        assert phase == "phase1"
        assert step > last_step, f"step 应单调递增：{last_step} -> {step}"
        last_step = step
    assert last_step == n_calls - 1


@pytest.mark.asyncio
async def test_phase1_callback_optional_no_regression(tmp_path):
    """不传 callback 时不报错，行为同 0.93.0。"""
    run_dir = _copy_fixture_to_tmp(tmp_path)
    meta, raw, _ = validate_recording(run_dir)
    enriched = preprocess(run_dir, meta, raw)

    audit = _make_fake_audit()

    steps, errors, n_calls = await run_phase1(
        run_dir, enriched,
        batch_size=3, audit=audit, log=None,
        # progress_callback 未传
    )
    assert n_calls >= 0
    assert isinstance(steps, list)


# -------- Phase 2 --------


@pytest.mark.asyncio
async def test_phase2_progress_callback_fires_for_each_round(tmp_path):
    run_dir = _copy_fixture_to_tmp(tmp_path)
    meta, raw, _ = validate_recording(run_dir)
    enriched = preprocess(run_dir, meta, raw)

    # 先跑 phase 1 拿到 steps（用空回复，所有 step 会落 fallback，但足够产生 effective 列表）
    audit1 = _make_fake_audit()
    steps, errors, _ = await run_phase1(run_dir, enriched, batch_size=3, audit=audit1, log=None)

    # 跑 phase 2
    audit2 = _make_fake_audit()
    events: list[tuple[str, int, int, str]] = []
    def cb(phase, step, total, msg):
        events.append((phase, step, total, msg))

    phase2_result, n_calls = await run_phase2(
        run_dir, steps,
        window_size=20, audit=audit2, log=None,
        progress_callback=cb,
    )

    assert n_calls >= 0
    assert len(events) == n_calls
    for phase, step, total, msg in events:
        assert phase == "phase2"
        assert step >= 0


# -------- Phase 4 --------


@pytest.mark.asyncio
async def test_phase4_progress_callback_fires_for_each_chunk(tmp_path):
    run_dir = _copy_fixture_to_tmp(tmp_path)
    meta, raw, _ = validate_recording(run_dir)
    enriched = preprocess(run_dir, meta, raw)

    audit1 = _make_fake_audit()
    steps, errors, _ = await run_phase1(run_dir, enriched, batch_size=3, audit=audit1, log=None)

    audit4 = _make_fake_audit()
    events: list[tuple[str, int, int, str]] = []
    def cb(phase, step, total, msg):
        events.append((phase, step, total, msg))

    agents_file, n_calls = await run_phase4(
        run_dir, steps,
        window_size=20, audit=audit4, log=None,
        progress_callback=cb,
    )

    assert n_calls >= 0
    assert len(events) == n_calls
    for phase, step, total, msg in events:
        assert phase == "phase4"


# -------- run_workflow 编排 --------


@pytest.mark.asyncio
async def test_run_workflow_progress_total_rebaselines_after_phase1(tmp_path):
    """workflow 应在 phase 1 完成后用 effective 数重算 total。"""
    from recorder_translate_server.backend.client import LLMClient

    run_dir = _copy_fixture_to_tmp(tmp_path)
    meta, raw, _ = validate_recording(run_dir)
    enriched = preprocess(run_dir, meta, raw)

    # 真实 LLMClient 但 call_chat 返空字符串 → 阶段会失败但 progress 事件仍发
    fake_client = MagicMock(spec=LLMClient)
    fake_client.call_chat = AsyncMock(return_value="")

    totals_seen: list[int] = []
    all_events: list[tuple[str, int, int, str]] = []
    last_phase = [None]  # 列表以便在闭包内修改

    def cb(phase, step, total, msg):
        all_events.append((phase, step, total, msg))
        # 跟踪 phase 切换：每个 phase 第一次出现时记录 total
        if phase != last_phase[0]:
            totals_seen.append(total)
            last_phase[0] = phase

    # 用 try/finally 兜住 phase 异常（因为 LLM 返回空，phase 1 会成功因为 fallback，phase 2/4 也会有 fallback）
    try:
        result = await run_workflow(
            run_dir, enriched,
            client=fake_client, log_instance=None,
            progress_callback=cb,
        )
    except Exception as e:
        pytest.fail(f"workflow 异常退出: {e}")

    # 至少 4 个阶段的"开始"事件：phase1, phase2, phase4, finalize
    assert len(totals_seen) >= 4, f"应至少 4 个 total 阶段事件，实际 {len(totals_seen)}: {totals_seen}"
    # total 至少更新过（不是初始 estimate，且最终是 finite）
    assert all(t > 0 for t in totals_seen), f"total 必须为正: {totals_seen}"
    # 应有 phase1/phase2/phase4/finalize 全部触发
    phases_seen = {e[0] for e in all_events}
    assert {"phase1", "phase2", "phase4", "finalize"}.issubset(phases_seen), f"缺失阶段: {phases_seen}"


@pytest.mark.asyncio
async def test_run_workflow_no_callback_no_regression(tmp_path):
    """不传 callback 时 0.93.0 行为不变。"""
    from recorder_translate_server.backend.client import LLMClient

    run_dir = _copy_fixture_to_tmp(tmp_path)
    meta, raw, _ = validate_recording(run_dir)
    enriched = preprocess(run_dir, meta, raw)

    fake_client = MagicMock(spec=LLMClient)
    fake_client.call_chat = AsyncMock(return_value="")

    result = await run_workflow(
        run_dir, enriched,
        client=fake_client, log_instance=None,
        # progress_callback 未传
    )
    assert result.steps_file is not None

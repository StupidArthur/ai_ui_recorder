"""工作流编排：Phase 1 → Phase 2 → Phase 4"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from .audit import LlmAudit
from .client import LLMClient
from .config import PHASE1_BATCH_SIZE, PHASE2_WINDOW_SIZE
from .models import EnrichedAction, StructuredStep
from .phases.phase1 import run_phase1
from .phases.phase2 import Phase2Result, run_phase2
from .phases.phase4 import run_phase4

log = logging.getLogger(__name__)


@dataclass
class WorkflowResult:
    steps_file: Path | None = None
    cases_file: Path | None = None
    agent_txt_file: Path | None = None
    fallback_applied: bool = False
    fallback_indices: list[int] = field(default_factory=list)
    cases_fallback_file: str | None = None


async def run_workflow(
    run_dir: Path,
    enriched_actions: list[EnrichedAction],
    *,
    phase1_batch_size: int = PHASE1_BATCH_SIZE,
    phase2_window_size: int = PHASE2_WINDOW_SIZE,
    client: LLMClient | None = None,
    log_instance=None,
) -> WorkflowResult:
    """
    完整翻译工作流：Phase 1 → Phase 2 → Phase 4。
    """
    _log = log_instance or log

    if client is None:
        client = LLMClient.from_config()

    audit = LlmAudit(run_dir, client, _log)

    # ========== Phase 1 ==========
    _log.info(f"[Phase 1] 正在生成结构化步骤 (批次大小={phase1_batch_size})...")
    phase1_dir = run_dir / "translate" / "phase1"
    phase1_dir.mkdir(parents=True, exist_ok=True)

    steps, errors = await run_phase1(
        run_dir, enriched_actions,
        batch_size=phase1_batch_size, audit=audit, log=_log,
    )

    _log.info(f"[Phase 1] 完成，共 {len(steps)} 条结构化步骤")
    if errors:
        _log.warning(f"[Phase 1] 存在 {len(errors)} 条 LLM 输出异常")

    # ========== Phase 2 ==========
    _log.info(f"[Phase 2] 正在归纳测试用例 (窗口大小={phase2_window_size})...")
    cases_file = run_dir / "translate" / "phase2" / "cases.md"

    phase2_result = await run_phase2(
        run_dir, steps,
        window_size=phase2_window_size, audit=audit, log=_log,
    )

    _log.info(f"[Phase 2] 完成")
    if phase2_result.fallback_applied:
        _log.warning(f"[Phase 2] 兜底已介入，缺失 {len(phase2_result.fallback_indices)} 步")

    # ========== Phase 4 ==========
    agent_txt_file = None
    try:
        agent_txt_file = await run_phase4(
            run_dir, steps,
            window_size=phase2_window_size, audit=audit, log=_log,
        )
    except Exception as e:
        _log.error(f"[Workflow] Agent TXT 生成失败: {e}")

    # ========== 审计收尾 ==========
    audit.finalize()

    return WorkflowResult(
        steps_file=phase1_dir / "structured_steps.json",
        cases_file=cases_file,
        agent_txt_file=agent_txt_file,
        fallback_applied=phase2_result.fallback_applied,
        fallback_indices=phase2_result.fallback_indices,
        cases_fallback_file=phase2_result.fallback_file,
    )

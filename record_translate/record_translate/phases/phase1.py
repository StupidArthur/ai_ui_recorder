"""Phase 1：微批处理生成结构化步骤"""

from __future__ import annotations

import json
from pathlib import Path

from ..audit import LlmAudit
from ..config import EVIDENCE_CONTEXT_WINDOW_SIZE, PHASE1_BATCH_SIZE, PHASE2_GAP_TAG_LONG_GAP_MS
from ..models import EnrichedAction, StructuredStep
from ..prompts.step_structured import build_system_prompt, build_user_prompt
from ..xml_parse import parse_batch_xml_steps


async def run_phase1(
    run_dir: Path,
    enriched_actions: list[EnrichedAction],
    *,
    batch_size: int = PHASE1_BATCH_SIZE,
    context_window_size: int = EVIDENCE_CONTEXT_WINDOW_SIZE,
    audit: LlmAudit,
    log=None,
) -> tuple[list[StructuredStep], list[dict]]:
    """
    Phase 1：微批处理生成结构化步骤。

    返回: (steps, errors)
    """
    steps: list[StructuredStep] = []
    errors: list[dict] = []
    llm_raw_batches: list[dict] = []
    previous_timestamp = None

    system_prompt = build_system_prompt()

    # 增量写盘函数
    def flush():
        _write_json(run_dir / "translate" / "phase1" / "structured_steps.json",
                    [s.model_dump(by_alias=True) for s in steps])
        _write_json(run_dir / "translate" / "phase1" / "errors.json", errors)
        _write_xml_artifacts(run_dir, steps, llm_raw_batches)

    total_actions = len(enriched_actions)
    cursor = 0

    while cursor < total_actions:
        # 构建当前批次
        action_batch: list[EnrichedAction] = []
        skip_noise_indices: list[int] = []

        for i in range(batch_size):
            if cursor + i >= total_actions:
                break
            action = enriched_actions[cursor + i]

            if action.skip or action.noise:
                interval = _compute_interval(action.timestamp, previous_timestamp)
                fallback = _build_fallback_step(action, interval)
                steps.append(fallback)
                skip_noise_indices.append(action.index)
                previous_timestamp = _normalize_timestamp(action.timestamp, previous_timestamp)
            else:
                action_batch.append(action)

        if not action_batch:
            cursor += len(skip_noise_indices)
            flush()
            continue

        # 构建上下文
        window_start = max(0, len(steps) - context_window_size)
        recent_steps = steps[window_start:]

        user_prompt = build_user_prompt(action_batch, recent_steps)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        start_idx = action_batch[0].index
        end_idx = action_batch[-1].index
        if log:
            log.info(f"[Phase 1] 正在处理批次: 操作 {start_idx}~{end_idx} (共 {len(action_batch)} 条)")

        try:
            call_id, raw_reply = await audit.call(
                {"phase": "phase1", "label": f"batch {start_idx}~{end_idx}", "extra": {"actionIndices": [a.index for a in action_batch]}},
                messages,
                {"temperature": 0, "max_tokens": 2000},
            )

            llm_raw_batches.append({"indexFrom": start_idx, "indexTo": end_idx, "raw": raw_reply})

            batch_result = parse_batch_xml_steps(raw_reply, action_batch, skip_noise_indices, log)

            batch_problems = [f"[{e['type']}] index={e.get('index', 'batch')}: {e['reason']}" for e in batch_result["errors"]]
            batch_ok = (
                len(batch_result["parsed_steps"]) == len(action_batch)
                and len(batch_result["failed_indices"]) == 0
                and len(batch_problems) == 0
            )

            audit.mark_outcome(call_id, {
                "ok": batch_ok,
                "problems": batch_problems if not batch_ok else [],
                "details": {
                    "parsedCount": len(batch_result["parsed_steps"]),
                    "expectedCount": len(action_batch),
                    "failedIndices": batch_result["failed_indices"],
                },
            })

            # 处理解析结果
            for parsed in batch_result["parsed_steps"]:
                matched = next((a for a in action_batch if a.index == parsed["index"]), None)
                if not matched:
                    continue
                interval = _compute_interval(matched.timestamp, previous_timestamp)
                step = _normalize_step(parsed, matched, interval)
                steps.append(step)
                previous_timestamp = _normalize_timestamp(matched.timestamp, previous_timestamp)

            # 处理失败条目
            for failed_idx in batch_result["failed_indices"]:
                matched = next((a for a in action_batch if a.index == failed_idx), None)
                if matched:
                    interval = _compute_interval(matched.timestamp, previous_timestamp)
                    specific_error = next((e for e in batch_result["errors"] if e.get("index") == failed_idx), None)
                    fallback = _build_fallback_step(matched, interval, specific_error.get("reason") if specific_error else None)
                    steps.append(fallback)
                    errors.append({
                        "index": failed_idx,
                        "type": "batch-fallback",
                        "reason": specific_error["reason"] if specific_error else "批次 XML 解析失败",
                    })
                    previous_timestamp = _normalize_timestamp(matched.timestamp, previous_timestamp)

        except Exception as e:
            if log:
                log.error(f"[Phase 1] 批次 {start_idx}~{end_idx} 处理失败: {e}")
            for action in action_batch:
                interval = _compute_interval(action.timestamp, previous_timestamp)
                fallback = _build_fallback_step(action, interval, str(e))
                steps.append(fallback)
                errors.append({"index": action.index, "type": "batch-exception-fallback", "reason": str(e)})
                previous_timestamp = _normalize_timestamp(action.timestamp, previous_timestamp)

        cursor += batch_size
        flush()

    return steps, errors


# ==================== 工具函数 ====================


def _normalize_step(parsed: dict, action: EnrichedAction, interval: int | None) -> StructuredStep:
    action_kind = _normalize_action_kind(parsed.get("actionKind") or _derive_action_kind(action))
    return StructuredStep(
        index=action.index,
        status="normal",
        description=_to_single_line(parsed.get("description", "")),
        ui_change=_to_single_line(parsed.get("uiChange", "")) or "无可见变化",
        page=_to_single_line(parsed.get("page", "")) or (action.page_title or "未知"),
        basis=["xml:action", "xml:observation"],
        action_kind=action_kind,
        target=_to_single_line(parsed.get("target", "")) or _derive_target(action),
        input_text=_to_single_line(parsed.get("inputText", "")) or (getattr(action, "input_value", None) or ""),
        key=_to_single_line(parsed.get("key", "")) or (getattr(action, "key", None) or ""),
        assert_text="",
        confidence=0.7,
        interval_from_previous_ms=interval,
        url=action.url or "",
        source_type=action.type or "unknown",
    )


def _build_fallback_step(action: EnrichedAction, interval: int | None, reason: str | None = None) -> StructuredStep:
    is_noise = bool(action.noise)
    is_skip = bool(action.skip)
    return StructuredStep(
        index=action.index,
        status="skip" if is_skip else ("noise" if is_noise else "fallback"),
        description=_derive_fallback_description(action),
        ui_change=_derive_ui_change(action),
        page=action.page_title or "未知",
        basis=[
            f"skip: {action.skip}" if is_skip else "",
            f"noise: {action.noise_reason or 'UI 无变化'}" if is_noise else "",
            f"fallbackReason: {reason}" if reason else "",
        ],
        action_kind=_derive_action_kind(action),
        target=_derive_target(action),
        input_text=getattr(action, "input_value", None) or "",
        key=getattr(action, "key", None) or "",
        confidence=0.4,
        interval_from_previous_ms=interval,
        url=action.url or "",
        source_type=action.type or "unknown",
    )


def _derive_fallback_description(action: EnrichedAction) -> str:
    el = action.element
    identify = el.label or el.text or el.placeholder or el.name or el.id or "目标元素"
    if action.type == "dblclick":
        return f"双击 {identify}"
    if action.type == "rightclick":
        return f"右键点击 {identify}"
    if action.type == "keypress":
        return f"按下按键 {action.key or ''}".strip()
    if action.type == "input":
        return f"在 {identify} 输入 {getattr(action, 'input_value', None) or ''}".strip()
    if action.type == "click":
        return f"点击 {identify}"
    return f"执行 {action.type or '未知'} 操作"


def _derive_action_kind(action: EnrichedAction) -> str:
    map_ = {"dblclick": "doubleClick", "rightclick": "rightClick", "keypress": "keyPress", "input": "input", "click": "click"}
    return map_.get(action.type, "other")


def _derive_target(action: EnrichedAction) -> str:
    el = action.element
    return el.label or el.text or el.placeholder or el.name or el.id or el.tag or ""


def _derive_ui_change(action: EnrichedAction) -> str:
    diff = getattr(action, "snapshot_diff", None) or ""
    if not diff or "完全相同" in diff or "无变化" in diff:
        return "无可见变化"
    return "界面状态发生变化"


def _normalize_action_kind(value: str) -> str:
    map_ = {
        "click": "click", "doubleClick": "doubleClick", "dblclick": "doubleClick",
        "rightClick": "rightClick", "rightclick": "rightClick",
        "keyPress": "keyPress", "keypress": "keyPress",
        "input": "input", "assert": "assert", "sleep": "sleep", "other": "other",
    }
    return map_.get(value.strip(), "other")


def _compute_interval(current: int, previous: int | None) -> int | None:
    if previous is None or current <= 0:
        return None
    delta = current - previous
    return delta if delta >= 0 else None


def _normalize_timestamp(value: int | None, fallback: int | None) -> int | None:
    if value and value > 0:
        return value
    return fallback


def _to_single_line(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


import re


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def _write_xml_artifacts(run_dir: Path, steps: list[StructuredStep], llm_raw_batches: list[dict]) -> None:
    phase1_dir = run_dir / "translate" / "phase1"
    phase1_dir.mkdir(parents=True, exist_ok=True)

    # structured_steps.xml
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<steps>']
    for s in steps:
        status = f' status="{s.status}"' if s.status else ""
        lines.append(f'  <step id="{s.index}"{status}>')
        lines.append(f"    <action>{_xml_escape(s.description)}</action>")
        lines.append(f"    <observation>{_xml_escape(s.ui_change)}</observation>")
        lines.append("  </step>")
    lines.append("</steps>")
    (phase1_dir / "structured_steps.xml").write_text("\n".join(lines) + "\n", "utf-8")

    # llm_raw_batches.xml
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<phase1_llm_batches>']
    for batch in llm_raw_batches:
        lines.append(f'  <batch indexFrom="{batch["indexFrom"]}" indexTo="{batch["indexTo"]}">')
        lines.append("    <![CDATA[")
        lines.append(batch["raw"])
        lines.append("    ]]>")
        lines.append("  </batch>")
    lines.append("</phase1_llm_batches>")
    (phase1_dir / "llm_raw_batches.xml").write_text("\n".join(lines) + "\n", "utf-8")


def _xml_escape(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

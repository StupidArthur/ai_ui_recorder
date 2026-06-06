"""XML 解析工具：预处理、step 解析、agent_chunk 解析、滑动窗口钳制"""

from __future__ import annotations

import re
from xml.etree import ElementTree as ET

from .client import clean_markdown_fence
from .config import (
    PHASE1_LLM_RAW_MAX_CHARS,
    SLIDING_WINDOW_MAX_ROUND_MULTIPLIER,
    XML_REGEX_ACTION_OBS_MAX_CHARS,
    XML_REGEX_LOGICAL_STEP_MAX_CHARS,
    XML_REGEX_MICRO_MAX_CHARS,
    XML_REGEX_STEP_BLOCK_MAX_CHARS,
)


def preprocess_llm_xml_output(raw: str, max_chars: int = PHASE1_LLM_RAW_MAX_CHARS) -> tuple[str, bool]:
    """预处理 LLM 原始文本（去围栏 / BOM / 换行 / 截断）"""
    text = clean_markdown_fence(raw or "")
    text = text.replace("﻿", "")
    text = text.replace("\r\n", "\n")

    truncated = False
    if len(text) > max_chars:
        text = text[:max_chars]
        truncated = True

    return text, truncated


def _to_single_line(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _bounded_cross_line(max_chars: int) -> str:
    n = max(1, int(max_chars))
    return rf"[\s\S]{{0,{n}}}?"


# ==================== Phase 1: parse_steps_xml ====================


def parse_steps_xml(raw_reply: str, expected_ids: set[int] | None = None) -> list[dict]:
    """
    解析 Phase 1 LLM 返回的 <steps> XML。
    先 etree 后正则。
    """
    text, _ = preprocess_llm_xml_output(raw_reply)

    # 快速路径：etree
    try:
        # 包裹一层确保有根节点
        if not text.strip().startswith("<steps"):
            text = f"<steps>{text}</steps>"
        root = ET.fromstring(text)
        steps = []
        for step_el in root.findall(".//step"):
            step_id = int(step_el.get("id", "0"))
            if expected_ids is not None and step_id not in expected_ids:
                continue
            action_el = step_el.find("action")
            obs_el = step_el.find("observation")
            steps.append({
                "id": step_id,
                "action": action_el.text.strip() if action_el is not None and action_el.text else "",
                "observation": obs_el.text.strip() if obs_el is not None and obs_el.text else "",
            })
        if steps:
            return steps
    except ET.ParseError:
        pass

    # 兼容路径：正则
    return _regex_extract_steps(text)


def _regex_extract_steps(text: str) -> list[dict]:
    """正则提取 <step> 块（与 Node.js robustExtractSteps 行为一致）"""
    if "</step>" not in text.lower():
        return []

    by_id: dict[int, dict] = {}
    block_pat = re.compile(
        rf'<step[^>]*\bid\s*=\s*["\']?(\d+)["\']?[^>]*>({_bounded_cross_line(XML_REGEX_STEP_BLOCK_MAX_CHARS)})</step>',
        re.IGNORECASE,
    )

    for match in block_pat.finditer(text):
        step_id = int(match.group(1))
        inner = match.group(2) or ""

        action_m = re.search(
            rf"<action[^>]*>({_bounded_cross_line(XML_REGEX_ACTION_OBS_MAX_CHARS)})</action>",
            inner, re.IGNORECASE,
        )
        obs_m = re.search(
            rf"<observation[^>]*>({_bounded_cross_line(XML_REGEX_ACTION_OBS_MAX_CHARS)})</observation>",
            inner, re.IGNORECASE,
        )

        action = _to_single_line(action_m.group(1)) if action_m else ""
        observation = _to_single_line(obs_m.group(1)) if obs_m else ""

        if not action and not observation:
            loose = _to_single_line(inner)
            if loose:
                action = loose
                observation = "无可见变化"

        if not action:
            continue

        if step_id not in by_id:
            by_id[step_id] = {"id": step_id, "action": action, "observation": observation}

    return list(by_id.values())


def parse_batch_xml_steps(
    raw_reply: str,
    action_batch: list,
    skip_noise_indices: list[int],
    log=None,
) -> dict:
    """
    解析 Phase 1 批次 LLM XML 回复，按 actionBatch index 对齐。

    返回: {"parsed_steps": [...], "failed_indices": [...], "errors": [...]}
    """
    parsed_steps = []
    failed_indices = []
    errors = []

    expected_ids = {a.index for a in action_batch}
    extracted = parse_steps_xml(raw_reply, expected_ids)

    by_id = {row["id"]: row for row in extracted}

    for action in action_batch:
        hit = by_id.get(action.index)
        if hit:
            parsed_steps.append({
                "index": action.index,
                "description": hit["action"],
                "uiChange": hit.get("observation", "无可见变化") or "无可见变化",
            })
        else:
            failed_indices.append(action.index)
            errors.append({
                "index": action.index,
                "type": "batch-missing-index",
                "reason": "LLM XML 未包含该 index",
            })

    if not parsed_steps and action_batch:
        errors.append({
            "index": action_batch[0].index,
            "type": "batch-parse-error",
            "reason": "未能从 XML 解析出任何有效 step",
        })
        for a in action_batch:
            if a.index not in failed_indices:
                failed_indices.append(a.index)

    return {"parsed_steps": parsed_steps, "failed_indices": failed_indices, "errors": errors}


# ==================== Phase 4: parse_agent_chunk_xml ====================


def parse_agent_chunk_xml(raw_reply: str) -> dict | None:
    """
    解析 Phase 4 agent_chunk XML。

    返回: {"use_case_name": ..., "use_case_purpose": ..., "agent_steps": [...], "total_consume": ...} 或 None
    """
    text, _ = preprocess_llm_xml_output(raw_reply)

    if "</agent_chunk>" not in text.lower() and "<agent_chunk" not in text.lower():
        return None

    chunk_m = re.search(r'<agent_chunk[^>]*\btotalConsume\s*=\s*["\']?(\d+)["\']?[^>]*>', text, re.IGNORECASE)
    total_consume = int(chunk_m.group(1)) if chunk_m else None

    use_case_name = None
    use_case_purpose = None
    uc_m = re.search(r'<use_case[^>]*\bname\s*=\s*["\']([^"\']*)["\'][^>]*\bpurpose\s*=\s*["\']([^"\']*)["\']', text, re.IGNORECASE)
    if not uc_m:
        uc_m = re.search(r'<use_case[^>]*\bname\s*=\s*["\']([^"\']*)["\']', text, re.IGNORECASE)
    if uc_m:
        use_case_name = _to_single_line(uc_m.group(1))
        if uc_m.lastindex and uc_m.lastindex >= 2:
            use_case_purpose = _to_single_line(uc_m.group(2))

    agent_steps = []
    logical_pat = re.compile(
        rf'<logical_step[^>]*\bconsume\s*=\s*["\']?(\d+)["\']?[^>]*>({_bounded_cross_line(XML_REGEX_LOGICAL_STEP_MAX_CHARS)})</logical_step>',
        re.IGNORECASE,
    )

    for lm in logical_pat.finditer(text):
        consume_step_count = int(lm.group(1)) or 1
        inner = lm.group(2) or ""

        name_m = re.search(rf"<name[^>]*>({_bounded_cross_line(XML_REGEX_MICRO_MAX_CHARS)})</name>", inner, re.IGNORECASE)
        logical_name = _to_single_line(name_m.group(1)) if name_m else "逻辑步骤"

        micro_pat = re.compile(rf"<micro[^>]*>({_bounded_cross_line(XML_REGEX_MICRO_MAX_CHARS)})", re.IGNORECASE)
        micro_actions = [_to_single_line(mm.group(1)) for mm in micro_pat.finditer(inner)]
        micro_actions = [m for m in micro_actions if m]

        if not micro_actions and logical_name:
            micro_actions = [logical_name]

        agent_steps.append({
            "logicalName": logical_name,
            "microActions": micro_actions,
            "consumeStepCount": max(1, consume_step_count),
        })

    if not agent_steps:
        return None

    if total_consume is None:
        total_consume = sum(s["consumeStepCount"] for s in agent_steps)

    return {
        "use_case_name": use_case_name,
        "use_case_purpose": use_case_purpose,
        "agent_steps": agent_steps,
        "total_consume": total_consume,
    }


# ==================== 滑动窗口工具 ====================


def clamp_window_consume(raw_consume, window_length: int) -> tuple[int, int | None, str | None]:
    """
    钳制滑动窗口消费步数（至少 1，至多窗口长度）。
    返回: (safe_consume, raw_consume, clamp_reason)
    """
    win_len = max(1, int(window_length))
    parsed = int(raw_consume) if raw_consume is not None else None
    has_num = parsed is not None
    raw = parsed if has_num and parsed > 0 else None

    clamp_reason = None
    if not has_num or (raw is not None and raw <= 0):
        clamp_reason = "zero-consume-clamped"
    elif raw is not None and raw > win_len:
        clamp_reason = "over-consume-clamped"

    safe_consume = max(1, min(raw if raw else 1, win_len))
    return safe_consume, raw, clamp_reason


def max_sliding_window_rounds(total_items: int, window_size: int) -> int:
    """滑动窗口最大允许轮次（保险丝）"""
    total = max(0, int(total_items))
    size = max(1, int(window_size))
    base = -(-total // size)  # ceil division
    fuse_from_window = max(1, base * SLIDING_WINDOW_MAX_ROUND_MULTIPLIER)
    return max(total, fuse_from_window)

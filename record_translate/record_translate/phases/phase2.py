"""Phase 2：滑动窗口归纳测试用例"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..audit import LlmAudit
from ..config import PHASE2_ASSERT_TEXT_MAX_CHARS, PHASE2_GAP_TAG_LONG_GAP_MS, PHASE2_WINDOW_MAX_TOKENS, PHASE2_WINDOW_SIZE
from ..models import StructuredStep
from ..prompts.case_generation import build_phase2_window_system_prompt, build_phase2_window_user_prompt
from ..xml_parse import clamp_window_consume, max_sliding_window_rounds


@dataclass
class Phase2Result:
    fallback_applied: bool = False
    fallback_indices: list[int] = field(default_factory=list)
    fallback_file: str | None = None


# ==================== Step 瘦身 ====================


def _build_route_key(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        from urllib.parse import urlparse
        u = urlparse(raw)
        key = u.path or ""
        if u.fragment:
            key += u.fragment.split("?")[0]
        return key.strip() or raw.split("?")[0][:200]
    except Exception:
        return raw.split("?")[0][:200]


def _build_gap_tag(interval_ms: int | None) -> str:
    ms = int(interval_ms) if interval_ms else 0
    if ms > PHASE2_GAP_TAG_LONG_GAP_MS:
        return "longGap"
    return "contiguous"


def _slim_step(step: StructuredStep) -> dict:
    action_kind = step.action_kind or "other"
    slim = {
        "index": step.index,
        "actionKind": action_kind,
        "description": (step.description or "").strip(),
        "uiChange": (step.ui_change or "").strip() or "无可见变化",
        "page": (step.page or "未知").strip(),
        "target": (step.target or "").strip(),
        "routeKey": _build_route_key(step.url),
        "gapTag": _build_gap_tag(step.interval_from_previous_ms),
    }
    if action_kind == "input" and step.input_text and step.input_text.strip():
        slim["inputText"] = step.input_text.strip()
    if action_kind == "keyPress" and step.key and step.key.strip():
        slim["key"] = step.key.strip()
    at = (step.assert_text or "").strip()
    if at:
        slim["assertText"] = at[:PHASE2_ASSERT_TEXT_MAX_CHARS]
    return slim


def _format_step_plain_text(step: dict | StructuredStep) -> str:
    if isinstance(step, StructuredStep):
        idx = step.index
        action = (step.description or "").strip() or "(无动作描述)"
        obs = (step.ui_change or "").strip() or "无可见变化"
    else:
        idx = step.get("index", "?")
        action = (step.get("description", "") or "").strip() or "(无动作描述)"
        obs = (step.get("uiChange", "") or "").strip() or "无可见变化"
    return f"步骤 {idx}:\n- 动作: {action}\n- 界面响应: {obs}"


def _format_steps_window(steps: list[dict]) -> str:
    return "\n\n".join(_format_step_plain_text(s) for s in steps)


# ==================== Phase 2 解析 ====================


def _parse_case_meta(raw_reply: str, expected_indices: list[int]) -> dict:
    """从 LLM 回复中解析 <case_meta> 和正文"""
    from ..client import clean_markdown_fence
    from ..xml_parse import preprocess_llm_xml_output

    text, _ = preprocess_llm_xml_output(clean_markdown_fence(raw_reply))

    # 提取 consumeStepCount
    meta_m = re.search(r'<case_meta[^>]*\bconsumeStepCount\s*=\s*["\']?(\d+)["\']?[^>]*/?>', text, re.IGNORECASE)
    raw_consume = int(meta_m.group(1)) if meta_m else None

    # 提取 lastIndex
    raw_last_index = None
    li_m = re.search(r'\blastIndex\s*=\s*["\']?(\d+)["\']?', text, re.IGNORECASE)
    if li_m:
        raw_last_index = int(li_m.group(1))

    # 去掉 meta 标签
    markdown_block = re.sub(r'<case_meta[^>]*/?>\s*', '', text).strip()
    if not markdown_block:
        markdown_block = "# 测试用例：未命名用例\n\n（模型未返回 Markdown 正文）"

    # consume 钳制
    win_len = len(expected_indices)
    safe_consume, raw_val, clamp_reason = clamp_window_consume(raw_consume, win_len)

    # lastIndex 校验（不覆盖 consume）
    if raw_last_index is not None and raw_last_index > 0 and win_len > 0:
        pos = expected_indices.index(raw_last_index) if raw_last_index in expected_indices else -1
        tail_at_consume = expected_indices[safe_consume - 1] if safe_consume <= len(expected_indices) else None
        if pos < 0:
            detail = f"lastIndex={raw_last_index} 不在本窗 index 列表，忽略"
            clamp_reason = f"{clamp_reason}; {detail}" if clamp_reason else detail
        elif tail_at_consume != raw_last_index:
            detail = f"lastIndex={raw_last_index} 与 consumeStepCount={safe_consume}(→index {tail_at_consume}) 不一致，以 consumeStepCount 为准"
            clamp_reason = f"{clamp_reason}; {detail}" if clamp_reason else detail

    covered_indices = expected_indices[:safe_consume]

    return {
        "markdown_block": markdown_block,
        "consume_step_count": safe_consume,
        "raw_consume": raw_val,
        "clamp_reason": clamp_reason,
        "covered_action_indices": covered_indices,
    }


# ==================== 全局 index 归一化 ====================


_STEP_INDEX_PATTERNS = [
    re.compile(r'\[步骤\s*(\d+)\]', re.IGNORECASE),
    re.compile(r'###\s*(?:\[)?步骤\s*(\d+)', re.IGNORECASE),
    re.compile(r'步骤\s*(\d+)\s*[：:]', re.IGNORECASE),
]


def _extract_mentioned_indices(markdown: str) -> set[int]:
    """从 Case 正文中提取被引用的步骤 index"""
    found: set[int] = set()
    for pat in _STEP_INDEX_PATTERNS:
        for m in pat.finditer(markdown):
            n = int(m.group(1))
            if n > 0:
                found.add(n)
    return found


def _normalize_case_to_global_indices(markdown: str, covered_indices: list[int]) -> str:
    """将 Case 正文中的窗内序号改写为全局 index"""
    if not covered_indices:
        return markdown

    first_global = covered_indices[0]
    n = len(covered_indices)
    md = markdown
    mentioned = _extract_mentioned_indices(md)

    # 如果已经有全局 index，不需要改写
    if any(i >= first_global for i in mentioned):
        return md
    if not mentioned:
        return md
    if not all(1 <= i <= n for i in mentioned):
        return md

    for local in range(1, n + 1):
        global_idx = covered_indices[local - 1]
        if global_idx is None:
            continue
        md = re.sub(rf'(###\s*)(?:\[)?步骤\s*{local}\b', rf'\1[步骤 {global_idx}]', md, flags=re.IGNORECASE)
        md = re.sub(rf'\[步骤\s*{local}\]', f'[步骤 {global_idx}]', md, flags=re.IGNORECASE)
        md = re.sub(rf'步骤\s*{local}\s*([：:])', f'[步骤 {global_idx}]\\1', md, flags=re.IGNORECASE)

    return md


def _is_redundant(markdown: str, prev_case_blocks: list[dict], covered_indices: list[int]) -> bool:
    """检查本窗 Case 是否与先前 Case 重复"""
    if not covered_indices:
        return False
    prev_md = "\n\n".join(b.get("markdown_block", "") for b in prev_case_blocks)
    prev_mentioned = _extract_mentioned_indices(prev_md)
    if not all(idx in prev_mentioned for idx in covered_indices):
        return False
    new_mentioned = _extract_mentioned_indices(markdown)
    if not new_mentioned:
        return True
    return all(i in prev_mentioned for i in new_mentioned)


# ==================== 兜底逻辑 ====================


def _render_supplemental_case(steps: list[StructuredStep], title: str) -> str:
    """将遗漏步骤补成可读 Case（不调用 LLM）"""
    if not steps:
        return ""
    md = f"# 测试用例：{title}\n\n"
    md += "> 本段由程序根据 Phase 1 结构化步骤自动补全（LLM Case 正文未覆盖这些 index）。\n\n"
    md += "## 1. 业务背景与初始状态\n"
    md += "录制流中上述步骤已发生，但 Phase 2 归纳未写入对应业务描述，此处按 Phase 1 动作与界面响应原样列出供核对。\n\n"
    md += "## 2. 测试步骤流\n\n"
    for s in steps:
        action = (s.description or "").strip() or "(无动作描述)"
        obs = (s.ui_change or "").strip() or "无可见变化"
        md += f"### [步骤 {s.index}] {action}\n"
        md += f"- **执行动作**：{action}\n"
        md += f"- **状态验证**：{obs}\n\n"
    return md.rstrip()


def _render_coverage_table(steps: list[StructuredStep], all_cases_md: str) -> str:
    """渲染覆盖核对表"""
    mentioned = _extract_mentioned_indices(all_cases_md)
    normal_steps = [s for s in steps if s.status in ("normal", "fallback", "")]

    md = "## 覆盖表\n\n"
    md += "| index | status | 是否出现在 Case 正文 | 操作摘要 |\n"
    md += "|------:|--------|:--------------------:|----------|\n"

    missing = 0
    for s in normal_steps:
        ok = s.index in mentioned
        if not ok and s.status not in ("noise", "skip"):
            missing += 1
        flag = "是" if ok else "**否**"
        summary = (s.description or "")[:60].replace("|", "\\|").replace("\n", " ")
        md += f"| {s.index} | {s.status or 'normal'} | {flag} | {summary} |\n"

    if missing > 0:
        md += f"\n> 仍有 **{missing}** 条有效步骤未在 Case 正文中被引用。\n"
    else:
        md += "\n> 所有有效步骤均在 Case 正文或程序补全段中有对应 index 引用。\n"

    return md


# ==================== 主入口 ====================


async def run_phase2(
    run_dir: Path,
    steps: list[StructuredStep],
    *,
    window_size: int = PHASE2_WINDOW_SIZE,
    audit: LlmAudit,
    log=None,
) -> Phase2Result:
    """
    Phase 2：滑动窗口归纳测试用例。
    """
    phase2_dir = run_dir / "translate" / "phase2"
    phase2_dir.mkdir(parents=True, exist_ok=True)

    # 过滤有效步骤
    effective = [s for s in steps if s.status in ("normal", "fallback")]
    slim_all = [_slim_step(s) for s in effective]

    if not slim_all:
        empty_doc = "# 录制流程测试用例归纳\n\n> 无有效步骤（均为 noise/skip/fallback 等），未生成 Case。\n"
        (phase2_dir / "cases.md").write_text(empty_doc, "utf-8")
        (phase2_dir / "coverage.md").write_text("# Case 覆盖核对\n\n> 无有效步骤，未生成 Case。\n", "utf-8")
        if log:
            log.warning("[Phase 2] 无有效步骤，已写入空文档")
        return Phase2Result()

    case_blocks: list[dict] = []
    system_prompt = build_phase2_window_system_prompt()
    max_rounds = max_sliding_window_rounds(len(slim_all), window_size)

    cursor = 0
    round_num = 0

    while cursor < len(slim_all):
        round_num += 1
        if round_num > max_rounds:
            if log:
                log.warning(f"[Phase 2] 已达最大轮次 {max_rounds}，剩余步骤本地兜底")
            remain = slim_all[cursor:]
            case_blocks.append({"markdown_block": f"# 测试用例：剩余步骤（本地兜底）\n\n{_format_steps_window(remain)}"})
            cursor = len(slim_all)
            break

        window_slim = slim_all[cursor : cursor + window_size]
        expected_indices = [s["index"] for s in window_slim]
        index_list_text = json.dumps(expected_indices)
        window_text = _format_steps_window(window_slim)

        if log:
            log.info(f"[Phase 2] 轮次 {round_num}, cursor={cursor}, 窗口步数 {len(window_slim)}, index {expected_indices[0]}~{expected_indices[-1]}")

        user_prompt = build_phase2_window_user_prompt(window_text, index_list_text)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        call_id = None
        try:
            call_id, raw_reply = await audit.call(
                {"phase": "phase2", "label": f"round {round_num} index {expected_indices[0]}~{expected_indices[-1]}", "extra": {"round": round_num, "expectedIndices": expected_indices}},
                messages,
                {"temperature": 0.3, "max_tokens": PHASE2_WINDOW_MAX_TOKENS},
            )

            if not raw_reply:
                raise ValueError(f"[Phase 2] 轮次 {round_num} AI 返回空结果")

            parsed = _parse_case_meta(raw_reply, expected_indices)

            problems = []
            if parsed["clamp_reason"]:
                problems.append(f"consume clamp: {parsed['clamp_reason']} (raw={parsed['raw_consume']})")

            audit.mark_outcome(call_id, {
                "ok": True,
                "problems": problems,
                "details": {
                    "consumeStepCount": parsed["consume_step_count"],
                    "rawConsume": parsed["raw_consume"],
                    "coveredActionIndices": parsed["covered_action_indices"],
                },
            })

            normalized_block = _normalize_case_to_global_indices(
                parsed["markdown_block"].strip(),
                parsed["covered_action_indices"],
            )

            if _is_redundant(normalized_block, case_blocks, parsed["covered_action_indices"]):
                if log:
                    log.warning(f"[Phase 2] 轮次 {round_num} 跳过重复 Case")
            else:
                case_blocks.append({"markdown_block": normalized_block})

            consumed = parsed["consume_step_count"]
            if log:
                log.info(f"[Phase 2] 轮次 {round_num} 消费 {consumed} 步")
            cursor += consumed

        except Exception as e:
            if call_id:
                audit.mark_outcome(call_id, {"ok": False, "problems": [str(e)]})
            fallback_consume = 1
            case_blocks.append({"markdown_block": f"# 测试用例：解析失败兜底\n\n{_format_steps_window(window_slim[:fallback_consume])}\n\n> {e}"})
            cursor += fallback_consume
            if log:
                log.warning(f"[Phase 2] 轮次 {round_num} 解析失败: {e}")

    # ========== 严格模式兜底判定 ==========
    main_cases_md = "# 录制流程测试用例归纳\n\n" + "\n\n---\n\n".join(b["markdown_block"] for b in case_blocks)
    mentioned_in_main = _extract_mentioned_indices(main_cases_md)
    all_normal = [s for s in steps if s.status in ("normal", "fallback", "")]
    uncovered = [s for s in all_normal if s.index not in mentioned_in_main]

    result = Phase2Result()
    fallback_text = ""

    if uncovered:
        result.fallback_applied = True
        result.fallback_indices = [s.index for s in uncovered]
        fallback_text = _render_supplemental_case(uncovered, f"未覆盖步骤（程序补全，共 {len(uncovered)} 步）")
        if log:
            log.warning(f"[Phase 2] 兜底介入：缺失 index {','.join(str(i) for i in result.fallback_indices)}（共 {len(uncovered)} 步）")

    # 写出主结果（仅主流程，不含兜底段）
    (phase2_dir / "cases.md").write_text(main_cases_md, "utf-8")
    if log:
        log.info(f"[Phase 2] 主结果: {phase2_dir / 'cases.md'}")

    # 写出兜底结果
    fallback_file = phase2_dir / "cases_fallback.md"
    if result.fallback_applied and fallback_text:
        doc = f"# Phase 2 兜底补全\n\n> ⚠️ 本次翻译触发了兜底补全：以下步骤未被 LLM 主流程覆盖。\n\n**缺失 index**：{','.join(str(i) for i in result.fallback_indices)}（共 {len(result.fallback_indices)} 步）\n\n---\n\n{fallback_text}"
        fallback_file.write_text(doc, "utf-8")
        result.fallback_file = str(fallback_file)
        if log:
            log.warning(f"[Phase 2] 兜底结果: {fallback_file}")
    else:
        if fallback_file.exists():
            fallback_file.write_text("# Phase 2 兜底补全\n\n> 本次翻译未触发兜底。\n", "utf-8")

    # 覆盖核对表
    coverage_file = phase2_dir / "coverage.md"
    coverage_text = "# Case 覆盖核对\n\n> 用例正文见 `translate/phase2/cases.md`；Phase 1 全量步骤见 `translate/phase1/structured_steps.json`。\n\n" + _render_coverage_table(steps, main_cases_md)
    coverage_file.write_text(coverage_text, "utf-8")
    if log:
        log.info(f"[Phase 2] 覆盖核对表: {coverage_file}")

    return result

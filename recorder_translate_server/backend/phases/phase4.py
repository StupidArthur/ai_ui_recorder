"""Phase 4：生成 Agent 可执行用例"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from ..audit import LlmAudit
from ..config import PHASE4_WINDOW_SIZE
from ..models import StructuredStep
from ..prompts.agent_txt import build_agent_txt_system_prompt, build_agent_txt_user_prompt
from ..xml_parse import clamp_window_consume, max_sliding_window_rounds, parse_agent_chunk_xml

from .phase2 import _format_step_plain_text, _slim_step

# 进度回调签名：(phase, in_step, in_total, message)
ProgressCallback = Callable[[str, int, int, str], None]


def _format_micro_action(step: StructuredStep) -> str:
    target = step.target or "目标元素"
    if step.action_kind == "input":
        val = "******" if step.input_text == "[MASKED]" else (step.input_text or "")
        return f"在「{target}」输入 {val}" if val else f"在「{target}」输入内容"
    if step.action_kind == "keyPress":
        return f"在「{target}」按下 {step.key or 'Enter'} 键"
    if step.action_kind == "doubleClick":
        return f"双击「{target}」"
    if step.action_kind == "rightClick":
        return f"右键点击「{target}」"
    return f"点击「{target}」"


def _build_local_steps(chunk: list[StructuredStep]) -> list[dict]:
    """本地兜底：每条 step 对应一个逻辑步骤"""
    return [
        {
            "logicalName": s.description or f"操作 {s.index}",
            "microActions": [_format_micro_action(s)],
            "consumeStepCount": 1,
        }
        for s in chunk
    ]


def _derive_use_case_name(steps: list[StructuredStep]) -> str:
    first = steps[0] if steps else None
    if not first:
        return "未命名测试用例"
    page = first.page if first.page and first.page != "未知" else ""
    desc = first.description or ""
    if page and desc:
        return f"{page} - {desc[:30]}"
    return desc[:40] or page or "录制流程测试用例"


async def run_phase4(
    run_dir: Path,
    steps: list[StructuredStep],
    *,
    window_size: int = PHASE4_WINDOW_SIZE,
    audit: LlmAudit,
    log=None,
    progress_callback: ProgressCallback | None = None,
) -> tuple[Path | None, int]:
    """
    Phase 4：生成 Agent 可执行用例。
    返回 (agents.txt 路径, n_llm_calls)；无有效步骤时返回 (None, 0)。
    """
    effective = [s for s in steps if s.status in ("normal", "fallback")]
    if not effective:
        if log:
            log.warning("[Agent TXT] 无有效步骤，跳过生成")
        return None, 0

    system_prompt = build_agent_txt_system_prompt()
    max_rounds = max_sliding_window_rounds(len(effective), window_size)

    cursor = 0
    global_agent_steps: list[dict] = []
    global_use_case_name = _derive_use_case_name(effective)
    global_use_case_purpose = "验证录制业务流程可正常执行"
    used_local_fallback = False
    round_num = 0
    n_llm_calls = 0

    while cursor < len(effective):
        round_num += 1
        if round_num > max_rounds:
            if log:
                log.warning(f"[Agent TXT] 已达最大轮次 {max_rounds}，剩余步骤本地兜底")
            global_agent_steps.extend(_build_local_steps(effective[cursor:]))
            used_local_fallback = True
            cursor = len(effective)
            break

        chunk = effective[cursor : cursor + window_size]
        window_text = "\n\n".join(_format_step_plain_text(s) for s in chunk)

        if log:
            log.info(f"[Agent TXT] 正在处理步骤 {cursor + 1}~{cursor + len(chunk)}...")

        # 进度回调：LLM 调用前触发
        if progress_callback is not None:
            try:
                progress_callback(
                    "phase4", n_llm_calls, 0,
                    f"[Phase 4] 批 {round_num}/{max_rounds} 步骤 {cursor + 1}~{cursor + len(chunk)}",
                )
            except Exception:
                if log:
                    log.exception("[Phase 4] progress_callback raised")

        user_prompt = build_agent_txt_user_prompt(window_text)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        call_id = None
        try:
            call_id, raw_reply = await audit.call(
                {"phase": "phase4", "label": f"chunk {cursor + 1}~{cursor + len(chunk)}", "extra": {"stepIndices": [s.index for s in chunk], "round": round_num}},
                messages,
                {"temperature": 0.1, "max_tokens": 2000},
            )

            parsed = parse_agent_chunk_xml(raw_reply)
            parse_ok = parsed is not None and parsed.get("agent_steps")

            problems = [] if parse_ok else ["agent_chunk XML 解析失败或 agentSteps 为空"]

            safe_consume = len(chunk)
            raw_consume = None
            clamp_reason = None

            if parse_ok and parsed["total_consume"] is not None:
                safe_consume, raw_consume, clamp_reason = clamp_window_consume(parsed["total_consume"], len(chunk))
                if clamp_reason:
                    problems.append(clamp_reason)

            audit.mark_outcome(call_id, {
                "ok": parse_ok,
                "problems": problems,
                "details": {
                    "useCaseName": parsed.get("use_case_name") if parsed else None,
                    "agentStepCount": len(parsed.get("agent_steps", [])) if parsed else 0,
                    "totalConsume": parsed.get("total_consume") if parsed else None,
                    "safeConsume": safe_consume,
                },
            })

            if not parsed or not parsed.get("agent_steps"):
                global_agent_steps.extend(_build_local_steps(chunk))
                used_local_fallback = True
                cursor += len(chunk)
                n_llm_calls += 1
                continue

            if cursor == 0 and parsed.get("use_case_name"):
                global_use_case_name = parsed["use_case_name"]
                if parsed.get("use_case_purpose"):
                    global_use_case_purpose = parsed["use_case_purpose"]

            consumed = 0
            for logical_step in parsed["agent_steps"]:
                global_agent_steps.append(logical_step)
                consumed += logical_step.get("consumeStepCount", 1)
                if consumed >= safe_consume:
                    break

            cursor += safe_consume
            if log:
                log.info(f"[Agent TXT] 轮次 {round_num} 消费 {safe_consume} 步")

        except Exception as e:
            if call_id:
                audit.mark_outcome(call_id, {"ok": False, "problems": [str(e)]})
            if log:
                log.warning(f"[Agent TXT] LLM 失败 ({e})，使用本地兜底")
            global_agent_steps.extend(_build_local_steps(chunk))
            used_local_fallback = True
            cursor += len(chunk)

        n_llm_calls += 1

    if not global_agent_steps:
        global_agent_steps = _build_local_steps(effective)
        used_local_fallback = True

    # 渲染 TXT
    txt = f"测试用例名称：{global_use_case_name}\n测试目的：{global_use_case_purpose}\n\n测试步骤：\n\n"
    for i, step in enumerate(global_agent_steps):
        txt += f"步骤{i + 1}: {step.get('logicalName', f'逻辑步骤 {i + 1}')}\n"
        actions = step.get("microActions", [])
        if not actions:
            txt += "- （无微观动作描述）\n"
        else:
            for action in actions:
                txt += f"- {action}\n"
        txt += "\n"

    agents_file = run_dir / "translate" / "phase4" / "agents.txt"
    agents_file.parent.mkdir(parents=True, exist_ok=True)
    agents_file.write_text(txt.strip(), "utf-8")

    if log:
        log.info(f"[Agent TXT] 生成成功 ({len(global_agent_steps)} 个逻辑步骤)，文件: {agents_file}")

    return agents_file, n_llm_calls

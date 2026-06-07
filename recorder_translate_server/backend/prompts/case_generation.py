"""Phase 2 固定窗口 Case 归纳 Prompt 入口"""

from __future__ import annotations

from .loader import load_prompt_md


def build_phase2_window_system_prompt() -> str:
    """构建 Phase 2 单窗口 System Prompt"""
    return load_prompt_md("steps-2-cases-skill.md")


def build_phase2_window_user_prompt(window_steps_plain_text: str, index_list_text: str) -> str:
    """构建 Phase 2 单窗口 User Prompt"""
    return f"""本窗口底层步骤记录（纯文本）：

{window_steps_plain_text}

本窗口可用 index 列表（consumeStepCount 对应前缀连续子集，从这里取）：{index_list_text}

请归纳成 1 个 Case，输出 Markdown 正文，最后一行输出 <case_meta consumeStepCount="N" lastIndex="..."/>。禁止 JSON。"""

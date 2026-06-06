"""Phase 4 Agent TXT Prompt 入口"""

from __future__ import annotations

from .loader import load_prompt_md


def build_agent_txt_system_prompt() -> str:
    """构建 Phase 4 Agent TXT 的 System Prompt"""
    return load_prompt_md("case-4-agents-skill.md")


def build_agent_txt_user_prompt(steps_plain_text: str) -> str:
    """构建 Phase 4 Agent TXT 的 User Prompt"""
    return f"""请根据以下按时间顺序排列的底层步骤记录（纯文本），进行业务逻辑聚合并输出 <agent_chunk> XML：

{steps_plain_text}"""

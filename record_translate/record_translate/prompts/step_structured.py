"""Phase 1 微批处理 Prompt 入口"""

from __future__ import annotations

from .loader import load_prompt_md


def build_system_prompt() -> str:
    """构建 Phase 1 批处理 System Prompt"""
    return load_prompt_md("snapshots-2-steps-skill.md")


def build_user_prompt(enriched_actions_batch: list, recent_steps: list) -> str:
    """构建 Phase 1 批处理 User Prompt"""
    # 历史上下文
    if recent_steps:
        context_history = "\n".join(
            f"[Index {s.index}] {s.description} -> 变化: {s.ui_change}"
            for s in recent_steps[-3:]
        )
    else:
        context_history = "(无历史上下文，这是起始操作)"

    # 本批 action
    action_count = len(enriched_actions_batch)
    action_blocks = []
    for i, action in enumerate(enriched_actions_batch):
        header = f"=============【动作 Index: {action.index} (第 {i + 1}/{action_count} 个)】============="
        import json
        body = json.dumps({
            "type": action.type,
            "timestamp": action.timestamp,
            "element": action.element.model_dump(by_alias=True) if hasattr(action.element, "model_dump") else action.element,
            "formStateDelta": action.form_state,
            "snapshotDiff": action.snapshot_diff,
        }, ensure_ascii=False, indent=2)
        action_blocks.append(f"{header}\n{body}\n")

    return f"""【历史上下文参考】
以下是发生在本次批处理之前的最近几次动作解析结果，仅供你理解上下文逻辑，**不需要**在你的输出中包含它们：
{context_history}

【本次需要解析的动作数组】
注意：以下共有 {action_count} 个动作。你必须输出 {action_count} 个解析结果。

{"".join(action_blocks)}
请立即开始解析，并严格按照 System Prompt 的 Output Format 输出 JSON 对象。"""

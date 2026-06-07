"""噪声检测模块"""

from __future__ import annotations

from ..models import EnrichedAction


def detect_noise(
    enriched: EnrichedAction,
    is_first: bool,
    is_last: bool,
) -> tuple[bool, str | None]:
    """
    噪声检测：判断一条已富化的 action 是否为无意义噪声。

    返回: (is_noise, reason)
    """
    # 首尾 action 不判噪声
    if is_first or is_last:
        return False, None

    # 已被标记为 skip 或已被识别为 input 的，不再判噪声
    if enriched.skip or enriched.type == "input":
        return False, None

    # 只对 click 类型判断噪声
    if enriched.type != "click":
        return False, None

    # 条件 1：diff 为空或无变化
    if not _is_diff_empty(enriched.snapshot_diff):
        return False, None

    # 条件 2：formState 无变化
    if enriched.form_state_changes and enriched.form_state_changes.get("hasChanges"):
        return False, None

    return True, "diff-empty + formState-unchanged"


def _is_diff_empty(diff_text: str | None) -> bool:
    """判断 snapshot diff 是否为空（无实质变化）"""
    if not diff_text:
        return True
    if "完全相同" in diff_text:
        return True
    if not diff_text.strip():
        return True

    # diff 文本中没有 + 或 - 开头的行
    lines = diff_text.split("\n")
    has_changes = any(
        (line.lstrip().startswith("+") and not line.lstrip().startswith("+++"))
        or (line.lstrip().startswith("-") and not line.lstrip().startswith("---"))
        for line in lines
    )
    return not has_changes

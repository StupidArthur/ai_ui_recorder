"""表单状态差异计算模块"""

from __future__ import annotations

from typing import Any


def compute_form_state_changes(
    prev_form_state: dict[str, Any] | None,
    curr_form_state: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    计算两次 formState 之间的差异。

    返回:
        {
            "changed": { xpath: {"from": ..., "to": ...} },
            "added": { xpath: value },
            "removed": { xpath: value },
            "hasChanges": bool
        }
    """
    result: dict[str, Any] = {
        "changed": {},
        "added": {},
        "removed": {},
        "hasChanges": False,
    }

    prev = prev_form_state or {}
    curr = curr_form_state or {}

    prev_keys = set(prev.keys())
    curr_keys = set(curr.keys())

    # 检查值变化和新增
    for key in curr_keys:
        if key in prev_keys:
            if not _is_equal(prev[key], curr[key]):
                result["changed"][key] = {"from": prev[key], "to": curr[key]}
                result["hasChanges"] = True
        else:
            result["added"][key] = curr[key]
            result["hasChanges"] = True

    # 检查消失的元素
    for key in prev_keys:
        if key not in curr_keys:
            result["removed"][key] = prev[key]
            result["hasChanges"] = True

    return result


def format_form_state_changes(changes: dict[str, Any] | None) -> str | None:
    """将 formState 差异格式化为人类可读的文本摘要"""
    if not changes or not changes.get("hasChanges"):
        return None

    lines: list[str] = []

    for selector, delta in changes.get("changed", {}).items():
        lines.append(f"[变化] {selector}: \"{delta.get('from', '')}\" → \"{delta.get('to', '')}\"")

    for selector, value in changes.get("added", {}).items():
        lines.append(f"[新增] {selector}: \"{value}\"")

    for selector, value in changes.get("removed", {}).items():
        lines.append(f"[消失] {selector}: \"{value}\"")

    return "\n".join(lines) if lines else None


def _is_equal(a: Any, b: Any) -> bool:
    """简单的值相等比较（支持基本类型和简单对象）"""
    if a is b:
        return True
    if type(a) is not type(b):
        return False
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(_is_equal(a[k], b[k]) for k in a)
    return a == b

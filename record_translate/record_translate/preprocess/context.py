"""快照上下文片段提取模块"""

from __future__ import annotations

from pathlib import Path

from ..config import CONTEXT_EXCERPT_MAX_SIBLINGS
from ..models import ElementInfo


def extract_context(
    run_dir: Path,
    action_index: int,
    element: ElementInfo,
    max_siblings: int = CONTEXT_EXCERPT_MAX_SIBLINGS,
) -> str | None:
    """
    从快照文本中提取被操作元素附近的上下文片段。

    算法：
    1. 根据 element 的 text/label/name/id 在快照行中模糊匹配
    2. 找到匹配行后，向上回溯到父节点
    3. 从父节点开始，向下收集最近 N 个同级兄弟节点
    """
    snapshot_file = run_dir / "record" / "snapshots" / f"snapshot_{action_index - 1:03d}.txt"
    if not snapshot_file.exists():
        return None

    snapshot_text = snapshot_file.read_text("utf-8")
    return extract_context_from_text(snapshot_text, element, max_siblings)


def extract_context_from_text(
    snapshot_text: str,
    element: ElementInfo,
    max_siblings: int = CONTEXT_EXCERPT_MAX_SIBLINGS,
) -> str | None:
    """从快照文本中提取上下文片段"""
    if not snapshot_text or not element:
        return None

    lines = snapshot_text.split("\n")
    if not lines:
        return None

    keywords = _build_search_keywords(element)
    if not keywords:
        return None

    match_index = _find_best_match(lines, keywords)
    if match_index < 0:
        return None

    match_indent = _get_indent(lines[match_index])

    # 向上回溯找父节点
    parent_index = -1
    for i in range(match_index - 1, -1, -1):
        if _get_indent(lines[i]) < match_indent and lines[i].strip():
            parent_index = i
            break

    # 收集上下文行
    excerpt_lines: list[str] = []
    start_index = parent_index if parent_index >= 0 else match_index
    parent_indent = _get_indent(lines[parent_index]) if parent_index >= 0 else match_indent

    if parent_index >= 0:
        excerpt_lines.append(lines[parent_index])

    # 从父节点的下一行开始，收集同级子节点
    sibling_count = 0
    match_included = False

    for i in range(start_index + 1, len(lines)):
        line = lines[i]
        line_indent = _get_indent(line)

        # 缩进更小或相等的行 = 离开了父节点的范围
        if line_indent <= parent_indent and line.strip():
            break

        # 同级子节点
        if line_indent == match_indent:
            sibling_count += 1

            if i == match_index:
                match_included = True
                excerpt_lines.append(line + "  ← [操作目标]")
                # 收集该元素的子节点
                for j in range(i + 1, len(lines)):
                    if _get_indent(lines[j]) > match_indent:
                        excerpt_lines.append(lines[j])
                    else:
                        break
            elif abs(i - match_index) <= max_siblings:
                excerpt_lines.append(line)

    if not match_included:
        excerpt_lines.append(lines[match_index] + "  ← [操作目标]")

    if not excerpt_lines:
        return None

    return "\n".join(excerpt_lines)


def _build_search_keywords(element: ElementInfo) -> list[str]:
    keywords: list[str] = []
    if element.text:
        keywords.append(element.text.strip())
    if element.label:
        keywords.append(element.label.strip())
    if element.name:
        keywords.append(element.name.strip())
    if element.placeholder:
        keywords.append(element.placeholder.strip())
    if element.id:
        keywords.append(element.id.strip())
    return [k for k in keywords if k and len(k) >= 2]


def _find_best_match(lines: list[str], keywords: list[str]) -> int:
    for keyword in keywords:
        for i, line in enumerate(lines):
            if keyword in line:
                return i
    return -1


def _get_indent(line: str) -> int:
    return len(line) - len(line.lstrip())

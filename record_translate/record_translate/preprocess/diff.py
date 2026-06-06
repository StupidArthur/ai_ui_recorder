"""快照差异计算模块"""

from __future__ import annotations

import difflib
from pathlib import Path

from ..config import DIFF_TRUNCATE_THRESHOLD


def compute_diff(pre_text: str, post_text: str) -> str:
    """
    计算两段快照文本的行级 diff。
    输出格式：每行以 "+ " 或 "- " 前缀，与 Node.js diff 包一致。
    """
    pre_lines = pre_text.splitlines()
    post_lines = post_text.splitlines()

    result: list[str] = []
    has_change = False

    matcher = difflib.SequenceMatcher(None, pre_lines, post_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in ("replace", "delete"):
            has_change = True
            for line in pre_lines[i1:i2]:
                result.append(f"- {line}")
        if tag in ("replace", "insert"):
            has_change = True
            for line in post_lines[j1:j2]:
                result.append(f"+ {line}")

    if not has_change:
        return "（preSnapshot 和 postSnapshot 完全相同，操作未引起可见的 UI 变化）"

    return "\n".join(result)


def truncate_diff(diff_text: str, threshold: int = DIFF_TRUNCATE_THRESHOLD) -> str:
    """截断超长 diff，保留首尾各一半。与 Node.js truncateDiff() 行为一致。"""
    if not diff_text or len(diff_text) <= threshold:
        return diff_text
    half = threshold // 2
    head = diff_text[:half]
    tail = diff_text[-half:]
    return f"{head}\n\n... [diff 过长，已截断 {len(diff_text) - threshold} 字符] ...\n\n{tail}"


def compute_all_diffs(
    run_dir: Path,
    total_snapshots: int,
    log=None,
) -> dict[int, str]:
    """
    遍历所有快照对，计算行级 diff。

    返回: actionIndex → 截断后 diff 文本 的映射
    """
    snapshots_dir = run_dir / "record" / "snapshots"
    diffs_dir = run_dir / "translate" / "preprocess" / "diffs"
    diffs_dir.mkdir(parents=True, exist_ok=True)

    total_diffs = total_snapshots - 1
    diffs: dict[int, str] = {}

    if total_diffs <= 0:
        if log:
            log.warning("快照不足，无法计算 diff")
        return diffs

    if log:
        log.info(f"开始计算 {total_diffs} 个 snapshot diff...")

    for i in range(1, total_diffs + 1):
        try:
            pre_file = snapshots_dir / f"snapshot_{i - 1:03d}.txt"
            post_file = snapshots_dir / f"snapshot_{i:03d}.txt"

            pre_text = pre_file.read_text("utf-8")
            post_text = post_file.read_text("utf-8")

            diff_text = compute_diff(pre_text, post_text)

            # 保存完整 diff 到文件
            diff_filename = f"diff_{i:03d}.txt"
            (diffs_dir / diff_filename).write_text(diff_text, "utf-8")

            # 映射中存储截断后的版本（供 AI 使用）
            diffs[i] = truncate_diff(diff_text)
        except Exception as e:
            msg = f"diff_{i:03d} 计算失败: {e}"
            if log:
                log.warning(msg)
            diffs[i] = "（diff 计算失败）"

    if log:
        log.info(f"{total_diffs} 个 diff 计算完成")

    return diffs

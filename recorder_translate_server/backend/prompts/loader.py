"""Prompt Markdown 加载器（从 config/prompts/ 目录读取）"""

from __future__ import annotations

import sys
from pathlib import Path

_cache: dict[str, str] = {}


def _get_md_search_paths() -> list[Path]:
    """构建 prompt 搜索路径列表"""
    paths = []

    # EXE 场景：EXE 同级 config/prompts/
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
        paths.append(exe_dir / "config" / "prompts")

    # 包内：recorder_translate_server/config/prompts/
    pkg_dir = Path(__file__).resolve().parent.parent.parent
    paths.append(pkg_dir / "config" / "prompts")

    # 通用：CWD/config/prompts/
    cwd = Path.cwd()
    paths.append(cwd / "config" / "prompts")

    # 开发环境回退：Node.js 的 prompts/md/ 目录
    paths.append(cwd / "recorder" / "case_translate" / "prompts" / "md")

    return paths


def load_prompt_md(relative_path: str, vars: dict | None = None) -> str:
    """加载 Skill Prompt Markdown 文件"""
    if relative_path in _cache:
        text = _cache[relative_path]
    else:
        for base in _get_md_search_paths():
            full_path = base / relative_path
            if full_path.exists():
                text = full_path.read_text("utf-8-sig")
                _cache[relative_path] = text
                break
        else:
            raise FileNotFoundError(
                f"找不到 Prompt 文件: {relative_path}，已搜索: {[str(p) for p in _get_md_search_paths()]}"
            )

    result = text
    if vars:
        for key, value in vars.items():
            result = result.replace(f"{{{{{key}}}}}", str(value))

    return result.strip()

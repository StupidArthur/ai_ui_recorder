"""白名单打包：只把用户需要的翻译产物打进结果 zip。"""

from __future__ import annotations

import zipfile
from pathlib import Path

# 用户可见的产物路径（相对于 run_dir）
RESULT_WHITELIST: list[str] = [
    "translate/phase1/structured_steps.json",
    "translate/phase2/cases.md",
    "translate/phase2/cases_fallback.md",
    "translate/phase2/coverage.md",
    "translate/phase4/agents.txt",
]


def create_result_zip(run_dir: Path, out_path: Path) -> Path:
    """
    把 run_dir 下白名单内的文件打包到 out_path。
    返回 out_path 便于链式调用。
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for pattern in RESULT_WHITELIST:
            for f in run_dir.glob(pattern):
                arcname = f.relative_to(run_dir)
                zf.write(f, arcname.as_posix())
    return out_path

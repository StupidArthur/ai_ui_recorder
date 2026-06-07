"""zip 安全解压工具。

防御：
- 路径穿越（绝对路径、`..`）
- 跳过 macOS 垃圾文件（`__MACOSX/`、`.DS_Store`）
- GBK 编码 fallback（处理 cp437 误编码的中文文件名）
- 解压后大小上限（防止 zip bomb）
"""

from __future__ import annotations

import zipfile
from pathlib import Path

MAX_UPLOAD_SIZE_MB = 200
MAX_EXTRACT_SIZE_MB = 500


def safe_extract(zip_path: Path, target_dir: Path) -> Path:
    """
    安全解压 zip 到 target_dir，返回 run_dir（含 meta.json 的目录）。

    异常：
        FileNotFoundError: zip 不存在
        ValueError: 解压后超限 / zip 中未找到 meta.json
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    total_uncompressed = 0
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            safe_name = member.replace("\\", "/")
            # 路径穿越防护
            if safe_name.startswith("/") or ".." in safe_name:
                continue
            # macOS 垃圾
            if safe_name.startswith("__MACOSX/") or safe_name.endswith(".DS_Store"):
                continue
            # GBK fallback（cp437 误编码中文）
            try:
                info = zf.getinfo(member)
            except UnicodeEncodeError:
                try:
                    member_bytes = member.encode("cp437")
                    safe_name = member_bytes.decode("gbk").replace("\\", "/")
                except (UnicodeDecodeError, UnicodeEncodeError):
                    continue
                if safe_name.startswith("/") or ".." in safe_name:
                    continue
                info = zf.getinfo(member)
            # 大小累加
            total_uncompressed += info.file_size
            if total_uncompressed > MAX_EXTRACT_SIZE_MB * 1024 * 1024:
                raise ValueError(f"解压后大小超过 {MAX_EXTRACT_SIZE_MB}MB 限制")
            # 重写 info 的 filename 后再 extract
            info.filename = safe_name
            zf.extract(info, target_dir)

    return _find_run_dir(target_dir)


def _find_run_dir(root: Path) -> Path:
    """递归查找含 meta.json 的目录，作为 run_dir。"""
    for meta in root.rglob("meta.json"):
        return meta.parent
    raise ValueError("zip 中未找到 meta.json")

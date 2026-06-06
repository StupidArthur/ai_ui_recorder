"""录制数据校验入口"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .adapter import adapt_action_v0_to_v1, adapt_meta_v0_to_v1
from .config import META_FILENAME
from .models import RawAction, RecordingMeta

log = logging.getLogger(__name__)


def validate_recording(run_dir: Path) -> tuple[RecordingMeta, list[RawAction], str]:
    """
    校验录制数据，返回 (meta, raw_actions, format_version)。

    format_version: "0.0"（现网）或 "1.0"（目标）

    Raises:
        FileNotFoundError: meta.json 或 action/snapshot 文件缺失
        ValueError: 字段不一致
    """
    meta_path = run_dir / META_FILENAME
    if not meta_path.exists():
        raise FileNotFoundError(f"meta.json 不存在: {meta_path}")

    raw = json.loads(meta_path.read_text("utf-8-sig"))

    # 适配 v0 → v1 结构
    adapted = adapt_meta_v0_to_v1(raw, run_dir=run_dir)
    version = adapted.get("formatVersion", "0.0")

    # 解析 meta
    meta = RecordingMeta.model_validate(adapted)

    # 校验目录
    actions_dir = run_dir / "record" / "actions"
    snapshots_dir = run_dir / "record" / "snapshots"

    if not actions_dir.exists():
        raise FileNotFoundError(f"actions 目录不存在: {actions_dir}")
    if not snapshots_dir.exists():
        raise FileNotFoundError(f"snapshots 目录不存在: {snapshots_dir}")

    actual_actions = len(list(actions_dir.glob("action_*.json")))
    actual_snapshots = len(list(snapshots_dir.glob("snapshot_*.txt")))

    if meta.total_actions != actual_actions:
        raise ValueError(
            f"totalActions 不一致: meta={meta.total_actions}, 实际={actual_actions}"
        )
    if meta.total_snapshots != actual_snapshots:
        raise ValueError(
            f"totalSnapshots 不一致: meta={meta.total_snapshots}, 实际={actual_snapshots}"
        )
    if meta.total_snapshots != meta.total_actions + 1:
        raise ValueError(
            f"totalSnapshots({meta.total_snapshots}) != totalActions({meta.total_actions}) + 1"
        )

    # 读取并适配所有 action 文件
    raw_actions: list[RawAction] = []
    for i in range(1, meta.total_actions + 1):
        action_file = actions_dir / f"action_{i:03d}.json"
        if not action_file.exists():
            raise FileNotFoundError(f"action 文件缺失: {action_file}")

        action_data = json.loads(action_file.read_text("utf-8"))

        # 校验 index 一致性
        if action_data.get("index") != i:
            log.warning(f"action 文件 {action_file.name} index 不一致: 文件={i}, 字段={action_data.get('index')}")

        # v0 → v1 适配
        adapted_action = adapt_action_v0_to_v1(action_data)
        raw_actions.append(RawAction.model_validate(adapted_action))

    # snapshot 文件连续性检查
    for i in range(0, meta.total_snapshots):
        snapshot_file = snapshots_dir / f"snapshot_{i:03d}.txt"
        if not snapshot_file.exists():
            raise FileNotFoundError(f"snapshot 文件缺失: {snapshot_file}")

    log.info(f"录制数据校验通过: {meta.total_actions} 个操作, {meta.total_snapshots} 个快照, 格式版本={version}")

    return meta, raw_actions, version

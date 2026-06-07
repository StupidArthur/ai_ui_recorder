"""预处理编排入口"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from ..config import RECORD_SUBDIR
from ..models import EnrichedAction, RawAction, RecordingMeta
from .classify import classify_action
from .diff import compute_all_diffs
from .form_state import compute_form_state_changes, format_form_state_changes
from .merge import merge_actions
from .noise import detect_noise

log = logging.getLogger(__name__)


def preprocess(
    run_dir: Path,
    meta: RecordingMeta,
    raw_actions: list[RawAction],
    log_instance=None,
) -> list[EnrichedAction]:
    """
    预处理入口。

    Args:
        run_dir: 录制目录路径
        meta: 已解析的 meta 数据
        raw_actions: 已读取并适配的原始 action 列表
        log_instance: 可选日志器

    返回: 富化后的 action 列表
    """
    _log = log_instance or log

    _log.info("========== 数据预处理开始 ==========")

    # 确保翻译目录存在
    diffs_dir = run_dir / "translate" / "preprocess" / "diffs"
    enriched_dir = run_dir / "translate" / "preprocess" / "enriched"
    merged_dir = run_dir / "translate" / "preprocess" / "merged"
    for d in (diffs_dir, enriched_dir, merged_dir):
        d.mkdir(parents=True, exist_ok=True)

    # ========== 第 1 步：语义归并 ==========
    _log.info("[预处理 1/3] 批量读取 action + 语义归并...")
    merged_actions, merge_report = merge_actions(raw_actions, log=_log)

    # 保存归并报告
    merge_report_file = merged_dir / "merge_report.json"
    merge_report_file.write_text(json.dumps(merge_report, ensure_ascii=False, indent=2), "utf-8")
    _log.info(f"[预处理 1/3] 归并报告已保存: {merge_report_file}")

    # ========== 第 2 步：计算所有 snapshot diff ==========
    _log.info("[预处理 2/3] 计算快照 diff...")
    diffs = compute_all_diffs(run_dir, meta.total_snapshots, log=_log)

    # ========== 第 3 步：逐条富化 action ==========
    _log.info("[预处理 3/3] 逐条富化 action 数据...")

    enriched_actions: list[EnrichedAction] = []
    prev_form_state = None
    noise_count = 0
    total_merged = len(merged_actions)

    for idx, action in enumerate(merged_actions):
        i = action.index

        try:
            # 被双击去重标记的 action → 直接跳过
            if action.skip:
                _log.info(f"  action {i}/{meta.total_actions} 已跳过 [{action.skip}]")
                enriched_actions.append(EnrichedAction(
                    index=i,
                    type=action.type,
                    element=action.element,
                    url=action.url,
                    page_title=action.page_title,
                    timestamp=action.timestamp,
                    skip=action.skip,
                    classification={"category": "skipped", "element_type": "other", "hints": []},
                ))
                prev_form_state = action.form_state or prev_form_state
                continue

            # 获取 diff
            snapshot_diff = diffs.get(i, "（diff 不可用）")

            # 读取对应的快照文本
            snapshots_dir = run_dir / "record" / "snapshots"
            pre_snapshot_file = snapshots_dir / f"snapshot_{i - 1:03d}.txt"
            post_snapshot_file = snapshots_dir / f"snapshot_{i:03d}.txt"
            pre_snapshot = pre_snapshot_file.read_text("utf-8") if pre_snapshot_file.exists() else None
            post_snapshot = post_snapshot_file.read_text("utf-8") if post_snapshot_file.exists() else None

            # 提取上下文片段
            from .context import extract_context_from_text
            context_excerpt = None
            if pre_snapshot:
                context_excerpt = extract_context_from_text(pre_snapshot, action.element)

            # 计算 formState 变化
            form_state_changes = compute_form_state_changes(prev_form_state, action.form_state)
            form_state_change_text = format_form_state_changes(form_state_changes)

            # 分类操作 + 生成 hints
            classification = classify_action(
                action.type,
                action.element,
                snapshot_diff,
                form_state_changes,
                input_value=getattr(action, "input_value", None),
                key=getattr(action, "key", None),
            )

            # 噪声检测
            is_first = idx == 0
            is_last = idx == total_merged - 1
            noise_result = detect_noise(
                EnrichedAction(
                    index=i,
                    type=action.type,
                    element=action.element,
                    url=action.url,
                    page_title=action.page_title,
                    timestamp=action.timestamp,
                    snapshot_diff=snapshot_diff,
                    form_state_changes=form_state_changes if form_state_changes.get("hasChanges") else None,
                ),
                is_first,
                is_last,
            )

            # 构建富化后的 action
            enriched = EnrichedAction(
                index=i,
                type=action.type,
                original_type=getattr(action, "original_type", None),
                input_value=getattr(action, "input_value", None),
                element=action.element,
                key=getattr(action, "key", None),
                url=action.url,
                page_title=action.page_title,
                timestamp=action.timestamp,
                form_state=action.form_state,
                snapshot_diff=snapshot_diff,
                pre_snapshot=f"[见 record/snapshots/snapshot_{i - 1:03d}.txt]" if pre_snapshot else None,
                post_snapshot=f"[见 record/snapshots/snapshot_{i:03d}.txt]" if post_snapshot else None,
                context_excerpt=context_excerpt,
                form_state_changes=form_state_changes if form_state_changes.get("hasChanges") else None,
                form_state_change_text=form_state_change_text,
                classification=classification,
                noise=noise_result[0] or None,
                noise_reason=noise_result[1],
            )

            enriched_actions.append(enriched)

            # 如果被标记为噪声，追加到归并报告
            if noise_result[0]:
                noise_count += 1
                merge_report["details"].append({
                    "index": i,
                    "rule": "noise",
                    "reason": noise_result[1],
                })

            # 更新 prevFormState
            prev_form_state = action.form_state or prev_form_state

            status_tag = "noise" if noise_result[0] else classification.category
            _log.info(f"  action {i}/{meta.total_actions} 富化完成 [{status_tag}]")

        except Exception as e:
            _log.warning(f"  action {i}/{meta.total_actions} 富化失败: {e}")
            enriched_actions.append(EnrichedAction(
                index=i,
                type="unknown",
                element=RawAction(
                    index=i, type="unknown", timestamp=0, url="", pageTitle="",
                    element={"tag": "unknown", "xpath": "unknown"},
                ).element,
                url="",
                page_title="未知",
                timestamp=0,
                snapshot_diff="（预处理失败）",
                classification={"category": "other", "element_type": "other", "hints": []},
            ))

    # 更新归并报告（追加噪声统计）
    merge_report["noiseMarked"] = noise_count
    merge_report_file.write_text(json.dumps(merge_report, ensure_ascii=False, indent=2), "utf-8")

    # 保存富化后的 action 到文件
    for enriched in enriched_actions:
        enriched_file = enriched_dir / f"enriched_{enriched.index:03d}.json"
        enriched_file.write_text(
            json.dumps(enriched.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False, indent=2),
            "utf-8",
        )

    _log.info(
        f"========== 数据预处理完成：{len(enriched_actions)} 条富化数据"
        f"（噪声 {noise_count} 条, skip {merge_report['dblclickDeduped']} 条）=========="
    )

    return enriched_actions

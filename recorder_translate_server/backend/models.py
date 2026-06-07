"""Pydantic 数据模型：录制数据 + 预处理中间态 + 翻译结果"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ==================== 录制数据模型（输入） ====================


class ElementInfo(BaseModel):
    """action 中的目标元素信息"""

    tag: str
    id: Optional[str] = None
    name: Optional[str] = None
    input_type: Optional[str] = Field(None, alias="type")
    text: str = ""
    placeholder: Optional[str] = None
    title: Optional[str] = None
    href: Optional[str] = None
    xpath: str = ""
    label: Optional[str] = None

    model_config = {"populate_by_name": True}


class ActionSummaryItem(BaseModel):
    """meta.json 中的操作摘要条目"""

    index: int
    type: str
    element_tag: str = Field(..., alias="elementTag")
    element_desc: str = Field(..., alias="elementDesc")
    page_title: str = Field(..., alias="pageTitle")
    timestamp: Optional[int] = None  # v0 无此字段，adapter 从 action 文件回填

    model_config = {"populate_by_name": True}


class RecordingMeta(BaseModel):
    """meta.json 的完整结构"""

    format_version: str = Field(..., alias="formatVersion")
    record_start_time: datetime = Field(..., alias="recordStartTime")
    record_end_time: datetime = Field(..., alias="recordEndTime")
    total_actions: int = Field(..., alias="totalActions")
    total_snapshots: int = Field(..., alias="totalSnapshots")
    target_url: str = Field(..., alias="targetUrl")
    start_page_title: str = Field(..., alias="startPageTitle")
    snapshot_poll_interval_ms: int = Field(300, alias="snapshotPollIntervalMs")
    action_summary: list[ActionSummaryItem] = Field(..., alias="actionSummary")

    model_config = {"populate_by_name": True}


class RawAction(BaseModel):
    """action_NNN.json 的完整结构（v1.0 格式，v0 经 adapter 转换后）"""

    index: int
    type: str
    timestamp: int
    url: str
    page_title: str = Field(..., alias="pageTitle")
    element: ElementInfo
    form_state: Optional[dict[str, Any]] = Field(None, alias="formState")
    # 归并阶段追加字段（v0 原始数据无此字段，由 merge 写入）
    skip: Optional[str] = None
    original_type: Optional[str] = Field(None, alias="originalType")
    input_value: Optional[str] = Field(None, alias="inputValue")
    key: Optional[str] = None

    model_config = {"populate_by_name": True}


# ==================== 预处理数据模型（中间态） ====================


class Classification(BaseModel):
    """操作分类结果"""

    category: str = "other"
    element_type: str = "other"
    hints: list[str] = []


class EnrichedAction(BaseModel):
    """预处理后的富化 action"""

    index: int
    type: str
    original_type: Optional[str] = None
    input_value: Optional[str] = None
    element: ElementInfo
    key: Optional[str] = None
    url: str
    page_title: str
    timestamp: int
    form_state: Optional[dict[str, Any]] = None
    # 预处理追加字段
    snapshot_diff: Optional[str] = None
    pre_snapshot: Optional[str] = None
    post_snapshot: Optional[str] = None
    context_excerpt: Optional[str] = None
    form_state_changes: Optional[dict[str, Any]] = None
    form_state_change_text: Optional[str] = None
    classification: Classification = Classification()
    skip: Optional[str] = None
    noise: Optional[bool] = None
    noise_reason: Optional[str] = None


# ==================== 翻译结果模型（输出） ====================


class StructuredStep(BaseModel):
    """Phase 1 输出：结构化步骤"""

    index: int
    status: str = "normal"  # normal | skip | noise | fallback
    description: str = ""
    ui_change: str = "无可见变化"
    page: str = "未知"
    basis: list[str] = []
    action_kind: str = "other"
    target: str = ""
    input_text: str = ""
    key: str = ""
    assert_text: str = ""
    confidence: float = 0.7
    interval_from_previous_ms: Optional[int] = None
    url: str = ""
    source_type: str = "unknown"

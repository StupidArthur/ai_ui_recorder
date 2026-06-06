"""v0（现网）→ v1.0 格式适配器"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def parse_desc(desc: str) -> dict[str, str]:
    """
    从 v0 的 desc 自由文本中提取 elementTag 和 elementDesc。

    v0 格式示例：
        "点击 <input> \"请输入用户名\""  → tag="input", desc="请输入用户名"
        "按键 [Enter] 在 <button> (确定)" → tag="button", desc="确定"
        "双击 <div> \"偏好设置\""          → tag="div", desc="偏好设置"
    """
    # 匹配 <tag>
    tag_match = re.search(r'<(\w+)>', desc)
    tag = tag_match.group(1) if tag_match else ""

    # 匹配引号内的描述 或 括号内的描述
    desc_match = re.search(r'"([^"]+)"', desc) or re.search(r'\(([^)]+)\)', desc)
    element_desc = desc_match.group(1) if desc_match else desc

    return {"tag": tag, "desc": element_desc}


def adapt_meta_v0_to_v1(raw: dict[str, Any], run_dir: Path | None = None) -> dict[str, Any]:
    """
    将 v0 格式的 meta.json 适配为 v1.0 结构。

    Args:
        raw: 原始 meta.json 解析后的 dict
        run_dir: 录制目录路径（用于从 action 文件回填 timestamp）
    """
    adapted = dict(raw)

    # 补 formatVersion
    if "formatVersion" not in adapted:
        adapted["formatVersion"] = "0.0"

    # 补 totalSnapshots
    if "totalSnapshots" not in adapted:
        adapted["totalSnapshots"] = adapted["totalActions"] + 1

    # actionSummary 字段映射
    if "actionSummary" in adapted:
        for item in adapted["actionSummary"]:
            if "desc" in item and "elementTag" not in item:
                parsed = parse_desc(item["desc"])
                item["elementTag"] = parsed["tag"]
                item["elementDesc"] = parsed["desc"]
            if "page" in item and "pageTitle" not in item:
                item["pageTitle"] = item.pop("page")
            # timestamp：从 action 文件回填（v0 summary 中无此字段）
            if "timestamp" not in item and run_dir:
                action_file = run_dir / "record" / "actions" / f"action_{item['index']:03d}.json"
                if action_file.exists():
                    try:
                        action_data = json.loads(action_file.read_text("utf-8"))
                        item["timestamp"] = action_data.get("timestamp")
                    except Exception:
                        pass

    # convention → 删除
    adapted.pop("convention", None)

    return adapted


def adapt_action_v0_to_v1(raw: dict[str, Any]) -> dict[str, Any]:
    """将 v0 格式的 action_NNN.json 适配为 v1.0 结构"""
    adapted = dict(raw)

    # title → pageTitle
    if "title" in adapted and "pageTitle" not in adapted:
        adapted["pageTitle"] = adapted.pop("title")

    # element.type → element.inputType
    if "element" in adapted:
        el = dict(adapted["element"])
        if "type" in el and "inputType" not in el:
            el["inputType"] = el.pop("type")
        # 删除 v1.0 不需要的字段
        el.pop("href", None)
        el.pop("title", None)
        adapted["element"] = el

    # formStateDelta → formState（原样透传，不做脱敏）
    if "formStateDelta" in adapted and "formState" not in adapted:
        adapted["formState"] = adapted.pop("formStateDelta")

    return adapted

"""语义归并模块：双击去重 + 输入识别"""

from __future__ import annotations

from ..config import DBLCLICK_TIME_THRESHOLD_MS
from ..models import RawAction


def merge_actions(
    raw_actions: list[RawAction],
    log=None,
) -> tuple[list[RawAction], dict]:
    """
    语义归并：双击去重 → 输入识别。
    返回 (merged_actions, merge_report)。
    """
    # 浅拷贝，避免污染原始数据
    actions = [a.model_copy(deep=False) for a in raw_actions]

    report = {
        "totalOriginal": len(actions),
        "inputRecognized": 0,
        "dblclickDeduped": 0,
        "details": [],
    }

    # 规则 1：双击去重（先执行，避免冗余 click 影响输入识别判断）
    _deduplicate_double_clicks(actions, report, log)

    # 规则 2：输入识别（不做密码脱敏）
    _recognize_input_actions(actions, report, log)

    if log:
        log.info(
            f"[语义归并] 完成: 输入识别 {report['inputRecognized']} 条, "
            f"双击去重 {report['dblclickDeduped']} 条"
        )

    return actions, report


# ==================== 双击去重 ====================


def _deduplicate_double_clicks(actions: list, report: dict, log) -> None:
    """
    检测并标记双击事件产生的冗余 click。
    浏览器双击事件序列：click → click → dblclick（作用于同一元素）。
    """
    for i in range(len(actions)):
        if actions[i].type != "dblclick":
            continue

        dblclick_action = actions[i]
        dblclick_time = dblclick_action.timestamp
        dblclick_xpath = dblclick_action.element.xpath if dblclick_action.element else None

        # 向前扫描最多 2 个位置
        for j in range(max(0, i - 2), i):
            if actions[j].type != "click":
                continue
            if actions[j].element.xpath != dblclick_xpath:
                continue
            if dblclick_time - actions[j].timestamp > DBLCLICK_TIME_THRESHOLD_MS:
                continue

            # 标记为冗余
            actions[j] = actions[j].model_copy(update={"skip": "dblclick-dedup"})
            report["dblclickDeduped"] += 1
            report["details"].append({
                "index": actions[j].index,
                "rule": "dblclick-dedup",
                "mergedInto": dblclick_action.index,
            })

            if log:
                log.info(f"  action {actions[j].index}: 双击去重 → 被 dblclick(action {dblclick_action.index}) 合并")


# ==================== 输入识别 ====================


def _recognize_input_actions(actions: list, report: dict, log) -> None:
    """
    遍历 action 数组，识别"点击输入框"并重新标注为"输入"类型。
    对比 action[i] 与 action[i+1] 的 formState 中目标字段的值变化。
    """
    for i in range(len(actions) - 1):
        if actions[i].skip:
            continue

        curr = actions[i]
        nxt = actions[i + 1]

        # 必须是 click 类型
        if curr.type != "click":
            continue

        # 必须点击的是 input 或 textarea（排除 checkbox / radio）
        tag = (curr.element.tag or "").lower()
        if tag not in ("input", "textarea"):
            continue

        input_type = (curr.element.input_type or "").lower()
        if input_type in ("checkbox", "radio"):
            continue

        # 在 formState 中查找目标元素
        form_key = _find_matching_form_state_key(curr.element, curr.form_state)
        if not form_key:
            continue

        # 对比当前和下一个 action 的 formState 中该字段的值
        prev_value = _extract_value(curr.form_state, form_key)
        next_value = _extract_value(nxt.form_state, form_key)

        # 值未变化或下一个 action 中该字段不存在 → 不是输入
        if prev_value == next_value or next_value is None:
            continue

        # 确认为输入操作
        updated = {
            "original_type": curr.type,
            "type": "input",
            "input_value": next_value,
        }
        actions[i] = curr.model_copy(update=updated)

        report["inputRecognized"] += 1
        report["details"].append({
            "index": curr.index,
            "rule": "input-recognize",
            "from": curr.type,
            "to": "input",
            "inputValue": next_value,
        })

        if log:
            log.info(f"  action {curr.index}: click → input \"{next_value}\" ({form_key})")


# ==================== formState 键匹配 ====================


def _xpath_string_literal(s: str) -> str:
    if "'" not in s:
        return f"'{s}'"
    parts = s.split("'")
    out = "concat("
    for i, part in enumerate(parts):
        if i > 0:
            out += ", \"'\", "
        out += f"'{part}'"
    out += ")"
    return out


def _xpath_key_from_id(id_val: str) -> str:
    return f"//*[@id={_xpath_string_literal(id_val)}]"


def _find_matching_form_state_key(element, form_state: dict | None) -> str | None:
    if not form_state or not element:
        return None

    keys = list(form_state.keys())
    if not keys:
        return None

    if element.xpath and element.xpath in form_state:
        return element.xpath

    if element.id:
        id_key = _xpath_key_from_id(element.id)
        if id_key in form_state:
            return id_key

    if element.id:
        for key in keys:
            if element.id in key:
                return key

    return None


def _extract_value(form_state: dict | None, form_key: str) -> str | None:
    if not form_state or form_key not in form_state:
        return None
    entry = form_state[form_key]
    if isinstance(entry, dict) and "value" in entry:
        return entry["value"]
    return None

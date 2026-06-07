"""操作分类与 AI 提示生成模块"""

from __future__ import annotations

from ..models import Classification, ElementInfo


def classify_action(
    action_type: str,
    element: ElementInfo,
    diff_text: str | None,
    form_state_changes: dict | None,
    input_value: str | None = None,
    key: str | None = None,
) -> Classification:
    """对单条 action 进行分类，并生成 AI 提示"""
    tag = (element.tag or "").lower()

    # 元素类型分类
    element_type = _classify_element_type(tag, element)

    # 业务场景分类
    category = _classify_category(action_type, element_type, element, key, diff_text)

    # 生成 AI 提示
    hints = _generate_hints(action_type, element_type, category, element, diff_text, form_state_changes, input_value)

    return Classification(category=category, element_type=element_type, hints=hints)


def _classify_element_type(tag: str, element: ElementInfo) -> str:
    if tag == "button" or element.input_type == "submit":
        return "button"
    if tag == "a":
        return "link"
    if tag in ("input", "textarea"):
        it = (element.input_type or "").lower()
        if it == "checkbox":
            return "checkbox"
        if it == "radio":
            return "radio"
        return "input"
    if tag == "select":
        return "select"
    return "other"


def _classify_category(
    action_type: str,
    element_type: str,
    element: ElementInfo,
    key: str | None,
    diff_text: str | None,
) -> str:
    if action_type == "input":
        return "form-input"

    if action_type == "keypress":
        if key == "Enter":
            return "form-submit"
        if key == "Escape":
            return "dialog-dismiss"
        if key == "Tab":
            return "navigation"
        return "form-input"

    if action_type in ("click", "dblclick"):
        if element_type in ("checkbox", "radio"):
            return "toggle"
        if element_type == "link":
            return "navigation"

        if element_type == "button":
            text = (element.text or element.label or "").lower()
            if any(k in text for k in ("确定", "提交", "submit", "ok", "保存", "save")):
                return "form-submit"
            if any(k in text for k in ("取消", "cancel", "关闭", "close")):
                return "dialog-dismiss"
            if any(k in text for k in ("删除", "delete", "移除", "remove")):
                return "destructive"

        if diff_text and ("dialog" in diff_text or "modal" in diff_text):
            return "dialog"

        return "other"

    if action_type == "rightclick":
        return "context-menu"

    return "other"


def _generate_hints(
    action_type: str,
    element_type: str,
    category: str,
    element: ElementInfo,
    diff_text: str | None,
    form_state_changes: dict | None,
    input_value: str | None,
) -> list[str]:
    hints: list[str] = []

    if diff_text and "完全相同" in diff_text:
        hints.append("Diff 显示 UI 无变化，这可能是一次没有视觉反馈的点击，或者效果是异步的。")

    if category == "form-input":
        if action_type == "input" and input_value:
            hints.append(f'这是一次文本输入操作（由语义归并识别），用户在此元素中输入了 "{input_value}"。请以此值为准描述操作。')
        else:
            hints.append("这是一次键盘输入操作，请重点关注 formStateDelta 中的值变化，以确定用户输入了什么。")
            if form_state_changes and form_state_changes.get("hasChanges"):
                hints.append("formState 发生了变化，请以 formState 中的精确值为准描述输入内容。")
    elif category == "form-submit":
        hints.append("这可能是一次表单提交操作，请关注 diff 中是否出现了提交后的反馈。")
    elif category == "toggle":
        hints.append("这是一个开关/复选框操作，请在 diff 中查找 checked/unchecked 状态变化。")
    elif category == "navigation":
        hints.append("这可能触发了页面导航，请关注 diff 中大面积的内容变化。")
    elif category == "dialog":
        hints.append("diff 中出现了 dialog/modal 相关变化，请关注是否打开或关闭了弹窗。")
    elif category == "dialog-dismiss":
        hints.append("这可能是关闭弹窗或取消操作，请确认 diff 中弹窗内容是否消失。")
    elif category == "destructive":
        hints.append("这可能是一次删除/移除操作，请关注 diff 中消失的内容。")
    elif category == "context-menu":
        hints.append("这是一次右键操作，通常会打开上下文菜单，请关注 diff 中新出现的菜单内容。")

    return hints

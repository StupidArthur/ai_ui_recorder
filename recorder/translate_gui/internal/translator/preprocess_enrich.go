package translator

import (
	"strings"
)

// ==================== 上下文片段提取 ====================

func extractContextExcerpt(snapshotText string, element map[string]interface{}, maxSiblings int) string {
	if maxSiblings <= 0 {
		maxSiblings = ContextExcerptMaxSiblings
	}
	if snapshotText == "" || element == nil {
		return ""
	}
	lines := strings.Split(snapshotText, "\n")
	if len(lines) == 0 {
		return ""
	}
	keywords := buildSearchKeywords(element)
	if len(keywords) == 0 {
		return ""
	}
	matchIndex := findBestMatch(lines, keywords)
	if matchIndex < 0 {
		return ""
	}
	matchIndent := getIndent(lines[matchIndex])

	parentIndex := -1
	for i := matchIndex - 1; i >= 0; i-- {
		if getIndent(lines[i]) < matchIndent && strings.TrimSpace(lines[i]) != "" {
			parentIndex = i
			break
		}
	}

	var excerptLines []string
	startIndex := matchIndex
	parentIndent := matchIndent
	if parentIndex >= 0 {
		startIndex = parentIndex
		parentIndent = getIndent(lines[parentIndex])
		excerptLines = append(excerptLines, lines[parentIndex])
	}

	matchIncluded := false
	for i := startIndex + 1; i < len(lines); i++ {
		line := lines[i]
		lineIndent := getIndent(line)
		if lineIndent <= parentIndent && strings.TrimSpace(line) != "" {
			break
		}
		if lineIndent == matchIndent {
			if i == matchIndex {
				matchIncluded = true
				excerptLines = append(excerptLines, line+"  ← [操作目标]")
				for j := i + 1; j < len(lines); j++ {
					if getIndent(lines[j]) > matchIndent {
						excerptLines = append(excerptLines, lines[j])
					} else {
						break
					}
				}
			} else if abs(i-matchIndex) <= maxSiblings {
				excerptLines = append(excerptLines, line)
			}
		}
	}

	if !matchIncluded {
		excerptLines = append(excerptLines, lines[matchIndex]+"  ← [操作目标]")
	}
	if len(excerptLines) == 0 {
		return ""
	}
	return strings.Join(excerptLines, "\n")
}

func buildSearchKeywords(element map[string]interface{}) []string {
	var keywords []string
	for _, key := range []string{"text", "label", "name", "placeholder", "id"} {
		v := strings.TrimSpace(getString(element, key))
		if v != "" && len(v) >= 2 {
			keywords = append(keywords, v)
		}
	}
	return keywords
}

func findBestMatch(lines []string, keywords []string) int {
	for _, keyword := range keywords {
		for i, line := range lines {
			if strings.Contains(line, keyword) {
				return i
			}
		}
	}
	return -1
}

func getIndent(line string) int {
	count := 0
	for _, c := range line {
		if c == ' ' {
			count++
		} else if c == '\t' {
			count += 4
		} else {
			break
		}
	}
	return count
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// ==================== formState 差异 ====================

type FormStateChanges struct {
	Changed    map[string]FormChange  `json:"changed"`
	Added      map[string]interface{} `json:"added"`
	Removed    map[string]interface{} `json:"removed"`
	HasChanges bool                   `json:"hasChanges"`
}

type FormChange struct {
	From interface{} `json:"from"`
	To   interface{} `json:"to"`
}

func computeFormStateChanges(prevFormState, currFormState map[string]interface{}) FormStateChanges {
	result := FormStateChanges{
		Changed: map[string]FormChange{},
		Added:   map[string]interface{}{},
		Removed: map[string]interface{}{},
	}
	prev := prevFormState
	curr := currFormState
	if prev == nil {
		prev = map[string]interface{}{}
	}
	if curr == nil {
		curr = map[string]interface{}{}
	}

	for key, currVal := range curr {
		if prevVal, ok := prev[key]; ok {
			if !isEqual(prevVal, currVal) {
				result.Changed[key] = FormChange{From: prevVal, To: currVal}
				result.HasChanges = true
			}
		} else {
			result.Added[key] = currVal
			result.HasChanges = true
		}
	}
	for key, prevVal := range prev {
		if _, ok := curr[key]; !ok {
			result.Removed[key] = prevVal
			result.HasChanges = true
		}
	}
	return result
}

func isEqual(a, b interface{}) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	aJSON, _ := jsonMarshal(a)
	bJSON, _ := jsonMarshal(b)
	return string(aJSON) == string(bJSON)
}

// ==================== 操作分类 ====================

func classifyAction(action mergedAction, diffText string, formStateChanges FormStateChanges) ActionClassification {
	element := action.Element
	if element == nil {
		element = map[string]interface{}{}
	}
	tag := strings.ToLower(getString(element, "tag"))
	elementType := classifyElementType(tag, element)
	category := classifyCategory(action.Type, elementType, element, action.Key, diffText)
	hints := generateHints(action.Type, elementType, category, element, diffText, formStateChanges, action.InputValue)
	return ActionClassification{
		ElementType: elementType,
		Category:    category,
		Hints:       hints,
	}
}

func classifyElementType(tag string, element map[string]interface{}) string {
	if tag == "button" || getString(element, "type") == "submit" {
		return "button"
	}
	if tag == "a" {
		return "link"
	}
	if tag == "input" || tag == "textarea" {
		inputType := strings.ToLower(getString(element, "type"))
		if inputType == "checkbox" {
			return "checkbox"
		}
		if inputType == "radio" {
			return "radio"
		}
		return "input"
	}
	if tag == "select" {
		return "select"
	}
	if getString(element, "role") == "switch" || strings.Contains(getString(element, "classes"), "switch") {
		return "switch"
	}
	if getString(element, "role") == "tab" {
		return "tab"
	}
	if getString(element, "role") == "menuitem" {
		return "menuitem"
	}
	return "other"
}

func classifyCategory(actionType, elementType string, element map[string]interface{}, key, diffText string) string {
	if actionType == "input" {
		return "form-input"
	}
	if actionType == "keypress" {
		if key == "Enter" {
			return "form-submit"
		}
		if key == "Escape" {
			return "dialog-dismiss"
		}
		if key == "Tab" {
			return "navigation"
		}
		return "form-input"
	}
	if actionType == "click" || actionType == "dblclick" {
		if elementType == "checkbox" || elementType == "switch" || elementType == "radio" {
			return "toggle"
		}
		if elementType == "link" {
			return "navigation"
		}
		if elementType == "tab" || elementType == "menuitem" || elementType == "select" {
			return "selection"
		}
		if elementType == "button" {
			text := strings.ToLower(getString(element, "text") + getString(element, "label"))
			for _, k := range []string{"确定", "提交", "submit", "ok", "保存", "save"} {
				if strings.Contains(text, k) {
					return "form-submit"
				}
			}
			for _, k := range []string{"取消", "cancel", "关闭", "close"} {
				if strings.Contains(text, k) {
					return "dialog-dismiss"
				}
			}
			for _, k := range []string{"删除", "delete", "移除", "remove"} {
				if strings.Contains(text, k) {
					return "destructive"
				}
			}
		}
		if diffText != "" && (strings.Contains(diffText, "dialog") || strings.Contains(diffText, "modal")) {
			return "dialog"
		}
		return "other"
	}
	if actionType == "rightclick" {
		return "context-menu"
	}
	return "other"
}

func generateHints(actionType, elementType, category string, element map[string]interface{}, diffText string, formStateChanges FormStateChanges, inputValue string) []string {
	var hints []string
	if diffText != "" && strings.Contains(diffText, "完全相同") {
		hints = append(hints, "Diff 显示 UI 无变化，这可能是一次没有视觉反馈的点击，或者效果是异步的。")
	}
	switch category {
	case "form-input":
		if actionType == "input" && inputValue != "" {
			hints = append(hints, "这是一次文本输入操作（由语义归并识别），用户在此元素中输入了 \""+inputValue+"\"。请以此值为准描述操作。")
		} else {
			hints = append(hints, "这是一次键盘输入操作，请重点关注 formStateDelta 中的值变化，以确定用户输入了什么。")
			if formStateChanges.HasChanges {
				hints = append(hints, "formState 发生了变化，请以 formState 中的精确值为准描述输入内容。")
			}
		}
	case "form-submit":
		hints = append(hints, "这可能是一次表单提交操作，请关注 diff 中是否出现了提交后的反馈（成功/失败提示、页面跳转等）。")
	case "toggle":
		hints = append(hints, "这是一个开关/复选框操作，请在 diff 中查找 checked/unchecked 状态变化来判断是\"打开\"还是\"关闭\"。")
	case "navigation":
		hints = append(hints, "这可能触发了页面导航，请关注 diff 中大面积的内容变化。")
	case "dialog":
		hints = append(hints, "diff 中出现了 dialog/modal 相关变化，请关注是否打开或关闭了弹窗。")
	case "dialog-dismiss":
		hints = append(hints, "这可能是关闭弹窗或取消操作，请确认 diff 中弹窗内容是否消失。")
	case "selection":
		hints = append(hints, "这是一次选择操作（Tab/菜单/下拉），请关注 diff 中 selected/expanded 等属性变化。")
	case "destructive":
		hints = append(hints, "这可能是一次删除/移除操作，请关注 diff 中消失的内容。")
	case "context-menu":
		hints = append(hints, "这是一次右键操作，通常会打开上下文菜单，请关注 diff 中新出现的菜单内容。")
	}
	return hints
}

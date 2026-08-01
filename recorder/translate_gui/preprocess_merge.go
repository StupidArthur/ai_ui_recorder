package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// ==================== 语义归并 ====================

type MergeReport struct {
	TotalOriginal   int           `json:"totalOriginal"`
	InputRecognized int           `json:"inputRecognized"`
	DblclickDeduped int           `json:"dblclickDeduped"`
	NoiseMarked     int           `json:"noiseMarked"`
	Details         []MergeDetail `json:"details"`
}

type MergeDetail struct {
	Index      int    `json:"index"`
	Rule       string `json:"rule"`
	Reason     string `json:"reason,omitempty"`
	From       string `json:"from,omitempty"`
	To         string `json:"to,omitempty"`
	InputValue string `json:"inputValue,omitempty"`
	MergedInto int    `json:"mergedInto,omitempty"`
}

// mergedAction 归并后的 action（带 skip 标记）
type mergedAction struct {
	Index          int                    `json:"index"`
	Type           string                 `json:"type"`
	OriginalType   string                 `json:"originalType,omitempty"`
	InputValue     string                 `json:"inputValue,omitempty"`
	Element        map[string]interface{} `json:"element"`
	Key            string                 `json:"key,omitempty"`
	URL            string                 `json:"url,omitempty"`
	Title          string                 `json:"title,omitempty"`
	Timestamp      int64                  `json:"timestamp"`
	FormStateDelta map[string]interface{} `json:"formStateDelta"`
	Skip           string                 `json:"skip,omitempty"`
}

func mergeActions(rawActions []ActionFile) ([]mergedAction, MergeReport) {
	report := MergeReport{TotalOriginal: len(rawActions), Details: []MergeDetail{}}
	actions := make([]mergedAction, len(rawActions))
	for i, a := range rawActions {
		actions[i] = mergedAction{
			Index:          a.Index,
			Type:           a.Action.Type,
			Element:        a.Action.Element,
			Key:            a.Action.Key,
			URL:            a.Action.URL,
			Title:          a.Action.Title,
			Timestamp:      a.Action.Timestamp,
			FormStateDelta: a.Action.FormState,
		}
	}

	deduplicateDoubleClicks(actions, &report)
	recognizeInputActions(actions, &report)

	return actions, report
}

// ==================== 双击去重 ====================

func deduplicateDoubleClicks(actions []mergedAction, report *MergeReport) {
	for i := 0; i < len(actions); i++ {
		if actions[i].Type != "dblclick" {
			continue
		}
		dblclickXpath := getXpath(actions[i].Element)
		dblclickTime := actions[i].Timestamp

		for j := i - 1; j >= 0 && j >= i-2; j-- {
			if actions[j].Type != "click" {
				continue
			}
			if getXpath(actions[j].Element) != dblclickXpath {
				continue
			}
			if dblclickTime-actions[j].Timestamp > DblclickTimeThresholdMs {
				continue
			}
			actions[j].Skip = "dblclick-dedup"
			report.DblclickDeduped++
			report.Details = append(report.Details, MergeDetail{
				Index: actions[j].Index, Rule: "dblclick-dedup", MergedInto: actions[i].Index,
			})
		}
	}
}

// ==================== 输入识别 ====================

func recognizeInputActions(actions []mergedAction, report *MergeReport) {
	for i := 0; i < len(actions)-1; i++ {
		if actions[i].Skip != "" {
			continue
		}
		curr := &actions[i]
		next := &actions[i+1]
		if curr.Type != "click" {
			continue
		}
		tag := strings.ToLower(getString(curr.Element, "tag"))
		if tag != "input" && tag != "textarea" {
			continue
		}
		inputType := strings.ToLower(getString(curr.Element, "type"))
		if inputType == "checkbox" || inputType == "radio" {
			continue
		}
		formKey := findMatchingFormStateKey(curr.Element, curr.FormStateDelta)
		if formKey == "" {
			continue
		}
		prevValue := extractFormValue(curr.FormStateDelta, formKey)
		nextValue := extractFormValue(next.FormStateDelta, formKey)
		if prevValue == nextValue || nextValue == "" {
			continue
		}
		curr.OriginalType = curr.Type
		curr.Type = "input"
		curr.InputValue = nextValue
		report.InputRecognized++
		report.Details = append(report.Details, MergeDetail{
			Index: curr.Index, Rule: "input-recognize", From: curr.OriginalType, To: "input", InputValue: nextValue,
		})
	}
}

// ==================== formStateDelta 键匹配 ====================

func xpathKeyFromId(id string) string {
	s := id
	if !strings.Contains(s, "'") {
		return "//*[@id='" + s + "']"
	}
	parts := strings.Split(s, "'")
	return "//*[@id=concat('" + strings.Join(parts, "', \"'\", '") + "')]"
}

func findMatchingFormStateKey(element map[string]interface{}, formState map[string]interface{}) string {
	if formState == nil || element == nil {
		return ""
	}
	xpath := getXpath(element)
	if xpath != "" {
		if _, ok := formState[xpath]; ok {
			return xpath
		}
	}
	id := getString(element, "id")
	if id != "" {
		idKey := xpathKeyFromId(id)
		if _, ok := formState[idKey]; ok {
			return idKey
		}
		for key := range formState {
			if strings.Contains(key, id) {
				return key
			}
		}
	}
	return ""
}

func extractFormValue(formState map[string]interface{}, key string) string {
	if formState == nil {
		return ""
	}
	entry, ok := formState[key].(map[string]interface{})
	if !ok {
		return ""
	}
	if v, ok := entry["value"]; ok {
		return toString(v)
	}
	return ""
}

// ==================== 噪声检测 ====================

func detectNoise(enriched *EnrichedAction, isFirst, isLast bool) (bool, string) {
	if isFirst || isLast {
		return false, ""
	}
	if enriched.Classification.Category == "skipped" || enriched.Action.Type == "input" {
		return false, ""
	}

	// 孤立 Enter：keypress Enter 作用在空内容 form 元素上、且无可见 UI 变化
	// （前后没有 input 步骤把它合并掉，单成 step 没法描述，会让下游处理出错）
	if enriched.Action.Type == "keypress" && strings.EqualFold(enriched.Action.Key, "Enter") {
		if isDiffEmpty(enriched.Diff) && !formStateHasMeaningfulValue(enriched.Action.FormState) {
			return true, "lone-enter-empty-form"
		}
	}

	if enriched.Action.Type != "click" {
		return false, ""
	}
	if !isDiffEmpty(enriched.Diff) {
		return false, ""
	}
	if enriched.FormStateDelta != nil {
		return false, ""
	}
	return true, "diff-empty + formState-unchanged"
}

// formStateHasMeaningfulValue 检查 raw formState（xpath→state map）里是否存在非空文本值。
// 空字符串 / 全空白 / "on" 这种布尔占位都算"无意义"。
func formStateHasMeaningfulValue(formState map[string]interface{}) bool {
	if len(formState) == 0 {
		return false
	}
	for _, raw := range formState {
		m, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		v, exists := m["value"]
		if !exists {
			continue
		}
		s, ok := v.(string)
		if !ok {
			continue
		}
		if strings.TrimSpace(s) != "" && s != "on" {
			return true
		}
	}
	return false
}

func isDiffEmpty(diffText string) bool {
	if diffText == "" {
		return true
	}
	if strings.Contains(diffText, "完全相同") {
		return true
	}
	if strings.TrimSpace(diffText) == "" {
		return true
	}
	lines := strings.Split(diffText, "\n")
	for _, line := range lines {
		trimmed := strings.TrimLeft(line, " \t")
		if (strings.HasPrefix(trimmed, "+") && !strings.HasPrefix(trimmed, "+++")) ||
			(strings.HasPrefix(trimmed, "-") && !strings.HasPrefix(trimmed, "---")) {
			return false
		}
	}
	return true
}

// ==================== 工具函数 ====================

func getString(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok {
		return ""
	}
	return toString(v)
}

func getXpath(element map[string]interface{}) string {
	return getString(element, "xpath")
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case float64:
		if val == float64(int64(val)) {
			return intToStr(int64(val))
		}
		return floatToStr(val)
	case int:
		return intToStr(int64(val))
	case int64:
		return intToStr(val)
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		data, _ := json.Marshal(v)
		return string(data)
	}
}

func intToStr(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func floatToStr(f float64) string {
	data, _ := json.Marshal(f)
	return string(data)
}

// padIndex 3 位补零
func padIndex(i int) string {
	if i < 10 {
		return "00" + intToStr(int64(i))
	}
	if i < 100 {
		return "0" + intToStr(int64(i))
	}
	return intToStr(int64(i))
}

// readActionFiles 批量读取 action 文件
func readActionFiles(actionsDir string, totalActions int) []ActionFile {
	actions := make([]ActionFile, 0, totalActions)
	for i := 1; i <= totalActions; i++ {
		path := filepath.Join(actionsDir, "action_"+padIndex(i)+".json")
		data, err := os.ReadFile(path)
		if err != nil {
			actions = append(actions, ActionFile{Index: i, Action: RawAction{Type: "unknown", Element: map[string]interface{}{}, Timestamp: 0}})
			continue
		}
		af, parseErr := parseActionFile(data, i)
		if parseErr != nil {
			actions = append(actions, ActionFile{Index: i, Action: RawAction{Type: "unknown", Element: map[string]interface{}{}, Timestamp: 0}})
			continue
		}
		actions = append(actions, af)
	}
	return actions
}

// parseActionFile 兼容 action.json 的平铺结构（index/type/element/url/timestamp/formStateDelta 在顶层）
// 与嵌套结构（{index, action:{...}}）两种格式
func parseActionFile(data []byte, fallbackIndex int) (ActionFile, error) {
	// 先尝试平铺结构：action.json 顶层即 type/element/url/timestamp/formStateDelta
	var flat struct {
		Index     int                    `json:"index"`
		Type      string                 `json:"type"`
		Key       string                 `json:"key"`
		Timestamp int64                  `json:"timestamp"`
		Element   map[string]interface{} `json:"element"`
		FormState map[string]interface{} `json:"formStateDelta"`
		URL       string                 `json:"url"`
		Title     string                 `json:"title"`
	}
	if err := json.Unmarshal(data, &flat); err == nil && flat.Type != "" {
		idx := flat.Index
		if idx == 0 {
			idx = fallbackIndex
		}
		if flat.Element == nil {
			flat.Element = map[string]interface{}{}
		}
		return ActionFile{
			Index: idx,
			Action: RawAction{
				Type:      flat.Type,
				Key:       flat.Key,
				Timestamp: flat.Timestamp,
				Element:   flat.Element,
				FormState: flat.FormState,
				URL:       flat.URL,
				Title:     flat.Title,
			},
		}, nil
	}

	// 回退到嵌套结构 {index, action:{...}}
	var af ActionFile
	if err := json.Unmarshal(data, &af); err != nil {
		return ActionFile{}, err
	}
	if af.Index == 0 {
		af.Index = fallbackIndex
	}
	if af.Action.Element == nil {
		af.Action.Element = map[string]interface{}{}
	}
	return af, nil
}

package main

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type SlimStep struct {
	Index       int    `json:"index"`
	ActionKind  string `json:"actionKind"`
	Description string `json:"description"`
	UiChange    string `json:"uiChange"`
	Page        string `json:"page"`
	Target      string `json:"target"`
	RouteKey    string `json:"routeKey"`
	GapTag      string `json:"gapTag"`
	InputText   string `json:"inputText,omitempty"`
	Key         string `json:"key,omitempty"`
	AssertText  string `json:"assertText,omitempty"`
	Status      string `json:"status,omitempty"`
}

type CaseBlock struct {
	MarkdownBlock string `json:"markdownBlock"`
}

// CaseWithConsume 单个 Case 及其消费的步数（Phase 2 v4 多 Case 输出）
type CaseWithConsume struct {
	MarkdownBlock        string
	ConsumeStepCount     int
	CoveredActionIndices []int
}

type Phase2ParseResult struct {
	Cases                []CaseWithConsume `json:"cases"`
	MarkdownBlock        string            `json:"markdownBlock"`
	ConsumeStepCount     int               `json:"consumeStepCount"`
	RawConsume           int               `json:"rawConsume"`
	ClampReason          string            `json:"clampReason"`
	CoveredActionIndices []int             `json:"coveredActionIndices"`
}

type AgentStep struct {
	LogicalName      string   `json:"logicalName"`
	MicroActions     []string `json:"microActions"`
	ConsumeStepCount int      `json:"consumeStepCount"`
}

type ParsedAgentChunk struct {
	UseCaseName    string      `json:"useCaseName"`
	UseCasePurpose string      `json:"useCasePurpose"`
	AgentSteps     []AgentStep `json:"agentSteps"`
	TotalConsume   int         `json:"totalConsume"`
}

var (
	reCaseMeta      = regexp.MustCompile(`(?i)<case_meta[^>]*\bconsumeStepCount\s*=\s*["']?(\d+)["']?[^>]*\/?>`)
	reLastIndex     = regexp.MustCompile(`(?i)\blastIndex\s*=\s*["']?(\d+)["']?`)
	reStepIndexRef1 = regexp.MustCompile(`(?i)\[步骤\s*(\d+)\]`)
	reStepIndexRef2 = regexp.MustCompile(`(?i)###\s*(?:\[)?步骤\s*(\d+)`)
	reStepIndexRef3 = regexp.MustCompile(`(?i)步骤\s*(\d+)\s*[：:]`)
)

func buildRouteKey(urlStr string) string {
	raw := strings.TrimSpace(urlStr)
	if raw == "" {
		return ""
	}

	u, err := url.Parse(raw)
	if err != nil {
		s := strings.SplitN(raw, "?", 2)[0]
		if len(s) > 200 {
			s = s[:200]
		}
		return s
	}

	key := u.Path
	if key == "" {
		key = "/"
	}
	if strings.Contains(raw, "#") {
		hashNoQuery := strings.SplitN(u.Fragment, "?", 2)[0]
		key += "#" + hashNoQuery
	}
	key = strings.TrimSpace(key)
	if key != "" {
		return key
	}

	s := strings.SplitN(raw, "?", 2)[0]
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

func buildGapTag(intervalFromPreviousMs *int64) string {
	if intervalFromPreviousMs == nil {
		return "contiguous"
	}
	ms := *intervalFromPreviousMs
	if ms < 0 {
		return "contiguous"
	}
	if ms > Phase2GapTagLongGapMs {
		return "longGap"
	}
	return "contiguous"
}

func truncateAssertText(text string) string {
	s := strings.TrimSpace(text)
	if s == "" {
		return ""
	}
	return truncateRunes(s, Phase2AssertTextMaxChars)
}

func slimStepForPhase2(step StructuredStep) SlimStep {
	actionKind := step.ActionKind
	if actionKind == "" {
		actionKind = "other"
	}

	uiChange := strings.TrimSpace(step.UiChange)
	if uiChange == "" {
		uiChange = "无可见变化"
	}

	page := step.Page
	if page == "" {
		page = "未知"
	}
	page = strings.TrimSpace(page)

	slim := SlimStep{
		Index:       step.ID,
		ActionKind:  actionKind,
		Description: strings.TrimSpace(step.Description),
		UiChange:    uiChange,
		Page:        page,
		Target:      strings.TrimSpace(step.Target),
		RouteKey:    buildRouteKey(step.URL),
		GapTag:      buildGapTag(step.IntervalFromPreviousMs),
	}

	if actionKind == "input" {
		inputText := strings.TrimSpace(step.InputText)
		if inputText != "" {
			slim.InputText = inputText
		}
	}
	if actionKind == "keyPress" {
		key := strings.TrimSpace(step.Key)
		if key != "" {
			slim.Key = key
		}
	}

	at := truncateAssertText(step.AssertText)
	if at != "" {
		slim.AssertText = at
	}

	slim.Status = step.Status

	return slim
}

func slimStepsForPhase2(steps []StructuredStep) []SlimStep {
	result := make([]SlimStep, 0, len(steps))
	for _, s := range steps {
		result = append(result, slimStepForPhase2(s))
	}
	return result
}

func formatStepAsPlainText(step StructuredStep) string {
	idx := strconv.Itoa(step.ID)
	action := strings.TrimSpace(step.Description)
	if action == "" {
		action = "(无动作描述)"
	}
	obs := strings.TrimSpace(step.UiChange)
	if obs == "" {
		obs = "无可见变化"
	}
	assertText := strings.TrimSpace(step.AssertText)
	if assertText == "" {
		assertText = "无可见变化"
	}
	return "步骤 " + idx + ":\n- 动作: " + action + "\n- 界面响应: " + obs + "\n- 完成标准: " + assertText
}

func formatStepsWindowPlainText(steps []StructuredStep) string {
	parts := make([]string, 0, len(steps))
	for _, s := range steps {
		parts = append(parts, formatStepAsPlainText(s))
	}
	return strings.Join(parts, "\n\n")
}

func formatSlimStepAsPlainText(step SlimStep) string {
	idx := strconv.Itoa(step.Index)
	action := strings.TrimSpace(step.Description)
	if action == "" {
		action = "(无动作描述)"
	}
	obs := strings.TrimSpace(step.UiChange)
	if obs == "" {
		obs = "无可见变化"
	}
	return "步骤 " + idx + ":\n- 动作: " + action + "\n- 界面响应: " + obs
}

func formatSlimStepsWindowPlainText(steps []SlimStep) string {
	parts := make([]string, 0, len(steps))
	for _, s := range steps {
		parts = append(parts, formatSlimStepAsPlainText(s))
	}
	return strings.Join(parts, "\n\n")
}

func isPhase2EffectiveStep(step StructuredStep) bool {
	return step.Status == "normal" || step.Status == "fallback"
}

func filterEffectiveStepsForPhase2(steps []StructuredStep) []StructuredStep {
	var result []StructuredStep
	for _, s := range steps {
		if isPhase2EffectiveStep(s) {
			result = append(result, s)
		}
	}
	return result
}

func parsePhase2MarkdownResponse(rawReply string, expectedIndices []int) Phase2ParseResult {
	cleaned, _ := preprocessLlmXmlOutputFull(cleanMarkdownFence(rawReply), Phase1LlmRawMaxChars)

	// 找到所有 <case_meta> 匹配（支持多 Case 输出）
	metaMatches := reCaseMeta.FindAllStringSubmatchIndex(cleaned, -1)

	// 兼容旧格式：无 meta 或仅 1 个 meta 时走单 Case 逻辑
	if len(metaMatches) <= 1 {
		return parsePhase2SingleCase(cleaned, expectedIndices)
	}

	// 多 Case：按 <case_meta> 拆分
	indices := expectedIndices
	winLen := len(indices)

	var cases []CaseWithConsume
	totalConsume := 0
	var clampReasons []string

	for i, loc := range metaMatches {
		consume, err := strconv.Atoi(cleaned[loc[2]:loc[3]])
		if err != nil || consume < 1 {
			consume = 1
		}

		var blockStart int
		if i == 0 {
			blockStart = 0
		} else {
			blockStart = metaMatches[i-1][1]
		}
		markdownBlock := strings.TrimSpace(cleaned[blockStart:loc[0]])
		markdownBlock = strings.TrimPrefix(markdownBlock, "---")
		markdownBlock = strings.TrimSpace(markdownBlock)
		if markdownBlock == "" {
			markdownBlock = fmt.Sprintf("# 测试用例：未命名用例 %d\n\n（模型未返回 Markdown 正文）", i+1)
		}

		remaining := winLen - totalConsume
		if consume > remaining {
			consume = remaining
			clampReasons = append(clampReasons, fmt.Sprintf("case %d over-consume-clamped", i+1))
		}
		if consume < 1 {
			consume = 1
		}

		start := totalConsume
		end := start + consume
		if end > winLen {
			end = winLen
		}
		covered := indices[start:end]

		cases = append(cases, CaseWithConsume{
			MarkdownBlock:        markdownBlock,
			ConsumeStepCount:     consume,
			CoveredActionIndices: covered,
		})
		totalConsume += consume
	}

	if totalConsume > winLen {
		totalConsume = winLen
	}
	coveredAll := indices
	if totalConsume < winLen {
		coveredAll = indices[:totalConsume]
	}

	firstBlock := ""
	if len(cases) > 0 {
		firstBlock = cases[0].MarkdownBlock
	}

	return Phase2ParseResult{
		Cases:                cases,
		MarkdownBlock:        firstBlock,
		ConsumeStepCount:     totalConsume,
		RawConsume:           totalConsume,
		ClampReason:          strings.Join(clampReasons, "; "),
		CoveredActionIndices: coveredAll,
	}
}

// parsePhase2SingleCase 处理单 Case 输出（兼容旧格式 / LLM 只返回 1 个 Case）
func parsePhase2SingleCase(cleaned string, expectedIndices []int) Phase2ParseResult {
	metaMatch := reCaseMeta.FindStringSubmatch(cleaned)

	var rawConsume interface{}
	if metaMatch != nil {
		if n, err := strconv.Atoi(metaMatch[1]); err == nil {
			rawConsume = n
		}
	}

	var rawLastIndex int
	hasLastIndex := false
	if metaMatch != nil {
		if lm := reLastIndex.FindStringSubmatch(metaMatch[0]); lm != nil {
			if n, err := strconv.Atoi(lm[1]); err == nil {
				rawLastIndex = n
				hasLastIndex = true
			}
		}
	} else {
		if lm := reLastIndex.FindStringSubmatch(cleaned); lm != nil {
			if n, err := strconv.Atoi(lm[1]); err == nil {
				rawLastIndex = n
				hasLastIndex = true
			}
		}
	}

	markdownBlock := cleaned
	if loc := reCaseMeta.FindStringIndex(cleaned); loc != nil {
		markdownBlock = cleaned[:loc[0]] + cleaned[loc[1]:]
	}
	markdownBlock = strings.TrimSpace(markdownBlock)
	if markdownBlock == "" {
		markdownBlock = "# 测试用例：未命名用例\n\n（模型未返回 Markdown 正文）"
	}

	indices := expectedIndices
	winLen := len(indices)
	safeConsume, rawConsumeInt, clampReason := clampWindowConsume(rawConsume, winLen)

	if hasLastIndex && rawLastIndex > 0 && winLen > 0 {
		pos := -1
		for i, idx := range indices {
			if idx == rawLastIndex {
				pos = i
				break
			}
		}
		tailAtConsume := indices[safeConsume-1]
		if pos < 0 {
			detail := "lastIndex=" + strconv.Itoa(rawLastIndex) + " 不在本窗 index 列表，忽略"
			if clampReason != "" {
				clampReason = clampReason + "; " + detail
			} else {
				clampReason = detail
			}
		} else if tailAtConsume != rawLastIndex {
			detail := "lastIndex=" + strconv.Itoa(rawLastIndex) + " 与 consumeStepCount=" + strconv.Itoa(safeConsume) + "(→index " + strconv.Itoa(tailAtConsume) + ") 不一致，以 consumeStepCount 为准"
			if clampReason != "" {
				clampReason = clampReason + "; " + detail
			} else {
				clampReason = detail
			}
		}
	}

	end := safeConsume
	if end > len(indices) {
		end = len(indices)
	}
	coveredActionIndices := indices[:end]

	return Phase2ParseResult{
		Cases: []CaseWithConsume{{
			MarkdownBlock:        markdownBlock,
			ConsumeStepCount:     safeConsume,
			CoveredActionIndices: coveredActionIndices,
		}},
		MarkdownBlock:        markdownBlock,
		ConsumeStepCount:     safeConsume,
		RawConsume:           rawConsumeInt,
		ClampReason:          clampReason,
		CoveredActionIndices: coveredActionIndices,
	}
}

func renderCasesMarkdownDocument(cases []CaseBlock, documentTitle string) string {
	title := strings.TrimSpace(documentTitle)
	if title == "" {
		title = "录制流程测试用例归纳"
	}

	md := "# " + title + "\n\n"
	if len(cases) == 0 {
		md += "> 无有效步骤（均为 noise/skip/fallback 等），未生成 Case。\n"
	} else {
		for i, c := range cases {
			if c.MarkdownBlock != "" {
				if i > 0 {
					md += "\n\n---\n\n"
				}
				md += strings.TrimSpace(c.MarkdownBlock)
			}
		}
	}
	return strings.TrimRight(md, " \t\n\r\v\f") + "\n"
}

func escapeTableCell(text string) string {
	s := strings.ReplaceAll(text, "|", "\\|")
	s = strings.ReplaceAll(s, "\r\n", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}

func extractMentionedStepIndices(markdown string) map[int]bool {
	found := make(map[int]bool)
	for _, pat := range []*regexp.Regexp{reStepIndexRef1, reStepIndexRef2, reStepIndexRef3} {
		for _, m := range pat.FindAllStringSubmatch(markdown, -1) {
			if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
				found[n] = true
			}
		}
	}
	return found
}

func normalizeCaseMarkdownToGlobalIndices(markdownBlock string, coveredActionIndices []int) string {
	covered := coveredActionIndices
	if len(covered) == 0 {
		return markdownBlock
	}

	firstGlobal := covered[0]
	n := len(covered)
	md := markdownBlock
	mentioned := extractMentionedStepIndices(md)

	for i := range mentioned {
		if i >= firstGlobal {
			return md
		}
	}

	if len(mentioned) == 0 {
		return md
	}

	minM := 0
	maxM := 0
	first := true
	for i := range mentioned {
		if first {
			minM = i
			maxM = i
			first = false
		} else {
			if i < minM {
				minM = i
			}
			if i > maxM {
				maxM = i
			}
		}
	}

	if minM < 1 || maxM > n {
		return md
	}

	for i := range mentioned {
		if i < 1 || i > n {
			return md
		}
	}

	for local := 1; local <= n; local++ {
		global := covered[local-1]

		re1 := regexp.MustCompile(`(?i)(###\s*)(?:\[)?步骤\s*` + strconv.Itoa(local) + `\b`)
		md = re1.ReplaceAllString(md, "${1}[步骤 "+strconv.Itoa(global)+"]")

		re2 := regexp.MustCompile(`(?i)\[步骤\s*` + strconv.Itoa(local) + `\]`)
		md = re2.ReplaceAllString(md, "[步骤 "+strconv.Itoa(global)+"]")

		re3 := regexp.MustCompile(`(?i)步骤\s*` + strconv.Itoa(local) + `\s*([：:])`)
		md = re3.ReplaceAllString(md, "[步骤 "+strconv.Itoa(global)+"]${1}")
	}

	return md
}

func isRedundantCaseBlock(markdownBlock string, caseBlocks []CaseBlock, coveredActionIndices []int) bool {
	covered := coveredActionIndices
	if len(covered) == 0 {
		return false
	}

	var prevParts []string
	for _, c := range caseBlocks {
		prevParts = append(prevParts, c.MarkdownBlock)
	}
	prevMd := strings.Join(prevParts, "\n\n")
	prevMentioned := extractMentionedStepIndices(prevMd)

	for _, idx := range covered {
		if !prevMentioned[idx] {
			return false
		}
	}

	newMentioned := extractMentionedStepIndices(markdownBlock)
	if len(newMentioned) == 0 {
		return true
	}

	for i := range newMentioned {
		if !prevMentioned[i] {
			return false
		}
	}
	return true
}

func renderSupplementalCaseFromSteps(steps []StructuredStep, title string) string {
	if len(steps) == 0 {
		return ""
	}

	md := "# 测试用例：" + title + "\n\n"
	md += "> 本段由程序根据 Phase 1 结构化步骤自动补全（LLM Case 正文未覆盖这些 index）。\n\n"
	md += "## 1. 业务背景与初始状态\n"
	md += "录制流中上述步骤已发生，但 Phase 2 归纳未写入对应业务描述，此处按 Phase 1 动作与界面响应原样列出供核对。\n\n"
	md += "## 2. 测试步骤流\n\n"

	for _, step := range steps {
		idx := strconv.Itoa(step.ID)
		action := strings.TrimSpace(step.Description)
		if action == "" {
			action = "(无动作描述)"
		}
		obs := strings.TrimSpace(step.UiChange)
		if obs == "" {
			obs = "无可见变化"
		}
		md += "### [步骤 " + idx + "] " + action + "\n"
		md += "- **执行动作**：" + action + "\n"
		md += "- **状态验证**：" + obs + "\n\n"
	}

	return strings.TrimRight(md, " \t\n\r\v\f")
}

func findWindowCoverageGaps(markdownBlock string, coveredActionIndices []int) []int {
	covered := coveredActionIndices
	if len(covered) == 0 {
		return nil
	}
	mentioned := extractMentionedStepIndices(markdownBlock)
	var gaps []int
	for _, idx := range covered {
		if !mentioned[idx] {
			gaps = append(gaps, idx)
		}
	}
	return gaps
}

func renderCaseCoverageAppendix(steps []StructuredStep, allCasesMarkdown string) string {
	mentioned := extractMentionedStepIndices(allCasesMarkdown)

	var list []StructuredStep
	for _, s := range steps {
		if s.Status == "normal" || s.Status == "" {
			list = append(list, s)
		}
	}

	md := "## 覆盖表\n\n"
	md += "| index | status | 是否出现在 Case 正文 | 操作摘要 |\n"
	md += "|------:|--------|:--------------------:|----------|\n"

	missing := 0
	for _, s := range list {
		idx := strconv.Itoa(s.ID)
		ok := mentioned[s.ID]
		if !ok && s.Status != "noise" && s.Status != "skip" {
			missing++
		}
		flag := "是"
		if !ok {
			flag = "**否**"
		}
		summary := escapeTableCell(truncateRunes(s.Description, 60))
		status := s.Status
		if status == "" {
			status = "normal"
		}
		md += "| " + idx + " | " + escapeTableCell(status) + " | " + flag + " | " + summary + " |\n"
	}

	if missing > 0 {
		md += "\n> 仍有 **" + strconv.Itoa(missing) + "** 条有效步骤未在 Case 正文中被引用（可能仅出现在附录 A 或程序补全段）。\n"
	} else {
		md += "\n> 所有有效步骤均在 Case 正文或程序补全段中有对应 index 引用。\n"
	}

	return md
}

package translator

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ==================== XML 提取 ====================

type ExtractedStep struct {
	ID          int    `json:"id"`
	Action      string `json:"action"`
	Observation string `json:"observation"`
	AssertText  string `json:"assertText"`
}

type ExtractError struct {
	Type   string `json:"type"`
	Index  int    `json:"index,omitempty"`
	Reason string `json:"reason"`
}

type ExtractResult struct {
	Steps  []ExtractedStep `json:"steps"`
	Errors []ExtractError  `json:"errors"`
}

var (
	reStepBlock = regexp.MustCompile(`(?is)<step[^>]*\bid\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)</step>`)
	reAction    = regexp.MustCompile(`(?is)<action[^>]*>([\s\S]*?)</action>`)
	reObs       = regexp.MustCompile(`(?is)<observation[^>]*>([\s\S]*?)</observation>`)
	reAssert    = regexp.MustCompile(`(?is)<assertText[^>]*>([\s\S]*?)</assertText>`)
)

func robustExtractSteps(llmOutput string) ExtractResult {
	text, _ := preprocessLlmXmlOutputFull(llmOutput, Phase1LlmRawMaxChars)
	errors := []ExtractError{}
	byId := map[int]ExtractedStep{}
	var orderedIds []int

	if !hasClosingTag(text, "</step>") {
		return ExtractResult{Steps: []ExtractedStep{}, Errors: []ExtractError{{Type: "xml-no-close-step", Reason: "缺少 </step> 闭合标签"}}}
	}

	matches := reStepBlock.FindAllStringSubmatch(text, -1)
	for _, m := range matches {
		id, err := strconv.Atoi(m[1])
		if err != nil || id <= 0 {
			continue
		}
		inner := m[2]
		actionM := reAction.FindStringSubmatch(inner)
		obsM := reObs.FindStringSubmatch(inner)
		assertM := reAssert.FindStringSubmatch(inner)

		action := ""
		observation := ""
		assertText := ""
		if actionM != nil {
			action = toSingleLineText(actionM[1])
		}
		if obsM != nil {
			observation = toSingleLineText(obsM[1])
		}
		if assertM != nil {
			assertText = toSingleLineText(assertM[1])
		}
		if assertText == "" && observation != "" && observation != "无可见变化" {
			assertText = observation
		}

		if action != "" && observation == "" {
			observation = "无可见变化"
			errors = append(errors, ExtractError{Type: "partial-xml", Index: id, Reason: "缺少 observation 节点"})
		}

		if action == "" && observation == "" {
			looseInner := toSingleLineText(inner)
			if looseInner != "" {
				action = looseInner
				observation = "无可见变化"
				errors = append(errors, ExtractError{Type: "loose-step", Index: id, Reason: "无法解析 action/observation 子标签"})
			}
		}

		if action == "" {
			continue
		}

		if _, exists := byId[id]; exists {
			errors = append(errors, ExtractError{Type: "xml-duplicate-id", Index: id, Reason: "重复 step id，已忽略后续"})
			continue
		}
		byId[id] = ExtractedStep{ID: id, Action: action, Observation: observation, AssertText: assertText}
		orderedIds = append(orderedIds, id)
	}

	steps := make([]ExtractedStep, 0, len(orderedIds))
	for _, id := range orderedIds {
		steps = append(steps, byId[id])
	}
	return ExtractResult{Steps: steps, Errors: errors}
}

// ==================== 批次解析 ====================

type BatchParseResult struct {
	ParsedSteps   []StructuredStep `json:"parsedSteps"`
	FailedIndices []int            `json:"failedIndices"`
	Errors        []ExtractError   `json:"errors"`
}

func parseBatchXmlSteps(rawReply string, actionBatch []EnrichedAction, skipNoiseIndices map[int]bool) BatchParseResult {
	parsedSteps := []StructuredStep{}
	failedIndices := []int{}
	errors := []ExtractError{}

	expectedIds := map[int]bool{}
	for _, a := range actionBatch {
		expectedIds[a.Index] = true
	}

	extracted := robustExtractSteps(rawReply)
	errors = append(errors, extracted.Errors...)

	byId := map[int]StructuredStep{}
	for _, row := range extracted.Steps {
		if !expectedIds[row.ID] {
			errors = append(errors, ExtractError{Index: row.ID, Type: "xml-unknown-id", Reason: fmt.Sprintf("XML id=%d 不在本批 actionBatch 中", row.ID)})
			continue
		}
		byId[row.ID] = StructuredStep{
			ID:          row.ID,
			Description: row.Action,
			UiChange:    row.Observation,
			AssertText:  row.AssertText,
		}
	}

	for _, action := range actionBatch {
		if hit, ok := byId[action.Index]; ok {
			parsedSteps = append(parsedSteps, hit)
		} else {
			failedIndices = append(failedIndices, action.Index)
			errors = append(errors, ExtractError{Index: action.Index, Type: "batch-missing-index", Reason: "LLM XML 未包含该 index"})
		}
	}

	if len(parsedSteps) == 0 && len(actionBatch) > 0 {
		errors = append(errors, ExtractError{Index: actionBatch[0].Index, Type: "batch-parse-error", Reason: "未能从 XML 解析出任何有效 step"})
		for _, action := range actionBatch {
			if !containsInt(failedIndices, action.Index) {
				failedIndices = append(failedIndices, action.Index)
			}
		}
	}

	return BatchParseResult{ParsedSteps: parsedSteps, FailedIndices: failedIndices, Errors: errors}
}

func containsInt(arr []int, v int) bool {
	for _, x := range arr {
		if x == v {
			return true
		}
	}
	return false
}

// ==================== XML 产物落盘 ====================

func escapeXmlText(text string) string {
	text = strings.ReplaceAll(text, "&", "&amp;")
	text = strings.ReplaceAll(text, "<", "&lt;")
	text = strings.ReplaceAll(text, ">", "&gt;")
	text = strings.ReplaceAll(text, "\"", "&quot;")
	return text
}

type StepXmlRow struct {
	Index       int
	Status      string
	Description string
	UiChange    string
}

func renderStructuredStepsXml(steps []StepXmlRow) string {
	var lines []string
	lines = append(lines, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<steps>")
	for _, step := range steps {
		id := intToStr(int64(step.Index))
		status := ""
		if step.Status != "" {
			status = " status=\"" + escapeXmlText(step.Status) + "\""
		}
		action := escapeXmlText(step.Description)
		observation := escapeXmlText(step.UiChange)
		if observation == "" {
			observation = "无可见变化"
		}
		lines = append(lines, "  <step id=\""+id+"\""+status+">")
		lines = append(lines, "    <action>"+action+"</action>")
		lines = append(lines, "    <observation>"+observation+"</observation>")
		lines = append(lines, "  </step>")
	}
	lines = append(lines, "</steps>")
	return strings.Join(lines, "\n") + "\n"
}

type LlmRawBatch struct {
	IndexFrom int
	IndexTo   int
	Raw       string
}

func renderLlmRawBatchesXml(batches []LlmRawBatch) string {
	var lines []string
	lines = append(lines, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<phase1_llm_batches>", "  <!-- 各批次 LLM 原始输出，用于对照 snapshots-2-steps-skill 与 xml-step-extractor -->")
	for _, batch := range batches {
		from := intToStr(int64(batch.IndexFrom))
		to := intToStr(int64(batch.IndexTo))
		text, _ := preprocessLlmXmlOutputFull(batch.Raw, Phase1LlmRawMaxChars)
		lines = append(lines, "  <batch indexFrom=\""+from+"\" indexTo=\""+to+"\">")
		lines = append(lines, "    <![CDATA[")
		lines = append(lines, text)
		lines = append(lines, "    ]]>")
		lines = append(lines, "  </batch>")
	}
	lines = append(lines, "</phase1_llm_batches>")
	return strings.Join(lines, "\n") + "\n"
}

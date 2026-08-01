package main

import (
	"strconv"
	"strings"
)

func formatStepAsPlainText(step StructuredStep) string {
	index := strconv.Itoa(step.ID)
	action := strings.TrimSpace(step.Description)
	if action == "" {
		action = "(无动作描述)"
	}
	observation := strings.TrimSpace(step.UiChange)
	if observation == "" {
		observation = "无可见变化"
	}
	assertText := strings.TrimSpace(step.AssertText)
	if assertText == "" {
		assertText = "无可见变化"
	}
	return "步骤 " + index + ":\n- 动作: " + action + "\n- 界面响应: " + observation + "\n- 完成标准: " + assertText
}

func formatStepsWindowPlainText(steps []StructuredStep) string {
	parts := make([]string, 0, len(steps))
	for _, step := range steps {
		parts = append(parts, formatStepAsPlainText(step))
	}
	return strings.Join(parts, "\n\n")
}

func isPhase2EffectiveStep(step StructuredStep) bool {
	return step.Status == "normal" || step.Status == "fallback"
}

func filterEffectiveStepsForPhase2(steps []StructuredStep) []StructuredStep {
	result := make([]StructuredStep, 0, len(steps))
	for _, step := range steps {
		if isPhase2EffectiveStep(step) {
			result = append(result, step)
		}
	}
	return result
}

func escapeTableCell(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(text), "|", "\\|"), "\n", "<br>")
}

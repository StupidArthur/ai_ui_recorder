package translator

import (
	"fmt"
	"strings"
)

// renderRunnableCase writes one debugger-consumable H3 per Phase 2 Case and
// one H4 per StructuredStep. It only formats recorded/transformed facts.
func renderRunnableCase(runDir string, steps []StructuredStep, slices []CaseSlice, logger *Logger) (string, error) {
	logger.Infof("[Phase 3] renderRunnableCase 开始：steps=%d, slices=%d", len(steps), len(slices))
	if err := validateCaseSlices(steps, slices); err != nil {
		return "", fmt.Errorf("[Phase 3] Case 切片校验失败: %w", err)
	}

	effectiveSteps := filterEffectiveStepsForPhase2(steps)
	startURL := resolveSanitizedStartURL(runDir, effectiveSteps)
	var md strings.Builder

	for caseIndex, slice := range slices {
		caseSteps := stepsForSlice(effectiveSteps, slice)
		if len(caseSteps) == 0 {
			return "", fmt.Errorf("[Phase 3] Case %d 未覆盖有效步骤", caseIndex+1)
		}

		name := strings.TrimSpace(slice.Name)
		if name == "" {
			name = fmt.Sprintf("测试用例 %d", caseIndex+1)
		}
		name = cleanMarkdownHeading(sanitizeKnownSensitiveText(name, effectiveSteps))
		md.WriteString(fmt.Sprintf("### %s（录制生成版）\n\n", name))

		purpose := strings.TrimSpace(sanitizeKnownSensitiveText(slice.Purpose, effectiveSteps))
		if purpose == "" {
			purpose = "未能从录制证据提取测试目的；待调试确认。"
		}
		md.WriteString("- 测试目的：" + cleanSingleLine(purpose) + "\n")
		if caseIndex == 0 {
			if startURL != "" {
				md.WriteString("- 起始 URL：" + startURL + "\n")
			} else {
				md.WriteString("- 起始 URL：未能从录制数据提取安全有效地址；待调试确认。\n")
			}
			md.WriteString("- 执行关系：本 Case 是录制流程的起点。\n\n")
		} else {
			md.WriteString(fmt.Sprintf("- 执行关系：承接 Case %d 完成后的页面和数据状态，按录制顺序继续，不重新打开流程起始 URL。\n\n", caseIndex))
		}

		md.WriteString("#### 执行约定\n\n")
		md.WriteString("- 操作和预期基于结构化翻译；本地兜底及未提取到可验证结果的步骤按下方逐项提示待确认。\n")
		md.WriteString("- 本文件是录制生成版；未经调试确认的信息不得当成已知执行条件。\n")
		for stepIndex, step := range caseSteps {
			for _, reason := range runnableConfirmationReasons(step) {
				md.WriteString(fmt.Sprintf("- 步骤%d（原始步骤 %d）待调试确认：%s。\n", stepIndex+1, step.ID, reason))
			}
		}
		md.WriteString("\n")

		for stepIndex, step := range caseSteps {
			title := runnableStepTitle(step)
			md.WriteString(fmt.Sprintf("#### 步骤%d %s\n\n", stepIndex+1, title))
			md.WriteString("**操作**\n\n")
			md.WriteString("1. " + renderRunnableStepAction(step) + "\n\n")
			md.WriteString("**预期**\n\n")
			if result := renderRunnableStepResult(step); result != "" {
				md.WriteString("- [ ] " + result + "\n\n")
			} else {
				md.WriteString("- [ ] 待调试确认：录制中未提取到可验证结果。\n\n")
			}
		}
	}

	content := strings.TrimRight(md.String(), " \t\n\r\v\f") + "\n"
	path := getTranslatePaths(runDir).RunnableCaseMd
	if err := textWriteFile(path, content); err != nil {
		return "", fmt.Errorf("[Phase 3] 写入 runnable_case.md 失败: %w", err)
	}
	logger.Infof("[Phase 3] runnable_case.md 生成成功 (%d 个 Case)，文件: %s", len(slices), path)
	return path, nil
}

func stepsForSlice(steps []StructuredStep, slice CaseSlice) []StructuredStep {
	selected := make([]StructuredStep, 0, slice.Consume)
	for _, step := range steps {
		if step.ID >= slice.StartStep && step.ID <= slice.EndStep {
			selected = append(selected, step)
		}
	}
	return selected
}

func runnableStepTitle(step StructuredStep) string {
	if isSensitiveStructuredInput(step) {
		return "输入凭据"
	}
	title := cleanSingleLine(strings.TrimSpace(step.Description))
	if title == "" || title == "(无动作描述)" {
		if target := strings.TrimSpace(step.Target); target != "" {
			title = target
		} else {
			title = "操作目标待确认"
		}
	}
	title = sanitizeKnownSensitiveText(title, []StructuredStep{step})
	return truncateRunes(cleanMarkdownHeading(title), 56)
}

func renderRunnableStepAction(step StructuredStep) string {
	action := renderStepAction(step)
	if step.ActionKind == "input" && isSensitiveStructuredInput(step) {
		return action + "（待调试确认凭据参数）"
	}
	if missingStructuredInputValue(step) {
		action += "（缺少输入值，待调试确认）"
	}
	if step.ActionKind != "keyPress" && strings.TrimSpace(step.Target) == "" {
		action += "（缺少操作目标，待调试确认）"
	}
	if strings.TrimSpace(step.Description) == "" {
		action += "（缺少具体操作描述，待调试确认）"
	}
	if step.IsFallback || step.Status == "fallback" {
		action += "（本地兜底步骤，待调试确认）"
	}
	return cleanSingleLine(action)
}

func renderRunnableStepResult(step StructuredStep) string {
	result := renderStepResult(step)
	return cleanSingleLine(sanitizeKnownSensitiveText(result, []StructuredStep{step}))
}

func runnableConfirmationReasons(step StructuredStep) []string {
	var reasons []string
	if step.IsFallback || step.Status == "fallback" {
		reasons = append(reasons, "步骤由本地兜底生成，需要核对操作和结果")
	}
	if step.ActionKind != "keyPress" && strings.TrimSpace(step.Target) == "" {
		reasons = append(reasons, "录制数据缺少操作目标")
	}
	if strings.TrimSpace(step.Description) == "" {
		reasons = append(reasons, "录制数据缺少具体操作描述")
	}
	if step.ActionKind == "input" {
		if isSensitiveStructuredInput(step) {
			reasons = append(reasons, "需要在执行时提供凭据参数；录制值已隐藏")
		} else if missingStructuredInputValue(step) {
			reasons = append(reasons, "录制数据缺少必填输入值")
		}
	}
	return reasons
}

func isSensitiveStructuredInput(step StructuredStep) bool {
	return step.ActionKind == "input" && (step.InputSensitive || isSensitiveInputTarget(step.Target, step.Description))
}

func missingStructuredInputValue(step StructuredStep) bool {
	if step.ActionKind != "input" || strings.TrimSpace(step.InputText) != "" || isSensitiveStructuredInput(step) {
		return false
	}
	description := strings.ToLower(step.Description + " " + step.Target)
	for _, marker := range []string{"清空", "清除", "清掉", "删除输入", "clear", "empty"} {
		if strings.Contains(description, marker) {
			return false
		}
	}
	return true
}

func sanitizeKnownSensitiveText(value string, steps []StructuredStep) string {
	for _, step := range steps {
		if !isSensitiveStructuredInput(step) {
			continue
		}
		secret := strings.TrimSpace(step.InputText)
		if secret != "" {
			value = strings.ReplaceAll(value, secret, "[凭据已脱敏]")
		}
	}
	return value
}

func cleanSingleLine(value string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(value, "\r", " ")), " ")
}

func cleanMarkdownHeading(value string) string {
	value = cleanSingleLine(value)
	value = strings.TrimSpace(strings.TrimLeft(value, "#"))
	return value
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit-1]) + "…"
}

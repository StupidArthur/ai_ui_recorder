package main

import (
	"fmt"
	"strings"
)

// renderHumanCase 将 Phase 3 同源的结构化步骤按 Phase 2 CaseSlice 分组，
// 输出可同时作为测试用例和录制测试记录的 Markdown 表格。
func renderHumanCase(runDir string, steps []StructuredStep, slices []CaseSlice, logger *Logger) (string, error) {
	logger.Infof("[Phase 4] renderHumanCase 开始：steps=%d, slices=%d", len(steps), len(slices))
	transPaths := getTranslatePaths(runDir)

	if len(slices) == 0 {
		return "", fmt.Errorf("[Phase 4] 无有效切片，无法生成 cases.md")
	}

	effectiveSteps := filterEffectiveStepsForPhase2(steps)

	var md strings.Builder
	md.WriteString("# TPT 测试用例与测试记录\n\n")
	md.WriteString("> “结果”来自录制过程中的实际观察，并作为后续回归执行的预期基线。\n")

	for caseIndex, slice := range slices {
		md.WriteString("\n")
		if caseIndex > 0 {
			md.WriteString("---\n\n")
		}

		name := strings.TrimSpace(slice.Name)
		if name == "" {
			name = fmt.Sprintf("测试用例 %d", caseIndex+1)
		}
		md.WriteString(fmt.Sprintf("## Case %d：%s\n\n", caseIndex+1, name))

		if purpose := strings.TrimSpace(slice.Purpose); purpose != "" {
			md.WriteString("**测试目的：** " + purpose + "\n\n")
		}

		md.WriteString("| 序号 | 操作 | 结果（录制实况 / 预期基线） |\n")
		md.WriteString("|---:|---|---|\n")

		rowIndex := 0
		for _, step := range effectiveSteps {
			if step.ID < slice.StartStep || step.ID > slice.EndStep {
				continue
			}
			rowIndex++
			action := escapeTableCell(renderStepAction(step))
			result := escapeTableCell(renderStepResult(step))
			md.WriteString(fmt.Sprintf("| %d | %s | %s |\n", rowIndex, action, result))
		}

		if rowIndex == 0 {
			md.WriteString("| 1 | （无有效操作步骤） |  |\n")
		}
	}

	content := strings.TrimRight(md.String(), " \t\n\r\v\f") + "\n"
	if err := textWriteFile(transPaths.CasesMd, content); err != nil {
		return "", fmt.Errorf("[Phase 4] 写入 cases.md 失败: %w", err)
	}

	logger.Infof("[Phase 4] cases.md 生成成功 (%d 个 Case)，文件: %s", len(slices), transPaths.CasesMd)
	return transPaths.CasesMd, nil
}

func renderStepResult(step StructuredStep) string {
	if result := normalizeRecordedResult(step.AssertText); result != "" {
		return result
	}
	return normalizeRecordedResult(step.UiChange)
}

func normalizeRecordedResult(value string) string {
	result := strings.TrimSpace(value)
	if result == "" {
		return ""
	}

	normalized := strings.TrimSpace(strings.TrimRight(result, "。.!！"))
	switch normalized {
	case "无可见变化", "无明显变化", "无界面变化", "无 UI 变化", "无UI变化", "无":
		return ""
	default:
		return result
	}
}

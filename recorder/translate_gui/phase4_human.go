package main

import (
	"fmt"
	"os"
	"strings"
)

func renderHumanCase(runDir string, steps []StructuredStep, slices []CaseSlice, logger *Logger) string {
	logger.Infof("[Phase 4] renderHumanCase 开始：steps=%d, slices=%d", len(steps), len(slices))
	transPaths := getTranslatePaths(runDir)

	if len(slices) == 0 {
		logger.Warn("[Phase 4] 无切片，跳过生成 cases.md")
		return ""
	}

	effectiveSteps := filterEffectiveStepsForPhase2(steps)

	var md strings.Builder
	md.WriteString("# 录制流程测试用例归纳\n\n")

	for i, sl := range slices {
		if i > 0 {
			md.WriteString("\n\n---\n\n")
		}

		name := sl.Name
		if name == "" {
			name = fmt.Sprintf("测试用例 %d", i+1)
		}
		md.WriteString(fmt.Sprintf("# 测试用例：%s\n\n", name))

		purpose := sl.Purpose
		if purpose == "" {
			purpose = "（未提供测试目的）"
		}
		md.WriteString("## 1. 业务背景与初始状态\n\n")
		md.WriteString(purpose + "\n\n")

		md.WriteString("## 2. 测试步骤流\n\n")

		for _, s := range effectiveSteps {
			if s.ID >= sl.StartStep && s.ID <= sl.EndStep {
				action := strings.TrimSpace(s.Description)
				if action == "" {
					action = "(无动作描述)"
				}
				obs := strings.TrimSpace(s.UiChange)
				if obs == "" {
					obs = "无可见变化"
				}

				md.WriteString(fmt.Sprintf("### [步骤 %d] %s\n\n", s.ID, action))
				md.WriteString(fmt.Sprintf("- **执行动作**：%s\n", action))
				md.WriteString(fmt.Sprintf("- **状态验证**：%s\n\n", obs))
			}
		}
	}

	content := strings.TrimRight(md.String(), " \t\n\r\v\f") + "\n"
	os.WriteFile(transPaths.CasesMd, []byte(content), 0644)

	logger.Infof("[Phase 4] cases.md 生成成功 (%d 个用例)，文件: %s", len(slices), transPaths.CasesMd)
	return transPaths.CasesMd
}

package main

import (
	"fmt"
	"os"
	"strings"
)

func renderAgentCase(runDir string, steps []StructuredStep, slices []CaseSlice, logger *Logger) string {
	logger.Infof("[Phase 3] renderAgentCase 开始：steps=%d, slices=%d", len(steps), len(slices))
	transPaths := getTranslatePaths(runDir)

	if len(slices) == 0 {
		logger.Warn("[Phase 3] 无切片，跳过生成 agents.txt")
		return ""
	}

	effectiveSteps := filterEffectiveStepsForPhase2(steps)

	var finalTxt strings.Builder

	useCaseName := "录制流程测试用例"
	useCasePurpose := ""
	if len(slices) > 0 {
		useCaseName = slices[0].Name
		useCasePurpose = slices[0].Purpose
	}
	finalTxt.WriteString(fmt.Sprintf("测试用例名称：%s\n测试目的：%s\n\n", useCaseName, useCasePurpose))

	startURL := readTargetURLFromMeta(runDir)
	if startURL == "" {
		for _, s := range effectiveSteps {
			if strings.TrimSpace(s.URL) != "" {
				startURL = strings.TrimSpace(s.URL)
				break
			}
		}
	}
	if startURL != "" {
		finalTxt.WriteString(fmt.Sprintf("起始 URL：%s\n\n", startURL))
	}

	finalTxt.WriteString("测试步骤：\n\n")

	for i, sl := range slices {
		logicalName := sl.Name
		if logicalName == "" {
			logicalName = fmt.Sprintf("逻辑步骤 %d", i+1)
		}
		finalTxt.WriteString(fmt.Sprintf("步骤%d: %s\n", i+1, logicalName))

		for _, s := range effectiveSteps {
			if s.ID >= sl.StartStep && s.ID <= sl.EndStep {
				micro := renderAgentMicro(s)
				finalTxt.WriteString(fmt.Sprintf("- %s\n", micro))
			}
		}
		finalTxt.WriteString("\n")
	}

	content := strings.TrimSpace(finalTxt.String())
	os.WriteFile(transPaths.AgentsTxt, []byte(content), 0644)

	logger.Infof("[Phase 3] agents.txt 生成成功 (%d 个逻辑步骤)，文件: %s", len(slices), transPaths.AgentsTxt)
	return transPaths.AgentsTxt
}

func renderAgentMicro(step StructuredStep) string {
	action := strings.TrimSpace(step.Description)
	if action == "" {
		action = "(无动作描述)"
	}
	assertText := strings.TrimSpace(step.AssertText)
	if assertText == "" || assertText == "无可见变化" {
		return action
	}
	return fmt.Sprintf("%s，确认%s", action, assertText)
}

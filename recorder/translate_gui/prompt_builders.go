package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ==================== Phase 1 Prompt ====================

func buildPhase1SystemPrompt() string {
	content, _ := LoadPrompt(Phase1Name)
	return trimPrompt(content)
}

func buildPhase1UserPrompt(batch []EnrichedAction, recentSteps []StructuredStep) string {
	var contextHistory string
	if len(recentSteps) > 0 {
		lines := make([]string, 0, 3)
		start := len(recentSteps) - 3
		if start < 0 {
			start = 0
		}
		for _, s := range recentSteps[start:] {
			lines = append(lines, fmt.Sprintf("[Index %d] %s -> 变化: %s", s.ID, s.Description, s.UiChange))
		}
		contextHistory = strings.Join(lines, "\n")
	} else {
		contextHistory = "(无历史上下文，这是起始操作)"
	}

	actionCount := len(batch)
	blocks := make([]string, 0, actionCount)
	for i, action := range batch {
		header := fmt.Sprintf("=============【动作 Index: %d (第 %d/%d 个)】=============", action.Index, i+1, actionCount)
		body := buildPhase1ActionJSON(action)
		blocks = append(blocks, header+"\n"+body+"\n")
	}
	actionBlocks := strings.Join(blocks, "\n")

	return fmt.Sprintf(`【历史上下文参考】
以下是发生在本次批处理之前的最近几次动作解析结果，仅供你理解上下文逻辑，**不需要**在你的输出中包含它们：
%s

【本次需要解析的动作数组】
注意：以下共有 %d 个动作。你必须输出 %d 个解析结果。

%s
请立即开始解析，并严格按照 System Prompt 的 Output Format 仅输出 XML，不要输出任何其他解释性文本。`, contextHistory, actionCount, actionCount, actionBlocks)
}

func buildPhase1ActionJSON(action EnrichedAction) string {
	obj := map[string]interface{}{
		"type":           action.Action.Type,
		"timestamp":      action.Action.Timestamp,
		"element":        action.Action.Element,
		"localContext":   action.Context,
		"formStateDelta": action.FormStateDelta,
		"snapshotDiff":   action.Diff,
	}
	data, _ := json.MarshalIndent(obj, "", "  ")
	return string(data)
}

// ==================== Phase 2 Prompt (slice-case) ====================

func buildPhase2SystemPrompt() string {
	content, _ := LoadPrompt(Phase2Name)
	return trimPrompt(content)
}

func buildPhase2UserPrompt(windowStepsPlainText, indexListText string) string {
	return fmt.Sprintf(`本窗口底层步骤记录（纯文本）：

%s

本窗口可用 index 列表（consume 对应前缀连续子集，从这里取）：%s

请按原子业务目标切分为多个 slice，每个 slice 覆盖一个独立的业务闭环。从窗口第一个步骤开始，顺序扫描，每检测到业务闭环就输出一个 <slice>。仅输出 <slices> XML，不要 Markdown，不要 JSON。`, windowStepsPlainText, indexListText)
}

// ==================== Legacy Phase 4 Prompt（旧 phase4.go 引用） ====================

func buildPhase4SystemPrompt() string {
	content, _ := LoadPrompt(Phase4Name)
	return trimPrompt(content)
}

func buildPhase4UserPrompt(stepsPlainText string) string {
	return fmt.Sprintf(`请根据以下按时间顺序排列的底层步骤记录（纯文本），进行业务逻辑聚合并输出 <agent_chunk> XML：

%s`, stepsPlainText)
}

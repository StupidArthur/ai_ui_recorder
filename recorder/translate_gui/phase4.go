package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ==================== Phase 4 agent_chunk XML 解析 ====================

var (
	reAgentChunk      = regexp.MustCompile(`(?i)<agent_chunk[^>]*\btotalConsume\s*=\s*["']?(\d+)["']?[^>]*>`)
	reUseCaseFull     = regexp.MustCompile(`(?i)<use_case[^>]*\bname\s*=\s*["']([^"']*)["'][^>]*\bpurpose\s*=\s*["']([^"']*)["'][^>]*/?>`)
	reUseCaseNameOnly = regexp.MustCompile(`(?i)<use_case[^>]*\bname\s*=\s*["']([^"']*)["'][^>]*/?>`)
	reLogicalStep     = regexp.MustCompile(`(?is)<logical_step[^>]*\bconsume\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)</logical_step>`)
	reLogicalName     = regexp.MustCompile(`(?is)<name[^>]*>([\s\S]*?)</name>`)
	reMicroAction     = regexp.MustCompile(`(?is)<micro[^>]*>([\s\S]*?)</micro>`)
)

// parseAgentChunkXml 解析单窗 agent_chunk XML
func parseAgentChunkXml(rawReply string) *ParsedAgentChunk {
	text, _ := preprocessLlmXmlOutputFull(rawReply, Phase1LlmRawMaxChars)

	if !hasClosingTag(text, "</agent_chunk>") && !strings.Contains(strings.ToLower(text), "<agent_chunk") {
		return nil
	}

	totalConsume := 0
	if m := reAgentChunk.FindStringSubmatch(text); m != nil {
		if n, err := strconv.Atoi(m[1]); err == nil {
			totalConsume = n
		}
	}

	useCaseName := ""
	useCasePurpose := ""
	if uc := reUseCaseFull.FindStringSubmatch(text); uc != nil {
		useCaseName = toSingleLineText(uc[1])
		useCasePurpose = toSingleLineText(uc[2])
	} else if uc := reUseCaseNameOnly.FindStringSubmatch(text); uc != nil {
		useCaseName = toSingleLineText(uc[1])
	}

	agentSteps := []AgentStep{}
	for _, lm := range reLogicalStep.FindAllStringSubmatch(text, -1) {
		parsed := 1
		if n, err := strconv.Atoi(lm[1]); err == nil {
			parsed = n
		}
		consumeStepCount := parsed
		if consumeStepCount < 1 {
			consumeStepCount = 1
		}

		inner := lm[2]
		logicalName := "逻辑步骤"
		if nameM := reLogicalName.FindStringSubmatch(inner); nameM != nil {
			logicalName = toSingleLineText(nameM[1])
		}

		microActions := []string{}
		for _, mm := range reMicroAction.FindAllStringSubmatch(inner, -1) {
			line := toSingleLineText(mm[1])
			if line != "" {
				microActions = append(microActions, line)
			}
		}
		if len(microActions) == 0 && logicalName != "" {
			microActions = []string{logicalName}
		}

		agentSteps = append(agentSteps, AgentStep{
			LogicalName:      logicalName,
			MicroActions:     microActions,
			ConsumeStepCount: consumeStepCount,
		})
	}

	if len(agentSteps) == 0 {
		return nil
	}

	if totalConsume == 0 {
		sum := 0
		for _, s := range agentSteps {
			sum += s.ConsumeStepCount
		}
		totalConsume = sum
	}

	return &ParsedAgentChunk{
		UseCaseName:    useCaseName,
		UseCasePurpose: useCasePurpose,
		AgentSteps:     agentSteps,
		TotalConsume:   totalConsume,
	}
}

// ==================== 本地兜底渲染 ====================

// formatStepAsMicroAction 将单条结构化步骤格式化为 Agent 可执行的微观动作描述（含完成标准）
func formatStepAsMicroAction(step StructuredStep) string {
	target := step.Target
	if target == "" {
		target = "目标元素"
	}
	var actionDesc string
	switch step.ActionKind {
	case "input":
		val := step.InputText
		if val != "" {
			actionDesc = fmt.Sprintf("在「%s」输入 %s", target, val)
		} else {
			actionDesc = fmt.Sprintf("在「%s」输入内容", target)
		}
	case "keyPress":
		key := step.Key
		if key == "" {
			key = "Enter"
		}
		actionDesc = fmt.Sprintf("在「%s」按下 %s 键", target, key)
	case "doubleClick":
		actionDesc = fmt.Sprintf("双击「%s」", target)
	case "rightClick":
		actionDesc = fmt.Sprintf("右键点击「%s」", target)
	default:
		actionDesc = fmt.Sprintf("点击「%s」", target)
	}
	assertText := strings.TrimSpace(step.AssertText)
	if assertText != "" && assertText != "无可见变化" {
		actionDesc += "，确认" + assertText
	}
	return actionDesc
}

// buildLocalAgentStepsFromChunk 本地确定性聚合：每条结构化步骤对应一个逻辑步骤（1:1）
func buildLocalAgentStepsFromChunk(chunk []StructuredStep) []AgentStep {
	result := make([]AgentStep, 0, len(chunk))
	for _, step := range chunk {
		logicalName := step.Description
		if logicalName == "" {
			logicalName = fmt.Sprintf("操作 %d", step.ID)
		}
		result = append(result, AgentStep{
			LogicalName:      logicalName,
			MicroActions:     []string{formatStepAsMicroAction(step)},
			ConsumeStepCount: 1,
		})
	}
	return result
}

// deriveUseCaseNameFromSteps 从结构化步骤推导用例名称
func deriveUseCaseNameFromSteps(steps []StructuredStep) string {
	if len(steps) == 0 {
		return "未命名测试用例"
	}
	first := steps[0]
	page := ""
	if first.Page != "" && first.Page != "未知" {
		page = first.Page
	}
	desc := first.Description
	if page != "" && desc != "" {
		return fmt.Sprintf("%s - %s", page, truncateRunes(desc, 30))
	}
	truncated := truncateRunes(desc, 40)
	if truncated != "" {
		return truncated
	}
	if page != "" {
		return page
	}
	return "录制流程测试用例"
}

// truncateRunes 按 rune 截断字符串，保证 UTF-8 安全（对齐 JS slice 的字符语义）
func truncateRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// ==================== Agent TXT 生成 ====================

// generateAgentTxt Phase 4：并发固定窗口 + LLM XML(agent_chunk) + 本地渲染 agents.txt
func generateAgentTxt(runDir string, structuredSteps []StructuredStep, client *LLMClient, logger *Logger, auditor *LlmAuditor, phaseWindowSize int) string {
	if phaseWindowSize <= 0 {
		phaseWindowSize = Phase4WindowSize
	}
	logger.Infof("[Agent TXT] 开始生成 Agent 专用测试用例 (窗口大小=%d, 并发=%d)...", phaseWindowSize, Phase1Concurrency)

	var effectiveSteps []StructuredStep
	for _, s := range structuredSteps {
		if s.Status == "normal" || s.Status == "fallback" {
			effectiveSteps = append(effectiveSteps, s)
		}
	}

	if len(effectiveSteps) == 0 {
		logger.Warn("[Agent TXT] 无有效步骤，跳过生成")
		return ""
	}

	type chunkResult struct {
		chunkIdx    int
		agentSteps  []AgentStep
		useCaseName string
		purpose     string
		isFallback  bool
	}

	type chunkInfo struct {
		chunk []StructuredStep
		start int
	}

	var chunkInfos []chunkInfo
	for cursor := 0; cursor < len(effectiveSteps); {
		end := cursor + phaseWindowSize
		if end > len(effectiveSteps) {
			end = len(effectiveSteps)
		}
		chunkInfos = append(chunkInfos, chunkInfo{chunk: effectiveSteps[cursor:end], start: cursor + 1})
		cursor = end
	}

	results := make([]chunkResult, len(chunkInfos))
	var mu sync.Mutex
	sem := make(chan struct{}, Phase1Concurrency)
	var wg sync.WaitGroup

	for idx, ci := range chunkInfos {
		wg.Add(1)
		go func(i int, c []StructuredStep, chunkStart int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			chunkEnd := chunkStart + len(c) - 1
			logger.Infof("[Agent TXT] 正在处理步骤 %d~%d (chunk %d/%d)...", chunkStart, chunkEnd, i+1, len(chunkInfos))

			windowPlainText := formatStepsWindowPlainText(c)
			messages := []chatMessage{
				{Role: "system", Content: buildPhase4SystemPrompt()},
				{Role: "user", Content: buildPhase4UserPrompt(windowPlainText)},
			}

			start := time.Now()
			rawReply, err := client.CallChat(messages, 0.1, Phase4MaxTokens)
			durationMs := time.Since(start).Milliseconds()

			mu.Lock()
			defer mu.Unlock()

			if err != nil {
				logger.Warnf("[Agent TXT] chunk %d LLM 失败 (%v)，使用本地兜底", i+1, err)
				if auditor != nil {
					auditor.Record("phase4", i+1, false, windowPlainText, "", durationMs, err.Error())
				}
				results[i] = chunkResult{chunkIdx: i, agentSteps: buildLocalAgentStepsFromChunk(c), isFallback: true}
				return
			}

			parsedChunk := parseAgentChunkXml(rawReply)
			parseOk := parsedChunk != nil && len(parsedChunk.AgentSteps) > 0
			errMsg := ""
			if !parseOk {
				errMsg = "agent_chunk XML 解析失败或 agentSteps 为空"
			}
			if auditor != nil {
				auditor.Record("phase4", i+1, parseOk, windowPlainText, rawReply, durationMs, errMsg)
			}

			if !parseOk {
				logger.Warnf("[Agent TXT] chunk %d XML 无效，使用本地兜底", i+1)
				results[i] = chunkResult{chunkIdx: i, agentSteps: buildLocalAgentStepsFromChunk(c), isFallback: true}
				return
			}

			useCaseName := ""
			purpose := ""
			if i == 0 && parsedChunk.UseCaseName != "" {
				useCaseName = parsedChunk.UseCaseName
				if parsedChunk.UseCasePurpose != "" {
					purpose = parsedChunk.UseCasePurpose
				}
			}

			safeConsume, _, _ := clampWindowConsume(parsedChunk.TotalConsume, len(c))
			consumedInChunk := 0
			var agentSteps []AgentStep
			for _, logicalStep := range parsedChunk.AgentSteps {
				agentSteps = append(agentSteps, logicalStep)
				cc := logicalStep.ConsumeStepCount
				if cc < 1 {
					cc = 1
				}
				consumedInChunk += cc
				if consumedInChunk >= safeConsume {
					break
				}
			}

			results[i] = chunkResult{chunkIdx: i, agentSteps: agentSteps, useCaseName: useCaseName, purpose: purpose}
		}(idx, ci.chunk, ci.start)
	}
	wg.Wait()

	globalUseCaseName := deriveUseCaseNameFromSteps(effectiveSteps)
	globalUseCasePurpose := "验证录制业务流程可正常执行"
	usedLocalFallback := false
	var globalAgentSteps []AgentStep

	for _, r := range results {
		if r.useCaseName != "" {
			globalUseCaseName = r.useCaseName
		}
		if r.purpose != "" {
			globalUseCasePurpose = r.purpose
		}
		if r.isFallback {
			usedLocalFallback = true
		}
		globalAgentSteps = append(globalAgentSteps, r.agentSteps...)
	}

	if len(globalAgentSteps) == 0 {
		logger.Warn("[Agent TXT] 全局步骤为空，对全部有效步骤做本地兜底")
		globalAgentSteps = buildLocalAgentStepsFromChunk(effectiveSteps)
		usedLocalFallback = true
	}

	var finalTxt strings.Builder
	finalTxt.WriteString(fmt.Sprintf("测试用例名称：%s\n测试目的：%s\n\n", globalUseCaseName, globalUseCasePurpose))

	// 起始 URL 优先取 meta.json 的 targetUrl（录制时用户输入的原始 URL，未被重定向污染）
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
	for i, step := range globalAgentSteps {
		logicalName := step.LogicalName
		if logicalName == "" {
			logicalName = fmt.Sprintf("逻辑步骤 %d", i+1)
		}
		finalTxt.WriteString(fmt.Sprintf("步骤%d: %s\n", i+1, logicalName))
		actions := step.MicroActions
		if len(actions) == 0 {
			finalTxt.WriteString("- （无微观动作描述）\n")
		} else {
			for _, action := range actions {
				finalTxt.WriteString(fmt.Sprintf("- %s\n", action))
			}
		}
		finalTxt.WriteString("\n")
	}

	transPaths := getTranslatePaths(runDir)
	os.WriteFile(transPaths.AgentsTxt, []byte(strings.TrimSpace(finalTxt.String())), 0644)

	fallbackTag := ""
	if usedLocalFallback {
		fallbackTag = "，含本地兜底"
	}
	logger.Infof("[Agent TXT] 生成成功 (%d 个逻辑步骤%s)，文件: %s", len(globalAgentSteps), fallbackTag, transPaths.AgentsTxt)

	return transPaths.AgentsTxt
}

// readTargetURLFromMeta 从 meta.json 读取起始 URL，优先 initialUrl（录制工具配置的原始 URL，未被重定向），回退 targetUrl
func readTargetURLFromMeta(runDir string) string {
	metaPath := filepath.Join(runDir, MetaFilename)
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return ""
	}
	var meta Meta
	if err := json.Unmarshal(data, &meta); err != nil {
		return ""
	}
	if u := strings.TrimSpace(meta.InitialURL); u != "" {
		return u
	}
	return strings.TrimSpace(meta.TargetURL)
}

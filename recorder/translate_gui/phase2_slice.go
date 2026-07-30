package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type SliceParseResult struct {
	Slices               []CaseSlice
	ConsumeStepCount     int
	RawConsume           int
	ClampReason          string
	CoveredActionIndices []int
}

var reSlicesTotalConsume = regexp.MustCompile(`<slices[^>]*totalConsume\s*=\s*"(\d+)"`)
var reSliceBlock = regexp.MustCompile(`(?s)<slice[^>]*consume\s*=\s*"(\d+)"[^>]*startStep\s*=\s*"(\d+)"[^>]*endStep\s*=\s*"(\d+)"[^>]*>(.*?)</slice>`)
var reSliceName = regexp.MustCompile(`(?s)<name>(.*?)</name>`)
var reSlicePurpose = regexp.MustCompile(`(?s)<purpose>(.*?)</purpose>`)

func runPhase2Slice(steps []StructuredStep, client *LLMClient, logger *Logger, auditor *LlmAuditor, transPaths TranslatePaths) []CaseSlice {
	phaseWindowSize := Phase2CaseWindowSteps
	effectiveSteps := filterEffectiveStepsForPhase2(steps)

	if len(effectiveSteps) == 0 {
		jsonWriteFile(transPaths.CaseSlicesJson, []CaseSlice{})
		textWriteFile(transPaths.CasesCoverageMd, "# Case 切片覆盖核对\n\n> 无有效步骤，未生成切片。\n")
		logger.Warn("[Phase 2] 无有效步骤（normal），已写入空切片")
		return nil
	}
	logger.Info(fmt.Sprintf("[Phase 2] 开始切分：有效步骤 %d，窗口=%d，最大轮次=%d", len(effectiveSteps), phaseWindowSize, maxSlidingWindowRounds(len(effectiveSteps), phaseWindowSize)))

	var allSlices []CaseSlice
	systemPrompt := buildPhase2SystemPrompt()
	maxRounds := maxSlidingWindowRounds(len(effectiveSteps), phaseWindowSize)

	cursor := 0
	round := 0

	for cursor < len(effectiveSteps) {
		round++
		if round > maxRounds {
			logger.Warn(fmt.Sprintf("[Phase 2] 已达最大轮次 %d，剩余 %d 步将写入占位切片", maxRounds, len(effectiveSteps)-cursor))
			remain := effectiveSteps[cursor:]
			for i, s := range remain {
				allSlices = append(allSlices, CaseSlice{
					StartStep: s.ID,
					EndStep:   s.ID,
					Consume:   1,
					Name:      fmt.Sprintf("剩余步骤 %d", i+1),
					Purpose:   "本地兜底切片",
				})
			}
			break
		}

		end := cursor + phaseWindowSize
		if end > len(effectiveSteps) {
			end = len(effectiveSteps)
		}
		windowSteps := effectiveSteps[cursor:end]
		expectedIndices := make([]int, len(windowSteps))
		for i, s := range windowSteps {
			expectedIndices[i] = s.ID
		}
		indexListText := string(mustJSON(expectedIndices))
		windowPlainText := formatStepsWindowPlainText(windowSteps)

		logger.Info(fmt.Sprintf("[Phase 2] 轮次 %d，cursor=%d，窗口步数 %d，index %d–%d",
			round, cursor, len(windowSteps), expectedIndices[0], expectedIndices[len(expectedIndices)-1]))
		logger.Progress("phase2", fmt.Sprintf("round %d", round), fmt.Sprintf("index %d-%d", expectedIndices[0], expectedIndices[len(expectedIndices)-1]), 35+round*5)

		messages := []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: buildPhase2UserPrompt(windowPlainText, indexListText)},
		}

		start := time.Now()
		rawReply, err := client.CallChat(messages, 0.3, Phase2CaseWindowMaxTokens)
		durationMs := time.Since(start).Milliseconds()

		if err != nil {
			auditor.Record("phase2", round, false, "", "", durationMs, err.Error())
			s := effectiveSteps[cursor]
			allSlices = append(allSlices, CaseSlice{
				StartStep: s.ID,
				EndStep:   s.ID,
				Consume:   1,
				Name:      "解析失败兜底",
				Purpose:   err.Error(),
			})
			cursor += 1
			logger.Warn(fmt.Sprintf("[Phase 2] 轮次 %d 解析失败，消费 1 步: %s", round, err.Error()))
			continue
		}

		auditor.Record("phase2", round, true, messages[1].Content, rawReply, durationMs, "")

		parsed := parseSlicesResponse(rawReply, expectedIndices)

		allSlices = append(allSlices, parsed.Slices...)

		if parsed.ClampReason != "" {
			logger.Warn(fmt.Sprintf("[Phase 2] 轮次 %d clamp: %s", round, parsed.ClampReason))
		}
		logger.Info(fmt.Sprintf("[Phase 2] 轮次 %d 消费 %d 步（%d 个切片）", round, parsed.ConsumeStepCount, len(parsed.Slices)))
		cursor += parsed.ConsumeStepCount
	}

	jsonWriteFile(transPaths.CaseSlicesJson, allSlices)
	writeSliceCoverageMd(transPaths.CasesCoverageMd, allSlices, effectiveSteps)
	logger.Info(fmt.Sprintf("[Phase 2] 完成，共 %d 个切片", len(allSlices)))
	return allSlices
}

func parseSlicesResponse(rawReply string, expectedIndices []int) SliceParseResult {
	cleaned, _ := preprocessLlmXmlOutputFull(cleanMarkdownFence(rawReply), Phase1LlmRawMaxChars)

	var rawConsume int
	if m := reSlicesTotalConsume.FindStringSubmatch(cleaned); m != nil {
		if n, err := strconv.Atoi(m[1]); err == nil {
			rawConsume = n
		}
	}

	matches := reSliceBlock.FindAllStringSubmatch(cleaned, -1)
	indices := expectedIndices
	winLen := len(indices)

	var slices []CaseSlice
	totalConsume := 0
	var clampReasons []string

	for i, m := range matches {
		consume, _ := strconv.Atoi(m[1])
		startStep, _ := strconv.Atoi(m[2])
		endStep, _ := strconv.Atoi(m[3])
		inner := m[4]

		name := ""
		if nm := reSliceName.FindStringSubmatch(inner); nm != nil {
			name = strings.TrimSpace(nm[1])
		}
		purpose := ""
		if pm := reSlicePurpose.FindStringSubmatch(inner); pm != nil {
			purpose = strings.TrimSpace(pm[1])
		}

		if consume < 1 {
			consume = 1
		}

		remaining := winLen - totalConsume
		if consume > remaining {
			consume = remaining
			clampReasons = append(clampReasons, fmt.Sprintf("slice %d over-consume-clamped", i+1))
		}
		if consume < 1 {
			consume = 1
		}

		start := totalConsume
		end := start + consume
		if end > winLen {
			end = winLen
		}

		if start < winLen {
			startStep = indices[start]
			endStep = indices[end-1]
		}

		slices = append(slices, CaseSlice{
			StartStep: startStep,
			EndStep:   endStep,
			Consume:   consume,
			Name:      name,
			Purpose:   purpose,
		})
		totalConsume += consume
	}

	if len(slices) == 0 {
		consume := 1
		if consume > winLen {
			consume = winLen
		}
		slices = append(slices, CaseSlice{
			StartStep: indices[0],
			EndStep:   indices[consume-1],
			Consume:   consume,
			Name:      "未命名切片",
			Purpose:   "LLM 未返回有效切片，本地兜底",
		})
		totalConsume = consume
		clampReasons = append(clampReasons, "no-slice-fallback")
	}

	if totalConsume > winLen {
		totalConsume = winLen
	}

	coveredAll := indices
	if totalConsume < winLen {
		coveredAll = indices[:totalConsume]
	}

	return SliceParseResult{
		Slices:               slices,
		ConsumeStepCount:     totalConsume,
		RawConsume:           rawConsume,
		ClampReason:          strings.Join(clampReasons, "; "),
		CoveredActionIndices: coveredAll,
	}
}

func writeSliceCoverageMd(path string, slices []CaseSlice, steps []StructuredStep) {
	var sb strings.Builder
	sb.WriteString("# Case 切片覆盖核对\n\n")
	sb.WriteString(fmt.Sprintf("总步骤数: %d\n", len(steps)))
	sb.WriteString(fmt.Sprintf("切片数: %d\n\n", len(slices)))

	covered := make(map[int]bool)
	for _, sl := range slices {
		for _, s := range steps {
			if s.ID >= sl.StartStep && s.ID <= sl.EndStep {
				covered[s.ID] = true
			}
		}
	}

	sb.WriteString("| 切片 | 名称 | 起始步骤 | 结束步骤 | 步数 |\n")
	sb.WriteString("|------|------|----------|----------|------|\n")
	for i, sl := range slices {
		sb.WriteString(fmt.Sprintf("| %d | %s | %d | %d | %d |\n", i+1, sl.Name, sl.StartStep, sl.EndStep, sl.Consume))
	}

	sb.WriteString("\n## 未覆盖步骤\n\n")
	uncoveredCount := 0
	for _, s := range steps {
		if !covered[s.ID] {
			sb.WriteString(fmt.Sprintf("- 步骤 %d: %s\n", s.ID, s.Description))
			uncoveredCount++
		}
	}
	if uncoveredCount == 0 {
		sb.WriteString("(无)\n")
	}

	textWriteFile(path, sb.String())
}

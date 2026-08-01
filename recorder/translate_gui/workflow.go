package main

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	stdruntime "runtime"
)

// ==================== 工作流入口 ====================

func runWorkflow(runDir string, enrichedActions []EnrichedAction, client *LLMClient, logger *Logger) error {
	transPaths := getTranslatePaths(runDir)
	auditor := NewLlmAuditor(transPaths.LlmAuditDir)

	// ========== Phase 1 ==========
	logger.Info(fmt.Sprintf("[Phase 1] 正在生成结构化步骤 XML→step (批次大小=%d, 并发=%d)...", Phase1BatchSize, Phase1Concurrency))
	logger.Progress("phase1", "start", fmt.Sprintf("批次大小=%d, 并发=%d", Phase1BatchSize, Phase1Concurrency), 5)
	phase1Start := time.Now()

	steps, errors := runPhase1(enrichedActions, client, logger, auditor, transPaths)

	phase1Elapsed := time.Since(phase1Start).Seconds()
	logger.Info(fmt.Sprintf("[Phase 1] 完成，共 %d 条结构化步骤，耗时 %.1fs", len(steps), phase1Elapsed))
	logger.Progress("phase1", "done", fmt.Sprintf("%d 条步骤", len(steps)), 30)

	if len(errors) > 0 {
		logger.Warn(fmt.Sprintf("[Phase 1] 存在 %d 条异常（详见 llm_audit）", len(errors)))
	}

	// ========== Phase 2: slice-case ==========
	logger.Info(fmt.Sprintf("[Phase 2] 正在切分测试用例 (窗口大小=%d)...", Phase2CaseWindowSteps))
	logger.Progress("phase2", "start", fmt.Sprintf("窗口=%d", Phase2CaseWindowSteps), 35)
	phase2Start := time.Now()

	slices := runPhase2Slice(steps, client, logger, auditor, transPaths)

	phase2Elapsed := time.Since(phase2Start).Seconds()
	logger.Info(fmt.Sprintf("[Phase 2] 完成，共 %d 个切片，耗时 %.1fs", len(slices), phase2Elapsed))
	logger.Progress("phase2", "done", fmt.Sprintf("%d 个切片", len(slices)), 60)

	// ========== Phase 3 + Phase 4: 渲染最终产物 ==========
	logger.Info("[Phase 3/4] 正在渲染 Agent 用例和人类用例...")
	logger.Progress("phase3", "start", "", 65)
	logger.Progress("phase4", "start", "", 65)
	phase34Start := time.Now()

	if _, err := renderAgentCase(runDir, steps, slices, logger); err != nil {
		return err
	}
	logger.Progress("phase3", "done", "", 85)
	if _, err := renderHumanCase(runDir, steps, slices, logger); err != nil {
		return err
	}
	logger.Progress("phase4", "done", "", 95)

	phase34Elapsed := time.Since(phase34Start).Seconds()
	logger.Info(fmt.Sprintf("[Phase 3/4] 渲染完成，耗时 %.1fs", phase34Elapsed))

	// ========== 总结 ==========
	totalElapsed := time.Since(phase1Start).Seconds()
	logger.Info(fmt.Sprintf("AI 翻译总耗时: %.1fs", totalElapsed))
	logger.Progress("done", "complete", "翻译完成", 100)

	if err := auditor.Finalize(); err != nil {
		return err
	}
	return nil
}

// ==================== Phase 1：并发微批处理 ====================

func runPhase1(enrichedActions []EnrichedAction, client *LLMClient, logger *Logger, auditor *LlmAuditor, transPaths TranslatePaths) ([]StructuredStep, []ExtractError) {
	var mu sync.Mutex
	var steps []StructuredStep
	var errors []ExtractError
	var llmRawBatches []LlmRawBatch

	flushArtifacts := func() {
		mu.Lock()
		defer mu.Unlock()
		jsonWriteFile(transPaths.StructuredStepsJson, steps)
		jsonWriteFile(transPaths.ErrorsJson, errors)
		textWriteFile(transPaths.StructuredStepsXml, renderStructuredStepsXml(stepsToXmlRows(steps)))
		textWriteFile(transPaths.LlmRawXml, renderLlmRawBatchesXml(llmRawBatches))
	}

	totalActions := len(enrichedActions)
	cursor := 0
	logger.Info(fmt.Sprintf("[Phase 1] 预扫描开始：共 %d 条 action，批次大小=%d", totalActions, Phase1BatchSize))

	// 先处理 skip/noise，收集需要 LLM 的批次
	type llmBatch struct {
		actions     []EnrichedAction
		cursorStart int
	}
	var llmBatches []llmBatch

	for cursor < totalActions {
		var actionBatch []EnrichedAction
		skipCount := 0

		for i := 0; i < Phase1BatchSize && cursor+i < totalActions; i++ {
			ea := enrichedActions[cursor+i]
			if ea.Classification.Category == "skipped" || ea.IsNoise {
				fallback := buildFallbackStructuredStep(ea, ea.Index, "", nil)
				mu.Lock()
				steps = append(steps, fallback)
				mu.Unlock()

				if ea.Classification.Category == "skipped" {
					logger.Info(fmt.Sprintf("[Phase 1] 操作 %d 已跳过", ea.Index))
				} else {
					logger.Info(fmt.Sprintf("[Phase 1] 操作 %d 已标记噪声", ea.Index))
				}
				skipCount++
			} else {
				actionBatch = append(actionBatch, ea)
			}
		}

		if len(actionBatch) > 0 {
			llmBatches = append(llmBatches, llmBatch{actions: actionBatch, cursorStart: cursor})
		}

		cursor += Phase1BatchSize
		if len(actionBatch) == 0 {
			flushArtifacts()
		}
	}

	// 并发处理 LLM 批次
	logger.Info(fmt.Sprintf("[Phase 1] 预扫描完成，待 LLM 处理 %d 个批次（并发=%d）", len(llmBatches), Phase1Concurrency))
	sem := make(chan struct{}, Phase1Concurrency)
	var wg sync.WaitGroup

	for batchIdx, batch := range llmBatches {
		idx, b := batchIdx, batch // 捕获循环变量，避免闭包共享
		wg.Add(1)
		SafeGo(logger, fmt.Sprintf("phase1-batch-%d", idx), func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			processPhase1Batch(b.actions, client, logger, auditor, &mu, &steps, &errors, &llmRawBatches, idx)
			flushArtifacts()
		})
	}
	wg.Wait()
	sort.Slice(steps, func(i, j int) bool { return steps[i].ID < steps[j].ID })
	recomputeStepIntervals(steps, enrichedActions)
	flushArtifacts()

	return steps, errors
}

func processPhase1Batch(actionBatch []EnrichedAction, client *LLMClient, logger *Logger, auditor *LlmAuditor,
	mu *sync.Mutex, steps *[]StructuredStep, errors *[]ExtractError,
	llmRawBatches *[]LlmRawBatch, batchIdx int) {

	// 防御性 recover：把数据驱动的 panic 转化为整批 fallback，
	// 避免一个 batch 的异常把整个翻译进程带走（未 recover 的 goroutine panic 会直接退出进程）。
	defer func() {
		if r := recover(); r != nil {
			buf := make([]byte, 4096)
			n := stdruntime.Stack(buf, false)
			batchStart, batchEnd := -1, -1
			if len(actionBatch) > 0 {
				batchStart = actionBatch[0].Index
				batchEnd = actionBatch[len(actionBatch)-1].Index
			}
			logger.Error(fmt.Sprintf(
				"[Phase 1] 批次 %d~%d panic 已捕获，降级为 fallback: %v\n%s",
				batchStart, batchEnd, r, buf[:n],
			))

			for _, ea := range actionBatch {
				fallback := buildFallbackStructuredStep(ea, ea.Index, fmt.Sprintf("panic: %v", r), nil)
				mu.Lock()
				*steps = append(*steps, fallback)
				*errors = append(*errors, ExtractError{
					Index:  ea.Index,
					Type:   "batch-panic-fallback",
					Reason: fmt.Sprintf("%v", r),
				})
				mu.Unlock()
			}
		}
	}()

	startIdx := actionBatch[0].Index
	endIdx := actionBatch[len(actionBatch)-1].Index
	logger.Info(fmt.Sprintf("[Phase 1] 正在处理批次: 操作 %d~%d (共 %d 条)", startIdx, endIdx, len(actionBatch)))

	// 并发批次不传 recentSteps 上下文（避免依赖前序批次结果）
	messages := []chatMessage{
		{Role: "system", Content: buildPhase1SystemPrompt()},
		{Role: "user", Content: buildPhase1UserPrompt(actionBatch, nil)},
	}

	start := time.Now()
	rawReply, err := client.CallChat(messages, 0, Phase1MaxTokens)
	durationMs := time.Since(start).Milliseconds()

	if err != nil {
		logger.Error(fmt.Sprintf("[Phase 1] 批次 %d~%d 调用失败: %s", startIdx, endIdx, err.Error()))
		auditor.Record("phase1", batchIdx, false, "", "", durationMs, err.Error())

		// 整批 fallback
		for _, ea := range actionBatch {
			fallback := buildFallbackStructuredStep(ea, ea.Index, err.Error(), nil)
			mu.Lock()
			*steps = append(*steps, fallback)
			*errors = append(*errors, ExtractError{Index: ea.Index, Type: "batch-exception-fallback", Reason: err.Error()})
			mu.Unlock()
		}
		return
	}

	auditor.Record("phase1", batchIdx, true, messages[1].Content, rawReply, durationMs, "")

	mu.Lock()
	*llmRawBatches = append(*llmRawBatches, LlmRawBatch{IndexFrom: startIdx, IndexTo: endIdx, Raw: rawReply})
	mu.Unlock()

	batchResult := parseBatchXmlSteps(rawReply, actionBatch, nil)

	// 处理解析成功的步骤
	for _, parsed := range batchResult.ParsedSteps {
		var matchedAction *EnrichedAction
		for i := range actionBatch {
			if actionBatch[i].Index == parsed.ID {
				matchedAction = &actionBatch[i]
				break
			}
		}
		if matchedAction == nil {
			continue
		}
		step := normalizeStructuredStep(parsed, *matchedAction, parsed.ID, nil)
		mu.Lock()
		*steps = append(*steps, step)
		mu.Unlock()
	}

	// 处理失败的步骤（逐条 fallback）
	failedSeen := map[int]bool{}
	for _, failedIdx := range batchResult.FailedIndices {
		if failedSeen[failedIdx] {
			continue
		}
		failedSeen[failedIdx] = true
		var matchedAction *EnrichedAction
		for i := range actionBatch {
			if actionBatch[i].Index == failedIdx {
				matchedAction = &actionBatch[i]
				break
			}
		}
		if matchedAction != nil {
			reason := "批次 XML 解析失败或结构不匹配"
			for _, e := range batchResult.Errors {
				if e.Index == failedIdx {
					reason = e.Reason
					break
				}
			}
			fallback := buildFallbackStructuredStep(*matchedAction, failedIdx, reason, nil)
			mu.Lock()
			*steps = append(*steps, fallback)
			*errors = append(*errors, ExtractError{Index: failedIdx, Type: "batch-fallback", Reason: reason})
			mu.Unlock()
		}
	}
}

// recomputeStepIntervals 在所有并发批次完成并按 action index 排序后统一计算时间间隔。
// interval 是录制顺序属性，不能依赖 LLM 批次的响应完成顺序。
func recomputeStepIntervals(steps []StructuredStep, enrichedActions []EnrichedAction) {
	timestamps := make(map[int]int64, len(enrichedActions))
	for _, action := range enrichedActions {
		timestamps[action.Index] = action.Action.Timestamp
	}

	var previousTimestamp int64
	for i := range steps {
		currentTimestamp := timestamps[steps[i].ID]
		steps[i].IntervalFromPreviousMs = computeIntervalFromPreviousMs(currentTimestamp, previousTimestamp)
		previousTimestamp = normalizeTimestamp(currentTimestamp, previousTimestamp)
	}
}

// ==================== Phase 2 (legacy, 已迁移至 phase2_slice.go) ====================

// ==================== 工具函数 ====================

func normalizeStructuredStep(parsed StructuredStep, ea EnrichedAction, actionIndex int, interval *int64) StructuredStep {
	actionKind := normalizeActionKind(ea.Action.Type)
	return StructuredStep{
		ID:                     actionIndex,
		Status:                 "normal",
		Description:            toSingleLineText(parsed.Description),
		UiChange:               toSingleLineText(parsed.UiChange),
		Page:                   "未知",
		Basis:                  []string{"xml:action", "xml:observation"},
		ActionKind:             actionKind,
		Target:                 deriveTarget(ea),
		InputText:              deriveInputText(ea),
		Key:                    strings.TrimSpace(ea.Action.Key),
		AssertText:             toSingleLineText(parsed.AssertText),
		Confidence:             0.7,
		IntervalFromPreviousMs: interval,
		URL:                    strings.TrimSpace(ea.Action.URL),
		SourceType:             ea.Action.Type,
	}
}

func buildFallbackStructuredStep(ea EnrichedAction, actionIndex int, reason string, interval *int64) StructuredStep {
	isNoise := ea.IsNoise
	isSkip := ea.Classification.Category == "skipped"
	status := "fallback"
	if isSkip {
		status = "skip"
	} else if isNoise {
		status = "noise"
	}

	basis := []string{}
	if isSkip {
		basis = append(basis, "skip: "+ea.Classification.Category)
	}
	if isNoise {
		basis = append(basis, "noise: UI 无变化")
	}
	if reason != "" {
		basis = append(basis, "fallbackReason: "+reason)
	}

	return StructuredStep{
		ID:                     actionIndex,
		Status:                 status,
		Description:            deriveFallbackDescription(ea),
		UiChange:               deriveUiChangeFromDiff(ea.Diff),
		Page:                   "未知",
		Basis:                  basis,
		ActionKind:             deriveFallbackActionKind(ea.Action.Type),
		Target:                 deriveTarget(ea),
		InputText:              deriveInputText(ea),
		Key:                    strings.TrimSpace(ea.Action.Key),
		Confidence:             0.4,
		IntervalFromPreviousMs: interval,
		URL:                    strings.TrimSpace(ea.Action.URL),
		SourceType:             ea.Action.Type,
		IsSkip:                 isSkip,
		IsNoise:                isNoise,
		IsFallback:             !isSkip && !isNoise,
	}
}

func computeIntervalFromPreviousMs(currentTimestamp int64, previousTimestamp int64) *int64 {
	if currentTimestamp <= 0 || previousTimestamp <= 0 {
		return nil
	}
	delta := currentTimestamp - previousTimestamp
	if delta < 0 {
		return nil
	}
	return &delta
}

func normalizeTimestamp(value int64, fallback int64) int64 {
	if value <= 0 {
		return fallback
	}
	return value
}

func normalizeActionKind(actionType string) string {
	switch actionType {
	case "click":
		return "click"
	case "dblclick":
		return "doubleClick"
	case "rightclick":
		return "rightClick"
	case "keypress":
		return "keyPress"
	case "input":
		return "input"
	}
	return "other"
}

func deriveFallbackDescription(ea EnrichedAction) string {
	element := ea.Action.Element
	if element == nil {
		element = map[string]interface{}{}
	}
	identify := getString(element, "label")
	if identify == "" {
		identify = getString(element, "text")
	}
	if identify == "" {
		identify = getString(element, "placeholder")
	}
	if identify == "" {
		identify = getString(element, "name")
	}
	if identify == "" {
		identify = getString(element, "id")
	}
	if identify == "" {
		identify = "目标元素"
	}
	switch ea.Action.Type {
	case "dblclick":
		return "双击 " + identify
	case "rightclick":
		return "右键点击 " + identify
	case "keypress":
		if key := strings.TrimSpace(ea.Action.Key); key != "" {
			return "按下 " + key + " 键"
		}
		return "按下按键"
	case "input":
		return "在 " + identify + " 输入"
	case "click":
		return "点击 " + identify
	}
	return "执行 " + ea.Action.Type + " 操作"
}

func deriveUiChangeFromDiff(snapshotDiff string) string {
	if snapshotDiff == "" || strings.Contains(snapshotDiff, "完全相同") || strings.Contains(snapshotDiff, "无变化") {
		return "无可见变化"
	}
	return "界面状态发生变化"
}

func deriveFallbackActionKind(actionType string) string {
	return normalizeActionKind(actionType)
}

func deriveTarget(ea EnrichedAction) string {
	element := ea.Action.Element
	if element == nil {
		return ""
	}
	for _, key := range []string{"label", "text", "placeholder", "name", "id", "tag"} {
		v := getString(element, key)
		if v != "" {
			return v
		}
	}
	return ""
}

// deriveInputText 从 formStateDelta 提取 input 操作的输入值。
// formStateDelta 是 xpath→状态 的 map，input 操作时对应元素 value 会变化。
// 优先匹配操作元素的 xpath，其次取首个含 value 的非布尔状态。
func deriveInputText(ea EnrichedAction) string {
	if ea.Action.Type != "input" {
		return ""
	}
	formState := ea.FormStateDelta
	if len(formState) == 0 {
		formState = ea.Action.FormState
	}
	if len(formState) == 0 {
		return ""
	}
	elementXpath := ""
	if ea.Action.Element != nil {
		elementXpath = getString(ea.Action.Element, "xpath")
	}
	if elementXpath != "" {
		if state, ok := formState[elementXpath]; ok {
			if val := extractValueFromState(state); val != "" {
				return val
			}
		}
	}
	for _, state := range formState {
		if val := extractValueFromState(state); val != "" {
			return val
		}
	}
	return ""
}

// extractValueFromState 从 formStateDelta 的单个状态值中提取文本输入值，排除布尔/空值
func extractValueFromState(state interface{}) string {
	m, ok := state.(map[string]interface{})
	if !ok {
		return ""
	}
	v, exists := m["value"]
	if !exists {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	s = strings.TrimSpace(s)
	if s == "" || s == "on" {
		return ""
	}
	return s
}

func stepsToXmlRows(steps []StructuredStep) []StepXmlRow {
	rows := make([]StepXmlRow, len(steps))
	for i, s := range steps {
		rows[i] = StepXmlRow{Index: s.ID, Status: s.Status, Description: s.Description, UiChange: s.UiChange}
	}
	return rows
}

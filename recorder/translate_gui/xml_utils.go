package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ==================== think 标签剥离（兜底） ====================

var (
	reThinkingFull = regexp.MustCompile(`(?is)<thinking>[\s\S]*?</thinking>`)
	reThinkFull    = regexp.MustCompile(`(?is)<think>[\s\S]*?</think>`)
	reThinkOpen    = regexp.MustCompile(`(?is)^[\s\S]*?</think>`)
)

// cleanMarkdownFence 清理 think 标签和 markdown 代码围栏（兜底）。
// reasoning_split 已从源头分离 think，此处作为防御性二次清理。
func cleanMarkdownFence(text string) string {
	if text == "" {
		return ""
	}
	trimmed := strings.TrimSpace(text)

	trimmed = reThinkingFull.ReplaceAllString(trimmed, "")
	trimmed = reThinkFull.ReplaceAllString(trimmed, "")
	trimmed = reThinkOpen.ReplaceAllString(trimmed, "")
	trimmed = strings.TrimSpace(trimmed)

	return trimmed
}

// ==================== LLM XML 预处理 ====================

var reCodeFence = regexp.MustCompile("(?is)^```(?:json|markdown|xml)?\\s*\\n([\\s\\S]*?)\\n```\\s*$")

// preprocessLlmXmlOutput 清理 LLM 输出，提取 XML 正文。
func preprocessLlmXmlOutput(raw string) string {
	cleaned := cleanMarkdownFence(raw)
	if m := reCodeFence.FindStringSubmatch(cleaned); m != nil {
		cleaned = strings.TrimSpace(m[1])
	}
	return cleaned
}

// ==================== LLM 审计 ====================

type LlmAuditor struct {
	Dir     string
	Records []LlmAuditRecord
	mu      sync.Mutex
}

func NewLlmAuditor(dir string) *LlmAuditor {
	os.MkdirAll(dir, 0755)
	return &LlmAuditor{Dir: dir}
}

func (a *LlmAuditor) Record(phase string, batchIndex int, success bool, input, output string, durationMs int64, errMsg string) {
	rec := LlmAuditRecord{
		Phase:       phase,
		BatchIndex:  batchIndex,
		Success:     success,
		InputChars:  len(input),
		OutputChars: len(output),
		DurationMs:  durationMs,
		Error:       errMsg,
		Timestamp:   time.Now(),
	}
	a.mu.Lock()
	a.Records = append(a.Records, rec)
	a.mu.Unlock()
}

func (a *LlmAuditor) Finalize() error {
	a.mu.Lock()
	records := make([]LlmAuditRecord, len(a.Records))
	copy(records, a.Records)
	a.mu.Unlock()

	if len(records) == 0 {
		return nil
	}
	data := mustJSONIndent(records)
	if err := os.WriteFile(filepath.Join(a.Dir, "llm_audit.json"), data, 0644); err != nil {
		return fmt.Errorf("写入 LLM 审计文件失败: %w", err)
	}
	return nil
}

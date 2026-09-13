package translator

import (
	"math"
	"regexp"
	"strings"
)

// ==================== LLM XML 预处理 ====================

const bomPrefix = "\uFEFF"

// preprocessLlmXmlOutputFull 预处理 LLM 原始文本（去围栏/BOM/换行/超长截断）
func preprocessLlmXmlOutputFull(raw string, maxChars int) (string, bool) {
	if maxChars <= 0 {
		maxChars = Phase1LlmRawMaxChars
	}
	text := cleanMarkdownFence(raw)
	text = strings.TrimPrefix(text, bomPrefix)
	text = strings.ReplaceAll(text, "\r\n", "\n")

	truncated := false
	if len(text) > maxChars {
		text = text[:maxChars]
		truncated = true
	}
	return text, truncated
}

// hasClosingTag 是否包含闭合标签
func hasClosingTag(text, closeTagLiteral string) bool {
	return strings.Contains(strings.ToLower(text), strings.ToLower(closeTagLiteral))
}

// maxSlidingWindowRounds 滑动窗口最大允许轮次
func maxSlidingWindowRounds(totalItems, windowSize int) int {
	total := totalItems
	if total < 0 {
		total = 0
	}
	size := windowSize
	if size < 1 {
		size = 1
	}
	base := int(math.Ceil(float64(total) / float64(size)))
	if base < 1 {
		base = 1
	}
	fuseFromWindow := base * SlidingWindowMaxRoundMultiplier
	if fuseFromWindow < 1 {
		fuseFromWindow = 1
	}
	minRoundsForFullScan := total
	if minRoundsForFullScan > fuseFromWindow {
		return minRoundsForFullScan
	}
	return fuseFromWindow
}

// toSingleLineText 单行文本规范化
func toSingleLineText(value string) string {
	return strings.TrimSpace(regexp.MustCompile(`\s+`).ReplaceAllString(value, " "))
}

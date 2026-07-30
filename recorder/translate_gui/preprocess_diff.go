package main

import (
	"os"
	"path/filepath"
	"strings"
)

// ==================== 行级 diff（Myers 简化实现） ====================

// diffPart 表示一段 diff 片段
type diffPart struct {
	Value   string
	Added   bool
	Removed bool
}

// diffLines 计算两段文本的行级 diff（LCS 算法）
func diffLines(preText, postText string) []diffPart {
	preLines := splitLines(preText)
	postLines := splitLines(postText)

	lcs := computeLCS(preLines, postLines)

	var parts []diffPart
	i, j := 0, 0
	for _, l := range lcs {
		for i < len(preLines) && preLines[i] != l {
			parts = append(parts, diffPart{Value: preLines[i] + "\n", Removed: true})
			i++
		}
		for j < len(postLines) && postLines[j] != l {
			parts = append(parts, diffPart{Value: postLines[j] + "\n", Added: true})
			j++
		}
		parts = append(parts, diffPart{Value: l + "\n"})
		i++
		j++
	}
	for i < len(preLines) {
		parts = append(parts, diffPart{Value: preLines[i] + "\n", Removed: true})
		i++
	}
	for j < len(postLines) {
		parts = append(parts, diffPart{Value: postLines[j] + "\n", Added: true})
		j++
	}
	return mergeParts(parts)
}

func splitLines(text string) []string {
	text = strings.TrimSuffix(text, "\n")
	if text == "" {
		return []string{}
	}
	return strings.Split(text, "\n")
}

// computeLCS 计算最长公共子序列
func computeLCS(a, b []string) []string {
	m, n := len(a), len(b)
	if m == 0 || n == 0 {
		return []string{}
	}
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] >= dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}
	result := make([]string, 0, dp[m][n])
	i, j := m, n
	for i > 0 && j > 0 {
		if a[i-1] == b[j-1] {
			result = append([]string{a[i-1]}, result...)
			i--
			j--
		} else if dp[i-1][j] >= dp[i][j-1] {
			i--
		} else {
			j--
		}
	}
	return result
}

// mergeParts 合并相邻同类型 part
func mergeParts(parts []diffPart) []diffPart {
	if len(parts) == 0 {
		return parts
	}
	merged := []diffPart{parts[0]}
	for i := 1; i < len(parts); i++ {
		last := &merged[len(merged)-1]
		if (parts[i].Added && last.Added) || (parts[i].Removed && last.Removed) || (!parts[i].Added && !parts[i].Removed && !last.Added && !last.Removed) {
			last.Value += parts[i].Value
		} else {
			merged = append(merged, parts[i])
		}
	}
	return merged
}

// ==================== computeDiff ====================

// diffLineKind 行类型
type diffLineKind int

const (
	diffLineContext diffLineKind = iota
	diffLineAdded
	diffLineRemoved
)

// diffLine 展开后的单行 diff 标记
type diffLine struct {
	kind  diffLineKind
	value string
}

// expandDiffParts 将 diffPart 序列展开为行级标记，便于按行保留上下文
func expandDiffParts(parts []diffPart) []diffLine {
	var out []diffLine
	for _, p := range parts {
		value := strings.TrimSuffix(p.Value, "\n")
		if value == "" {
			continue
		}
		kind := diffLineContext
		if p.Added {
			kind = diffLineAdded
		} else if p.Removed {
			kind = diffLineRemoved
		}
		for _, line := range strings.Split(value, "\n") {
			out = append(out, diffLine{kind: kind, value: line})
		}
	}
	return out
}

func computeDiff(preText, postText string) string {
	parts := diffLines(preText, postText)
	lines := expandDiffParts(parts)

	n := len(lines)
	if n == 0 {
		return "（preSnapshot 和 postSnapshot 完全相同，操作未引起可见的 UI 变化）"
	}

	// 标记需要输出的行：变化行 + 前后 DiffContextLines 行上下文
	need := make([]bool, n)
	for i, l := range lines {
		if l.kind == diffLineAdded || l.kind == diffLineRemoved {
			lo := i - DiffContextLines
			if lo < 0 {
				lo = 0
			}
			hi := i + DiffContextLines
			if hi > n-1 {
				hi = n - 1
			}
			for j := lo; j <= hi; j++ {
				need[j] = true
			}
		}
	}

	var result []string
	hasChange := false
	for i, l := range lines {
		if !need[i] {
			continue
		}
		switch l.kind {
		case diffLineAdded:
			hasChange = true
			result = append(result, "+ "+l.value)
		case diffLineRemoved:
			hasChange = true
			result = append(result, "- "+l.value)
		default:
			result = append(result, "  "+l.value)
		}
	}

	if !hasChange {
		return "（preSnapshot 和 postSnapshot 完全相同，操作未引起可见的 UI 变化）"
	}
	return strings.Join(result, "\n")
}

// truncateDiff 截断超长 diff
func truncateDiff(diffText string, threshold int) string {
	if threshold <= 0 {
		threshold = DiffTruncateThreshold
	}
	if len(diffText) <= threshold {
		return diffText
	}
	half := threshold / 2
	head := diffText[:half]
	tail := diffText[len(diffText)-half:]
	return head + "\n\n... [diff 过长，已截断 " + intToStr(int64(len(diffText)-threshold)) + " 字符] ...\n\n" + tail
}

// ==================== computeAllDiffs ====================

func computeAllDiffs(snapshotsDir, diffsDir string, totalSnapshots int) map[int]string {
	diffs := make(map[int]string)
	totalDiffs := totalSnapshots - 1
	if totalDiffs <= 0 {
		return diffs
	}
	os.MkdirAll(diffsDir, 0755)

	for i := 1; i <= totalDiffs; i++ {
		preFile := filepath.Join(snapshotsDir, "snapshot_"+padIndex(i-1)+".txt")
		postFile := filepath.Join(snapshotsDir, "snapshot_"+padIndex(i)+".txt")
		preText, err1 := os.ReadFile(preFile)
		postText, err2 := os.ReadFile(postFile)
		if err1 != nil || err2 != nil {
			diffs[i] = "（diff 计算失败）"
			continue
		}
		diffText := computeDiff(string(preText), string(postText))
		os.WriteFile(filepath.Join(diffsDir, "diff_"+padIndex(i)+".txt"), []byte(diffText), 0644)
		diffs[i] = truncateDiff(diffText, DiffTruncateThreshold)
	}
	return diffs
}

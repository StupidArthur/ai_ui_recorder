package main

import (
	"embed"
	"os"
	"path/filepath"
	"strings"
)

//go:embed prompts/md/*.md
var embeddedPrompts embed.FS

// Phase 标识
const (
	Phase1Name = "phase1"
	Phase2Name = "phase2"
	Phase3Name = "phase3"
	Phase4Name = "phase4"
)

// phaseToFile phase -> 内置文件名（Phase 3/4 纯程序渲染，无 prompt）
var phaseToFile = map[string]string{
	Phase1Name: "snapshots-2-steps-skill.md",
	Phase2Name: "phase-2-slice-case.md",
}

// LoadPrompt 加载某 phase 的 prompt：用户自定义优先，否则内置。
func LoadPrompt(phase string) (content string, isCustom bool) {
	customPath := filepath.Join(promptsConfigDir(), phase+".md")
	if data, err := os.ReadFile(customPath); err == nil {
		return string(data), true
	}
	if fname, ok := phaseToFile[phase]; ok {
		if data, err := embeddedPrompts.ReadFile("prompts/md/" + fname); err == nil {
			return string(data), false
		}
	}
	return "", false
}

// ImportPrompt 导入用户自定义 prompt（以 phase 为单位）。
func ImportPrompt(phase, content string) error {
	dir := promptsConfigDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, phase+".md"), []byte(content), 0644)
}

// ExportPrompt 导出某 phase 的当前生效 prompt。
func ExportPrompt(phase string) (string, bool, error) {
	content, isCustom := LoadPrompt(phase)
	return content, isCustom, nil
}

// ResetPrompt 删除用户自定义，恢复内置。
func ResetPrompt(phase string) error {
	customPath := filepath.Join(promptsConfigDir(), phase+".md")
	if err := os.Remove(customPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ListPrompts 列出所有 phase 的信息。
func ListPrompts() []PromptInfo {
	phases := []string{Phase1Name, Phase2Name}
	result := make([]PromptInfo, 0, len(phases))
	for _, p := range phases {
		content, isCustom := LoadPrompt(p)
		result = append(result, PromptInfo{
			Phase:    p,
			Name:     phaseToFile[p],
			Content:  content,
			IsCustom: isCustom,
		})
	}
	return result
}

func phaseDisplay(phase string) string {
	switch phase {
	case Phase1Name:
		return "Phase 1 (format-step)"
	case Phase2Name:
		return "Phase 2 (slice-case)"
	case Phase3Name:
		return "Phase 3 (format-agent-case)"
	case Phase4Name:
		return "Phase 4 (format-human-case)"
	}
	return phase
}

func trimPrompt(s string) string {
	return strings.TrimSpace(s)
}

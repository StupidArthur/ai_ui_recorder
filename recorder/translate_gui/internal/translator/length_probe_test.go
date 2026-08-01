//go:build integration

package translator

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 从短到长探测 M3/M2.7 响应耗时与 finish_reason。
// 运行：go test -tags=integration -run TestInputLengthSweep -v -timeout 45m
// 可选环境变量：
//   AI_CONFIG_PATH  指定 ai.local.json
//   LENGTH_PROBE_MODELS  逗号分隔模型名，默认 MiniMax-M3
//   LENGTH_PROBE_TARGETS  逗号分隔 user 字符目标，默认 2000,8000,15000,22000

func TestInputLengthSweep(t *testing.T) {
	cfg := loadProbeAIConfig(t)
	systemPrompt, _ := LoadPrompt(Phase1Name)
	if systemPrompt == "" {
		t.Fatal("无法加载 Phase1 system prompt")
	}

	models := probeModels()
	targets := probeTargets()

	t.Logf("system_prompt_chars=%d targets=%v models=%v max_tokens=%d",
		len(systemPrompt), targets, models, Phase1MaxTokens)

	type row struct {
		Model            string  `json:"model"`
		UserChars        int     `json:"user_chars"`
		TotalChars       int     `json:"total_chars"`
		ElapsedSec       float64 `json:"elapsed_sec"`
		FinishReason     string  `json:"finish_reason"`
		ContentLen       int     `json:"content_len"`
		ReasoningLen     int     `json:"reasoning_len"`
		PromptTokens     int     `json:"prompt_tokens"`
		CompletionTokens int     `json:"completion_tokens"`
		Error            string  `json:"error,omitempty"`
	}
	var rows []row

	for _, model := range models {
		t.Run(model, func(t *testing.T) {
			client := NewLLMClient(AIConfig{
				BaseURL: cfg.BaseURL,
				APIKey:  cfg.APIKey,
				Model:   model,
			})

			for _, target := range targets {
				userPrompt := buildProbeUserPrompt(target)
				total := len(systemPrompt) + len(userPrompt)
				name := fmt.Sprintf("user_%d_total_%d", len(userPrompt), total)
				t.Run(name, func(t *testing.T) {
					t.Logf("calling model=%s user_chars=%d total≈%d ...", model, len(userPrompt), total)
					start := time.Now()
					result, err := client.CallChatDetailed(
						[]chatMessage{
							{Role: "system", Content: systemPrompt},
							{Role: "user", Content: userPrompt},
						},
						0,
						Phase1MaxTokens,
					)
					elapsed := time.Since(start).Seconds()

					r := row{
						Model:      model,
						UserChars:  len(userPrompt),
						TotalChars: total,
						ElapsedSec: round2(elapsed),
					}
					if err != nil {
						r.Error = err.Error()
						t.Logf("FAIL %.2fs err=%v", elapsed, err)
					} else {
						r.FinishReason = result.FinishReason
						r.ContentLen = len(result.Content)
						r.ReasoningLen = len(result.ReasoningContent)
						r.PromptTokens = result.PromptTokens
						r.CompletionTokens = result.CompletionTokens
						t.Logf("OK %.2fs finish=%s content=%d reasoning=%d tokens=%d/%d",
							elapsed, result.FinishReason, len(result.Content), len(result.ReasoningContent),
							result.PromptTokens, result.CompletionTokens)
					}
					rows = append(rows, r)
				})
			}
		})
	}

	outPath := filepath.Join("tools", "m3_length_probe_result.json")
	_ = os.MkdirAll(filepath.Dir(outPath), 0755)
	data, _ := json.MarshalIndent(rows, "", "  ")
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		t.Fatalf("写入结果失败: %v", err)
	}
	t.Logf("结果已写入 %s", outPath)
}

func loadProbeAIConfig(t *testing.T) AIConfig {
	if p := strings.TrimSpace(os.Getenv("AI_CONFIG_PATH")); p != "" {
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatalf("读取 AI_CONFIG_PATH 失败: %v", err)
		}
		var raw map[string]string
		if json.Unmarshal(data, &raw) != nil {
			t.Fatal("AI_CONFIG_PATH JSON 无效")
		}
		return AIConfig{
			BaseURL: strings.TrimSpace(raw["baseUrl"]),
			APIKey:  strings.TrimSpace(raw["apiKey"]),
			Model:   strings.TrimSpace(raw["model"]),
		}
	}

	candidates := []string{
		filepath.Join("build", "bin", "config", "ai.local.json"),
		filepath.Join("..", "config", "ai.local.json"),
	}
	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var raw map[string]string
		if json.Unmarshal(data, &raw) == nil && strings.TrimSpace(raw["apiKey"]) != "" {
			t.Logf("使用配置: %s", p)
			return AIConfig{
				BaseURL: strings.TrimSpace(raw["baseUrl"]),
				APIKey:  strings.TrimSpace(raw["apiKey"]),
				Model:   strings.TrimSpace(raw["model"]),
			}
		}
	}
	t.Fatal("未找到 ai.local.json，请设置 AI_CONFIG_PATH 或先 build GUI")
	return AIConfig{}
}

func probeModels() []string {
	if v := strings.TrimSpace(os.Getenv("LENGTH_PROBE_MODELS")); v != "" {
		return splitCSV(v)
	}
	return []string{"MiniMax-M3"}
}

func probeTargets() []int {
	if v := strings.TrimSpace(os.Getenv("LENGTH_PROBE_TARGETS")); v != "" {
		parts := splitCSV(v)
		out := make([]int, 0, len(parts))
		for _, p := range parts {
			var n int
			if _, err := fmt.Sscanf(p, "%d", &n); err == nil && n > 0 {
				out = append(out, n)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return []int{2000, 8000, 15000, 22000}
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func buildProbeUserPrompt(targetChars int) string {
	base := `【历史上下文参考】
[Index 7] 点击左侧菜单 -> 变化: 进入设置页

【本次需要解析的动作数组】
注意：以下共有 1 个动作。你必须输出 1 个解析结果。

=============【动作 Index: 8 (第 1/1 个)】=============
{
  "type": "click",
  "element": { "tag": "span", "text": "" },
  "localContext": "text \"推荐问题\"\n  switch [unchecked]",
  "formStateDelta": { "//*[@id='chat_input_textarea']": { "value": "" } },
  "snapshotDiff": "-       - switch [unchecked]\n+       - switch [checked]"
}

请立即开始解析，并严格按照 System Prompt 的 Output Format 仅输出 XML。
`
	fillerLine := "FILLER_CONTEXT: 占位上下文，模拟 formStateDelta 膨胀。\n"
	need := targetChars - len(base)
	if need <= 0 {
		return base
	}
	repeat := need/len(fillerLine) + 1
	filler := strings.Repeat(fillerLine, repeat)
	if len(filler) > need {
		filler = filler[:need]
	}
	return base + "\n【长度填充区，可忽略】\n" + filler
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

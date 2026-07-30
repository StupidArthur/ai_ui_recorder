package main

import "fmt"

// 测试用 key 占位符，请通过环境变量或 ai.local.json 注入真实 key
var keys = map[string]string{
	"minimax":  "",
	"mimo":     "",
	"deepseek": "",
}

func getKey(model string) string {
	if len(model) >= 7 && model[:7] == "MiniMax" {
		return keys["minimax"]
	}
	if len(model) >= 4 && model[:4] == "mimo" {
		return keys["mimo"]
	}
	if len(model) >= 8 && model[:8] == "deepseek" {
		return keys["deepseek"]
	}
	return ""
}

func main() {
	messages := []chatMessage{
		{Role: "user", Content: "用一句话回答：1+1等于几？"},
	}

	fmt.Printf("可用模型: %v\n\n", ListModels())

	for _, model := range ListModels() {
		result, err := Chat(model, messages, getKey(model), 0.2)
		fmt.Printf("================================================================\n")
		fmt.Printf("  %s\n", model)
		fmt.Printf("================================================================\n")
		if err != nil {
			fmt.Printf("  ERROR: %v\n", err)
			continue
		}
		fmt.Printf("  content:           %s\n", result.Content)
		fmt.Printf("  reasoning_content: %d chars\n", len(result.ReasoningContent))
		if len(result.ReasoningContent) > 0 {
			r := result.ReasoningContent
			if len(r) > 80 {
				r = r[:80]
			}
			fmt.Printf("    preview: %s\n", r)
		}
		fmt.Printf("  finish_reason:     %s\n", result.FinishReason)
		fmt.Printf("  prompt_tokens:     %d\n", result.PromptTokens)
		fmt.Printf("  completion_tokens: %d\n", result.CompletionTokens)
	}
}

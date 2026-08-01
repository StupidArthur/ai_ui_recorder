package translator

import "translate_gui/internal/llm"

type AIConfig = llm.AIConfig
type ModelInfo = llm.ModelInfo
type LLMClient = llm.LLMClient
type ThinkingConfig = llm.ThinkingConfig
type ChatCallResult = llm.ChatCallResult
type chatMessage = llm.ChatMessage

const (
	DefaultModelName = llm.DefaultModelName
	LlmPingTimeoutMs = llm.PingTimeoutMs
)

func NewLLMClient(cfg AIConfig) *LLMClient {
	return llm.NewLLMClient(cfg)
}

func ListModels() []ModelInfo {
	return llm.ListModels()
}

func LoadAIConfig() AIConfig {
	return llm.LoadAIConfig()
}

func SaveAIConfig(cfg AIConfig) SaveResult {
	result := llm.SaveAIConfig(cfg)
	return SaveResult{
		Success: result.Success,
		Message: result.Message,
		Path:    result.Path,
	}
}

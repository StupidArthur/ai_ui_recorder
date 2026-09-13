package translator

import "translate_gui/internal/llm"

type AIConfig = llm.AIConfig
type ConfigProfileInfo = llm.ConfigProfileInfo
type ConfigProfiles = llm.ConfigProfiles
type LLMClient = llm.LLMClient
type ChatCallResult = llm.ChatCallResult
type chatMessage = llm.ChatMessage

const LlmPingTimeoutMs = llm.PingTimeoutMs

func NewLLMClient(cfg AIConfig) *LLMClient {
	return llm.NewLLMClient(cfg)
}

func LoadActiveAIConfig() AIConfig {
	return llm.LoadActiveAIConfig()
}

// FindAIConfigProfile 按名字取完整配置（含 key），供测试连接补全留空的 key。
func FindAIConfigProfile(name string) (AIConfig, bool) {
	return llm.FindProfile(name)
}

func ListConfigProfiles() ConfigProfiles {
	return llm.ListConfigProfiles()
}

func SaveConfigProfile(name string, cfg AIConfig) SaveResult {
	result := llm.SaveConfigProfile(name, cfg)
	return SaveResult{Success: result.Success, Message: result.Message, Path: result.Path}
}

func DeleteConfigProfile(name string) SaveResult {
	result := llm.DeleteConfigProfile(name)
	return SaveResult{Success: result.Success, Message: result.Message, Path: result.Path}
}

func SetActiveConfigProfile(name string) SaveResult {
	result := llm.SetActiveConfigProfile(name)
	return SaveResult{Success: result.Success, Message: result.Message, Path: result.Path}
}

package main

import "sort"

// ==================== 模型注册表 ====================
//
// 参考 recorder/llm_client/llm_client.go 的设计，统一管理多家 LLM 供应商的技术差异。
// 调用方只需关注模型名，其余细节（端点、thinking、reasoning_split、max_tokens）
// 均由注册表自动处理。
//
// 支持的供应商及模型：
//   - MiniMax: M2.7-highspeed[thinking], M3, M3[thinking]
//   - Xiaomi MiMo: mimo-v2.5-pro, mimo-v2.5-pro[thinking]
//   - DeepSeek: deepseek-v4-pro, deepseek-v4-pro[thinking]

// modelConfig 单个模型的技术配置。
type modelConfig struct {
	APIModel       string // 实际调用的 API 模型名（可能与对外展示名不同）
	URL            string // API 端点 base_url（用户未配置时作为默认值）
	Thinking       string // "" 不发送 / "disabled" 关闭 / "adaptive" 开启
	ReasoningSplit bool   // MiniMax 需 true，MiMo/DeepSeek 需 false
	MaxTokens      int    // 模型支持的最大输出 token 数（实测上限）
}

// modelRegistry 模型注册表，key 为对外展示的模型名（前端下拉框用）。
var modelRegistry = map[string]modelConfig{
	// ---- MiniMax 系列 ----
	"MiniMax-M2.7-highspeed[thinking]": {
		APIModel:       "MiniMax-M2.7-highspeed",
		URL:            "https://api.minimax.chat/v1",
		Thinking:       "",
		ReasoningSplit: true,
		MaxTokens:      196608,
	},
	"MiniMax-M3": {
		APIModel:       "MiniMax-M3",
		URL:            "https://api.minimax.chat/v1",
		Thinking:       "disabled",
		ReasoningSplit: true,
		MaxTokens:      524288,
	},
	"MiniMax-M3[thinking]": {
		APIModel:       "MiniMax-M3",
		URL:            "https://api.minimax.chat/v1",
		Thinking:       "adaptive",
		ReasoningSplit: true,
		MaxTokens:      524288,
	},

	// ---- Xiaomi MiMo 系列 ----
	"mimo-v2.5-pro": {
		APIModel:       "mimo-v2.5-pro",
		URL:            "https://token-plan-cn.xiaomimimo.com/v1",
		Thinking:       "disabled",
		ReasoningSplit: false,
		MaxTokens:      131072,
	},
	"mimo-v2.5-pro[thinking]": {
		APIModel:       "mimo-v2.5-pro",
		URL:            "https://token-plan-cn.xiaomimimo.com/v1",
		Thinking:       "adaptive",
		ReasoningSplit: false,
		MaxTokens:      131072,
	},

	// ---- DeepSeek 系列 ----
	"deepseek-v4-pro": {
		APIModel:       "deepseek-v4-pro",
		URL:            "https://api.deepseek.com",
		Thinking:       "disabled",
		ReasoningSplit: false,
		MaxTokens:      393216,
	},
	"deepseek-v4-pro[thinking]": {
		APIModel:       "deepseek-v4-pro",
		URL:            "https://api.deepseek.com",
		Thinking:       "adaptive",
		ReasoningSplit: false,
		MaxTokens:      393216,
	},
}

// ModelInfo 供前端下拉框使用的模型信息。
type ModelInfo struct {
	Name    string `json:"name"`    // 对外展示名（注册表 key）
	BaseURL string `json:"baseUrl"` // 默认 API 端点
}

// ListModels 返回所有可选模型信息列表（按名称排序），供前端下拉框使用。
func ListModels() []ModelInfo {
	out := make([]ModelInfo, 0, len(modelRegistry))
	for name, cfg := range modelRegistry {
		out = append(out, ModelInfo{Name: name, BaseURL: cfg.URL})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out
}

// lookupModelConfig 查注册表，返回模型配置及是否命中。
// 未命中时返回零值 + false，调用方走兼容默认逻辑。
func lookupModelConfig(modelName string) (modelConfig, bool) {
	cfg, ok := modelRegistry[modelName]
	return cfg, ok
}

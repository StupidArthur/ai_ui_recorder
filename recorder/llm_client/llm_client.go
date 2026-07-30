// 统一 LLM 调用模块（Go 实现）。
//
// 本模块封装多家 LLM 供应商的调用差异，对外提供统一的输入/输出接口。
// 调用方只需关注：模型名、消息内容、API Key，其余细节（端点、thinking 参数、
// reasoning_split、max_tokens 等）均由模块内部根据模型注册表自动处理。
//
// 支持的供应商及模型：
//   - MiniMax: M2.7-highspeed[thinking], M3, M3[thinking]
//   - Xiaomi MiMo: mimo-v2.5-pro, mimo-v2.5-pro[thinking]
//   - DeepSeek: deepseek-v4-pro, deepseek-v4-pro[thinking]
//
// 对外接口：
//   - ListModels() []string        返回所有可选模型名称
//   - Chat(model, msgs, key, t)    统一调用入口
//
// 设计原则：
//   1. API Key 不存储在模块内，由调用方传入。
//   2. 模型注册表只记录技术参数，不含密钥。
//   3. 输出结构 ChatResult 对所有模型一致。
//   4. 新增供应商只需扩展 models 注册表。
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// =====================================================================
// 结果结构
// =====================================================================

// ChatResult 统一 LLM 调用结果，所有模型返回相同结构。
//
// 字段说明：
//   - Content:           模型生成的最终回答（已去除 thinking 标签等杂质）
//   - ReasoningContent:  模型的思考/推理过程（thinking 关闭时为空）
//   - FinishReason:      终止原因："stop"（正常）或 "length"（截断）
//   - PromptTokens:      输入 token 数
//   - CompletionTokens:  输出 token 数（含 reasoning + content）
type ChatResult struct {
	Content          string `json:"content"`
	ReasoningContent string `json:"reasoning_content"`
	FinishReason     string `json:"finish_reason"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
}

// =====================================================================
// 模型注册表
// =====================================================================

// modelConfig 单个模型的技术配置。
//
// 各字段含义：
//   - APIModel:       实际调用的 API 模型名（可能与对外展示名不同）
//   - URL:            API 端点 base_url
//   - Thinking:       thinking 模式控制
//                     ""          → 不发送 thinking 字段（M2.x 关不掉，保持默认）
//                     "disabled"  → 关闭思考（跳过推理，直接回答）
//                     "adaptive"  → 开启自适应思考
//   - ReasoningSplit: 是否需要在请求中显式发送 reasoning_split=true
//                     true:  MiniMax 需要，否则 thinking 内容混在 content 中
//                     false: MiMo/DeepSeek 自动返回 reasoning_content，无需发送
//   - MaxTokens:      模型支持的最大输出 token 数（经实测确认的实际上限）
//
// 注意：注册表不含 API Key，调用时由调用方通过 apiKey 参数传入。
type modelConfig struct {
	APIModel       string
	URL            string
	Thinking       string
	ReasoningSplit bool
	MaxTokens      int
}

// models 模型注册表，key 为对外展示的模型名（前端 select 用）。
var models = map[string]modelConfig{
	// ---- MiniMax 系列 ----
	// MiniMax M2.x 的 thinking 无法关闭，因此只有 [thinking] 一种形态。
	// MiniMax 需要显式发送 reasoning_split=true 才能将 thinking 分离到独立字段。
	"MiniMax-M2.7-highspeed[thinking]": {
		APIModel:       "MiniMax-M2.7-highspeed",
		URL:            "https://api.minimax.chat/v1",
		Thinking:       "",     // M2.x thinking 关不掉，不发送 thinking 字段
		ReasoningSplit: true,   // MiniMax 需要显式开启
		MaxTokens:      196608, // 实测上限（API 报错确认）
	},
	"MiniMax-M3": {
		APIModel:       "MiniMax-M3",
		URL:            "https://api.minimax.chat/v1",
		Thinking:       "disabled", // 关闭思考，跳过推理直接回答
		ReasoningSplit: true,
		MaxTokens:      524288, // M3 实测上限
	},
	"MiniMax-M3[thinking]": {
		APIModel:       "MiniMax-M3",
		URL:            "https://api.minimax.chat/v1",
		Thinking:       "adaptive", // 开启自适应思考
		ReasoningSplit: true,
		MaxTokens:      524288,
	},

	// ---- Xiaomi MiMo 系列 ----
	// MiMo 的 reasoning_content 自动返回，无需发送 reasoning_split。
	// thinking=disabled 时 reasoning_tokens=0，不产生推理开销。
	"mimo-v2.5-pro": {
		APIModel:       "mimo-v2.5-pro",
		URL:            "https://token-plan-cn.xiaomimimo.com/v1",
		Thinking:       "disabled",
		ReasoningSplit: false,  // MiMo 自动返回 reasoning_content
		MaxTokens:      131072, // 实测上限（131073 报错）
	},
	"mimo-v2.5-pro[thinking]": {
		APIModel:       "mimo-v2.5-pro",
		URL:            "https://token-plan-cn.xiaomimimo.com/v1",
		Thinking:       "adaptive",
		ReasoningSplit: false,
		MaxTokens:      131072,
	},

	// ---- DeepSeek 系列 ----
	// DeepSeek 的 reasoning_content 自动返回，无需发送 reasoning_split。
	// thinking 默认开启，可通过 thinking=disabled 关闭。
	"deepseek-v4-pro": {
		APIModel:       "deepseek-v4-pro",
		URL:            "https://api.deepseek.com",
		Thinking:       "disabled",
		ReasoningSplit: false,  // DeepSeek 自动返回 reasoning_content
		MaxTokens:      393216, // 实测上限（API 报错 valid range [1, 393216]）
	},
	"deepseek-v4-pro[thinking]": {
		APIModel:       "deepseek-v4-pro",
		URL:            "https://api.deepseek.com",
		Thinking:       "adaptive",
		ReasoningSplit: false,
		MaxTokens:      393216,
	},
}

// ListModels 返回所有可选模型名称列表。
//
// 返回值可直接用于前端 select 下拉框的选项列表。
// 模型命名规则：
//   - 不带 [thinking] 后缀：关闭思考模式（M2.x 除外）
//   - 带 [thinking] 后缀：开启思考模式
func ListModels() []string {
	keys := make([]string, 0, len(models))
	for k := range models {
		keys = append(keys, k)
	}
	return keys
}

// =====================================================================
// 请求/响应内部结构（JSON 序列化用）
// =====================================================================

// chatMessage 单条消息，遵循 OpenAI 格式。
// Role 可选值："system"（系统提示）、"user"（用户输入）、"assistant"（模型回复）。
type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// chatRequest API 请求体。
// 各字段按供应商需求自动填充，调用方无需关心。
type chatRequest struct {
	Model          string          `json:"model"`                     // 实际 API 模型名
	Messages       []chatMessage   `json:"messages"`                  // 消息数组
	Temperature    float64         `json:"temperature"`               // 生成温度
	MaxTokens      int             `json:"max_tokens"`                // 最大输出 token 数
	ReasoningSplit bool            `json:"reasoning_split,omitempty"` // 是否分离 thinking 输出（MiniMax 专用）
	Thinking       *thinkingConfig `json:"thinking,omitempty"`        // thinking 模式控制
}

// thinkingConfig thinking 模式配置。
// Type 可选值："disabled"（关闭）、"adaptive"（自适应开启）。
type thinkingConfig struct {
	Type string `json:"type"`
}

// chatResponse API 响应体。
type chatResponse struct {
	Choices []struct {
		FinishReason string `json:"finish_reason"` // 终止原因
		Message      struct {
			Content          string `json:"content"`           // 最终回答
			ReasoningContent string `json:"reasoning_content"` // 思考过程
		} `json:"message"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`     // 输入 token 数
		CompletionTokens int `json:"completion_tokens"` // 输出 token 数
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"` // 错误信息
	} `json:"error,omitempty"`
}

// =====================================================================
// 对外接口
// =====================================================================

// 重试配置
const maxRetries = 3        // 最大重试次数
const baseDelayMs = 2000    // 基础退避延迟（毫秒），实际延迟 = baseDelayMs * 2^(attempt-1)

// Chat 统一 LLM 调用入口。
//
// 内部自动处理以下差异：
//   - 各供应商的 API 端点和模型名
//   - thinking 参数的发送与否及具体值
//   - reasoning_split 的发送与否
//   - max_tokens 的模型实际上限
//   - 指数退避重试
//
// 参数：
//   - model:      模型名称，必须是 ListModels() 返回的值之一。
//   - messages:   消息数组，遵循 OpenAI 格式。
//   - apiKey:     API Key，由调用方从配置/环境变量/数据库等途径获取。
//   - temperature: 生成温度，控制输出随机性，范围 [0, 2]。
//
// 返回：
//   - *ChatResult: 成功时返回统一结果。
//   - error:       失败时返回错误（模型名无效或所有重试均失败）。
func Chat(model string, messages []chatMessage, apiKey string, temperature float64) (*ChatResult, error) {
	// 校验模型名
	cfg, ok := models[model]
	if !ok {
		return nil, fmt.Errorf("未知模型: %s，可选: %v", model, ListModels())
	}

	// 构建请求体
	body := chatRequest{
		Model:       cfg.APIModel,
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   cfg.MaxTokens,
	}

	// reasoning_split: 仅 MiniMax 需要显式发送
	if cfg.ReasoningSplit {
		body.ReasoningSplit = true
	}
	// thinking: 仅在需要显式控制时发送（空字符串表示不发送）
	if cfg.Thinking != "" {
		body.Thinking = &thinkingConfig{Type: cfg.Thinking}
	}

	payload, _ := json.Marshal(body)

	// 带指数退避的重试循环
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		result, err := doChat(cfg.URL, apiKey, payload)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if attempt < maxRetries {
			delay := time.Duration(baseDelayMs*(1<<(attempt-1))) * time.Millisecond
			time.Sleep(delay) // 指数退避：2s, 4s, 8s, ...
		}
	}
	return nil, fmt.Errorf("LLM 调用失败，已重试 %d 次: %w", maxRetries, lastErr)
}

// =====================================================================
// 内部实现
// =====================================================================

// doChat 执行单次 HTTP 请求调用 LLM API。
//
// 负责：
//   - 构建 HTTP 请求并设置认证头
//   - 发送请求并读取响应
//   - 校验 HTTP 状态码和 API 错误
//   - 提取 content 和 reasoning_content
//   - 容错：content 为空时从 reasoning 回退提取
//
// 参数：
//   - baseURL: API 端点 base_url（不含 /chat/completions 后缀）
//   - apiKey:  认证密钥
//   - payload: 已序列化的 JSON 请求体
func doChat(baseURL, apiKey string, payload []byte) (*ChatResult, error) {
	url := baseURL + "/chat/completions"

	// 构建 HTTP 请求
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	// 发送请求（5 分钟超时，适配长推理场景）
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// 读取响应体
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// 校验 HTTP 状态码
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(raw), 500))
	}

	// 解析 JSON 响应
	var result chatResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("响应解析失败: %w", err)
	}

	// 校验 API 层错误
	if result.Error != nil && result.Error.Message != "" {
		return nil, fmt.Errorf("API 错误: %s", result.Error.Message)
	}
	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("AI 返回空 choices")
	}

	// 提取 content 和 reasoning_content
	content := strings.TrimSpace(result.Choices[0].Message.Content)
	reasoning := strings.TrimSpace(result.Choices[0].Message.ReasoningContent)

	// 两者均为空则报错
	if content == "" && reasoning == "" {
		return nil, fmt.Errorf("AI 返回空结果")
	}

	// 容错：content 为空时尝试从 reasoning 的</think>标签后提取
	// 这是防御性逻辑，正常情况下 reasoning_split 已分离两者
	if content == "" {
		content = extractFromReasoning(reasoning)
		if content == "" {
			return nil, fmt.Errorf("AI 返回空 content，reasoning 无法提取")
		}
	}

	// 构建统一返回结果
	out := &ChatResult{
		Content:          content,
		ReasoningContent: reasoning,
		FinishReason:     result.Choices[0].FinishReason,
	}
	if result.Usage != nil {
		out.PromptTokens = result.Usage.PromptTokens
		out.CompletionTokens = result.Usage.CompletionTokens
	}
	return out, nil
}

// reThinkClose 匹配</think>结束标签的正则表达式。
// 使用 (?s) 标志使 . 匹配换行符，支持多行 thinking 内容。
var reThinkClose = regexp.MustCompile(`(?s)</think>`)

// extractFromReasoning 从 reasoning_content 中提取实际回答。
//
// 当 content 为空但 reasoning 非空时（异常情况），尝试从 reasoning 中恢复。
// 查找</think>结束标签，返回其后的内容作为回答。
//
// 这是防御性逻辑，正常流程中 reasoning_split 已将 thinking 和 content 分离。
func extractFromReasoning(reasoning string) string {
	loc := reThinkClose.FindStringIndex(reasoning)
	if loc != nil {
		after := strings.TrimSpace(reasoning[loc[1]:])
		if after != "" {
			return after
		}
	}
	// 未找到结束标签，返回整个 reasoning（最后的手段）
	return reasoning
}

// truncate 截断字符串到指定长度，超出部分用 "..." 替代。
// 用于错误日志中限制响应体长度，避免刷屏。
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

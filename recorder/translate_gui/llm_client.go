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

// ==================== LLM 客户端 ====================

type LLMClient struct {
	BaseURL        string
	APIKey         string
	Model          string
	HTTP           *http.Client
	Thinking       *ThinkingConfig
	ReasoningSplit bool
}

// ThinkingConfig 控制 thinking 模式：adaptive（默认开启）/ disabled（关闭，直接回答）
type ThinkingConfig struct {
	Type string `json:"type"`
}

// NewLLMClient 根据模型名查注册表，自动设置 thinking / reasoning_split 等技术参数。
// BaseURL 优先使用用户配置；为空时回退到注册表内置的默认端点。
// 未注册模型走兼容默认（reasoning_split=true，不发送 thinking），保证不破坏现有行为。
func NewLLMClient(cfg AIConfig) *LLMClient {
	model := strings.TrimSpace(cfg.Model)
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")

	reasoningSplit := true
	var thinking *ThinkingConfig
	if mc, ok := lookupModelConfig(model); ok {
		if baseURL == "" {
			baseURL = mc.URL
		}
		reasoningSplit = mc.ReasoningSplit
		if mc.Thinking != "" {
			thinking = &ThinkingConfig{Type: mc.Thinking}
		}
	}

	return &LLMClient{
		BaseURL:        baseURL,
		APIKey:         strings.TrimSpace(cfg.APIKey),
		Model:          model,
		HTTP:           &http.Client{Timeout: 300 * time.Second},
		Thinking:       thinking,
		ReasoningSplit: reasoningSplit,
	}
}

// chatMessage 请求消息
type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// chatRequest 请求体（含 reasoning_split）
type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []chatMessage   `json:"messages"`
	Temperature    float64         `json:"temperature"`
	MaxTokens      int             `json:"max_tokens"`
	ReasoningSplit bool            `json:"reasoning_split,omitempty"`
	Thinking       *ThinkingConfig `json:"thinking,omitempty"`
}

// chatResponse 响应体
type chatResponse struct {
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// ChatCallResult 单次 LLM 调用结果（含用量，供探测/诊断使用）
type ChatCallResult struct {
	Content          string
	ReasoningContent string
	FinishReason     string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// CallChat 调用 Chat Completions，带指数退避重试。
// reasoning_split=true 从源头分离 think，content 字段返回干净答案。
func (c *LLMClient) CallChat(messages []chatMessage, temperature float64, maxTokens int) (string, error) {
	result, err := c.CallChatDetailed(messages, temperature, maxTokens)
	if err != nil {
		return "", err
	}
	return result.Content, nil
}

// CallChatDetailed 调用 Chat Completions 并返回 finish_reason / token 用量。
func (c *LLMClient) CallChatDetailed(messages []chatMessage, temperature float64, maxTokens int) (*ChatCallResult, error) {
	targetModel := c.Model
	if targetModel == "" {
		targetModel = DefaultModelName
	}

	body := chatRequest{
		Model:          targetModel,
		Messages:       messages,
		Temperature:    temperature,
		MaxTokens:      maxTokens,
		ReasoningSplit: c.ReasoningSplit,
	}
	if c.Thinking != nil {
		body.Thinking = c.Thinking
	}
	payload, _ := json.Marshal(body)

	var lastErr error
	for attempt := 1; attempt <= LlmMaxRetries; attempt++ {
		result, err := c.doChatDetailed(payload)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if attempt < LlmMaxRetries {
			delay := time.Duration(LlmBaseDelayMs*(1<<(attempt-1))) * time.Millisecond
			time.Sleep(delay)
		}
	}
	return nil, fmt.Errorf("LLM 调用彻底失败，已重试 %d 次: %w", LlmMaxRetries, lastErr)
}

func (c *LLMClient) doChat(payload []byte) (string, error) {
	result, err := c.doChatDetailed(payload)
	if err != nil {
		return "", err
	}
	return result.Content, nil
}

func (c *LLMClient) doChatDetailed(payload []byte) (*ChatCallResult, error) {
	url := c.BaseURL + "/chat/completions"
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncateForLog(string(raw), 500))
	}

	var result chatResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("响应解析失败: %w", err)
	}

	if result.Error != nil && result.Error.Message != "" {
		return nil, fmt.Errorf("API 错误: %s", result.Error.Message)
	}

	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("AI 返回空 choices")
	}

	content := strings.TrimSpace(result.Choices[0].Message.Content)
	reasoning := strings.TrimSpace(result.Choices[0].Message.ReasoningContent)

	if content == "" && reasoning == "" {
		return nil, fmt.Errorf("AI 返回空结果（content 和 reasoning_content 均为空）")
	}

	if content == "" {
		content = extractContentFromReasoning(reasoning)
		if content == "" {
			return nil, fmt.Errorf("AI 返回空 content，reasoning_content 长度 %d 且无法提取有效内容", len(reasoning))
		}
	}

	out := &ChatCallResult{
		Content:          content,
		ReasoningContent: reasoning,
		FinishReason:     result.Choices[0].FinishReason,
	}
	if result.Usage != nil {
		out.PromptTokens = result.Usage.PromptTokens
		out.CompletionTokens = result.Usage.CompletionTokens
		out.TotalTokens = result.Usage.TotalTokens
	}
	return out, nil
}

// Ping 探活
func (c *LLMClient) Ping(timeoutMs int) (string, error) {
	if timeoutMs <= 0 {
		timeoutMs = LlmPingTimeoutMs
	}
	pingClient := &http.Client{Timeout: time.Duration(timeoutMs) * time.Millisecond}

	body := chatRequest{
		Model:          c.Model,
		Messages:       []chatMessage{{Role: "user", Content: LlmPingUserMessage}},
		MaxTokens:      256,
		Temperature:    0,
		ReasoningSplit: c.ReasoningSplit,
	}
	if c.Thinking != nil {
		body.Thinking = c.Thinking
	}
	payload, _ := json.Marshal(body)

	url := c.BaseURL + "/chat/completions"
	req, _ := http.NewRequest("POST", url, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := pingClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("%s", LlmPingFailMessage)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("%s", LlmPingFailMessage)
	}

	var result chatResponse
	if json.Unmarshal(raw, &result) != nil {
		return "", fmt.Errorf("%s", LlmPingFailMessage)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("%s", LlmPingFailMessage)
	}
	content := strings.TrimSpace(result.Choices[0].Message.Content)
	if content == "" && strings.TrimSpace(result.Choices[0].Message.ReasoningContent) == "" {
		return "", fmt.Errorf("%s", LlmPingFailMessage)
	}
	if content == "" {
		content = "(reasoning_split: content 为空，但推理过程正常)"
	}
	return content, nil
}

func truncateForLog(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

var reThinkClose = regexp.MustCompile(`(?s)</think>`)

func extractContentFromReasoning(reasoning string) string {
	loc := reThinkClose.FindStringIndex(reasoning)
	if loc != nil {
		after := strings.TrimSpace(reasoning[loc[1]:])
		if after != "" {
			return after
		}
	}
	return reasoning
}

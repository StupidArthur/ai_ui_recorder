package llm

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

// LLMClient 按标准 OpenAI 协议调用模型，支持 Chat Completions 与 Responses 两种协议。
type LLMClient struct {
	Protocol        Protocol
	BaseURL         string
	APIKey          string
	Model           string
	ReasoningEffort string
	HTTP            *http.Client
}

// NewLLMClient 根据 AIConfig 构造客户端。BaseURL 末尾斜杠会被去除。
func NewLLMClient(cfg AIConfig) *LLMClient {
	return &LLMClient{
		Protocol:        NormalizeProtocol(cfg.Protocol),
		BaseURL:         strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		APIKey:          strings.TrimSpace(cfg.APIKey),
		Model:           strings.TrimSpace(cfg.Model),
		ReasoningEffort: strings.TrimSpace(cfg.ReasoningEffort),
		HTTP:            &http.Client{Timeout: 300 * time.Second},
	}
}

// ChatMessage 一条 Chat Completions 消息。
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// endpoint 返回当前协议对应的请求地址。
func (c *LLMClient) endpoint() string {
	if c.Protocol == ProtocolResponses {
		return c.BaseURL + "/responses"
	}
	return c.BaseURL + "/chat/completions"
}

// ==================== 请求体 ====================

type chatRequest struct {
	Model           string        `json:"model"`
	Messages        []ChatMessage `json:"messages"`
	Temperature     float64       `json:"temperature"`
	MaxTokens       int           `json:"max_tokens"`
	ReasoningEffort string        `json:"reasoning_effort,omitempty"`
}

type respInputItem struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type reasoningParam struct {
	Effort string `json:"effort"`
}

type responsesRequest struct {
	Model           string          `json:"model"`
	Instructions    string          `json:"instructions,omitempty"`
	Input           []respInputItem `json:"input"`
	Temperature     *float64        `json:"temperature,omitempty"`
	MaxOutputTokens int             `json:"max_output_tokens,omitempty"`
	Reasoning       *reasoningParam `json:"reasoning,omitempty"`
}

// buildPayload 按协议构造请求体。
func (c *LLMClient) buildPayload(messages []ChatMessage, temperature float64, maxTokens int) ([]byte, error) {
	if c.Protocol == ProtocolResponses {
		var instructions []string
		input := make([]respInputItem, 0, len(messages))
		for _, m := range messages {
			if strings.EqualFold(m.Role, "system") {
				if strings.TrimSpace(m.Content) != "" {
					instructions = append(instructions, m.Content)
				}
				continue
			}
			input = append(input, respInputItem{Role: m.Role, Content: m.Content})
		}
		if len(input) == 0 {
			input = append(input, respInputItem{Role: "user", Content: ""})
		}

		body := responsesRequest{
			Model:           c.Model,
			Instructions:    strings.Join(instructions, "\n\n"),
			Input:           input,
			MaxOutputTokens: maxTokens,
		}
		if temperature != 0 {
			t := temperature
			body.Temperature = &t
		}
		if c.ReasoningEffort != "" {
			body.Reasoning = &reasoningParam{Effort: c.ReasoningEffort}
		}
		return json.Marshal(body)
	}

	body := chatRequest{
		Model:           c.Model,
		Messages:        messages,
		Temperature:     temperature,
		MaxTokens:       maxTokens,
		ReasoningEffort: c.ReasoningEffort,
	}
	return json.Marshal(body)
}

// ==================== 调用入口 ====================

// CallChat 调用模型，返回纯文本答案。
func (c *LLMClient) CallChat(messages []ChatMessage, temperature float64, maxTokens int) (string, error) {
	result, err := c.CallChatDetailed(messages, temperature, maxTokens)
	if err != nil {
		return "", err
	}
	return result.Content, nil
}

// CallChatDetailed 调用模型并返回 finish_reason / token 用量，带指数退避重试。
func (c *LLMClient) CallChatDetailed(messages []ChatMessage, temperature float64, maxTokens int) (*ChatCallResult, error) {
	payload, err := c.buildPayload(messages, temperature, maxTokens)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for attempt := 1; attempt <= MaxRetries; attempt++ {
		result, err := c.doRequest(payload)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if attempt < MaxRetries {
			delay := time.Duration(BaseDelayMs*(1<<(attempt-1))) * time.Millisecond
			time.Sleep(delay)
		}
	}
	return nil, fmt.Errorf("LLM 调用彻底失败，已重试 %d 次: %w", MaxRetries, lastErr)
}

func (c *LLMClient) doRequest(payload []byte) (*ChatCallResult, error) {
	req, err := http.NewRequest("POST", c.endpoint(), bytes.NewReader(payload))
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
	return c.parseResponse(raw)
}

// ==================== 响应解析 ====================

// ChatCallResult 单次 LLM 调用结果。
type ChatCallResult struct {
	Content          string
	ReasoningContent string
	FinishReason     string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

func (c *LLMClient) parseResponse(raw []byte) (*ChatCallResult, error) {
	if c.Protocol == ProtocolResponses {
		return parseResponsesResponse(raw)
	}
	return parseChatResponse(raw)
}

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

func parseChatResponse(raw []byte) (*ChatCallResult, error) {
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

	// 通用清洗：部分模型把思考放进 content 的 <think>/<thinking> 块，移出避免污染解析。
	if thinkText, cleaned := splitThinkBlocks(content); thinkText != "" {
		content = cleaned
		if reasoning == "" {
			reasoning = thinkText
		} else {
			reasoning = reasoning + "\n" + thinkText
		}
	}

	if content == "" && reasoning == "" {
		return nil, fmt.Errorf("AI 返回空结果（content 和 reasoning 均为空）")
	}
	if content == "" {
		content = extractContentFromReasoning(reasoning)
		if content == "" {
			return nil, fmt.Errorf("AI 返回空 content，reasoning 长度 %d 且无法提取有效内容", len(reasoning))
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

type responsesResponse struct {
	Status            string `json:"status"`
	IncompleteDetails *struct {
		Reason string `json:"reason"`
	} `json:"incomplete_details"`
	Output []struct {
		Type    string `json:"type"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Summary []struct {
			Text string `json:"text"`
		} `json:"summary"`
	} `json:"output"`
	Usage *struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func parseResponsesResponse(raw []byte) (*ChatCallResult, error) {
	var result responsesResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("响应解析失败: %w", err)
	}
	if result.Error != nil && result.Error.Message != "" {
		return nil, fmt.Errorf("API 错误: %s", result.Error.Message)
	}

	var contentParts, reasoningParts []string
	for _, item := range result.Output {
		switch item.Type {
		case "message":
			for _, c := range item.Content {
				if c.Type == "output_text" && c.Text != "" {
					contentParts = append(contentParts, c.Text)
				}
			}
		case "reasoning":
			for _, s := range item.Summary {
				if strings.TrimSpace(s.Text) != "" {
					reasoningParts = append(reasoningParts, s.Text)
				}
			}
			for _, c := range item.Content {
				if strings.TrimSpace(c.Text) != "" {
					reasoningParts = append(reasoningParts, c.Text)
				}
			}
		}
	}

	content := strings.TrimSpace(strings.Join(contentParts, ""))
	reasoning := strings.TrimSpace(strings.Join(reasoningParts, "\n"))

	if content == "" && reasoning == "" {
		return nil, fmt.Errorf("AI 返回空结果（output 中没有文本内容）")
	}
	if content == "" {
		content = extractContentFromReasoning(reasoning)
		if content == "" {
			return nil, fmt.Errorf("AI 返回空文本，reasoning 长度 %d 且无法提取有效内容", len(reasoning))
		}
	}

	finish := "stop"
	if result.Status != "" && result.Status != "completed" {
		finish = result.Status
		if result.IncompleteDetails != nil && result.IncompleteDetails.Reason != "" {
			finish += ":" + result.IncompleteDetails.Reason
		}
	}

	out := &ChatCallResult{
		Content:          content,
		ReasoningContent: reasoning,
		FinishReason:     finish,
	}
	if result.Usage != nil {
		out.PromptTokens = result.Usage.InputTokens
		out.CompletionTokens = result.Usage.OutputTokens
		out.TotalTokens = result.Usage.TotalTokens
	}
	return out, nil
}

// ==================== 探活 ====================

// Ping 探活：用当前协议发送一条最小消息。
func (c *LLMClient) Ping(timeoutMs int) (string, error) {
	if timeoutMs <= 0 {
		timeoutMs = PingTimeoutMs
	}
	payload, err := c.buildPayload([]ChatMessage{{Role: "user", Content: PingUserMessage}}, 0, 256)
	if err != nil {
		return "", fmt.Errorf("%s", PingFailMessage)
	}

	pingClient := &http.Client{Timeout: time.Duration(timeoutMs) * time.Millisecond}
	req, _ := http.NewRequest("POST", c.endpoint(), bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := pingClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("%s", PingFailMessage)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("%s", PingFailMessage)
	}

	result, err := c.parseResponse(raw)
	if err != nil || result == nil {
		return "", fmt.Errorf("%s", PingFailMessage)
	}
	if strings.TrimSpace(result.Content) == "" {
		return "(返回了推理内容，但 content 为空)", nil
	}
	return result.Content, nil
}

// ==================== 工具函数 ====================

func truncateForLog(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

var (
	reThinkBlock = regexp.MustCompile(`(?is)<think(?:ing)?>([\s\S]*?)</think(?:ing)?>`)
	reThinkClose = regexp.MustCompile(`(?s)</think>`)
)

// splitThinkBlocks 把 content 中的 <think>…</think> / <thinking>…</thinking> 拆出，
// 返回（推理文本, 清洗后正文）。无 think 块时返回 ("", 原文)。
func splitThinkBlocks(content string) (string, string) {
	if !strings.Contains(strings.ToLower(content), "<think") {
		return "", content
	}
	var reasons []string
	cleaned := reThinkBlock.ReplaceAllStringFunc(content, func(m string) string {
		sub := reThinkBlock.FindStringSubmatch(m)
		if len(sub) > 1 {
			if t := strings.TrimSpace(sub[1]); t != "" {
				reasons = append(reasons, t)
			}
		}
		return ""
	})
	return strings.Join(reasons, "\n"), strings.TrimSpace(cleaned)
}

// extractContentFromReasoning 当 content 为空时，从推理文本中尝试提取 </think> 之后的正文。
func extractContentFromReasoning(reasoning string) string {
	if loc := reThinkClose.FindStringIndex(reasoning); loc != nil {
		after := strings.TrimSpace(reasoning[loc[1]:])
		if after != "" {
			return after
		}
	}
	return reasoning
}

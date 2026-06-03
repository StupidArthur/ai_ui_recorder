package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"ai-ui-recorder/tool/ai-proxy-go/internal/config"
)

// ChatProxy 负责将请求转发到上游 OpenAI 兼容接口。
type ChatProxy struct {
	cfg    config.Config
	client *http.Client
}

// NewChatProxy 创建转发器。
func NewChatProxy(cfg config.Config) *ChatProxy {
	return &ChatProxy{
		cfg: cfg,
		client: &http.Client{
			Timeout: time.Duration(cfg.Upstream.TimeoutSeconds) * time.Second,
		},
	}
}

// ForwardCompletions 直接透传 /v1/chat/completions 请求。
// 这里会在 model 为空时自动补齐默认 model，避免调用方漏传时失败。
func (p *ChatProxy) ForwardCompletions(ctx context.Context, rawBody []byte) (*http.Response, error) {
	sanitized, err := p.ensureModel(rawBody)
	if err != nil {
		return nil, err
	}

	url := strings.TrimRight(p.cfg.Upstream.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(sanitized))
	if err != nil {
		return nil, fmt.Errorf("构建上游请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.cfg.Upstream.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("访问上游失败: %w", err)
	}
	return resp, nil
}

// BuildSimpleStreamPayload 将前端问答请求转换为标准 chat completion payload。
func (p *ChatProxy) BuildSimpleStreamPayload(prompt string, model string, systemPrompt string) ([]byte, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, fmt.Errorf("prompt 不能为空")
	}

	useModel := strings.TrimSpace(model)
	if useModel == "" {
		useModel = p.cfg.Upstream.Model
	}
	useSystemPrompt := strings.TrimSpace(systemPrompt)
	if useSystemPrompt == "" {
		useSystemPrompt = "你是一个简洁、准确的中文助手。"
	}

	payload := map[string]any{
		"model":  useModel,
		"stream": true,
		"messages": []map[string]string{
			{"role": "system", "content": useSystemPrompt},
			{"role": "user", "content": prompt},
		},
	}
	return json.Marshal(payload)
}

func (p *ChatProxy) ensureModel(rawBody []byte) ([]byte, error) {
	var payload map[string]any
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		return nil, fmt.Errorf("请求体不是合法 JSON: %w", err)
	}

	model, _ := payload["model"].(string)
	if strings.TrimSpace(model) == "" {
		payload["model"] = p.cfg.Upstream.Model
	}
	sanitized, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("请求体序列化失败: %w", err)
	}
	return sanitized, nil
}

// CopyStream 把上游流式响应复制给下游，并按块 flush。
func CopyStream(dst http.ResponseWriter, src io.Reader) error {
	flusher, ok := dst.(http.Flusher)
	if !ok {
		return fmt.Errorf("当前响应不支持流式输出")
	}

	buf := make([]byte, 4096)
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			flusher.Flush()
		}
		if readErr != nil {
			if readErr == io.EOF {
				return nil
			}
			return readErr
		}
	}
}

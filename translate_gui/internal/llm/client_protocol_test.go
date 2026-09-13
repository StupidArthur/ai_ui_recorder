package llm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildChatPayload(t *testing.T) {
	c := NewLLMClient(AIConfig{
		Protocol:        "chat_completions",
		BaseURL:         "https://example.com/v1/",
		APIKey:          "k",
		Model:           "m",
		ReasoningEffort: "low",
	})
	if c.BaseURL != "https://example.com/v1" {
		t.Fatalf("BaseURL 未去除尾部斜杠: %q", c.BaseURL)
	}

	raw, err := c.buildPayload([]ChatMessage{{Role: "user", Content: "hi"}}, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body["model"] != "m" || body["max_tokens"] != float64(100) {
		t.Fatalf("chat 请求字段错误: %s", raw)
	}
	if body["reasoning_effort"] != "low" {
		t.Fatalf("chat 未携带 reasoning_effort: %s", raw)
	}
}

func TestBuildResponsesPayloadSplitsSystem(t *testing.T) {
	c := NewLLMClient(AIConfig{
		Protocol:        "responses",
		BaseURL:         "https://example.com/v1",
		Model:           "m",
		ReasoningEffort: "medium",
	})
	raw, err := c.buildPayload([]ChatMessage{
		{Role: "system", Content: "sys"},
		{Role: "user", Content: "hi"},
	}, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Instructions    string `json:"instructions"`
		Input           []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"input"`
		MaxOutputTokens int `json:"max_output_tokens"`
		Reasoning       *struct {
			Effort string `json:"effort"`
		} `json:"reasoning"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body.Instructions != "sys" {
		t.Fatalf("system 未进入 instructions: %s", raw)
	}
	if len(body.Input) != 1 || body.Input[0].Role != "user" || body.Input[0].Content != "hi" {
		t.Fatalf("input 构造错误: %s", raw)
	}
	if body.MaxOutputTokens != 200 {
		t.Fatalf("max_output_tokens 错误: %s", raw)
	}
	if body.Reasoning == nil || body.Reasoning.Effort != "medium" {
		t.Fatalf("reasoning.effort 错误: %s", raw)
	}
}

func TestParseChatResponse(t *testing.T) {
	raw := []byte(`{
		"choices":[{"finish_reason":"stop","message":{"content":"答案","reasoning_content":"推理"}}],
		"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}
	}`)
	res, err := parseChatResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if res.Content != "答案" || res.ReasoningContent != "推理" || res.FinishReason != "stop" {
		t.Fatalf("chat 解析错误: %#v", res)
	}
	if res.TotalTokens != 3 {
		t.Fatalf("usage 解析错误: %#v", res)
	}
}

func TestParseChatResponseStripsThinkBlocks(t *testing.T) {
	raw := []byte(`{"choices":[{"finish_reason":"stop","message":{"content":"<think>内部推理</think>\n\n<step id=\"1\"/>","reasoning_content":""}}]}`)
	res, err := parseChatResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(res.Content, "内部推理") {
		t.Fatalf("think 块未被剥离: %q", res.Content)
	}
	if !strings.Contains(res.Content, "<step") {
		t.Fatalf("正文被误删: %q", res.Content)
	}
	if res.ReasoningContent != "内部推理" {
		t.Fatalf("think 未移入 reasoning: %q", res.ReasoningContent)
	}
}

func TestParseResponsesResponse(t *testing.T) {
	raw := []byte(`{
		"status":"completed",
		"output":[
			{"type":"reasoning","summary":[{"text":"推理A"}]},
			{"type":"message","content":[{"type":"output_text","text":"答案B"}]}
		],
		"usage":{"input_tokens":5,"output_tokens":6,"total_tokens":11}
	}`)
	res, err := parseResponsesResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if res.Content != "答案B" {
		t.Fatalf("responses 正文解析错误: %#v", res)
	}
	if res.ReasoningContent != "推理A" {
		t.Fatalf("responses 推理解析错误: %#v", res)
	}
	if res.FinishReason != "stop" || res.TotalTokens != 11 {
		t.Fatalf("responses 元数据解析错误: %#v", res)
	}
}

func TestParseResponsesIncomplete(t *testing.T) {
	raw := []byte(`{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"reasoning","summary":[{"text":"x"}]}]}`)
	res, err := parseResponsesResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if res.FinishReason != "incomplete:max_output_tokens" {
		t.Fatalf("finish 映射错误: %q", res.FinishReason)
	}
}

func TestCallChatViaHTTPBothProtocols(t *testing.T) {
	cases := []struct {
		protocol string
		path     string
		response string
		want     string
	}{
		{
			protocol: "chat_completions",
			path:     "/chat/completions",
			response: `{"choices":[{"finish_reason":"stop","message":{"content":"A"}}]}`,
			want:     "A",
		},
		{
			protocol: "responses",
			path:     "/responses",
			response: `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"B"}]}]}`,
			want:     "B",
		},
	}
	for _, tc := range cases {
		t.Run(tc.protocol, func(t *testing.T) {
			var hitPath string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hitPath = r.URL.Path
				if r.Header.Get("Authorization") != "Bearer key" {
					t.Errorf("缺少 Authorization 头")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.response))
			}))
			defer srv.Close()

			c := NewLLMClient(AIConfig{Protocol: tc.protocol, BaseURL: srv.URL, APIKey: "key", Model: "m"})
			got, err := c.CallChat([]ChatMessage{{Role: "user", Content: "hi"}}, 0, 32)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("CallChat=%q，期望 %q", got, tc.want)
			}
			if hitPath != tc.path {
				t.Fatalf("请求路径=%q，期望 %q", hitPath, tc.path)
			}
		})
	}
}

func TestPingBothProtocols(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/responses") {
			_, _ = w.Write([]byte(`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"pong"}}]}`))
	}))
	defer srv.Close()

	for _, protocol := range []string{"chat_completions", "responses"} {
		c := NewLLMClient(AIConfig{Protocol: protocol, BaseURL: srv.URL, APIKey: "key", Model: "m"})
		reply, err := c.Ping(5000)
		if err != nil {
			t.Fatalf("%s Ping 失败: %v", protocol, err)
		}
		if reply != "pong" {
			t.Fatalf("%s Ping 回复=%q", protocol, reply)
		}
	}
}

func TestNormalizeProtocol(t *testing.T) {
	if NormalizeProtocol("") != ProtocolChatCompletions {
		t.Fatal("空协议应回退 chat_completions")
	}
	if NormalizeProtocol("responses") != ProtocolResponses {
		t.Fatal("responses 归一化失败")
	}
	if NormalizeProtocol("CHAT_COMPLETIONS") != ProtocolChatCompletions {
		t.Fatal("大小写归一化失败")
	}
}

func TestAIConfigValidate(t *testing.T) {
	if err := (AIConfig{BaseURL: "u", Model: "m", APIKey: "k"}).Validate(); err != nil {
		t.Fatalf("完整配置不应报错: %v", err)
	}
	if err := (AIConfig{Model: "m", APIKey: "k"}).Validate(); err == nil {
		t.Fatal("缺少 BaseURL 应报错")
	}
	if err := (AIConfig{BaseURL: "u", Model: "m"}).Validate(); err == nil {
		t.Fatal("缺少 APIKey 应报错")
	}
}

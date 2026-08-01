//go:build integration

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestM3ThinkingBench 用产品代码路径对比 MiniMax-M3 在 thinking=disabled / adaptive 下的响应表现。
// 输入使用 run_2026-06-23T02-35-19 步骤 8 的真实录制数据（action + snapshot diff）。
func TestM3ThinkingBench(t *testing.T) {
	cfgPath := `G:\github\ai_ui_recorder\release\recorder\config\ai.local.json`
	cfgData, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("读配置失败: %v", err)
	}
	var cfgRaw map[string]string
	if err := json.Unmarshal(cfgData, &cfgRaw); err != nil {
		t.Fatalf("解析配置失败: %v", err)
	}

	runDir := `G:\github\ai_ui_recorder\release\recorder\output\run_2026-06-23T02-35-19\record`

	actionData, err := os.ReadFile(filepath.Join(runDir, "actions", "action_008.json"))
	if err != nil {
		t.Fatalf("读 action_008 失败: %v", err)
	}
	var af struct {
		Index     int                    `json:"index"`
		Type      string                 `json:"type"`
		Timestamp int64                  `json:"timestamp"`
		Element   map[string]interface{} `json:"element"`
		FormState map[string]interface{} `json:"formStateDelta"`
	}
	if err := json.Unmarshal(actionData, &af); err != nil {
		t.Fatalf("解析 action_008 失败: %v", err)
	}

	pre, err1 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_007.txt"))
	post, err2 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_008.txt"))
	if err1 != nil || err2 != nil {
		t.Fatalf("读 snapshot 失败: %v / %v", err1, err2)
	}
	diff := computeDiff(string(pre), string(post))

	ea := EnrichedAction{
		Index: af.Index,
		Action: RawAction{
			Type:      af.Type,
			Timestamp: af.Timestamp,
			Element:   af.Element,
			FormState: af.FormState,
		},
		FormStateDelta: af.FormState,
		Diff:           diff,
	}

	messages := []chatMessage{
		{Role: "system", Content: buildPhase1SystemPrompt()},
		{Role: "user", Content: buildPhase1UserPrompt([]EnrichedAction{ea}, nil)},
	}
	t.Logf("system prompt 长度: %d 字符", len(messages[0].Content))
	t.Logf("user prompt 长度: %d 字符", len(messages[1].Content))
	t.Logf("diff 内容:\n%s", diff)

	baseCfg := AIConfig{
		BaseURL: cfgRaw["baseUrl"],
		APIKey:  cfgRaw["apiKey"],
		Model:   "MiniMax-M3",
	}

	// ---------- thinking=disabled ----------
	t.Log("========== thinking=disabled（关闭思考） ==========")
	cDisabled := NewLLMClient(baseCfg)
	cDisabled.Thinking = &ThinkingConfig{Type: "disabled"}
	start := time.Now()
	resDisabled, errDisabled := cDisabled.CallChatDetailed(messages, 0, Phase1MaxTokens)
	durDisabled := time.Since(start)
	if errDisabled != nil {
		t.Logf("thinking=disabled 失败: %v (耗时 %s)", errDisabled, durDisabled)
	} else {
		t.Logf("thinking=disabled: 耗时=%s finish_reason=%s prompt_tokens=%d completion_tokens=%d content_len=%d",
			durDisabled, resDisabled.FinishReason, resDisabled.PromptTokens, resDisabled.CompletionTokens, len(resDisabled.Content))
		t.Logf("reasoning 长度: %d", len(resDisabled.ReasoningContent))
		t.Logf("content 预览:\n%s", truncateForLog(resDisabled.Content, 1000))
	}

	// ---------- thinking=adaptive ----------
	t.Log("========== thinking=adaptive（开启思考） ==========")
	cAdaptive := NewLLMClient(baseCfg)
	cAdaptive.Thinking = &ThinkingConfig{Type: "adaptive"}
	start = time.Now()
	resAdaptive, errAdaptive := cAdaptive.CallChatDetailed(messages, 0, Phase1MaxTokens)
	durAdaptive := time.Since(start)
	if errAdaptive != nil {
		t.Logf("thinking=adaptive 失败: %v (耗时 %s)", errAdaptive, durAdaptive)
	} else {
		t.Logf("thinking=adaptive: 耗时=%s finish_reason=%s prompt_tokens=%d completion_tokens=%d content_len=%d",
			durAdaptive, resAdaptive.FinishReason, resAdaptive.PromptTokens, resAdaptive.CompletionTokens, len(resAdaptive.Content))
		t.Logf("reasoning 长度: %d", len(resAdaptive.ReasoningContent))
		t.Logf("content 预览:\n%s", truncateForLog(resAdaptive.Content, 1000))
	}

	t.Logf("========== 对比 ==========")
	t.Logf("thinking=disabled 耗时 %s | thinking=adaptive 耗时 %s", durDisabled, durAdaptive)
}

// TestM3DiffImprovedVerify 用改进后的 diff（带上下文行）验证 M3 能否识别出开关名称。
func TestM3DiffImprovedVerify(t *testing.T) {
	cfgPath := `G:\github\ai_ui_recorder\release\recorder\config\ai.local.json`
	cfgData, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("读配置失败: %v", err)
	}
	var cfgRaw map[string]string
	if err := json.Unmarshal(cfgData, &cfgRaw); err != nil {
		t.Fatalf("解析配置失败: %v", err)
	}

	runDir := `G:\github\ai_ui_recorder\release\recorder\output\run_2026-06-23T02-35-19\record`

	indices := []int{8, 9}
	var batch []EnrichedAction
	for _, idx := range indices {
		actionData, err := os.ReadFile(filepath.Join(runDir, "actions", "action_"+padIndex(idx)+".json"))
		if err != nil {
			t.Fatalf("读 action_%d 失败: %v", idx, err)
		}
		var af struct {
			Index     int                    `json:"index"`
			Type      string                 `json:"type"`
			Timestamp int64                  `json:"timestamp"`
			Element   map[string]interface{} `json:"element"`
			FormState map[string]interface{} `json:"formStateDelta"`
		}
		if err := json.Unmarshal(actionData, &af); err != nil {
			t.Fatalf("解析 action_%d 失败: %v", idx, err)
		}
		pre, err1 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_"+padIndex(idx-1)+".txt"))
		post, err2 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_"+padIndex(idx)+".txt"))
		if err1 != nil || err2 != nil {
			t.Fatalf("读 snapshot_%d 失败: %v / %v", idx, err1, err2)
		}
		diff := computeDiff(string(pre), string(post))
		t.Logf("步骤 %d 改进后 diff:\n%s", idx, diff)
		batch = append(batch, EnrichedAction{
			Index: af.Index,
			Action: RawAction{
				Type:      af.Type,
				Timestamp: af.Timestamp,
				Element:   af.Element,
				FormState: af.FormState,
			},
			FormStateDelta: af.FormState,
			Diff:           diff,
		})
	}

	messages := []chatMessage{
		{Role: "system", Content: buildPhase1SystemPrompt()},
		{Role: "user", Content: buildPhase1UserPrompt(batch, nil)},
	}

	baseCfg := AIConfig{
		BaseURL: cfgRaw["baseUrl"],
		APIKey:  cfgRaw["apiKey"],
		Model:   "MiniMax-M3",
	}

	t.Log("========== 改进 diff + thinking=disabled ==========")
	c := NewLLMClient(baseCfg)
	c.Thinking = &ThinkingConfig{Type: "disabled"}
	start := time.Now()
	res, err := c.CallChatDetailed(messages, 0, Phase1MaxTokens)
	dur := time.Since(start)
	if err != nil {
		t.Logf("失败: %v (耗时 %s)", err, dur)
	} else {
		t.Logf("耗时=%s finish_reason=%s completion_tokens=%d", dur, res.FinishReason, res.CompletionTokens)
		t.Logf("content 预览:\n%s", truncateForLog(res.Content, 1500))
		if strings.Contains(res.Content, "推荐问题") {
			t.Logf("✓ 已识别出「推荐问题」开关")
		} else {
			t.Logf("✗ 未识别出「推荐问题」开关")
		}
		if strings.Contains(res.Content, "显示所有对话过程") {
			t.Logf("✓ 已识别出「显示所有对话过程」开关")
		} else {
			t.Logf("✗ 未识别出「显示所有对话过程」开关")
		}
	}
}

// TestM3Batch3Adaptive 用 batch=3（action 7/8/9）+ adaptive 思考，验证 batch 增大后是否变慢。
// 与 TestM3ThinkingBench 的 batch=1 adaptive（9.33s）形成对照。
func TestM3Batch3Adaptive(t *testing.T) {
	cfgPath := `G:\github\ai_ui_recorder\release\recorder\config\ai.local.json`
	cfgData, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("读配置失败: %v", err)
	}
	var cfgRaw map[string]string
	if err := json.Unmarshal(cfgData, &cfgRaw); err != nil {
		t.Fatalf("解析配置失败: %v", err)
	}

	runDir := `G:\github\ai_ui_recorder\release\recorder\output\run_2026-06-23T02-35-19\record`

	// 构造 batch=3：action 7/8/9，各自用前一个 snapshot 到当前 snapshot 的 diff
	indices := []int{7, 8, 9}
	var batch []EnrichedAction
	for _, idx := range indices {
		actionData, err := os.ReadFile(filepath.Join(runDir, "actions", "action_"+padIndex(idx)+".json"))
		if err != nil {
			t.Fatalf("读 action_%d 失败: %v", idx, err)
		}
		var af struct {
			Index     int                    `json:"index"`
			Type      string                 `json:"type"`
			Timestamp int64                  `json:"timestamp"`
			Element   map[string]interface{} `json:"element"`
			FormState map[string]interface{} `json:"formStateDelta"`
		}
		if err := json.Unmarshal(actionData, &af); err != nil {
			t.Fatalf("解析 action_%d 失败: %v", idx, err)
		}

		pre, err1 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_"+padIndex(idx-1)+".txt"))
		post, err2 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_"+padIndex(idx)+".txt"))
		if err1 != nil || err2 != nil {
			t.Fatalf("读 snapshot_%d 失败: %v / %v", idx, err1, err2)
		}
		diff := computeDiff(string(pre), string(post))

		batch = append(batch, EnrichedAction{
			Index: af.Index,
			Action: RawAction{
				Type:      af.Type,
				Timestamp: af.Timestamp,
				Element:   af.Element,
				FormState: af.FormState,
			},
			FormStateDelta: af.FormState,
			Diff:           diff,
		})
	}

	messages := []chatMessage{
		{Role: "system", Content: buildPhase1SystemPrompt()},
		{Role: "user", Content: buildPhase1UserPrompt(batch, nil)},
	}
	t.Logf("system prompt 长度: %d 字符", len(messages[0].Content))
	t.Logf("user prompt 长度: %d 字符", len(messages[1].Content))

	baseCfg := AIConfig{
		BaseURL: cfgRaw["baseUrl"],
		APIKey:  cfgRaw["apiKey"],
		Model:   "MiniMax-M3",
	}

	t.Log("========== batch=3 thinking=adaptive ==========")
	c := NewLLMClient(baseCfg)
	c.Thinking = &ThinkingConfig{Type: "adaptive"}
	start := time.Now()
	res, err := c.CallChatDetailed(messages, 0, Phase1MaxTokens)
	dur := time.Since(start)
	if err != nil {
		t.Logf("batch=3 adaptive 失败: %v (耗时 %s)", err, dur)
	} else {
		t.Logf("batch=3 adaptive: 耗时=%s finish_reason=%s prompt_tokens=%d completion_tokens=%d content_len=%d",
			dur, res.FinishReason, res.PromptTokens, res.CompletionTokens, len(res.Content))
		t.Logf("reasoning 长度: %d", len(res.ReasoningContent))
		t.Logf("content 预览:\n%s", truncateForLog(res.Content, 1500))
	}
	t.Logf("对照: batch=1 adaptive 耗时 9.33s（见 TestM3ThinkingBench）")
}

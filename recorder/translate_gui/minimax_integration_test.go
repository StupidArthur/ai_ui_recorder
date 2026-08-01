//go:build integration

package main

import (
	"os"
	"strings"
	"testing"
)

// TestMiniMaxM3EndToEnd 使用临时 API Key 和合成录制数据验证：
// MiniMax-M3 不思考模式、探活、预处理、Phase 1/2、Agent/Human 最终产物。
//
// 必需环境变量：
//
//	MINIMAX_TEST_API_KEY
func TestMiniMaxM3EndToEnd(t *testing.T) {
	apiKey := strings.TrimSpace(os.Getenv("MINIMAX_TEST_API_KEY"))
	if apiKey == "" {
		t.Skip("需要 MINIMAX_TEST_API_KEY")
	}

	client := NewLLMClient(AIConfig{
		APIKey: apiKey,
		Model:  "MiniMax-M3",
	})
	if client.BaseURL != "https://api.minimax.chat/v1" {
		t.Fatalf("BaseURL=%q", client.BaseURL)
	}
	if client.Thinking == nil || client.Thinking.Type != "disabled" {
		t.Fatalf("MiniMax-M3 应使用 thinking=disabled，实际 %#v", client.Thinking)
	}
	if !client.ReasoningSplit {
		t.Fatal("MiniMax-M3 应启用 reasoning_split")
	}

	reply, err := client.Ping(LlmPingTimeoutMs)
	if err != nil {
		t.Fatalf("MiniMax-M3 探活失败: %v", err)
	}
	t.Logf("MiniMax-M3 探活成功，回复长度=%d", len(reply))

	runDir := createValidRecordingFixture(t)
	if err := validateRecordingData(runDir); err != nil {
		t.Fatalf("合成录制数据契约校验失败: %v", err)
	}

	paths := getTranslatePaths(runDir)
	logger := NewLogger(paths.GenerateLog, nil)
	defer logger.Close()

	enriched, _, err := preprocess(runDir, logger)
	if err != nil {
		t.Fatalf("预处理失败: %v", err)
	}
	if err := runWorkflow(runDir, enriched, client, logger); err != nil {
		t.Fatalf("翻译工作流失败: %v", err)
	}

	for name, path := range map[string]string{
		"Agent TXT": paths.AgentsTxt,
		"人类用例":      paths.CasesMd,
		"结构化步骤":     paths.StructuredStepsJson,
		"切片结果":      paths.CaseSlicesJson,
	} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("%s 未生成: %v", name, err)
		}
		if info.Size() == 0 {
			t.Fatalf("%s 为空: %s", name, path)
		}
		t.Logf("%s 生成成功，大小=%d", name, info.Size())
	}

	agentContent, err := os.ReadFile(paths.AgentsTxt)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(agentContent), "Enter") {
		t.Fatalf("Agent TXT 未保留 Enter 按键:\n%s", agentContent)
	}

	humanContent, err := os.ReadFile(paths.CasesMd)
	if err != nil {
		t.Fatal(err)
	}
	humanText := string(humanContent)
	for _, expected := range []string{
		"| 序号 | 操作 | 结果（录制实况 / 预期基线） |",
		"## Case 1：",
		"Enter",
	} {
		if !strings.Contains(humanText, expected) {
			t.Fatalf("Case 表格缺少 %q:\n%s", expected, humanText)
		}
	}

	t.Logf("===== Phase 3 执行用例 =====\n%s", agentContent)
	t.Logf("===== Phase 4 Case 表格 =====\n%s", humanContent)
}

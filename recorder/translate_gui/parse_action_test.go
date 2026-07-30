package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestParseActionFileFlat 验证平铺结构 action.json 能正确解析出 type/url/timestamp
func TestParseActionFileFlat(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(`G:\github\ai_ui_recorder\release\recorder\output\run_2026-06-23T02-35-19\record\actions`, "action_001.json"))
	if err != nil {
		t.Fatalf("读 action_001 失败: %v", err)
	}
	af, err := parseActionFile(data, 1)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	t.Logf("Index=%d Type=%q URL=%q Timestamp=%d", af.Index, af.Action.Type, af.Action.URL, af.Action.Timestamp)
	if af.Action.Type != "click" {
		t.Errorf("Type 期望 click，实际 %q", af.Action.Type)
	}
	if af.Action.URL == "" {
		t.Errorf("URL 不应为空")
	} else {
		t.Logf("✓ URL=%s", af.Action.URL)
	}
	if af.Action.Timestamp == 0 {
		t.Errorf("Timestamp 不应为 0")
	}

	// 验证 action_008（input 类型）
	data8, _ := os.ReadFile(filepath.Join(`G:\github\ai_ui_recorder\release\recorder\output\run_2026-06-23T02-35-19\record\actions`, "action_008.json"))
	af8, _ := parseActionFile(data8, 8)
	t.Logf("action_008: Type=%q URL=%q", af8.Action.Type, af8.Action.URL)
	if af8.Action.Type == "" {
		t.Errorf("action_008 Type 不应为空")
	}
}

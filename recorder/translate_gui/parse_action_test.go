package main

import "testing"

func TestParseActionFileFlat(t *testing.T) {
	data := []byte(`{
		"index": 7,
		"type": "keypress",
		"key": "Enter",
		"timestamp": 1720000000000,
		"element": {"tag": "input", "id": "query"},
		"formStateDelta": {"//*[@id='query']": {"value": "hello"}},
		"url": "https://example.test/search",
		"title": "Search"
	}`)

	action, err := parseActionFile(data, 1)
	if err != nil {
		t.Fatalf("解析平铺 action 失败: %v", err)
	}
	if action.Index != 7 {
		t.Fatalf("Index=%d，期望 7", action.Index)
	}
	if action.Action.Type != "keypress" {
		t.Fatalf("Type=%q，期望 keypress", action.Action.Type)
	}
	if action.Action.Key != "Enter" {
		t.Fatalf("Key=%q，期望 Enter", action.Action.Key)
	}
	if action.Action.Timestamp != 1720000000000 {
		t.Fatalf("Timestamp=%d，未完整保留", action.Action.Timestamp)
	}
	if action.Action.URL != "https://example.test/search" {
		t.Fatalf("URL=%q，未完整保留", action.Action.URL)
	}
}

package llm

import (
	"os"
	"path/filepath"
	"testing"
)

func isolateHome(t *testing.T) {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("USERPROFILE", tmp)
	t.Setenv("HOME", tmp)
}

func TestConfigProfileStoreLifecycle(t *testing.T) {
	isolateHome(t)

	if got := ListConfigProfiles(); len(got.Profiles) != 0 || got.Active != "" {
		t.Fatalf("初始应为空: %#v", got)
	}

	cfgA := AIConfig{Protocol: "chat_completions", BaseURL: "https://a/v1", APIKey: "key-a", Model: "ma"}
	if r := SaveConfigProfile("a", cfgA); !r.Success {
		t.Fatalf("保存 a 失败: %s", r.Message)
	}
	cfgB := AIConfig{Protocol: "responses", BaseURL: "https://b/v1", APIKey: "key-b", Model: "mb"}
	if r := SaveConfigProfile("b", cfgB); !r.Success {
		t.Fatalf("保存 b 失败: %s", r.Message)
	}

	list := ListConfigProfiles()
	if len(list.Profiles) != 2 || list.Active != "b" {
		t.Fatalf("列表/active 错误: %#v", list)
	}
	for _, p := range list.Profiles {
		if !p.HasKey {
			t.Fatalf("HasKey 应为 true: %#v", p)
		}
	}

	// key 留空保存应保留旧值
	if r := SaveConfigProfile("a", AIConfig{Protocol: "responses", BaseURL: "https://a2/v1", Model: "ma2"}); !r.Success {
		t.Fatalf("覆盖 a 失败: %s", r.Message)
	}
	stored, ok := FindProfile("a")
	if !ok || stored.APIKey != "key-a" {
		t.Fatalf("留空 key 未保留旧值: %#v", stored)
	}
	if stored.Protocol != "responses" || stored.BaseURL != "https://a2/v1" {
		t.Fatalf("其他字段未更新: %#v", stored)
	}

	// active 应切到 a
	if active := LoadActiveAIConfig(); active.Name != "a" {
		t.Fatalf("active 应为 a: %#v", active)
	}

	// 删除 active，应顺延到 b
	if r := DeleteConfigProfile("a"); !r.Success {
		t.Fatalf("删除 a 失败: %s", r.Message)
	}
	if active := LoadActiveAIConfig(); active.Name != "b" {
		t.Fatalf("删除 active 后应顺延到 b: %#v", active)
	}

	// 文件确实落在 ~/.ui_translator/ai.local.json
	home, _ := os.UserHomeDir()
	if _, err := os.Stat(filepath.Join(home, productDirName, "ai.local.json")); err != nil {
		t.Fatalf("配置文件未落盘: %v", err)
	}
}

func TestSetActiveMissingProfile(t *testing.T) {
	isolateHome(t)
	if r := SetActiveConfigProfile("nope"); r.Success {
		t.Fatal("切换不存在的配置应失败")
	}
}

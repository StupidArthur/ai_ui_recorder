package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestValidateRecordingData(t *testing.T) {
	runDir := createValidRecordingFixture(t)
	if err := validateRecordingData(runDir); err != nil {
		t.Fatalf("有效录制数据不应校验失败: %v", err)
	}
}

func TestValidateRecordingDataRejectsMissingSnapshot(t *testing.T) {
	runDir := createValidRecordingFixture(t)
	if err := os.Remove(filepath.Join(runDir, "record", "snapshots", "snapshot_001.txt")); err != nil {
		t.Fatal(err)
	}
	if err := validateRecordingData(runDir); err == nil {
		t.Fatal("缺少 postSnapshot 时应拒绝翻译")
	}
}

func TestRecomputeStepIntervalsUsesActionOrder(t *testing.T) {
	steps := []StructuredStep{{ID: 1}, {ID: 2}, {ID: 3}}
	actions := []EnrichedAction{
		{Index: 3, Action: RawAction{Timestamp: 2500}},
		{Index: 1, Action: RawAction{Timestamp: 1000}},
		{Index: 2, Action: RawAction{Timestamp: 1600}},
	}

	recomputeStepIntervals(steps, actions)
	if steps[0].IntervalFromPreviousMs != nil {
		t.Fatalf("首步骤 interval 应为空，实际 %v", *steps[0].IntervalFromPreviousMs)
	}
	if got := *steps[1].IntervalFromPreviousMs; got != 600 {
		t.Fatalf("步骤 2 interval=%d，期望 600", got)
	}
	if got := *steps[2].IntervalFromPreviousMs; got != 900 {
		t.Fatalf("步骤 3 interval=%d，期望 900", got)
	}
}

func TestKeyFlowsIntoPromptAndStructuredStep(t *testing.T) {
	action := EnrichedAction{
		Index:  1,
		Action: RawAction{Type: "keypress", Key: "Enter", Timestamp: 1000},
	}
	prompt := buildPhase1ActionJSON(action)
	if !strings.Contains(prompt, `"key": "Enter"`) {
		t.Fatalf("Phase 1 输入未包含 key:\n%s", prompt)
	}

	step := normalizeStructuredStep(StructuredStep{Description: "提交"}, action, 1, nil)
	if step.Key != "Enter" {
		t.Fatalf("结构化步骤 Key=%q，期望 Enter", step.Key)
	}

	fallback := buildFallbackStructuredStep(action, 1, "test", nil)
	if fallback.Key != "Enter" || !strings.Contains(fallback.Description, "Enter") {
		t.Fatalf("fallback 未保留按键: key=%q description=%q", fallback.Key, fallback.Description)
	}
}

func TestRenderHumanCaseAsOperationResultTable(t *testing.T) {
	runDir := t.TempDir()
	logger := NewLogger(filepath.Join(runDir, "translate", "logs", "generate.log"), nil)
	defer logger.Close()

	steps := []StructuredStep{
		{
			ID:          1,
			Status:      "normal",
			Description: "输入用户名",
			UiChange:    "无可见变化",
			ActionKind:  "input",
		},
		{
			ID:          2,
			Status:      "normal",
			Description: "点击“立即登录”",
			AssertText:  "进入系统首页",
			ActionKind:  "click",
		},
	}
	slices := []CaseSlice{{
		StartStep: 1,
		EndStep:   2,
		Consume:   2,
		Name:      "登录系统",
		Purpose:   "验证有效账号可以登录",
	}}

	output, err := renderHumanCase(runDir, steps, slices, logger)
	if err != nil {
		t.Fatalf("渲染 Phase 4 失败: %v", err)
	}
	contentBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)

	checks := []string{
		"## Case 1：登录系统",
		"| 序号 | 操作 | 结果（录制实况 / 预期基线） |",
		"| 1 | 输入用户名 |  |",
		"| 2 | 点击“立即登录” | 进入系统首页 |",
	}
	for _, expected := range checks {
		if !strings.Contains(content, expected) {
			t.Fatalf("Phase 4 缺少 %q:\n%s", expected, content)
		}
	}
	if strings.Contains(content, "状态验证") {
		t.Fatalf("Phase 4 不应重复输出旧版状态验证结构:\n%s", content)
	}
}

func TestLlmAuditorConcurrentRecord(t *testing.T) {
	auditor := NewLlmAuditor(t.TempDir())
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			auditor.Record("phase1", index, true, "input", "output", 1, "")
		}(i)
	}
	wg.Wait()

	if err := auditor.Finalize(); err != nil {
		t.Fatalf("写入审计文件失败: %v", err)
	}
	if len(auditor.Records) != 100 {
		t.Fatalf("审计记录数=%d，期望 100", len(auditor.Records))
	}
}

func TestSupportedModelsExcludeHighspeed(t *testing.T) {
	if DefaultModelName != "MiniMax-M3" {
		t.Fatalf("默认模型=%q，期望 MiniMax-M3", DefaultModelName)
	}
	for _, model := range ListModels() {
		if strings.Contains(strings.ToLower(model.Name), "highspeed") {
			t.Fatalf("内置模型列表仍包含 Highspeed: %s", model.Name)
		}
	}
}

func createValidRecordingFixture(t *testing.T) string {
	t.Helper()
	runDir := t.TempDir()
	actionsDir := filepath.Join(runDir, "record", "actions")
	snapshotsDir := filepath.Join(runDir, "record", "snapshots")
	if err := os.MkdirAll(actionsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(snapshotsDir, 0755); err != nil {
		t.Fatal(err)
	}

	files := map[string]string{
		filepath.Join(runDir, "meta.json"): `{"totalActions":1,"recordStartTime":"2026-07-30T00:00:00Z"}`,
		filepath.Join(actionsDir, "action_001.json"): `{
			"index":1,
			"type":"keypress",
			"key":"Enter",
			"timestamp":1720000000000,
			"element":{"tag":"input"}
		}`,
		filepath.Join(snapshotsDir, "snapshot_000.txt"): "textbox query",
		filepath.Join(snapshotsDir, "snapshot_001.txt"): "textbox query\nstatus submitted",
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	return runDir
}

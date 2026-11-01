package translator

import (
	"encoding/json"
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

func TestFormStateChangesBelongToPrecedingActionInterval(t *testing.T) {
	xpath := `//*[@id='query']`
	state := func(value string) map[string]interface{} {
		return map[string]interface{}{
			xpath: map[string]interface{}{"value": value},
		}
	}
	actions := []mergedAction{
		{Index: 1, FormStateDelta: state("")},
		{Index: 2, FormStateDelta: state("hello")},
		{Index: 3, FormStateDelta: state("hello")},
	}

	first := formStateChangesAfterAction(actions, 0)
	change, ok := first.Changed[xpath]
	if !ok {
		t.Fatalf("action 1 应接收其后操作间隔内的表单变化: %+v", first)
	}
	from := change.From.(map[string]interface{})["value"]
	to := change.To.(map[string]interface{})["value"]
	if from != "" || to != "hello" {
		t.Fatalf("变化方向错误: from=%v to=%v", from, to)
	}

	second := formStateChangesAfterAction(actions, 1)
	if second.HasChanges {
		t.Fatalf("action 2 后无表单变化，不应分配变化: %+v", second)
	}
	last := formStateChangesAfterAction(actions, 2)
	if last.HasChanges {
		t.Fatalf("最后一个 action 缺少后继事件，不应推断表单变化: %+v", last)
	}
}

func TestFormStateChangesRequireBothBoundarySamples(t *testing.T) {
	actions := []mergedAction{
		{Index: 1, FormStateDelta: map[string]interface{}{"field": map[string]interface{}{"value": "before"}}},
		{Index: 2, FormStateDelta: nil},
	}
	if got := formStateChangesAfterAction(actions, 0); got.HasChanges {
		t.Fatalf("缺少任一边界采样时不应推断变化: %+v", got)
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

func TestRenderStepActionPreservesInputAndMasksCredential(t *testing.T) {
	plain := renderStepAction(StructuredStep{
		ActionKind: "input", Description: "在用户名输入框中输入", Target: "用户名", InputText: "alice",
	})
	if !strings.Contains(plain, "alice") {
		t.Fatalf("非敏感输入值未保留: %s", plain)
	}
	secret := renderStepAction(StructuredStep{
		ActionKind: "input", Description: "在密码输入框中输入 secret-value", Target: "密码", InputText: "secret-value",
	})
	if strings.Contains(secret, "secret-value") || !strings.Contains(secret, "凭据参数") {
		t.Fatalf("敏感输入应改为凭据参数引用: %s", secret)
	}
}

func TestSensitiveInputDetectionUsesElementMetadata(t *testing.T) {
	action := EnrichedAction{
		Action: RawAction{Type: "input", Element: map[string]interface{}{"tag": "input", "type": "password"}},
	}
	if !deriveInputSensitive(action) {
		t.Fatal("type=password 必须标记为敏感输入")
	}
	step := normalizeStructuredStep(StructuredStep{Description: "在输入框中输入"}, action, 1, nil)
	if !step.InputSensitive {
		t.Fatal("敏感标记必须进入 StructuredStep")
	}
}

func TestDeriveInputTextReadsAddedAndChangedFormState(t *testing.T) {
	xpath := `//input[@name="nickname"]`
	to := map[string]interface{}{"value": "alice-demo"}
	cases := []struct {
		name  string
		state map[string]interface{}
	}{
		{
			name: "added",
			state: map[string]interface{}{
				"added": map[string]interface{}{xpath: to},
			},
		},
		{
			name: "changed",
			state: map[string]interface{}{
				"changed": map[string]FormChange{xpath: {To: to}},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			action := EnrichedAction{
				Action:         RawAction{Type: "input", Element: map[string]interface{}{"tag": "input", "xpath": xpath}},
				FormStateDelta: tc.state,
			}
			if got := deriveInputText(action); got != "alice-demo" {
				t.Fatalf("deriveInputText()=%q, want alice-demo", got)
			}
		})
	}
}

func TestRobustExtractStepsDecodesXmlEntities(t *testing.T) {
	raw := `<steps><step id="1"><action>Open Preferences &gt; Appearance &amp; save</action><observation>Shows Saved &amp; ready</observation><assertText>Path contains &gt;</assertText></step></steps>`
	got := robustExtractSteps(raw)
	if len(got.Steps) != 1 {
		t.Fatalf("解析步骤数=%d, want 1; errors=%+v", len(got.Steps), got.Errors)
	}
	step := got.Steps[0]
	if step.Action != "Open Preferences > Appearance & save" {
		t.Errorf("action=%q", step.Action)
	}
	if step.Observation != "Shows Saved & ready" {
		t.Errorf("observation=%q", step.Observation)
	}
	if step.AssertText != "Path contains >" {
		t.Errorf("assertText=%q", step.AssertText)
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
		t.Fatalf("渲染 Phase 3 Case 表格失败: %v", err)
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
			t.Fatalf("Phase 3 Case 表格缺少 %q:\n%s", expected, content)
		}
	}
	if strings.Contains(content, "状态验证") {
		t.Fatalf("Phase 3 Case 表格不应重复输出旧版状态验证结构:\n%s", content)
	}
}

func TestRenderPhase3OutputsFollowMultiCaseStepContractAndRedactSecrets(t *testing.T) {
	runDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(runDir, MetaFilename), []byte(`{"initialUrl":"https://example.test/login?tenant=demo&TOKEN=secret-query&tPt-ToKeN=tpt-secret&ACCESS_TOKEN=access-secret&refresh_token=refresh-secret&Authorization=auth-secret&sessionid=session-secret&code=code-secret#/login?tab=main&sessionID=fragment-secret"}`), 0644); err != nil {
		t.Fatal(err)
	}
	logger := NewLogger(filepath.Join(runDir, "translate", "logs", "generate.log"), nil)
	defer logger.Close()
	steps := []StructuredStep{
		{ID: 1, Status: "normal", Description: "在「用户名」输入框输入「alice」", Target: "用户名", InputText: "alice", ActionKind: "input", AssertText: "用户名框显示 alice"},
		{ID: 2, Status: "normal", Description: "在密码框输入 super-secret-value", Target: "密码", InputText: "super-secret-value", InputSensitive: true, ActionKind: "input", AssertText: "欢迎 super-secret-value"},
		{ID: 3, Status: "fallback", Description: "点击菜单", Target: "", ActionKind: "click", IsFallback: true},
		{ID: 4, Status: "normal", Description: "按 Enter 提交搜索", Target: "搜索框", ActionKind: "keyPress", Key: "Enter", AssertText: "搜索结果列表出现"},
		{ID: 5, Status: "normal", Description: "在筛选框输入查询条件", Target: "筛选框", ActionKind: "input", InputText: "", AssertText: "筛选结果更新"},
	}
	slices := []CaseSlice{
		{StartStep: 1, EndStep: 2, Consume: 2, Name: "登录系统 super-secret-value", Purpose: "验证有效账号可以登录 super-secret-value"},
		{StartStep: 3, EndStep: 5, Consume: 3, Name: "筛选工作台", Purpose: "验证工作台可按条件筛选"},
	}

	output, err := renderRunnableCase(runDir, steps, slices, logger)
	if err != nil {
		t.Fatal(err)
	}
	contentBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)
	h3Count, h4Count := 0, 0
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "#### ") {
			h4Count++
		} else if strings.HasPrefix(line, "### ") {
			h3Count++
		}
	}
	if got := h3Count; got != 2 {
		t.Fatalf("应为每个 Phase 2 Case 输出一个 H3，got=%d:\n%s", got, content)
	}
	if got := h4Count; got != 7 {
		t.Fatalf("应为每 Case 一个执行约定 H4 且每 Step 一个 H4，got=%d:\n%s", got, content)
	}
	checks := []string{
		"### 登录系统 [凭据已脱敏]（录制生成版）",
		"### 筛选工作台（录制生成版）",
		"- 测试目的：验证有效账号可以登录 [凭据已脱敏]",
		"- 起始 URL：https://example.test/login?tenant=demo#/login?tab=main",
		"#### 执行约定",
		"#### 步骤1 在「用户名」输入框输入「alice」",
		"#### 步骤2 输入凭据",
		"#### 步骤1 点击菜单",
		"#### 步骤2 按 Enter 提交搜索",
		"#### 步骤3 在筛选框输入查询条件",
		"**操作**\n\n1. 在「用户名」输入框输入「alice」\n\n**预期**\n\n- [ ] 用户名框显示 alice",
		"**操作**\n\n1. 在「敏感输入框」输入执行时提供的凭据参数（录制值已隐藏）（待调试确认凭据参数）\n\n**预期**\n\n- [ ] 欢迎 [凭据已脱敏]",
		"在筛选框输入查询条件（缺少输入值，待调试确认）",
		"（缺少操作目标，待调试确认）（本地兜底步骤，待调试确认）",
		"1. 按 Enter 提交搜索",
		"- 步骤2（原始步骤 2）待调试确认：需要在执行时提供凭据参数；录制值已隐藏。",
		"- 步骤1（原始步骤 3）待调试确认：录制数据缺少操作目标。",
		"- 步骤3（原始步骤 5）待调试确认：录制数据缺少必填输入值。",
	}
	for _, expected := range checks {
		if !strings.Contains(content, expected) {
			t.Fatalf("录制生成版缺少 %q:\n%s", expected, content)
		}
	}
	if strings.Index(content, "### 登录系统") > strings.Index(content, "### 筛选工作台") ||
		strings.Index(content, "#### 步骤2 输入凭据") > strings.Index(content, "### 筛选工作台") ||
		strings.Index(content, "### 筛选工作台") > strings.Index(content, "#### 步骤1 点击菜单") {
		t.Fatalf("Case / Step 顺序或归属错误:\n%s", content)
	}
	for _, secret := range []string{"super-secret-value", "secret-query", "tpt-secret", "access-secret", "refresh-secret", "auth-secret", "session-secret", "code-secret", "fragment-secret"} {
		if strings.Contains(content, secret) {
			t.Fatalf("runnable_case.md 泄露敏感值 %q:\n%s", secret, content)
		}
	}
	if !strings.Contains(content, "承接 Case 1 完成后的页面和数据状态") {
		t.Fatalf("后续 Case 未说明承接前序状态:\n%s", content)
	}

	agentPath, err := renderAgentCase(runDir, steps, slices, logger)
	if err != nil {
		t.Fatal(err)
	}
	agentBytes, err := os.ReadFile(agentPath)
	if err != nil {
		t.Fatal(err)
	}
	agentContent := string(agentBytes)
	if !strings.Contains(agentContent, "起始 URL：https://example.test/login?tenant=demo#/login?tab=main") {
		t.Fatalf("agents.txt 未使用同一 URL 清理逻辑:\n%s", agentContent)
	}
	for _, secret := range []string{"super-secret-value", "secret-query", "tpt-secret", "access-secret", "refresh-secret", "auth-secret", "session-secret", "code-secret", "fragment-secret"} {
		if strings.Contains(agentContent, secret) {
			t.Fatalf("agents.txt 泄露敏感值 %q:\n%s", secret, agentContent)
		}
	}

	humanPath, err := renderHumanCase(runDir, steps, slices, logger)
	if err != nil {
		t.Fatal(err)
	}
	humanBytes, err := os.ReadFile(humanPath)
	if err != nil {
		t.Fatal(err)
	}
	humanContent := string(humanBytes)
	if strings.Contains(humanContent, "起始 URL") || strings.Contains(humanContent, "https://example.test") {
		t.Fatalf("cases.md 不应输出 URL:\n%s", humanContent)
	}
	for _, secret := range []string{"super-secret-value", "secret-query", "tpt-secret", "access-secret", "refresh-secret", "auth-secret", "session-secret", "code-secret", "fragment-secret"} {
		if strings.Contains(humanContent, secret) {
			t.Fatalf("cases.md 泄露敏感值 %q:\n%s", secret, humanContent)
		}
	}
}

func TestRunnableMissingInputDoesNotMislabelExplicitClear(t *testing.T) {
	clear := StructuredStep{ActionKind: "input", Description: "清空筛选框", Target: "筛选框"}
	missing := StructuredStep{ActionKind: "input", Description: "输入筛选条件", Target: "筛选框"}
	if missingStructuredInputValue(clear) {
		t.Fatal("明确的清空动作不应被标成缺少输入值")
	}
	if !missingStructuredInputValue(missing) {
		t.Fatal("缺少必填输入值时应标记待确认")
	}
}

func TestParseSlicesIgnoresOutputAfterWindowConsumed(t *testing.T) {
	raw := `<slices totalConsume="2">
<slice consume="2" startStep="2" endStep="5"><name>登录</name><purpose>登录</purpose></slice>
<slice consume="1" startStep="9" endStep="9"><name>多余</name><purpose>多余</purpose></slice>
</slices>`
	result := parseSlicesResponse(raw, []int{2, 5})
	if len(result.Slices) != 1 || result.ConsumeStepCount != 2 {
		t.Fatalf("窗口耗尽后不应追加切片: %+v", result)
	}
	if !strings.Contains(result.ClampReason, "ignored-after-window-consumed") {
		t.Fatalf("应记录忽略原因: %+v", result)
	}
}

func TestValidateCaseSlicesSupportsGappedStepIDs(t *testing.T) {
	steps := []StructuredStep{
		{ID: 2, Status: "normal"},
		{ID: 3, Status: "noise"},
		{ID: 5, Status: "normal"},
		{ID: 9, Status: "fallback"},
	}
	valid := []CaseSlice{
		{StartStep: 2, EndStep: 5, Consume: 2},
		{StartStep: 9, EndStep: 9, Consume: 1},
	}
	if err := validateCaseSlices(steps, valid); err != nil {
		t.Fatalf("有效步骤 ID 有间隔时应通过: %v", err)
	}
	invalid := []CaseSlice{{StartStep: 2, EndStep: 5, Consume: 2}}
	if err := validateCaseSlices(steps, invalid); err == nil {
		t.Fatal("遗漏有效步骤时必须拒绝渲染")
	}
}

func TestListRunsRequiresCompletionMarkerForNewAttempt(t *testing.T) {
	outputDir := t.TempDir()
	runDir := filepath.Join(outputDir, "run_2026-09-12T10-00-00")
	paths := getTranslatePaths(runDir)
	if err := os.MkdirAll(paths.Phase3Dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.AgentsTxt, []byte("partial"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := jsonWriteFile(paths.AttemptStatus, map[string]string{"status": "running"}); err != nil {
		t.Fatal(err)
	}

	service := NewService()
	runs := service.ListRuns(outputDir)
	if len(runs) != 1 || runs[0].Translated {
		t.Fatalf("只有部分产物的新尝试不得标记成功: %+v", runs)
	}
	if err := jsonWriteFile(paths.CompletedStatus, map[string]string{"status": "completed"}); err != nil {
		t.Fatal(err)
	}
	runs = service.ListRuns(outputDir)
	if len(runs) != 1 || runs[0].Translated {
		t.Fatalf("attempt 仍为 running 时不能仅凭 completed.json 标记成功: %+v", runs)
	}
	if err := jsonWriteFile(paths.AttemptStatus, map[string]string{"status": "completed"}); err != nil {
		t.Fatal(err)
	}
	runs = service.ListRuns(outputDir)
	if len(runs) != 1 || !runs[0].Translated {
		t.Fatalf("attempt 与完成标志都完成时应标记成功: %+v", runs)
	}
	if err := jsonWriteFile(paths.AttemptStatus, map[string]string{"status": "failed", "error": "translation failed"}); err != nil {
		t.Fatal(err)
	}
	runs = service.ListRuns(outputDir)
	if len(runs) != 1 || runs[0].Translated {
		t.Fatalf("失败状态不能被过期 completed.json 误标为成功: %+v", runs)
	}
}

func TestAttemptFailureStatusRedactsSensitiveErrorAndPanic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "attempt.json")
	if err := writeAttemptRunning(path); err != nil {
		t.Fatal(err)
	}
	if err := finalizeAttemptFailure(path, true, false, "request failed token=secret-token phone=13800138000 Bearer abc.def", nil); err != nil {
		t.Fatal(err)
	}
	assertFailedAttemptIsSafe(t, path, "request failed", "secret-token", "13800138000", "abc.def")

	if err := writeAttemptRunning(path); err != nil {
		t.Fatal(err)
	}
	if err := finalizeAttemptFailure(path, true, false, "panic carries password=super-secret", "panic carries password=super-secret"); err != nil {
		t.Fatal(err)
	}
	assertFailedAttemptIsSafe(t, path, "panic carries", "super-secret", "password=")

	if err := finalizeAttemptFailure(path, true, true, "ignored failure", nil); err != nil {
		t.Fatal(err)
	}
	if status := readTranslateStatus(path); status != "failed" {
		t.Fatalf("成功结果不应被 failure finalizer 覆盖，status=%q", status)
	}
}

func assertFailedAttemptIsSafe(t *testing.T, path string, forbidden ...string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var attempt struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(data, &attempt); err != nil {
		t.Fatal(err)
	}
	if attempt.Status != "failed" || strings.TrimSpace(attempt.Error) == "" {
		t.Fatalf("错误/恐慌后 attempt 应包含 failed + error，got %+v", attempt)
	}
	for _, value := range forbidden {
		if strings.Contains(string(data), value) {
			t.Fatalf("attempt.json 泄露敏感内容 %q: %s", value, data)
		}
	}
}

func TestSanitizeStartURLRemovesSensitiveQueryKeysAndFailsClosed(t *testing.T) {
	got := sanitizeStartURL("https://user:pass@example.test/path?tenant=demo&TOKEN=a&tPt-ToKeN=b&ACCESS_TOKEN=c&refresh_token=d&auth=e&authorization=f&session=g&sessionid=h&code=i&auth-token=k&csrf_token=l#/route?tab=main&token=j")
	if !strings.Contains(got, "tenant=demo") || !strings.Contains(got, "#/route?tab=main") {
		t.Fatalf("应保留普通 query 与 hash 路由: %q", got)
	}
	if strings.Contains(got, "user") || strings.Contains(got, "pass") {
		t.Fatalf("应移除 URL userinfo: %q", got)
	}
	for _, sensitive := range []string{"TOKEN", "tpt-token", "ACCESS_TOKEN", "refresh_token", "auth=", "authorization=", "session=", "sessionid=", "code=", "auth-token", "csrf_token", "token=j"} {
		if strings.Contains(strings.ToLower(got), strings.ToLower(sensitive)) {
			t.Fatalf("敏感 URL 参数未移除 (%s): %q", sensitive, got)
		}
	}
	for _, malformed := range []string{"https://example.test/path?token=%ZZ", "https://example.test/path#route?session=%ZZ", "not a URL?token=must-not-leak"} {
		if sanitized := sanitizeStartURL(malformed); sanitized != "" {
			t.Fatalf("解析失败的 URL 必须 fail closed，got %q for %q", sanitized, malformed)
		}
	}
}

func TestRunPhase1PropagatesConcurrentIntermediateWriteError(t *testing.T) {
	root := t.TempDir()
	paths := getTranslatePaths(root)
	ensureTranslateLayout(root)
	if err := os.Mkdir(paths.StructuredStepsJson, 0755); err != nil {
		t.Fatal(err)
	}
	logger := NewLogger(paths.GenerateLog, nil)
	defer logger.Close()
	actions := make([]EnrichedAction, Phase1BatchSize+1)
	for i := range actions {
		actions[i] = EnrichedAction{Index: i + 1, Action: RawAction{Type: "click"}, Classification: ActionClassification{Category: "interactive"}}
	}
	steps, _, err := runPhase1(actions, nil, logger, NewLlmAuditor(paths.LlmAuditDir), paths)
	if err == nil || !strings.Contains(err.Error(), "structured_steps.json") {
		t.Fatalf("Phase 1 必须传播中间产物写入错误，steps=%d err=%v", len(steps), err)
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

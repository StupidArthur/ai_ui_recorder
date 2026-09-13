package translator

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	stdruntime "runtime"
	"sort"
	"strings"
	"time"
)

type Service struct {
	progressCh chan TranslateProgress
}

func NewService() *Service {
	return &Service{
		progressCh: make(chan TranslateProgress, 100),
	}
}

// ==================== 录制列表 ====================

func (s *Service) ListRuns(outputDir string) []RunInfo {
	if outputDir == "" {
		return []RunInfo{}
	}
	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return []RunInfo{}
	}
	var runs []RunInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "run_") {
			continue
		}
		fullPath := filepath.Join(outputDir, name)
		run := RunInfo{DirName: name, FullPath: fullPath, Title: "TPT"}
		if metaData, err := os.ReadFile(filepath.Join(fullPath, MetaFilename)); err == nil {
			var meta Meta
			if json.Unmarshal(metaData, &meta) == nil {
				run.StartedAt = meta.StartedAt
				run.ActionCount = meta.ActionCount
			}
		}
		paths := getTranslatePaths(fullPath)
		// 新版翻译以 completed.json 为成功标志；没有 attempt.json 的旧记录按历史产物兼容识别。
		newAttempt := fileExists(paths.AttemptStatus)
		legacyOutput := fileExists(paths.RunnableCaseMd) || fileExists(paths.CasesMd) || fileExists(paths.AgentsTxt) ||
			fileExists(filepath.Join(fullPath, TranslateLegacyPhase4CasesMdRel))
		if newAttempt {
			run.Translated = readTranslateStatus(paths.AttemptStatus) == "completed" &&
				readTranslateStatus(paths.CompletedStatus) == "completed"
		} else if legacyOutput {
			run.Translated = true
		}
		runs = append(runs, run)
	}
	sort.Slice(runs, func(i, j int) bool {
		return runs[i].DirName > runs[j].DirName
	})
	return runs
}

// ==================== 翻译 ====================

func (s *Service) StartTranslate(runDir string) (result TranslateResult) {
	var logger *Logger // 提前声明，供顶层 recover 在落盘时引用（即便 panic 发生在 logger 创建之后）
	attemptStatusPath := ""
	attemptStarted := false
	defer func() {
		recovered := recover()
		if recovered != nil {
			buf := make([]byte, 8192)
			n := stdruntime.Stack(buf, false)
			stack := string(buf[:n])
			// 顶层 recover：把 panic + 完整堆栈写进 generate.log（可能已关闭，best-effort）和 crash.log（必落盘）
			if logger != nil {
				logger.LogCrash("StartTranslate", recovered, stack)
			} else {
				WriteCrash("StartTranslate", recovered, stack)
			}
			result = TranslateResult{Success: false, Message: fmt.Sprintf("翻译过程发生异常: %T\n%s", recovered, stack), RunDir: runDir}
		}
		if err := finalizeAttemptFailure(attemptStatusPath, attemptStarted, result.Success, result.Message, recovered); err != nil {
			if logger != nil {
				logger.Error("写入翻译失败状态失败: " + sanitizeAttemptError(err.Error()))
			}
		}
	}()
	if runDir == "" {
		return TranslateResult{Success: false, Message: "未指定录制目录"}
	}
	if _, err := os.Stat(runDir); err != nil {
		return TranslateResult{Success: false, Message: "目录不存在: " + runDir}
	}
	if err := validateRecordingData(runDir); err != nil {
		return TranslateResult{Success: false, Message: "录制数据校验失败: " + err.Error(), RunDir: runDir}
	}

	// 尽早设置 crash.log 路径：保证后续任何阶段（含预处理、Phase 1~3、各 goroutine）的 panic 都能落盘
	SetCrashLogPath(filepath.Join(runDir, RunTranslateSubdir, "logs", "crash.log"))

	cfg := LoadActiveAIConfig()
	if err := cfg.Validate(); err != nil {
		return TranslateResult{Success: false, Message: "模型配置不可用: " + err.Error() + "，请先在「模型配置」中填写"}
	}

	transPaths := getTranslatePaths(runDir)
	if _, err := os.Stat(transPaths.TranslateDir); err == nil {
		historyDir := filepath.Join(runDir, "translate_history")
		if err := os.MkdirAll(historyDir, 0755); err != nil {
			return TranslateResult{Success: false, Message: "创建翻译历史目录失败: " + err.Error(), RunDir: runDir}
		}
		timestamp := time.Now().Format("2006-01-02_15-04-05.000")
		archiveName := "translate_" + timestamp
		if err := os.Rename(transPaths.TranslateDir, filepath.Join(historyDir, archiveName)); err != nil {
			return TranslateResult{Success: false, Message: "归档上一次翻译结果失败: " + err.Error(), RunDir: runDir}
		}
	}
	logger = NewLogger(transPaths.GenerateLog, s.progressCh)
	defer logger.Close()
	if err := writeAttemptRunning(transPaths.AttemptStatus); err != nil {
		return TranslateResult{Success: false, Message: "写入翻译状态失败: " + err.Error(), RunDir: runDir}
	}
	attemptStatusPath = transPaths.AttemptStatus
	attemptStarted = true

	logger.Info("========== AI 翻译开始 ==========")
	logger.Info("目标目录: " + runDir)
	logger.Info("模型: " + cfg.Model)
	logger.Info("Base URL: " + cfg.BaseURL)
	logger.Progress("init", "start", "正在初始化...", 0)

	client := NewLLMClient(cfg)

	logger.Info("正在探活 LLM...")
	logger.Progress("init", "ping", "正在测试 LLM 连接...", 2)
	if _, err := client.Ping(LlmPingTimeoutMs); err != nil {
		logger.Error("LLM 探活失败: " + err.Error())
		return TranslateResult{Success: false, Message: err.Error(), RunDir: runDir}
	}
	logger.Info("LLM 探活成功")
	logger.Progress("init", "done", "LLM 连接正常", 5)

	enrichedActions, meta, err := preprocess(runDir, logger)
	if err != nil {
		logger.Error("预处理失败: " + err.Error())
		return TranslateResult{Success: false, Message: "预处理失败: " + err.Error(), RunDir: runDir}
	}

	if len(enrichedActions) == 0 {
		return TranslateResult{Success: false, Message: "无有效操作数据", RunDir: runDir}
	}

	logger.Info(fmt.Sprintf("预处理完成，共 %d 条富化数据，开始 AI 翻译...", len(enrichedActions)))
	_ = meta

	if err := runWorkflow(runDir, enrichedActions, client, logger); err != nil {
		logger.Error("翻译失败: " + err.Error())
		return TranslateResult{Success: false, Message: err.Error(), RunDir: runDir}
	}
	if err := writeAttemptCompleted(transPaths.AttemptStatus); err != nil {
		logger.Error("写入翻译完成状态失败: " + sanitizeAttemptError(err.Error()))
		return TranslateResult{Success: false, Message: "写入翻译完成状态失败: " + err.Error(), RunDir: runDir}
	}
	if err := jsonWriteFile(transPaths.CompletedStatus, map[string]interface{}{
		"status":      "completed",
		"completedAt": time.Now().Format(time.RFC3339Nano),
	}); err != nil {
		logger.Error("写入完成状态失败: " + err.Error())
		return TranslateResult{Success: false, Message: "写入完成状态失败: " + err.Error(), RunDir: runDir}
	}
	logger.Progress("done", "complete", "翻译完成", 100)

	return TranslateResult{Success: true, Message: "翻译完成", RunDir: runDir}
}

var (
	sensitiveAssignmentRE = regexp.MustCompile(`(?i)(\b(?:tpt[-_]?token|access[-_]?token|refresh[-_]?token|id[-_]?token|token|auth|authorization|session(?:id|_id)?|code|client[-_]?secret|api[-_]?key|password|passwd|pwd)\b\s*[=:]\s*)("[^"]*"|'[^']*'|[^&\s,;]+)`)
	bearerCredentialRE    = regexp.MustCompile(`(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]+`)
	apiKeyRE              = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{12,}\b`)
	phoneNumberRE         = regexp.MustCompile(`\b1[3-9][0-9]{9}\b`)
)

func writeAttemptRunning(path string) error {
	return jsonWriteFile(path, map[string]interface{}{
		"status":    "running",
		"startedAt": time.Now().Format(time.RFC3339Nano),
	})
}

func writeAttemptCompleted(path string) error {
	return jsonWriteFile(path, map[string]interface{}{
		"status":      "completed",
		"completedAt": time.Now().Format(time.RFC3339Nano),
	})
}

func writeAttemptFailed(path string, failure error) error {
	message := "翻译失败；详细错误未写入 attempt 状态文件，请查看本地生成日志"
	if failure == nil {
		message = "翻译失败，未提供错误详情"
	}
	return jsonWriteFile(path, map[string]interface{}{
		"status":   "failed",
		"failedAt": time.Now().Format(time.RFC3339Nano),
		"error":    message,
	})
}

func finalizeAttemptFailure(path string, started, success bool, message string, recovered interface{}) error {
	if !started || success {
		return nil
	}
	failure := fmt.Errorf("%s", message)
	if recovered != nil {
		failure = attemptPanicError(recovered)
	}
	return writeAttemptFailed(path, failure)
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func attemptPanicError(value interface{}) error {
	return fmt.Errorf("翻译过程中发生异常（%T）", value)
}

func sanitizeAttemptError(message string) string {
	message = strings.Join(strings.Fields(message), " ")
	message = sensitiveAssignmentRE.ReplaceAllString(message, "$1[REDACTED]")
	message = bearerCredentialRE.ReplaceAllString(message, "$1[REDACTED]")
	message = apiKeyRE.ReplaceAllString(message, "[REDACTED_API_KEY]")
	message = phoneNumberRE.ReplaceAllString(message, "[REDACTED_PHONE]")
	return truncateRunes(message, 500)
}

func readTranslateStatus(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var status struct {
		Status string `json:"status"`
	}
	if json.Unmarshal(data, &status) != nil {
		return ""
	}
	return status.Status
}

// ==================== 进度订阅 ====================

func (s *Service) GetProgress() TranslateProgress {
	select {
	case p := <-s.progressCh:
		return p
	default:
		return TranslateProgress{}
	}
}

// ==================== 文件读取 ====================

func (s *Service) ReadFile(runDir, relPath string) string {
	if runDir == "" || relPath == "" {
		return ""
	}
	fullPath := filepath.Join(runDir, relPath)
	if !isPathSafe(runDir, fullPath) {
		return ""
	}
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return ""
	}
	return string(data)
}

func (s *Service) GetRunDetail(runDir string) map[string]interface{} {
	if runDir == "" {
		return map[string]interface{}{}
	}
	detail := map[string]interface{}{
		"runDir": runDir,
		"files":  s.listTranslateFiles(runDir),
	}
	if metaData, err := os.ReadFile(getMetaPath(runDir)); err == nil {
		var meta Meta
		if json.Unmarshal(metaData, &meta) == nil {
			detail["meta"] = meta
		}
	}
	return detail
}

func (s *Service) listTranslateFiles(runDir string) []map[string]string {
	transPaths := getTranslatePaths(runDir)
	files := []map[string]string{
		{"name": "Case 切片", "path": "translate/phase2/case_slices.json", "type": "json"},
		{"name": "覆盖核对", "path": "translate/phase2/coverage.md", "type": "markdown"},
		{"name": "执行用例", "path": "translate/phase3/agents.txt", "type": "text"},
		{"name": "录制生成版", "path": TranslatePhase3RunnableCaseMdRel, "type": "markdown"},
		{"name": "Case 表格 / 测试记录", "path": TranslatePhase3CasesMdRel, "type": "markdown"},
		{"name": "历史 Case 表格 / 测试记录", "path": TranslateLegacyPhase4CasesMdRel, "type": "markdown"},
		{"name": "结构化步骤", "path": "translate/phase1/structured_steps.json", "type": "json"},
		{"name": "翻译日志", "path": "translate/logs/generate.log", "type": "text"},
	}
	_ = transPaths
	result := make([]map[string]string, 0, len(files))
	for _, f := range files {
		fullPath := filepath.Join(runDir, f["path"])
		if _, err := os.Stat(fullPath); err == nil {
			result = append(result, f)
		}
	}
	return result
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// ==================== AI 配置 ====================

func (s *Service) ListConfigProfiles() ConfigProfiles {
	return ListConfigProfiles()
}

func (s *Service) SaveConfigProfile(name string, cfg AIConfig) SaveResult {
	return SaveConfigProfile(name, cfg)
}

func (s *Service) DeleteConfigProfile(name string) SaveResult {
	return DeleteConfigProfile(name)
}

func (s *Service) SetActiveConfigProfile(name string) SaveResult {
	return SetActiveConfigProfile(name)
}

// TestLLMConnection 用表单值测试连接；若 API Key 留空，则按 name 取已保存配置的 key。
func (s *Service) TestLLMConnection(name string, cfg AIConfig) TestResult {
	if strings.TrimSpace(cfg.APIKey) == "" {
		if stored, ok := FindAIConfigProfile(name); ok {
			cfg.APIKey = stored.APIKey
		}
	}
	if err := cfg.Validate(); err != nil {
		return TestResult{Success: false, Message: err.Error()}
	}
	client := NewLLMClient(cfg)
	reply, err := client.Ping(LlmPingTimeoutMs)
	if err != nil {
		return TestResult{Success: false, Message: err.Error()}
	}
	return TestResult{Success: true, Message: "连接成功", Reply: reply}
}

// ==================== Prompt 导入导出 ====================

func (s *Service) ListPrompts() []PromptInfo {
	return ListPrompts()
}

func (s *Service) ExportPrompt(phase string) PromptInfo {
	content, isCustom := LoadPrompt(phase)
	return PromptInfo{Phase: phase, Content: content, IsCustom: isCustom}
}

func (s *Service) ImportPrompt(phase, content string) SaveResult {
	if err := ImportPrompt(phase, content); err != nil {
		return SaveResult{Success: false, Message: err.Error()}
	}
	return SaveResult{Success: true, Message: "Prompt 已导入"}
}

func (s *Service) ResetPrompt(phase string) SaveResult {
	if err := ResetPrompt(phase); err != nil {
		return SaveResult{Success: false, Message: err.Error()}
	}
	return SaveResult{Success: true, Message: "已恢复内置 Prompt"}
}

// ==================== 路径安全 ====================

func isPathSafe(baseDir, targetPath string) bool {
	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		return false
	}
	absTarget, err := filepath.Abs(targetPath)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absBase, absTarget)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(rel, "..") && rel != "."
}

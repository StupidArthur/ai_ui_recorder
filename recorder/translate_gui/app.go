package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	progressCh chan TranslateProgress
}

func NewApp() *App {
	return &App{
		progressCh: make(chan TranslateProgress, 100),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ==================== 录制列表 ====================

func (a *App) ListRuns(outputDir string) []RunInfo {
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
		if _, err := os.Stat(getTranslatePaths(fullPath).AgentsTxt); err == nil {
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

func (a *App) StartTranslate(runDir string) (result TranslateResult) {
	var logger *Logger // 提前声明，供顶层 recover 在落盘时引用（即便 panic 发生在 logger 创建之后）
	defer func() {
		if r := recover(); r != nil {
			buf := make([]byte, 8192)
			n := stdruntime.Stack(buf, false)
			stack := string(buf[:n])
			// 顶层 recover：把 panic + 完整堆栈写进 generate.log（可能已关闭，best-effort）和 crash.log（必落盘）
			if logger != nil {
				logger.LogCrash("StartTranslate", r, stack)
			} else {
				WriteCrash("StartTranslate", r, stack)
			}
			result = TranslateResult{Success: false, Message: fmt.Sprintf("翻译过程发生异常: %v\n%s", r, stack), RunDir: runDir}
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

	// 尽早设置 crash.log 路径：保证后续任何阶段（含预处理、Phase 1~4、各 goroutine）的 panic 都能落盘
	SetCrashLogPath(filepath.Join(runDir, RunTranslateSubdir, "logs", "crash.log"))

	cfg := LoadAIConfig()
	if strings.TrimSpace(cfg.APIKey) == "" {
		return TranslateResult{Success: false, Message: "未配置 API Key，请先在「模型配置」中填写"}
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
	logger = NewLogger(transPaths.GenerateLog, a.progressCh)
	defer logger.Close()

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

	return TranslateResult{Success: true, Message: "翻译完成", RunDir: runDir}
}

// ==================== 进度订阅 ====================

func (a *App) GetProgress() TranslateProgress {
	select {
	case p := <-a.progressCh:
		return p
	default:
		return TranslateProgress{}
	}
}

// ==================== 文件读取 ====================

func (a *App) ReadFile(runDir, relPath string) string {
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

func (a *App) GetRunDetail(runDir string) map[string]interface{} {
	if runDir == "" {
		return map[string]interface{}{}
	}
	detail := map[string]interface{}{
		"runDir": runDir,
		"files":  a.listTranslateFiles(runDir),
	}
	if metaData, err := os.ReadFile(getMetaPath(runDir)); err == nil {
		var meta Meta
		if json.Unmarshal(metaData, &meta) == nil {
			detail["meta"] = meta
		}
	}
	return detail
}

func (a *App) listTranslateFiles(runDir string) []map[string]string {
	transPaths := getTranslatePaths(runDir)
	files := []map[string]string{
		{"name": "Case 切片", "path": "translate/phase2/case_slices.json", "type": "json"},
		{"name": "覆盖核对", "path": "translate/phase2/coverage.md", "type": "markdown"},
		{"name": "执行用例", "path": "translate/phase3/agents.txt", "type": "text"},
		{"name": "Case 表格 / 测试记录", "path": "translate/phase4/cases.md", "type": "markdown"},
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

// ==================== AI 配置 ====================

func (a *App) ListModels() []ModelInfo {
	return ListModels()
}

func (a *App) LoadAIConfig() AIConfig {
	return LoadAIConfig()
}

func (a *App) SaveAIConfig(cfg AIConfig) SaveResult {
	return SaveAIConfig(cfg)
}

func (a *App) TestLLMConnection(cfg AIConfig) TestResult {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return TestResult{Success: false, Message: "API Key 不能为空"}
	}
	client := NewLLMClient(cfg)
	reply, err := client.Ping(LlmPingTimeoutMs)
	if err != nil {
		return TestResult{Success: false, Message: err.Error()}
	}
	return TestResult{Success: true, Message: "连接成功", Reply: reply}
}

// ==================== Prompt 导入导出 ====================

func (a *App) ListPrompts() []PromptInfo {
	return ListPrompts()
}

func (a *App) ExportPrompt(phase string) PromptInfo {
	content, isCustom := LoadPrompt(phase)
	return PromptInfo{Phase: phase, Content: content, IsCustom: isCustom}
}

func (a *App) ImportPrompt(phase, content string) SaveResult {
	if err := ImportPrompt(phase, content); err != nil {
		return SaveResult{Success: false, Message: err.Error()}
	}
	return SaveResult{Success: true, Message: "Prompt 已导入"}
}

func (a *App) ResetPrompt(phase string) SaveResult {
	if err := ResetPrompt(phase); err != nil {
		return SaveResult{Success: false, Message: err.Error()}
	}
	return SaveResult{Success: true, Message: "已恢复内置 Prompt"}
}

// ==================== 工具方法 ====================

func (a *App) OpenInFolder(dir string) {
	if dir == "" {
		return
	}
	switch stdruntime.GOOS {
	case "windows":
		exec.Command("explorer", dir).Start()
	case "darwin":
		exec.Command("open", dir).Start()
	default:
		exec.Command("xdg-open", dir).Start()
	}
}

func (a *App) SelectDirectory() string {
	if a.ctx == nil {
		return ""
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择 output 目录",
	})
	if err != nil {
		return ""
	}
	return dir
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

// 防止未使用 import
var _ = time.Now

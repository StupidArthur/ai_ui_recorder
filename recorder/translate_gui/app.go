package main

import (
	"context"
	"os/exec"
	stdruntime "runtime"

	"translate_gui/internal/translator"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type RunInfo = translator.RunInfo
type TranslateResult = translator.TranslateResult
type TranslateProgress = translator.TranslateProgress
type ModelInfo = translator.ModelInfo
type AIConfig = translator.AIConfig
type SaveResult = translator.SaveResult
type TestResult = translator.TestResult
type PromptInfo = translator.PromptInfo

// App is the Wails adapter. Translation behavior lives in internal/translator.
type App struct {
	ctx     context.Context
	service *translator.Service
}

func NewApp() *App {
	return &App{service: translator.NewService()}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) ListRuns(outputDir string) []RunInfo {
	return a.service.ListRuns(outputDir)
}

func (a *App) StartTranslate(runDir string) TranslateResult {
	return a.service.StartTranslate(runDir)
}

func (a *App) GetProgress() TranslateProgress {
	return a.service.GetProgress()
}

func (a *App) ReadFile(runDir, relPath string) string {
	return a.service.ReadFile(runDir, relPath)
}

func (a *App) GetRunDetail(runDir string) map[string]interface{} {
	return a.service.GetRunDetail(runDir)
}

func (a *App) ListModels() []ModelInfo {
	return a.service.ListModels()
}

func (a *App) LoadAIConfig() AIConfig {
	return a.service.LoadAIConfig()
}

func (a *App) SaveAIConfig(cfg AIConfig) SaveResult {
	return a.service.SaveAIConfig(cfg)
}

func (a *App) TestLLMConnection(cfg AIConfig) TestResult {
	return a.service.TestLLMConnection(cfg)
}

func (a *App) ListPrompts() []PromptInfo {
	return a.service.ListPrompts()
}

func (a *App) ExportPrompt(phase string) PromptInfo {
	return a.service.ExportPrompt(phase)
}

func (a *App) ImportPrompt(phase, content string) SaveResult {
	return a.service.ImportPrompt(phase, content)
}

func (a *App) ResetPrompt(phase string) SaveResult {
	return a.service.ResetPrompt(phase)
}

func (a *App) OpenInFolder(dir string) {
	if dir == "" {
		return
	}
	switch stdruntime.GOOS {
	case "windows":
		_ = exec.Command("explorer", dir).Start()
	case "darwin":
		_ = exec.Command("open", dir).Start()
	default:
		_ = exec.Command("xdg-open", dir).Start()
	}
}

func (a *App) SelectDirectory() string {
	if a.ctx == nil {
		return ""
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择 output 目录"})
	if err != nil {
		return ""
	}
	return dir
}

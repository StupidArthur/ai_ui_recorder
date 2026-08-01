package main

import "time"

// ==================== 录制元信息 ====================

// Meta 录制元信息。JSON tag 对齐录制端 recorder.js 写入的字段名
// （totalActions / recordStartTime / recordEndTime / startPageTitle 等）。
type Meta struct {
	RunID         string `json:"runId"`
	StartedAt     string `json:"recordStartTime"`
	EndedAt       string `json:"recordEndTime"`
	InitialURL    string `json:"initialUrl"`
	TargetURL     string `json:"targetUrl"`
	Mode          string `json:"mode"`
	ActionCount   int    `json:"totalActions"`
	SnapshotCount int    `json:"snapshotCount"`
	Title         string `json:"startPageTitle"`
}

// ==================== 原始动作 ====================

type RawAction struct {
	Type      string                 `json:"type"`
	Key       string                 `json:"key,omitempty"`
	Timestamp int64                  `json:"timestamp"`
	Element   map[string]interface{} `json:"element"`
	FormState map[string]interface{} `json:"formStateDelta,omitempty"`
	URL       string                 `json:"url,omitempty"`
	Title     string                 `json:"title,omitempty"`
}

type ActionFile struct {
	Index  int       `json:"index"`
	Action RawAction `json:"action"`
}

// ==================== 预处理产物 ====================

type EnrichedAction struct {
	Index          int                    `json:"index"`
	Action         RawAction              `json:"action"`
	Diff           string                 `json:"diff"`
	Context        string                 `json:"context"`
	FormStateDelta map[string]interface{} `json:"formStateDelta"`
	Classification ActionClassification   `json:"classification"`
	IsNoise        bool                   `json:"isNoise"`
	MergedFrom     []int                  `json:"mergedFrom,omitempty"`
}

type ActionClassification struct {
	ElementType string   `json:"elementType"`
	Category    string   `json:"category"`
	Hints       []string `json:"hints"`
}

// ==================== Phase 1 结构化步骤 ====================

// StructuredStep Phase 1 产出的结构化步骤（与 JS 版 workflow 内部结构对齐）
type StructuredStep struct {
	ID                     int      `json:"index"`
	Status                 string   `json:"status"`
	Description            string   `json:"description"`
	UiChange               string   `json:"uiChange"`
	Page                   string   `json:"page"`
	Basis                  []string `json:"basis"`
	ActionKind             string   `json:"actionKind"`
	Target                 string   `json:"target"`
	InputText              string   `json:"inputText"`
	Key                    string   `json:"key"`
	AssertText             string   `json:"assertText"`
	Confidence             float64  `json:"confidence"`
	IntervalFromPreviousMs *int64   `json:"intervalFromPreviousMs"`
	URL                    string   `json:"url"`
	SourceType             string   `json:"sourceType"`
	IsSkip                 bool     `json:"-"`
	IsNoise                bool     `json:"-"`
	IsFallback             bool     `json:"-"`
}

// ==================== Phase 2 Case Slice ====================

type CaseSlice struct {
	StartStep int    `json:"startStep"`
	EndStep   int    `json:"endStep"`
	Consume   int    `json:"consume"`
	Name      string `json:"name"`
	Purpose   string `json:"purpose"`
}

// ==================== LLM 审计 ====================

type LlmAuditRecord struct {
	Phase       string    `json:"phase"`
	BatchIndex  int       `json:"batchIndex"`
	Success     bool      `json:"success"`
	InputChars  int       `json:"inputChars"`
	OutputChars int       `json:"outputChars"`
	DurationMs  int64     `json:"durationMs"`
	Error       string    `json:"error,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// ==================== 前端交互结构 ====================

type RunInfo struct {
	DirName     string `json:"dirName"`
	FullPath    string `json:"fullPath"`
	Title       string `json:"title"`
	StartedAt   string `json:"startedAt"`
	ActionCount int    `json:"actionCount"`
	Translated  bool   `json:"translated"`
}

type AIConfig struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

type SaveResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Path    string `json:"path"`
}

type TestResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Reply   string `json:"reply"`
}

type TranslateProgress struct {
	Phase   string `json:"phase"`
	Step    string `json:"step"`
	Detail  string `json:"detail"`
	Percent int    `json:"percent"`
}

type TranslateResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	RunDir  string `json:"runDir"`
}

type PromptInfo struct {
	Phase    string `json:"phase"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	IsCustom bool   `json:"isCustom"`
}

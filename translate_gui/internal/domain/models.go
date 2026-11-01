package domain

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
	Type              string                 `json:"type"`
	Key               string                 `json:"key,omitempty"`
	Timestamp         int64                  `json:"timestamp"`
	PreSnapshotIndex  *int                   `json:"preSnapshotIndex,omitempty"`
	PostSnapshotIndex *int                   `json:"postSnapshotIndex,omitempty"`
	Element           map[string]interface{} `json:"element"`
	FormState         map[string]interface{} `json:"formStateDelta,omitempty"`
	URL               string                 `json:"url,omitempty"`
	Title             string                 `json:"title,omitempty"`
}

type ActionFile struct {
	Index  int       `json:"index"`
	Action RawAction `json:"action"`
}

// ==================== 预处理产物 ====================

type EnrichedAction struct {
	Index            int                    `json:"index"`
	Action           RawAction              `json:"action"`
	Diff             string                 `json:"diff"`
	Context          string                 `json:"context"`
	FormStateDelta   map[string]interface{} `json:"formStateDelta"`
	TemporalEvidence *TemporalEvidence      `json:"temporalEvidence,omitempty"`
	Classification   ActionClassification   `json:"classification"`
	IsNoise          bool                   `json:"isNoise"`
	MergedFrom       []int                  `json:"mergedFrom,omitempty"`
}

// SnapshotTiming 记录一次 AX 快照实际采样的时间窗及其所属页面。
type SnapshotTiming struct {
	Index               int    `json:"index"`
	File                string `json:"file"`
	CaptureSequence     int64  `json:"captureSequence"`
	CaptureStartedAt    int64  `json:"captureStartedAt"`
	CaptureCompletedAt  int64  `json:"captureCompletedAt"`
	CaptureDurationMs   int64  `json:"captureDurationMs"`
	PageID              *int   `json:"pageId"`
	URL                 string `json:"url"`
	Title               string `json:"title"`
	Role                string `json:"role"`
	PreviousActionIndex int    `json:"previousActionIndex,omitempty"`
	NextActionIndex     int    `json:"nextActionIndex,omitempty"`
	IntervalStartAt     int64  `json:"intervalStartAt,omitempty"`
	IntervalEndAt       int64  `json:"intervalEndAt,omitempty"`
	BoundaryStatus      string `json:"boundaryStatus,omitempty"`
	Selection           string `json:"selection,omitempty"`
}

// TemporalEvidence 将物理事件时间与前后 AX 快照采样时间关联起来。
type TemporalEvidence struct {
	EventTimestamp                     int64           `json:"eventTimestamp"`
	PreviousEventTimestamp             int64           `json:"previousEventTimestamp,omitempty"`
	NextEventTimestamp                 int64           `json:"nextEventTimestamp,omitempty"`
	IntervalFromPreviousMs             *int64          `json:"intervalFromPreviousMs,omitempty"`
	PreSnapshot                        *SnapshotTiming `json:"preSnapshot,omitempty"`
	PostSnapshot                       *SnapshotTiming `json:"postSnapshot,omitempty"`
	PreSnapshotCompletedBeforeEvent    bool            `json:"preSnapshotCompletedBeforeEvent"`
	PostSnapshotInsideOperationInterval bool           `json:"postSnapshotInsideOperationInterval"`
	PostSnapshotBoundaryStatus         string          `json:"postSnapshotBoundaryStatus,omitempty"`
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
	InputSensitive         bool     `json:"inputSensitive,omitempty"`
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

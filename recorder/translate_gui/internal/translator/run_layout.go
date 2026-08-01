package translator

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// ==================== 目录名常量 ====================

const RunRecordSubdir = "record"
const RunTranslateSubdir = "translate"
const ScreenshotsSubdir = "screenshots"

// ==================== 相对路径（相对 runDir） ====================

const RecordActionsRel = RunRecordSubdir + "/actions"
const RecordSnapshotsRel = RunRecordSubdir + "/snapshots"
const RecordLogRel = RunRecordSubdir + "/recorder.log"

const TranslateGenerateLogRel = RunTranslateSubdir + "/logs/generate.log"
const TranslatePreprocessRel = RunTranslateSubdir + "/preprocess"
const TranslatePhase1Rel = RunTranslateSubdir + "/phase1"
const TranslatePhase1StepsJsonRel = TranslatePhase1Rel + "/structured_steps.json"
const TranslatePhase1StepsXmlRel = TranslatePhase1Rel + "/structured_steps.xml"
const TranslatePhase1LlmRawXmlRel = TranslatePhase1Rel + "/llm_raw_batches.xml"
const TranslatePhase1ErrorsJsonRel = TranslatePhase1Rel + "/errors.json"
const TranslatePhase2SlicesJsonRel = RunTranslateSubdir + "/phase2/case_slices.json"
const TranslatePhase2CoverageMdRel = RunTranslateSubdir + "/phase2/coverage.md"
const TranslatePhase3AgentsTxtRel = RunTranslateSubdir + "/phase3/agents.txt"
const TranslatePhase4CasesMdRel = RunTranslateSubdir + "/phase4/cases.md"
const TranslateLlmAuditRel = RunTranslateSubdir + "/llm_audit"

// ==================== 路径获取 ====================

func getMetaPath(runDir string) string {
	return filepath.Join(runDir, MetaFilename)
}

func readTargetURLFromMeta(runDir string) string {
	data, err := os.ReadFile(getMetaPath(runDir))
	if err != nil {
		return ""
	}
	var meta Meta
	if err := json.Unmarshal(data, &meta); err != nil {
		return ""
	}
	if initialURL := strings.TrimSpace(meta.InitialURL); initialURL != "" {
		return initialURL
	}
	return strings.TrimSpace(meta.TargetURL)
}

type RecordPaths struct {
	RecordDir      string
	ActionsDir     string
	SnapshotsDir   string
	ScreenshotsDir string
	RecorderLog    string
}

func getRecordPaths(runDir string) RecordPaths {
	recordDir := filepath.Join(runDir, RunRecordSubdir)
	return RecordPaths{
		RecordDir:      recordDir,
		ActionsDir:     filepath.Join(recordDir, "actions"),
		SnapshotsDir:   filepath.Join(recordDir, "snapshots"),
		ScreenshotsDir: filepath.Join(recordDir, ScreenshotsSubdir),
		RecorderLog:    filepath.Join(recordDir, "recorder.log"),
	}
}

type TranslatePaths struct {
	TranslateDir        string
	GenerateLog         string
	PreprocessDir       string
	DiffsDir            string
	EnrichedDir         string
	MergedDir           string
	Phase1Dir           string
	StructuredStepsJson string
	StructuredStepsXml  string
	LlmRawXml           string
	ErrorsJson          string
	Phase2Dir           string
	CaseSlicesJson      string
	CasesCoverageMd     string
	Phase3Dir           string
	AgentsTxt           string
	Phase4Dir           string
	CasesMd             string
	LlmAuditDir         string
}

func getTranslatePaths(runDir string) TranslatePaths {
	translateDir := filepath.Join(runDir, RunTranslateSubdir)
	preprocessDir := filepath.Join(translateDir, "preprocess")
	phase1Dir := filepath.Join(translateDir, "phase1")
	phase2Dir := filepath.Join(translateDir, "phase2")
	phase3Dir := filepath.Join(translateDir, "phase3")
	phase4Dir := filepath.Join(translateDir, "phase4")
	return TranslatePaths{
		TranslateDir:        translateDir,
		GenerateLog:         filepath.Join(translateDir, "logs", "generate.log"),
		PreprocessDir:       preprocessDir,
		DiffsDir:            filepath.Join(preprocessDir, "diffs"),
		EnrichedDir:         filepath.Join(preprocessDir, "enriched"),
		MergedDir:           filepath.Join(preprocessDir, "merged"),
		Phase1Dir:           phase1Dir,
		StructuredStepsJson: filepath.Join(phase1Dir, "structured_steps.json"),
		StructuredStepsXml:  filepath.Join(phase1Dir, "structured_steps.xml"),
		LlmRawXml:           filepath.Join(phase1Dir, "llm_raw_batches.xml"),
		ErrorsJson:          filepath.Join(phase1Dir, "errors.json"),
		Phase2Dir:           phase2Dir,
		CaseSlicesJson:      filepath.Join(phase2Dir, "case_slices.json"),
		CasesCoverageMd:     filepath.Join(phase2Dir, "coverage.md"),
		Phase3Dir:           phase3Dir,
		AgentsTxt:           filepath.Join(phase3Dir, "agents.txt"),
		Phase4Dir:           phase4Dir,
		CasesMd:             filepath.Join(phase4Dir, "cases.md"),
		LlmAuditDir:         filepath.Join(translateDir, "llm_audit"),
	}
}

func ensureTranslateLayout(runDir string) {
	p := getTranslatePaths(runDir)
	os.MkdirAll(filepath.Join(p.TranslateDir, "logs"), 0755)
	os.MkdirAll(p.DiffsDir, 0755)
	os.MkdirAll(p.EnrichedDir, 0755)
	os.MkdirAll(p.MergedDir, 0755)
	os.MkdirAll(p.Phase1Dir, 0755)
	os.MkdirAll(p.Phase2Dir, 0755)
	os.MkdirAll(p.Phase3Dir, 0755)
	os.MkdirAll(p.Phase4Dir, 0755)
	os.MkdirAll(p.LlmAuditDir, 0755)
}

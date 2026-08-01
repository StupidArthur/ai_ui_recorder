package main

// ==================== 录制数据规范 ====================

const MetaFilename = "meta.json"

// ==================== 预处理 ====================

const DiffTruncateThreshold = 3000
const DiffContextLines = 2
const ContextExcerptMaxSiblings = 5
const DblclickTimeThresholdMs = 500

// ==================== Phase 1 ====================

const Phase1BatchSize = 3
const EvidenceContextWindowSize = 10
const Phase1LlmRawMaxChars = 60000
const Phase1MaxTokens = 12000

// ==================== Phase 2 (slice-case) ====================

const Phase2CaseWindowSteps = 20
const Phase2CaseWindowMaxTokens = 4000
const Phase2GapTagLongGapMs = 45000
const Phase2AssertTextMaxChars = 200

// ==================== Phase 3 (format-agent-case) ====================

const Phase3MaxStepsPerSlice = 20

// ==================== Phase 4 (format-human-case) ====================

const Phase4MaxStepsPerSlice = 20

// ==================== Legacy 常量（旧 phase4.go 仍引用） ====================

const Phase4WindowSize = 20
const Phase4MaxTokens = 12000

// ==================== 滑动窗口安全 ====================

const SlidingWindowMaxRoundMultiplier = 2

// ==================== XML 解析 ====================

const XmlRegexStepBlockMaxChars = 4000
const XmlRegexActionObsMaxChars = 2000
const XmlRegexLogicalStepMaxChars = 2000
const XmlRegexMicroMaxChars = 500

// ==================== LLM ====================

const LlmMaxRetries = 3
const LlmBaseDelayMs = 2000
const LlmPingTimeoutMs = 10000
const LlmPingUserMessage = "你好"
const LlmPingFailMessage = "LLM 调用出错，请确认 config 或者网络。"

// ==================== Phase 1 并发 ====================

const Phase1Concurrency = 4

// ==================== 默认模型 ====================

const DefaultModelName = "MiniMax-M3"
const DefaultBaseUrl = "https://api.minimaxi.com/v1"

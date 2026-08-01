package translator

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

// ==================== 滑动窗口安全 ====================

const SlidingWindowMaxRoundMultiplier = 2

// ==================== XML 解析 ====================

const XmlRegexStepBlockMaxChars = 4000
const XmlRegexActionObsMaxChars = 2000

// ==================== Phase 1 并发 ====================

const Phase1Concurrency = 4

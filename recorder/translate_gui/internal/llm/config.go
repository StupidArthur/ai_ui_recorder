package llm

const (
	MaxRetries       = 3
	BaseDelayMs      = 2000
	PingTimeoutMs    = 10000
	PingUserMessage  = "你好"
	PingFailMessage  = "LLM 调用出错，请确认 config 或者网络。"
	DefaultModelName = "MiniMax-M3"
)

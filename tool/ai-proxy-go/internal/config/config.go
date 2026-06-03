package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	// DefaultListenAddr 是中转服务默认监听地址。
	DefaultListenAddr = "127.0.0.1:8787"
	// DefaultModel 是上游未显式指定模型时的默认值。
	DefaultModel = "Qwen/Qwen3-VL-235B-A22B-Instruct"
	// DefaultRequestsPerMinute 是每个 key+IP 的默认分钟限额。
	DefaultRequestsPerMinute = 30
	// DefaultUpstreamTimeoutSeconds 是请求上游的默认超时时间（秒）。
	DefaultUpstreamTimeoutSeconds = 120
)

// Config 表示代理服务配置。
type Config struct {
	ListenAddr string `json:"listenAddr"`
	Enabled    bool   `json:"enabled"`
	Upstream   struct {
		BaseURL        string `json:"baseUrl"`
		APIKey         string `json:"apiKey"`
		Model          string `json:"model"`
		TimeoutSeconds int    `json:"timeoutSeconds"`
	} `json:"upstream"`
	TrialKeys []string `json:"trialKeys"`
	RateLimit struct {
		RequestsPerMinute int `json:"requestsPerMinute"`
	} `json:"rateLimit"`
}

// Load 从配置文件加载并校验配置。
// 当 configPath 为空时，会按候选路径顺序自动查找。
func Load(configPath string) (Config, string, error) {
	paths := candidatePaths(configPath)

	var (
		rawPath string
		rawData []byte
	)
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err == nil {
			rawPath = p
			rawData = data
			break
		}
	}
	if rawPath == "" {
		return Config{}, "", fmt.Errorf("未找到配置文件，请创建: %s", strings.Join(paths, " | "))
	}

	cfg := defaultConfig()
	if err := json.Unmarshal(rawData, &cfg); err != nil {
		return Config{}, "", fmt.Errorf("配置文件解析失败(%s): %w", rawPath, err)
	}
	if err := validate(&cfg); err != nil {
		return Config{}, "", err
	}
	return cfg, rawPath, nil
}

func defaultConfig() Config {
	cfg := Config{
		ListenAddr: DefaultListenAddr,
		Enabled:    true,
	}
	cfg.Upstream.Model = DefaultModel
	cfg.Upstream.TimeoutSeconds = DefaultUpstreamTimeoutSeconds
	cfg.RateLimit.RequestsPerMinute = DefaultRequestsPerMinute
	return cfg
}

func validate(cfg *Config) error {
	cfg.ListenAddr = strings.TrimSpace(cfg.ListenAddr)
	cfg.Upstream.BaseURL = strings.TrimSpace(cfg.Upstream.BaseURL)
	cfg.Upstream.APIKey = strings.TrimSpace(cfg.Upstream.APIKey)
	cfg.Upstream.Model = strings.TrimSpace(cfg.Upstream.Model)

	if cfg.ListenAddr == "" {
		return fmt.Errorf("listenAddr 不能为空")
	}
	if cfg.Upstream.BaseURL == "" {
		return fmt.Errorf("upstream.baseUrl 不能为空")
	}
	if cfg.Upstream.APIKey == "" {
		return fmt.Errorf("upstream.apiKey 不能为空")
	}
	if cfg.Upstream.Model == "" {
		cfg.Upstream.Model = DefaultModel
	}
	if cfg.Upstream.TimeoutSeconds <= 0 {
		cfg.Upstream.TimeoutSeconds = DefaultUpstreamTimeoutSeconds
	}
	if len(cfg.TrialKeys) == 0 {
		return fmt.Errorf("trialKeys 至少提供 1 个 key")
	}
	if cfg.RateLimit.RequestsPerMinute <= 0 {
		cfg.RateLimit.RequestsPerMinute = DefaultRequestsPerMinute
	}
	return nil
}

func candidatePaths(configPath string) []string {
	if strings.TrimSpace(configPath) != "" {
		return []string{configPath}
	}
	paths := []string{
		filepath.Join("config", "proxy.local.json"),
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		paths = append(paths, filepath.Join(exeDir, "config", "proxy.local.json"))
	}

	seen := map[string]struct{}{}
	unique := make([]string, 0, len(paths))
	for _, p := range paths {
		abs, err := filepath.Abs(p)
		if err != nil {
			abs = p
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		unique = append(unique, abs)
	}
	return unique
}

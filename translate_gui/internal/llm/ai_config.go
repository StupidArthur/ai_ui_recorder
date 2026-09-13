package llm

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ==================== 协议 ====================

// Protocol 模型调用协议，取值见下方常量。
type Protocol string

const (
	// ProtocolChatCompletions OpenAI 标准 Chat Completions（POST {baseUrl}/chat/completions）
	ProtocolChatCompletions Protocol = "chat_completions"
	// ProtocolResponses OpenAI 标准 Responses（POST {baseUrl}/responses）
	ProtocolResponses Protocol = "responses"
)

// NormalizeProtocol 归一化协议名，非法/空值回退到 chat_completions。
func NormalizeProtocol(p string) Protocol {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "responses", "response":
		return ProtocolResponses
	default:
		return ProtocolChatCompletions
	}
}

// ==================== 配置结构 ====================

// AIConfig 一个模型配置档（含 API Key，落盘用）。
type AIConfig struct {
	Name            string `json:"name,omitempty"`
	Protocol        string `json:"protocol"`
	BaseURL         string `json:"baseUrl"`
	APIKey          string `json:"apiKey"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

// ConfigProfileInfo 回传前端的配置档信息（不含 key 明文）。
type ConfigProfileInfo struct {
	Name            string `json:"name"`
	Protocol        string `json:"protocol"`
	BaseURL         string `json:"baseUrl"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
	HasKey          bool   `json:"hasKey"`
}

// ConfigProfiles 配置档列表 + 当前选用档。
type ConfigProfiles struct {
	Active   string              `json:"active"`
	Profiles []ConfigProfileInfo `json:"profiles"`
}

// SaveResult 配置写操作结果。
type SaveResult struct {
	Success bool
	Message string
	Path    string
}

// configStore 落盘结构。
type configStore struct {
	Active   string     `json:"active"`
	Profiles []AIConfig `json:"profiles"`
}

// ==================== 路径 ====================

// productDirName 产品在用户系统目录下的配置目录名。
const productDirName = ".ui_translator"

// configDir 返回 ~/.ui_translator（用户主目录）。主目录不可用时回退到当前目录。
func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return productDirName
	}
	return filepath.Join(home, productDirName)
}

func configPath() string {
	return filepath.Join(configDir(), "ai.local.json")
}

// ==================== 加载 / 保存 ====================

func loadStore() configStore {
	var store configStore
	data, err := os.ReadFile(configPath())
	if err != nil {
		return store
	}
	_ = json.Unmarshal(data, &store)
	return store
}

func (s configStore) find(name string) (int, bool) {
	for i := range s.Profiles {
		if s.Profiles[i].Name == name {
			return i, true
		}
	}
	return -1, false
}

// LoadActiveAIConfig 读取当前选用档；无 active 或不存在时返回零值。
func LoadActiveAIConfig() AIConfig {
	store := loadStore()
	if store.Active == "" {
		return AIConfig{}
	}
	if i, ok := store.find(store.Active); ok {
		cfg := store.Profiles[i]
		cfg.Protocol = string(NormalizeProtocol(cfg.Protocol))
		return cfg
	}
	return AIConfig{}
}

// FindProfile 按名字取完整配置（供测试连接时补 key）。
func FindProfile(name string) (AIConfig, bool) {
	store := loadStore()
	if i, ok := store.find(strings.TrimSpace(name)); ok {
		return store.Profiles[i], true
	}
	return AIConfig{}, false
}

// ListConfigProfiles 返回全部配置档（不含 key）。
func ListConfigProfiles() ConfigProfiles {
	store := loadStore()
	out := ConfigProfiles{
		Active:   store.Active,
		Profiles: make([]ConfigProfileInfo, 0, len(store.Profiles)),
	}
	for _, p := range store.Profiles {
		out.Profiles = append(out.Profiles, ConfigProfileInfo{
			Name:            p.Name,
			Protocol:        string(NormalizeProtocol(p.Protocol)),
			BaseURL:         p.BaseURL,
			Model:           p.Model,
			ReasoningEffort: p.ReasoningEffort,
			HasKey:          strings.TrimSpace(p.APIKey) != "",
		})
	}
	return out
}

func writeStore(store configStore) error {
	if err := os.MkdirAll(configDir(), 0755); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(store, "", "  ")
	data = append(data, '\n')
	return os.WriteFile(configPath(), data, 0644)
}

// SaveConfigProfile 新增或覆盖配置档；key 留空则保留旧 key；保存后设为 active。
func SaveConfigProfile(name string, cfg AIConfig) SaveResult {
	name = strings.TrimSpace(name)
	if name == "" {
		return SaveResult{Success: false, Message: "配置名称不能为空"}
	}

	store := loadStore()
	cfg.Name = name
	cfg.Protocol = string(NormalizeProtocol(cfg.Protocol))
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.Model = strings.TrimSpace(cfg.Model)
	cfg.ReasoningEffort = strings.TrimSpace(cfg.ReasoningEffort)

	if i, ok := store.find(name); ok {
		if strings.TrimSpace(cfg.APIKey) == "" {
			cfg.APIKey = store.Profiles[i].APIKey
		} else {
			cfg.APIKey = strings.TrimSpace(cfg.APIKey)
		}
		store.Profiles[i] = cfg
	} else {
		cfg.APIKey = strings.TrimSpace(cfg.APIKey)
		store.Profiles = append(store.Profiles, cfg)
	}
	store.Active = name

	if err := writeStore(store); err != nil {
		return SaveResult{Success: false, Message: "写入配置失败: " + err.Error()}
	}
	return SaveResult{Success: true, Message: "配置已保存", Path: configPath()}
}

// DeleteConfigProfile 删除配置档；若删除的是 active，则顺延到首个剩余档或清空。
func DeleteConfigProfile(name string) SaveResult {
	name = strings.TrimSpace(name)
	store := loadStore()
	i, ok := store.find(name)
	if !ok {
		return SaveResult{Success: false, Message: "配置不存在: " + name}
	}

	store.Profiles = append(store.Profiles[:i], store.Profiles[i+1:]...)
	if store.Active == name {
		store.Active = ""
		if len(store.Profiles) > 0 {
			store.Active = store.Profiles[0].Name
		}
	}

	if err := writeStore(store); err != nil {
		return SaveResult{Success: false, Message: "写入配置失败: " + err.Error()}
	}
	return SaveResult{Success: true, Message: "配置已删除", Path: configPath()}
}

// SetActiveConfigProfile 切换当前配置档。
func SetActiveConfigProfile(name string) SaveResult {
	name = strings.TrimSpace(name)
	store := loadStore()
	if _, ok := store.find(name); !ok {
		return SaveResult{Success: false, Message: "配置不存在: " + name}
	}
	store.Active = name
	if err := writeStore(store); err != nil {
		return SaveResult{Success: false, Message: "写入配置失败: " + err.Error()}
	}
	return SaveResult{Success: true, Message: "已切换当前配置", Path: configPath()}
}

// ==================== 校验 ====================

// Validate 校验运行时必需字段。
func (c AIConfig) Validate() error {
	if strings.TrimSpace(c.BaseURL) == "" {
		return errors.New("Base URL 不能为空")
	}
	if strings.TrimSpace(c.Model) == "" {
		return errors.New("模型名不能为空")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return errors.New("API Key 不能为空")
	}
	return nil
}

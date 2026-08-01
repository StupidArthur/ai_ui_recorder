package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// ==================== 配置文件路径 ====================

func configDir() string {
	exe, err := os.Executable()
	if err == nil {
		return filepath.Join(filepath.Dir(exe), "config")
	}
	return "config"
}

func aiConfigPath() string {
	return filepath.Join(configDir(), "ai.local.json")
}

func promptsConfigDir() string {
	return filepath.Join(configDir(), "prompts")
}

// ==================== 加载 ====================

func LoadAIConfig() AIConfig {
	cfg := AIConfig{
		BaseURL: "",
		APIKey:  "",
		Model:   DefaultModelName,
	}

	data, err := os.ReadFile(aiConfigPath())
	if err == nil {
		var raw map[string]string
		if json.Unmarshal(data, &raw) == nil {
			if v := strings.TrimSpace(raw["baseUrl"]); v != "" {
				cfg.BaseURL = v
			}
			if v := strings.TrimSpace(raw["apiKey"]); v != "" {
				cfg.APIKey = v
			}
			if v := strings.TrimSpace(raw["model"]); v != "" {
				if strings.Contains(strings.ToLower(v), "highspeed") {
					cfg.Model = DefaultModelName
				} else {
					cfg.Model = v
				}
			}
		}
	}
	return cfg
}

// ==================== 保存 ====================

func SaveAIConfig(cfg AIConfig) SaveResult {
	dir := configDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return SaveResult{Success: false, Message: "创建配置目录失败: " + err.Error()}
	}

	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		if existing, err := os.ReadFile(aiConfigPath()); err == nil {
			var prev map[string]string
			if json.Unmarshal(existing, &prev) == nil {
				if v := strings.TrimSpace(prev["apiKey"]); v != "" {
					apiKey = v
				}
			}
		}
	}

	raw := map[string]string{
		"baseUrl": strings.TrimSpace(cfg.BaseURL),
		"apiKey":  apiKey,
		"model":   strings.TrimSpace(cfg.Model),
	}
	data, _ := json.MarshalIndent(raw, "", "  ")
	data = append(data, '\n')

	path := aiConfigPath()
	if err := os.WriteFile(path, data, 0644); err != nil {
		return SaveResult{Success: false, Message: "写入配置失败: " + err.Error()}
	}
	return SaveResult{Success: true, Message: "配置已保存", Path: path}
}

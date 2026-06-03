package security

import (
	"net/http"
	"strings"
)

// Authenticator 负责 trial key 校验。
type Authenticator struct {
	allowed map[string]struct{}
}

// NewAuthenticator 根据配置中的 trial keys 构建校验器。
func NewAuthenticator(keys []string) *Authenticator {
	allowed := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		normalized := strings.TrimSpace(key)
		if normalized == "" {
			continue
		}
		allowed[normalized] = struct{}{}
	}
	return &Authenticator{allowed: allowed}
}

// IsAllowed 判断传入 key 是否允许访问。
func (a *Authenticator) IsAllowed(key string) bool {
	_, ok := a.allowed[strings.TrimSpace(key)]
	return ok
}

// ParseBearerToken 从 Authorization 中提取 Bearer token。
func ParseBearerToken(header string) string {
	raw := strings.TrimSpace(header)
	if raw == "" {
		return ""
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(raw, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(raw, prefix))
}

// TokenFromRequest 从 HTTP 请求中提取客户端试用 key。
// 优先 Header: Authorization，再回退查询参数 apiKey（仅用于调试）。
func TokenFromRequest(r *http.Request) string {
	token := ParseBearerToken(r.Header.Get("Authorization"))
	if token != "" {
		return token
	}
	return strings.TrimSpace(r.URL.Query().Get("apiKey"))
}

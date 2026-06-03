package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ai-ui-recorder/tool/ai-proxy-go/internal/config"
	"ai-ui-recorder/tool/ai-proxy-go/internal/proxy"
	"ai-ui-recorder/tool/ai-proxy-go/internal/security"
)

// Server 是代理服务实例，聚合配置、鉴权、限流与转发能力。
type Server struct {
	cfg     config.Config
	auth    *security.Authenticator
	limiter *security.FixedWindowLimiter
	proxy   *proxy.ChatProxy
	httpSrv *http.Server
}

type apiChatRequest struct {
	APIKey       string `json:"apiKey"`
	Prompt       string `json:"prompt"`
	Model        string `json:"model"`
	SystemPrompt string `json:"systemPrompt"`
}

// NewServer 创建 HTTP 服务实例。
func NewServer(cfg config.Config) *Server {
	s := &Server{
		cfg:     cfg,
		auth:    security.NewAuthenticator(cfg.TrialKeys),
		limiter: security.NewFixedWindowLimiter(cfg.RateLimit.RequestsPerMinute),
		proxy:   proxy.NewChatProxy(cfg),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/chat", s.handleAPIChat)
	mux.HandleFunc("/v1/chat/completions", s.handleCompletions)

	s.httpSrv = &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           loggingMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return s
}

// Start 启动 HTTP 服务。
func (s *Server) Start() error {
	log.Printf("[proxy] listening on http://%s", s.cfg.ListenAddr)
	return s.httpSrv.ListenAndServe()
}

// Shutdown 优雅关闭服务。
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpSrv.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"enabled":  s.cfg.Enabled,
		"upstream": s.cfg.Upstream.BaseURL,
		"model":    s.cfg.Upstream.Model,
	})
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	indexPath, err := resolveWebPath("index.html")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	data, err := os.ReadFile(indexPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "页面文件读取失败"})
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleAPIChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	if !s.cfg.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "proxy disabled"})
		return
	}

	var req apiChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json body"})
		return
	}

	token := strings.TrimSpace(req.APIKey)
	if token == "" || !s.auth.IsAllowed(token) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid trial key"})
		return
	}
	clientID := buildClientID(token, clientIP(r))
	if ok, reason := s.limiter.Allow(clientID, time.Now()); !ok {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": reason})
		return
	}

	payload, err := s.proxy.BuildSimpleStreamPayload(req.Prompt, req.Model, req.SystemPrompt)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	s.forwardWithRawBody(w, r, payload)
}

func (s *Server) handleCompletions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	if !s.cfg.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "proxy disabled"})
		return
	}
	token := security.TokenFromRequest(r)
	if token == "" || !s.auth.IsAllowed(token) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid trial key"})
		return
	}
	clientID := buildClientID(token, clientIP(r))
	if ok, reason := s.limiter.Allow(clientID, time.Now()); !ok {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": reason})
		return
	}

	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "failed to read body"})
		return
	}
	s.forwardWithRawBody(w, r, rawBody)
}

func (s *Server) forwardWithRawBody(w http.ResponseWriter, r *http.Request, rawBody []byte) {
	upstreamResp, err := s.proxy.ForwardCompletions(r.Context(), rawBody)
	if err != nil {
		log.Printf("[proxy] forward error: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "upstream request failed"})
		return
	}
	defer upstreamResp.Body.Close()

	if isStreamResponse(upstreamResp.Header.Get("Content-Type")) {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(upstreamResp.StatusCode)
		if err := proxy.CopyStream(w, upstreamResp.Body); err != nil {
			log.Printf("[proxy] stream copy ended: %v", err)
		}
		return
	}

	forwardNonStream(w, upstreamResp)
}

func forwardNonStream(w http.ResponseWriter, upstreamResp *http.Response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(upstreamResp.StatusCode)
	if _, err := io.Copy(w, upstreamResp.Body); err != nil {
		log.Printf("[proxy] copy response failed: %v", err)
	}
}

func writeJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func isStreamResponse(contentType string) bool {
	return strings.Contains(strings.ToLower(contentType), "text/event-stream")
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func buildClientID(token string, ip string) string {
	return fmt.Sprintf("%s@%s", token, ip)
}

func resolveWebPath(filename string) (string, error) {
	candidates := []string{
		filepath.Join("web", filename),
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates, filepath.Join(exeDir, "web", filename))
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			abs, absErr := filepath.Abs(candidate)
			if absErr != nil {
				return candidate, nil
			}
			return abs, nil
		}
	}
	return "", fmt.Errorf("未找到 web 资源: %s", filename)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("[http] %s %s (%dms)", r.Method, r.URL.Path, time.Since(start).Milliseconds())
	})
}

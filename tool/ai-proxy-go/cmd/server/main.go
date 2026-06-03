package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ai-ui-recorder/tool/ai-proxy-go/internal/config"
	httpserver "ai-ui-recorder/tool/ai-proxy-go/internal/http"
)

// runServer 是程序主流程函数。
// 按项目约定，配置通过函数参数传入，而非命令行参数。
func runServer(configPath string) error {
	cfg, cfgPath, err := config.Load(configPath)
	if err != nil {
		return err
	}
	log.Printf("[proxy] config loaded: %s", cfgPath)

	srv := httpserver.NewServer(cfg)

	errCh := make(chan error, 1)
	go func() {
		if startErr := srv.Start(); startErr != nil && !errors.Is(startErr, context.Canceled) {
			errCh <- startErr
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Printf("[proxy] received signal: %s", sig.String())
	case startErr := <-errCh:
		return startErr
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

func main() {
	// 为空时自动查找：
	// 1) ./config/proxy.local.json
	// 2) {exeDir}/config/proxy.local.json
	const configPath = ""
	if err := runServer(configPath); err != nil {
		log.Fatalf("[proxy] start failed: %v", err)
	}
}

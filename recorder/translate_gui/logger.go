package main

import (
	"fmt"
	"os"
	"path/filepath"
	stdruntime "runtime"
	"sync"
	"time"
)

// Logger 日志器，同时写文件和内存（供前端读取）
type Logger struct {
	mu         sync.Mutex
	file       *os.File
	progressCh chan TranslateProgress
}

func NewLogger(logPath string, progressCh chan TranslateProgress) *Logger {
	os.MkdirAll(filepath.Dir(logPath), 0755)
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		f = nil
	}
	return &Logger{file: f, progressCh: progressCh}
}

func (l *Logger) write(level, msg string) {
	ts := time.Now().Format("15:04:05")
	line := fmt.Sprintf("[%s] %s %s", ts, level, msg)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		l.file.WriteString(line + "\n")
	}
}

func (l *Logger) Info(msg string) {
	l.write("INFO", msg)
}

func (l *Logger) Warn(msg string) {
	l.write("WARN", msg)
}

func (l *Logger) Error(msg string) {
	l.write("ERROR", msg)
}

func (l *Logger) Infof(format string, args ...interface{}) {
	l.Info(fmt.Sprintf(format, args...))
}

func (l *Logger) Errorf(format string, args ...interface{}) {
	l.Error(fmt.Sprintf(format, args...))
}

// Progress 发送进度
func (l *Logger) Progress(phase, step, detail string, percent int) {
	if l.progressCh != nil {
		select {
		case l.progressCh <- TranslateProgress{Phase: phase, Step: step, Detail: detail, Percent: percent}:
		default:
		}
	}
}

func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		l.file.Close()
	}
}

// ==================== 崩溃兜底 ====================

// gCrashLogPath 独立的崩溃日志路径（translate/logs/crash.log）。
// 与 generate.log 分离：即便 logger 自身未初始化或文件已关闭，panic 仍能落盘。
var gCrashLogPath string

// SetCrashLogPath 设置崩溃日志路径，应在 StartTranslate 最早处调用。
func SetCrashLogPath(p string) {
	gCrashLogPath = p
}

// WriteCrash 把 panic 值 + 完整堆栈写入独立 crash.log（追加模式，开即写即关），
// 同时输出到 stderr。即使 generate.log 因 logger 未初始化/已关闭而写不进去，这里也能保住现场。
func WriteCrash(label string, r interface{}, stack string) {
	msg := fmt.Sprintf("==== %s ====\n[CRASH/%s] panic: %v\n%s\n",
		time.Now().Format("2006-01-02 15:04:05"), label, r, stack)
	if gCrashLogPath != "" {
		os.MkdirAll(filepath.Dir(gCrashLogPath), 0755)
		if f, err := os.OpenFile(gCrashLogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
			f.WriteString(msg)
			f.Close()
		}
	}
	// stderr：开发调试时可见；打包后一般不可见，但不影响 crash.log
	fmt.Fprintln(os.Stderr, msg)
}

// LogCrash 同时写 generate.log（经 logger）和 crash.log（经 WriteCrash）。
func (l *Logger) LogCrash(label string, r interface{}, stack string) {
	if l != nil {
		l.Error(fmt.Sprintf("[CRASH/%s] panic 已捕获: %v\n%s", label, r, stack))
	}
	WriteCrash(label, r, stack)
}

// SafeGo 启动一个带 panic 兜底的 goroutine。
// 任何 panic 都会被捕获并写入 generate.log + crash.log，避免未 recover 的 goroutine panic
// 直接拖垮整个 Wails 进程（Go 中未 recover 的 goroutine panic 会让整个程序退出）。
func SafeGo(logger *Logger, label string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				buf := make([]byte, 8192)
				n := stdruntime.Stack(buf, false)
				stack := string(buf[:n])
				if logger != nil {
					logger.LogCrash(label, r, stack)
				} else {
					WriteCrash(label, r, stack)
				}
			}
		}()
		fn()
	}()
}

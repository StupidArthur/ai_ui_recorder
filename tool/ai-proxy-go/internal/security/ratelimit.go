package security

import (
	"fmt"
	"sync"
	"time"
)

type bucket struct {
	windowStart time.Time
	count       int
	lastSeen    time.Time
}

// FixedWindowLimiter 提供按 key 的固定窗口限流。
// 对本工具场景，固定窗口实现简单、可读性好，足够满足试用防滥用需求。
type FixedWindowLimiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	buckets  map[string]*bucket
	cleanupN int
	hits     int
}

// NewFixedWindowLimiter 创建限流器。
func NewFixedWindowLimiter(limitPerMinute int) *FixedWindowLimiter {
	if limitPerMinute <= 0 {
		limitPerMinute = 30
	}
	return &FixedWindowLimiter{
		limit:    limitPerMinute,
		window:   time.Minute,
		buckets:  make(map[string]*bucket),
		cleanupN: 100,
	}
}

// Allow 检查并占用一个请求配额。
func (l *FixedWindowLimiter) Allow(key string, now time.Time) (bool, string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.hits++
	if l.hits%l.cleanupN == 0 {
		l.cleanup(now)
	}

	b, ok := l.buckets[key]
	if !ok {
		l.buckets[key] = &bucket{
			windowStart: now,
			count:       1,
			lastSeen:    now,
		}
		return true, ""
	}

	if now.Sub(b.windowStart) >= l.window {
		b.windowStart = now
		b.count = 1
		b.lastSeen = now
		return true, ""
	}

	if b.count >= l.limit {
		wait := l.window - now.Sub(b.windowStart)
		if wait < 0 {
			wait = 0
		}
		return false, fmt.Sprintf("请求过于频繁，请 %.0f 秒后重试", wait.Seconds())
	}

	b.count++
	b.lastSeen = now
	return true, ""
}

func (l *FixedWindowLimiter) cleanup(now time.Time) {
	ttl := 3 * l.window
	for key, b := range l.buckets {
		if now.Sub(b.lastSeen) > ttl {
			delete(l.buckets, key)
		}
	}
}

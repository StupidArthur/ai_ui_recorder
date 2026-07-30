# Wails 后端模式

本章节定义 GUI 工具 Go 后端的标准分层、Wails 绑定、测试、错误处理，以及前端如何衔接 Wails 后端。

## 标准文件结构

```
项目根/
├── main.go              Wails 入口 + 窗口配置
├── app.go               App struct + 暴露给前端的方法
├── <domain>.go          核心业务逻辑（纯函数，可独立测试）
├── <domain>_test.go     核心逻辑的单元测试
└── frontend/            前端（见 shared/前端架构模式）
```

### 分层原则

| 文件 | 职责 | 依赖 |
|------|------|------|
| `main.go` | 启动 Wails、配置窗口 | app.go |
| `app.go` | 暴露给前端的方法，调用核心逻辑 | 核心逻辑 + Wails runtime |
| `<domain>.go` | 纯业务逻辑，不依赖 Wails | 仅标准库 |
| `<domain>_test.go` | 测试核心逻辑 | 仅标准库 + testing |

**关键**：核心逻辑文件（如 `skillManager.go`）**不 import Wails**，保证可独立 `go test`。

## main.go 标准模板

```go
package main

import (
	"embed"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:     "工具名称",
		Width:     1180,
		Height:    780,
		MinWidth:  920,
		MinHeight: 620,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{app},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
```

**规范**：
- 背景色白色 `RGBA{255,255,255,1}`（浅色主题）
- 窗口最小尺寸 920×620
- `Bind` 只绑定一个 app 实例

## app.go 标准模板

```go
package main

import (
	"context"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// 以下为暴露给前端的方法，命名用 PascalCase（Wails 会生成同名 JS 方法）

// GetXxx 获取数据
func (a *App) GetXxx(id string) XxxResult {
	return getXxx(id)  // 调用核心逻辑
}

// PickFile 弹出文件选择框
func (a *App) PickFile() string {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "ZIP", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return ""
	}
	return path
}

// SaveFile 弹出保存框
func (a *App) SaveFile(defaultName string) string {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "ZIP", Pattern: "*.zip"},
		},
	})
	if err != nil || path == "" {
		return ""
	}
	return path
}

// OpenInFolder 打开系统资源管理器（跨平台）
func (a *App) OpenInFolder(dir string) {
	switch stdruntime.GOOS {
	case "windows":
		exec.Command("explorer", dir).Start()
	case "darwin":
		exec.Command("open", dir).Start()
	default:
		exec.Command("xdg-open", dir).Start()
	}
}
```

### 方法命名规范

| 模式 | 含义 | 返回 |
|------|------|------|
| `GetXxx` | 获取数据 | 结构体 |
| `ListXxx` | 列出集合 | 数组 |
| `PickXxx` | 弹框选择 | 字符串（路径） |
| `InstallXxx` | 安装/创建 | 结果结构体 |
| `UninstallXxx` | 卸载/删除 | bool |
| `ExportXxx` | 导出 | 字符串（路径） |
| `OpenInFolder` | 打开目录 | void |

## 核心逻辑层规范

### 数据结构定义

```go
type Skill struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Dir         string            `json:"dir"`
	Files       []FileInfo        `json:"files"`
}

type FileInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`  // "file" | "dir"
}
```

**规范**：
- 所有结构体字段必须加 `json` tag
- 返回给前端的数据用结构体，不用 map
- 错误信息放在结果结构体的 `Error` 字段，不抛 panic

### 错误处理模式

```go
type InstallResult struct {
	Success   bool     `json:"success"`
	Installed []string `json:"installed"`
	Error     string   `json:"error"`  // 错误信息放这里
}

func installFromZip(...) InstallResult {
	if err != nil {
		return InstallResult{Error: err.Error()}  // 返回错误，不 panic
	}
	return InstallResult{Success: true, ...}
}
```

**规范**：
- 核心逻辑遇到错误返回带 `Error` 字段的结果，不 panic
- app.go 层不额外处理错误，直接透传给前端
- 前端检查 `res.error` 字段决定显示成功还是失败

## 测试规范

测试纪律（必须有测试、覆盖场景、测试隔离）遵循 [dev-discipline](../../dev-discipline/testing.md)。本章节只补充 Wails 后端的测试文件命名、分层和模板。

### 测试文件命名

`<domain>_test.go`，与被测文件同包同目录。

### 测试分层

- 核心逻辑（不依赖 Wails 的纯函数）必须有测试（见 ../../testing.md）
- app.go 里的方法（依赖 Wails runtime）不强制测试
- 用 `t.TempDir()` 创建临时目录，测试完自动清理

### 测试模板

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestXxx(t *testing.T) {
	dir := t.TempDir()
	skillsDir := filepath.Join(dir, "skills")  // 用不存在的子路径测"不存在"场景

	// 准备测试数据
	// ...

	// 执行
	res := doSomething(skillsDir)

	// 断言
	if !res.Success {
		t.Errorf("应成功，得到 %+v", res)
	}
}
```

### 运行测试

```bash
go test -v -count=1 ./...
```

## 跨平台处理

涉及系统操作的代码，必须用 `runtime.GOOS` 分支处理三平台：

```go
switch stdruntime.GOOS {
case "windows":
    // Windows 实现
case "darwin":
    // macOS 实现
default:
    // Linux 实现
}
```

路径拼接用 `filepath.Join`（不用 `/` 或 `\` 拼接），获取用户目录用 `os.UserHomeDir()`。

## API 封装层（Wails 版）

GUI 场景的 [前端 API 封装层](../shared/frontend-patterns.md#api-封装层必须) 实现为封装 Wails 生成的 Go 绑定。

```ts
// frontend/src/lib/api.ts
import { GetAgents, ListSkills, GetSkillDetail, PickZip, InstallFromZip } from '../../wailsjs/go/main/App'
import type { main } from '../../wailsjs/go/models'

// 类型从 Wails 生成的 models 重导出，组件用业务类型名
export type Agent = main.Agent
export type Skill = main.Skill

export const api = {
  getAgents: GetAgents,
  listSkills: ListSkills,
  getSkillDetail: GetSkillDetail,
  pickZip: PickZip,
  installFromZip: InstallFromZip,
}
```

**规范**：
- 组件永远 `import { api } from '@/lib/api'`，不直接 import `wailsjs`
- 后端方法签名变更时，只改这一个文件
- 类型重导出用业务语义名（`Agent` 而非 `main.Agent`）

## 顶层 App 骨架

GUI 工具的 `App.tsx` 标准骨架，体现"状态上提 + ToastProvider 包裹 + 三态渲染"。

```tsx
import { useEffect, useState, useCallback } from 'react'
import { ToastProvider, useToast } from '@/components/Toast'
import { Sidebar } from '@/components/Sidebar'
import { api, type Agent } from '@/lib/api'

function AppContent() {
  const toast = useToast()
  const [agents, setAgents] = useState<Agent[]>([])
  const [current, setCurrent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { api.getAgents().then(setAgents).catch(() => {}) }, [])

  const load = useCallback(async () => {
    if (!current) return
    setLoading(true)
    try {
      // await api.xxx(current.id)
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [current, toast])

  return (
    <div className="flex h-screen">
      <Sidebar agents={agents} current={current} onSelect={setCurrent} />
      <main className="flex-1 flex flex-col">{/* 顶栏 + 内容区 */}</main>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}
```

**规范**：`ToastProvider` 必须在最外层，`useToast` 只能在 `AppContent` 内用（不能在 Provider 自身用）。

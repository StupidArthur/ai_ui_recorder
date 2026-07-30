# Go CLI 技术栈

CLI 工具选用 Go 时的技术栈与规范。适用于：分发优先、系统运维、高并发、需要单文件无依赖的场景。

## 技术栈

| 库 | 作用 |
|-----|------|
| **cobra** | CLI 框架（子命令、flag、帮助自动生成） |
| 标准库 flag | 极简场景可替代 cobra |
| 标准库 net/http | HTTP 客户端 |

## 项目结构

```
mycli/
├── main.go              入口
├── cmd/                 子命令
│   ├── root.go          根命令
│   ├── list.go          list 子命令
│   └── install.go       install 子命令
├── internal/            核心逻辑（可独立测试）
│   └── service.go
├── go.mod
└── go.sum
```

**分层原则**：`cmd/` 只管参数解析和输出格式，业务逻辑放 `internal/`，不依赖 cobra，保证可独立 `go test`。

## cobra 用法模板

```go
// cmd/root.go
package cmd

import (
	"fmt"
	"os"
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "mycli",
	Short: "工具简述",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

```go
// cmd/list.go
package cmd

import (
	"fmt"
	"github.com/spf13/cobra"
	"mycli/internal"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "列出项目",
	Run: func(cmd *cobra.Command, args []string) {
		items, err := internal.ListItems()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		for _, it := range items {
			fmt.Println(it)
		}
	},
}

func init() {
	rootCmd.AddCommand(listCmd)
}
```

```go
// main.go
package main

import "mycli/cmd"

func main() {
	cmd.Execute()
}
```

## 构建与分发

```bash
# 当前平台
go build -o mycli .

# 交叉编译（Windows）
GOOS=windows GOARCH=amd64 go build -o mycli.exe .

# 交叉编译（macOS）
GOOS=darwin GOARCH=amd64 go build -o mycli .
```

产物是单文件，无运行时依赖，直接分发。

## 测试

核心逻辑放 `internal/`，不依赖 cobra，可独立测试：

```bash
go test -v ./...
```

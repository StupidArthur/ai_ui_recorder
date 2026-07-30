# Go 后端（gin）

B/S 网站后端选用 Go 时的技术栈与规范。适用于：高并发、微服务、单二进制部署、性能优先的场景。

## 技术栈

| 库 | 作用 |
|-----|------|
| **gin** | HTTP 框架（路由、中间件、性能好） |
| 标准库 net/http | 底层 |
| swag（可选） | Swagger 文档生成 |

## 项目结构

```
myapi/
├── main.go              入口
├── router.go            路由注册
├── handler/             HTTP 处理器
│   ├── agent.go
│   └── skill.go
├── service/             核心业务逻辑（可独立测试）
│   └── skill.go
├── model/               数据结构
│   └── types.go
├── go.mod
└── go.sum
```

**分层原则**：`handler/` 只管 HTTP 解析和响应，业务逻辑放 `service/`，不依赖 gin，保证可独立 `go test`。

## gin 路由模板

```go
// main.go
package main

import "github.com/gin-gonic/gin"

func main() {
	r := gin.Default()
	registerRoutes(r)
	r.Run(":8080")
}
```

```go
// router.go
package main

import (
	"github.com/gin-gonic/gin"
	"myapi/handler"
)

func registerRoutes(r *gin.Engine) {
	api := r.Group("/api")
	{
		api.GET("/agents", handler.ListAgents)
		api.GET("/agents/:id/skills", handler.ListSkills)
		api.POST("/install", handler.InstallFromZip)
	}
}
```

```go
// handler/skill.go
package handler

import (
	"net/http"
	"github.com/gin-gonic/gin"
	"myapi/service"
)

func ListSkills(c *gin.Context) {
	agentId := c.Param("id")
	skills, err := service.ListSkills(agentId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, skills)
}
```

## 跨域（CORS）

前端独立部署，后端需开 CORS：

```go
import "github.com/gin-contrib/cors"

r.Use(cors.Default())
```

## 部署

```bash
# 编译单二进制
go build -o myapi .

# 运行
./myapi
```

单二进制部署，无需运行时环境。

## 测试

核心逻辑放 `service/`，不依赖 gin，可独立测试：

```bash
go test -v ./...
```

前端衔接见 [B/S 选型的 fetch 封装](stack.md#前端-api-封装层fetch-版)。

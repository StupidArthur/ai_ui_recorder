# CLI 工具选型

CLI 工具不带界面，不引用 [共享前端层](../shared/frontend-stack.md)。后端语言在 Go 和 Python 之间选型——两者都可行，按场景维度决定。

## 选型维度

| 维度 | Go | Python |
|------|-----|--------|
| 分发 | 编译单文件，无运行时依赖 | 需解释器或 PyInstaller 打包 |
| 体积 | 单文件 ~8-15MB | PyInstaller 打包 ~30-50MB |
| 性能 | 编译型，快 | 解释型，CLI 场景通常够用 |
| 开发速度 | 稍慢，静态类型 | 快，动态灵活 |
| 生态 | 系统运维 / 并发 / 云原生 | AI / 数据处理 / 科学计算 |
| 跨平台 | 交叉编译方便（GOOS/GOARCH） | 需各平台分别打包 |
| HTTP 客户端 | 标准库 net/http | httpx |

## 推荐

- **选 Go**：分发优先（要单文件无依赖）、系统运维、高并发、需交叉编译多平台
- **选 Python**：AI / 数据处理、快速脚本、依赖 Python 生态库（pandas / numpy 等）

## 选定后

- Go：见 [Go CLI 技术栈](go.md)
- Python：见 [Python CLI 技术栈](python.md)

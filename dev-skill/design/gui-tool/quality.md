# GUI 工具质量标准

本章节定义 GUI 工具开发的硬性质量门槛，所有 GUI 工具必须达标才能交付。

## 体积红线

| 指标 | 红线 | 说明 |
|------|------|------|
| 最终 exe | **≤ 15 MB** | `wails build` 产出的单文件 |
| 前端打包后 | ≤ 2 MB | `frontend/dist` 总大小 |

### 体积检查命令

```powershell
# 检查 exe 体积
$f = "build\bin\<工具名>.exe"
$mb = [math]::Round((Get-Item $f).Length/1MB, 2)
Write-Output "exe: $mb MB"
```

### 超标处理

如果 exe 超过 15MB：
1. 检查是否误引入了重型依赖
2. 用 `wails build -upx` 压缩（需装 upx）
3. 检查前端是否引入了未 tree-shake 的大库

## 测试要求

测试纪律（必须有测试、覆盖场景、测试隔离）遵循 [测试纪律](../../testing.md)。本章节只补充 GUI 工具的测试分层和运行命令。

| 层 | 要求 |
|----|------|
| 后端核心逻辑 | 必须有单元测试（见 ../../testing.md） |
| app.go 方法 | 不强制（依赖 Wails runtime） |
| 前端组件 | 不强制（轻量工具规模） |

### 测试运行

```bash
# 运行所有测试，显示详情
go test -v -count=1 ./...

# 只看结果
go test ./...
```

## 构建标准

### 开发模式

```bash
wails dev
```
- 热刷新，改前端自动刷新，改 Go 自动重编译
- 首次编译较慢，后续增量快

### 生产构建

```bash
wails build
```
- 一条命令完成：生成绑定 → 前端构建 → Go 编译 → 打包
- 产物在 `build/bin/<工具名>.exe`

### 清理重建

```bash
wails build -clean
```
- 清空 build 目录后重新构建，解决缓存导致的奇怪问题

## 交付前检查清单

交付一个 GUI 工具前，逐项确认：

- [ ] `wails build` 成功，无报错
- [ ] exe 体积 ≤ 15MB
- [ ] `go test ./...` 全部通过
- [ ] 应用能正常启动，窗口显示正常
- [ ] 核心功能手动验证可用
- [ ] 空状态有友好提示
- [ ] 错误情况有 Toast 反馈
- [ ] 配色遵循设计 Token（暖灰底 + 单色强调）
- [ ] 无外部字体/图片依赖
- [ ] 跨平台代码有 GOOS 分支处理

## 常见问题处理

### WebView2 冲突（开发时）

现象：`wails dev` 报 `8000ffff: Catastrophic failure`
原因：多个实例抢同一 WebView2 user data 目录
解决：关掉所有运行中的实例，再启动

### 前端 TS 编译错误

现象：`wails build` 在 "Compiling frontend" 阶段失败
解决：`cd frontend && npx tsc --noEmit` 看具体错误

### 绑定未更新

现象：前端调用后端方法报 undefined
解决：`wails generate module` 重新生成绑定

### Go 依赖下载慢

```powershell
$env:GOPROXY='https://goproxy.cn,direct'
```

### 前端依赖安装慢

```powershell
npm config set registry https://registry.npmmirror.com
```

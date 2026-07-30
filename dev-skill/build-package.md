# 构建与打包

> 流程阶段⑤。承接测试阶段，执行构建、打包、分发。本规范语言与平台无关，具体打包工具由选型 skill 决定。

## 产物隔离

- 跨平台编译产物必须严格放在各自独立的命名子目录中（如 `dist/windows/`、`dist/linux/`），**禁止混合存放**。
- 打包生成的中间产物和输出目录绝对不允许被 Git 追踪，必须写入 `.gitignore`。

## 无环境依赖分发

- 打包产物应尽量做到在**无开发环境**的目标系统上可直接运行（内置依赖）。
- GUI 工具打包时必须确保运行时**不显示控制台窗口**（如 PyInstaller 用 `--noconsole`，Go 用 `-ldflags "-H windowsgui"`）。

## 跨平台兼容

- CLI 工具和需跨平台运行的工具，必须同步考虑目标平台的兼容性（路径分隔符、系统调用、换行符等）。
- 路径拼接用各语言的跨平台 API（如 Go 的 `filepath.Join`、Python 的 `os.path.join`），禁止硬编码分隔符。

## 具体打包规范

各技术栈的具体打包命令和规范由选型 skill 提供：
- GUI 工具（Wails）：见 [dev-route-selection/gui-tool/quality.md](../dev-route-selection/gui-tool/quality.md)
- Python CLI（PyInstaller）：见 [dev-route-selection/cli-tool/python.md](../dev-route-selection/cli-tool/python.md)
- Go CLI（go build）：见 [dev-route-selection/cli-tool/go.md](../dev-route-selection/cli-tool/go.md)

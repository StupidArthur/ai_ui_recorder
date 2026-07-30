# Python CLI 技术栈

CLI 工具选用 Python 时的技术栈与规范。适用于：AI / 数据处理、快速脚本、依赖 Python 生态库的场景。

## 技术栈

| 库 | 作用 |
|-----|------|
| **typer** | CLI 框架（类型提示驱动，FastAPI 同作者） |
| **httpx** | HTTP 客户端 |
| **pyinstaller** | 打包成单文件 exe |

## 项目结构

```
mycli/
├── main.py              入口（typer app）
├── commands/            子命令
│   ├── list.py
│   └── install.py
├── core/                核心逻辑（可独立测试）
│   └── service.py
├── requirements.txt
└── pyproject.toml
```

**分层原则**：`main.py` / `commands/` 只管参数解析和输出，业务逻辑放 `core/`，不依赖 typer，保证可独立 pytest。

## typer 用法模板

```python
# main.py
import typer

app = typer.Typer(help="工具简述")

@app.command()
def list():
    """列出项目"""
    from core.service import list_items
    items = list_items()
    for it in items:
        typer.echo(it)

@app.command()
def install(name: str = typer.Argument(..., help="项目名")):
    """安装项目"""
    from core.service import install_item
    install_item(name)

if __name__ == "__main__":
    app()
```

## HTTP 调用（httpx）

```python
import httpx

def fetch_data(url: str):
    with httpx.Client(timeout=10) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.json()
```

## 打包（PyInstaller）

```bash
# 单文件打包
pyinstaller --onefile --name mycli main.py

# 产物在 dist/mycli.exe
```

注意：PyInstaller 打包体积较大（~30-50MB），且需在目标平台打包（无法交叉编译）。若目标机器已有 Python 环境，可直接 `pip install` 分发，无需打包。

## 测试

核心逻辑放 `core/`，不依赖 typer，用 pytest 测试：

```bash
pytest -v
```

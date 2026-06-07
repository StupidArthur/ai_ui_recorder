"""uvicorn 启动入口：python -m recorder_translate_server.server"""

from __future__ import annotations

import argparse

import uvicorn


def main() -> None:
    p = argparse.ArgumentParser(description="Recorder Translate Server")
    p.add_argument("--host", default="127.0.0.1", help="绑定地址（默认 127.0.0.1）")
    p.add_argument("--port", type=int, default=8000, help="端口（默认 8000）")
    p.add_argument("--reload", action="store_true", help="开发模式自动重载")
    args = p.parse_args()

    uvicorn.run(
        "recorder_translate_server.server.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=1,  # 强制单进程，保持 dispatcher 单例
    )


if __name__ == "__main__":
    main()

"""PyInstaller 打包脚本：生成独立 EXE（config 目录外置）"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def main():
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--name", "ai-ui-translate",
        "--console",
        "--clean",
        # 隐式导入
        "--hidden-import", "openai",
        "--hidden-import", "pydantic",
        "--hidden-import", "httpx",
        "--hidden-import", "httpcore",
        "--hidden-import", "httpx._transports.default",
        "--hidden-import", "pydantic.deprecated.decorator",
        "--hidden-import", "jiter",
        "--hidden-import", "yaml",
        # 入口
        str(ROOT / "record_translate" / "__main__.py"),
    ]

    print(f"执行: {' '.join(cmd)}\n")
    subprocess.run(cmd, check=True)

    exe_path = ROOT / "dist" / "ai-ui-translate.exe"
    if exe_path.exists():
        size_mb = exe_path.stat().st_size / 1024 / 1024
        print(f"\n打包成功: {exe_path} ({size_mb:.1f} MB)")
        print(f"\n分发时需要将以下目录与 EXE 放在一起：")
        print(f"  dist/ai-ui-translate.exe")
        print(f"  dist/config/ai.yaml")
        print(f"  dist/config/prompts/*.md")
    else:
        print("\n打包失败，未找到输出 EXE")


if __name__ == "__main__":
    main()

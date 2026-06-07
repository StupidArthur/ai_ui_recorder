"""LLM 客户端工厂。

不依赖 cwd-based 加载器（uvicorn 进程 CWD 不稳定），直接读 json + env。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from recorder_translate_server.backend.client import LLMClient
from recorder_translate_server.backend.config import DEFAULT_MODEL

BASE_DIR = Path(__file__).resolve().parent.parent

# 配置搜索路径（按顺序）
CONFIG_CANDIDATES: list[Path] = [
    BASE_DIR / "config" / "ai.local.json",
    BASE_DIR / "config" / "ai.json",
]


def build_client() -> LLMClient:
    """
    按搜索顺序找配置文件，构造 LLMClient。
    找不到配置文件时回退到环境变量（AI_BASE_URL/AI_API_KEY/AI_MODEL）。
    """
    cfg: dict = {}
    for p in CONFIG_CANDIDATES:
        if p.exists():
            raw = p.read_text(encoding="utf-8-sig")
            cfg = json.loads(raw)
            break

    base_url = cfg.get("baseUrl") or os.environ.get("AI_BASE_URL", "")
    api_key = cfg.get("apiKey") or os.environ.get("AI_API_KEY", "")
    model = cfg.get("model") or os.environ.get("AI_MODEL", DEFAULT_MODEL)

    return LLMClient(base_url=base_url, api_key=api_key, model=model)

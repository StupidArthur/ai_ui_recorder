"""配置常量 + AI 配置加载（config/ai.yaml）"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

# ==================== 录制数据规范 ====================

META_FILENAME = "meta.json"
FORMAT_VERSION = "1.0"

# ==================== 预处理 ====================

DIFF_TRUNCATE_THRESHOLD = 3000
CONTEXT_EXCERPT_MAX_SIBLINGS = 5
DBLCLICK_TIME_THRESHOLD_MS = 500
SNAPSHOT_MAX_DEPTH = 8

# ==================== Phase 1 ====================

PHASE1_BATCH_SIZE = 3
EVIDENCE_CONTEXT_WINDOW_SIZE = 10
PHASE1_LLM_RAW_MAX_CHARS = 60000

# ==================== Phase 2 ====================

PHASE2_WINDOW_SIZE = 20
PHASE2_WINDOW_MAX_TOKENS = 3500
PHASE2_GAP_TAG_LONG_GAP_MS = 45000
PHASE2_ASSERT_TEXT_MAX_CHARS = 200

# ==================== Phase 4 ====================

PHASE4_WINDOW_SIZE = 20

# ==================== 滑动窗口安全 ====================

SLIDING_WINDOW_MAX_ROUND_MULTIPLIER = 2

# ==================== XML 解析 ====================

XML_REGEX_STEP_BLOCK_MAX_CHARS = 4000
XML_REGEX_ACTION_OBS_MAX_CHARS = 2000
XML_REGEX_LOGICAL_STEP_MAX_CHARS = 2000
XML_REGEX_MICRO_MAX_CHARS = 500

# ==================== LLM ====================

LLM_MAX_RETRIES = 3
LLM_BASE_DELAY_MS = 2000
LLM_PING_TIMEOUT_MS = 3000
LLM_PING_USER_MESSAGE = "你好"
LLM_PING_FAIL_MESSAGE = "LLM 调用出错，请确认 config 或者网络。"

# ==================== 翻译产物路径常量（与 run-layout.js 对齐） ====================

TRANSLATE_SUBDIR = "translate"
RECORD_SUBDIR = "record"
PREPROCESS_SUBDIR = f"{TRANSLATE_SUBDIR}/preprocess"
PHASE1_SUBDIR = f"{TRANSLATE_SUBDIR}/phase1"
PHASE2_SUBDIR = f"{TRANSLATE_SUBDIR}/phase2"
PHASE4_SUBDIR = f"{TRANSLATE_SUBDIR}/phase4"
LLM_AUDIT_SUBDIR = f"{TRANSLATE_SUBDIR}/llm_audit"
GENERATE_LOG_REL = f"{TRANSLATE_SUBDIR}/logs/generate.log"
STRUCTURED_STEPS_JSON = f"{PHASE1_SUBDIR}/structured_steps.json"
STRUCTURED_STEPS_XML = f"{PHASE1_SUBDIR}/structured_steps.xml"
LLM_RAW_BATCHES_XML = f"{PHASE1_SUBDIR}/llm_raw_batches.xml"
ERRORS_JSON = f"{PHASE1_SUBDIR}/errors.json"
CASES_MD = f"{PHASE2_SUBDIR}/cases.md"
CASES_FALLBACK_MD = f"{PHASE2_SUBDIR}/cases_fallback.md"
COVERAGE_MD = f"{PHASE2_SUBDIR}/coverage.md"
AGENTS_TXT = f"{PHASE4_SUBDIR}/agents.txt"

# ==================== 路径工具 ====================

DEFAULT_MODEL = "Qwen/Qwen3-VL-235B-A22B-Instruct"


def get_app_dir() -> Path:
    """获取应用根目录（EXE 所在目录或 CWD）"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path.cwd()


def _get_package_dir() -> Path:
    """获取 backend 包所在目录（即 recorder_translate_server/）"""
    return Path(__file__).resolve().parent.parent


def get_config_dir() -> Path:
    """获取 config 目录路径"""
    return get_app_dir() / "config"


# ==================== AI 配置加载 ====================


def _get_config_candidates() -> list[Path]:
    """构建配置文件搜索路径"""
    app_dir = get_app_dir()
    pkg_dir = _get_package_dir()
    return [
        app_dir / "config" / "ai.yaml",         # EXE 同级 config/ai.yaml
        app_dir / "config" / "ai.local.json",    # 兼容旧格式
        pkg_dir / "config" / "ai.yaml",          # 包内 config/
        pkg_dir / "config" / "ai.local.json",
        Path.cwd() / "config" / "ai.yaml",
        Path.cwd() / "config" / "ai.local.json",
        Path.cwd() / "release1" / "config" / "ai.local.json",
    ]


def load_ai_config() -> dict:
    """
    加载 AI 配置，查找顺序：
    1. config/ai.yaml（EXE 同级或 CWD）
    2. config/ai.local.json（兼容旧格式）
    3. 环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL
    """
    for p in _get_config_candidates():
        if not p.exists():
            continue
        raw = p.read_text(encoding="utf-8-sig")
        if p.suffix in (".yaml", ".yml"):
            return yaml.safe_load(raw)
        else:
            import json
            return json.loads(raw)

    return {
        "baseUrl": os.environ.get("AI_BASE_URL", ""),
        "apiKey": os.environ.get("AI_API_KEY", ""),
        "model": os.environ.get("AI_MODEL", ""),
    }

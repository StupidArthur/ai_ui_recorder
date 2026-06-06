"""
ai_client.py - LLM 客户端封装层（Python 版本）

本模块提供以下能力：
1. call_chat(messages, **kwargs) — 调用 LLM Chat Completions API（纯文本）
2. call_vision(image_base64, prompt, **kwargs) — 调用视觉模型分析图片
3. clean_markdown_fence(text) — 清理 AI 输出中多余的 markdown 代码围栏

使用方式：
    from ai_client import call_chat, call_vision, clean_markdown_fence
    reply = await call_chat([
        {"role": "system", "content": "..."},
        {"role": "user", "content": "..."},
    ])
    description = await call_vision(image_base64, "描述这张图片")
"""

import json
import re
import time
import os
from pathlib import Path
from typing import Optional

import httpx

# ==================== 配置加载 ====================


def load_ai_config() -> dict:
    """
    加载 AI 配置（兼容 Node.js 版本的查找逻辑）

    查找顺序：
    1. 运行目录/config/ai.local.json
    2. 环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL

    Returns:
        dict: {"baseUrl": str, "apiKey": str, "model": str}
    """
    candidates = [
        Path.cwd() / "config" / "ai.local.json",
        Path.cwd() / "release1" / "config" / "ai.local.json",
    ]

    for config_path in candidates:
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8-sig") as f:
                    config = json.load(f)
                return {
                    "baseUrl": config.get("baseUrl", "").strip(),
                    "apiKey": config.get("apiKey", "").strip(),
                    "model": config.get("model", "").strip(),
                }
            except Exception as e:
                raise ValueError(f"AI 配置文件解析失败: {config_path} ({e})")

    # 兜底环境变量
    return {
        "baseUrl": os.environ.get("AI_BASE_URL", "").strip(),
        "apiKey": os.environ.get("AI_API_KEY", "").strip(),
        "model": os.environ.get("AI_MODEL", "").strip(),
    }


def _validate_config(config: dict) -> None:
    """校验配置完整性"""
    missing = []
    if not config.get("baseUrl"):
        missing.append("baseUrl")
    if not config.get("apiKey"):
        missing.append("apiKey")
    if missing:
        raise ValueError(
            f"AI 配置缺失字段: {', '.join(missing)}\n"
            "请在 config/ai.local.json 中配置，或设置环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL"
        )


# ==================== 全局配置 ====================

_runtime_config = load_ai_config()
_validate_config(_runtime_config)

# ==================== 重试配置 ====================

MAX_RETRIES = 3
BASE_DELAY_MS = 2000

# ==================== 视觉模型配置 ====================

VISION_API_ENDPOINT = "https://api.minimaxi.com/anthropic/v1/messages"
VISION_MODEL_NAME = "MiniMax-M3"

# ==================== 配置常量（兼容 Node.js config.js） ====================

LLM_PING_TIMEOUT_MS = 3000
LLM_PING_USER_MESSAGE = "你好"
LLM_PING_FAIL_MESSAGE = "LLM 调用出错，请确认 config 或者网络。"


# ==================== 核心 API ====================


async def call_chat(
    messages: list[dict],
    *,
    temperature: float = 0.2,
    max_tokens: int = 2000,
    model: Optional[str] = None,
    response_format: Optional[dict] = None,
) -> str:
    """
    调用 LLM Chat Completions API（带全局重试机制）

    Args:
        messages: 消息数组 [{"role": "system/user", "content": "..."}]
        temperature: 生成温度（0~2）
        max_tokens: 最大生成 token 数
        model: 覆盖默认模型名称
        response_format: 可选的 JSON Schema 格式约束

    Returns:
        str: AI 生成的回复文本

    Raises:
        ValueError: API 调用失败或返回空结果
    """
    target_model = model or _runtime_config["model"]
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            body = {
                "model": target_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if response_format:
                body["response_format"] = response_format

            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{_runtime_config['baseUrl']}/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {_runtime_config['apiKey']}",
                    },
                    json=body,
                )
                resp.raise_for_status()
                result = resp.json()

            content = result.get("choices", [{}])[0].get("message", {}).get("content")
            if not content:
                raise ValueError("AI 返回空结果")

            return content

        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES:
                delay = BASE_DELAY_MS * (2 ** (attempt - 1))
                print(f"[LLM 调用失败，第 {attempt} 次重试] {e}，{delay}ms 后重试...")
                await _async_sleep(delay / 1000)

    raise ValueError(
        f"[LLM 调用彻底失败] 已重试 {MAX_RETRIES} 次，最终错误: {last_error}"
    )


async def call_vision(
    image_base64: str,
    prompt: str,
    *,
    media_type: str = "image/jpeg",
    max_tokens: int = 1000,
    model: Optional[str] = None,
) -> str:
    """
    调用视觉模型分析图片（MiniMax M3 Anthropic 格式）

    Args:
        image_base64: 图片的 base64 编码（不含 data:image/... 前缀）
        prompt: 分析提示词
        media_type: 图片 MIME 类型
        max_tokens: 最大生成 token 数
        model: 覆盖默认视觉模型

    Returns:
        str: AI 生成的分析文本

    Raises:
        ValueError: API 调用失败或返回空结果
    """
    target_model = model or VISION_MODEL_NAME
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            body = {
                "model": target_model,
                "max_tokens": max_tokens,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_base64,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt,
                            },
                        ],
                    }
                ],
            }

            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    VISION_API_ENDPOINT,
                    headers={
                        "Content-Type": "application/json",
                        "x-api-key": _runtime_config["apiKey"],
                        "anthropic-version": "2023-06-01",
                    },
                    json=body,
                )
                resp.raise_for_status()
                result = resp.json()

            # 检查错误
            if "error" in result:
                raise ValueError(
                    f"视觉 API 错误: {result['error'].get('message', json.dumps(result['error']))}"
                )

            # 提取文本内容（跳过 thinking 块）
            content_blocks = result.get("content", [])
            text_content = next(
                (c for c in content_blocks if c.get("type") == "text"), None
            )
            if not text_content or not text_content.get("text"):
                raise ValueError("视觉模型返回空结果")

            return text_content["text"]

        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES:
                delay = BASE_DELAY_MS * (2 ** (attempt - 1))
                print(
                    f"[视觉模型调用失败，第 {attempt} 次重试] {e}，{delay}ms 后重试..."
                )
                await _async_sleep(delay / 1000)

    raise ValueError(
        f"[视觉模型调用彻底失败] 已重试 {MAX_RETRIES} 次，最终错误: {last_error}"
    )


async def ping_llm(timeout_ms: Optional[int] = None) -> str:
    """
    翻译开始前探活：发送极简 user 消息，在限定时间内等待回复

    Args:
        timeout_ms: 超时毫秒，默认 LLM_PING_TIMEOUT_MS

    Returns:
        str: 模型回复正文（已 strip）

    Raises:
        ValueError: 超时或调用失败
    """
    timeout = timeout_ms or LLM_PING_TIMEOUT_MS

    try:
        async with httpx.AsyncClient(timeout=timeout / 1000) as client:
            resp = await client.post(
                f"{_runtime_config['baseUrl']}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {_runtime_config['apiKey']}",
                },
                json={
                    "model": _runtime_config["model"],
                    "messages": [{"role": "user", "content": LLM_PING_USER_MESSAGE}],
                    "max_tokens": 32,
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            result = resp.json()

        content = result.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not content:
            raise ValueError("AI 返回空结果")

        return content

    except httpx.TimeoutException:
        raise ValueError(LLM_PING_FAIL_MESSAGE) from None
    except Exception as e:
        raise ValueError(LLM_PING_FAIL_MESSAGE) from e


# ==================== 工具函数 ====================


def clean_markdown_fence(text: str) -> str:
    """
    清理 AI 输出中可能包裹的 markdown 代码围栏

    AI 有时会把整个回答用 ```markdown ... ``` 包裹起来，
    尽管 prompt 中已要求不要这样做。此函数将这层多余的围栏剥除，
    保留内部的纯内容。
    同时剥离 <thinking>...</thinking> 思考标签。

    Args:
        text: AI 原始输出文本

    Returns:
        str: 清理后的文本
    """
    if not text:
        return ""

    trimmed = text.strip()

    # 剥离常见思考/推理标签（MiniMax 等模型）
    trimmed = re.sub(r"<thinking>[\s\S]*?</thinking>", "", trimmed, flags=re.IGNORECASE)
    trimmed = re.sub(r"[\s\S]*?</think>", "", trimmed)

    # 剥离完整 markdown 代码块包裹（```json / ```markdown / ```）
    fenced = re.match(r"^```(?:json|markdown)?\s*\n([\s\S]*?)\n```\s*$", trimmed, re.IGNORECASE)
    if fenced:
        return fenced.group(1).strip()

    # 兼容旧逻辑：首尾 ``` 但中间无闭合换行
    if re.match(r"^```(?:markdown|json)?\s*\n", trimmed, re.IGNORECASE) and trimmed.endswith("```"):
        first_newline = trimmed.index("\n")
        return trimmed[first_newline + 1 : -3].strip()

    return trimmed


def extract_first_json_object(text: str) -> Optional[str]:
    """
    从 LLM 原始输出中提取首个 JSON 对象片段

    Args:
        text: LLM 原始输出

    Returns:
        str | None: JSON 字符串，找不到返回 None
    """
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    return text[start : end + 1]


def parse_json_from_llm_reply(text: str) -> dict:
    """
    解析 LLM 输出为 JSON 对象（清理围栏 → 直接 parse → 暴力提取）

    Args:
        text: LLM 原始输出

    Returns:
        dict: 解析后的 JSON 对象

    Raises:
        ValueError: 无法解析时抛出
    """
    cleaned = clean_markdown_fence(text)

    # 直接解析
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # 暴力提取
    extracted = extract_first_json_object(cleaned)
    if extracted:
        try:
            parsed = json.loads(extracted)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    raise ValueError("无法从 LLM 输出解析 JSON 对象")


# ==================== 内部工具 ====================


async def _async_sleep(seconds: float) -> None:
    """异步休眠"""
    import asyncio
    await asyncio.sleep(seconds)

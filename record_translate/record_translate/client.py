"""LLM 客户端封装"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import httpx
import openai

from .config import (
    DEFAULT_MODEL,
    LLM_BASE_DELAY_MS,
    LLM_MAX_RETRIES,
    load_ai_config,
)


class LLMClient:
    """单例 LLM 客户端"""

    def __init__(self, base_url: str, api_key: str, model: str):
        self._client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model or DEFAULT_MODEL
        self._max_retries = LLM_MAX_RETRIES
        self._base_delay_ms = LLM_BASE_DELAY_MS

    @classmethod
    def from_config(cls) -> LLMClient:
        config = load_ai_config()
        return cls(
            base_url=config.get("baseUrl", ""),
            api_key=config.get("apiKey", ""),
            model=config.get("model", DEFAULT_MODEL),
        )

    async def call_chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 2000,
        model: str | None = None,
    ) -> str:
        """调用 Chat Completions API，带指数退避重试"""
        target_model = model or self._model
        last_error = None

        for attempt in range(1, self._max_retries + 1):
            try:
                completion = await self._client.chat.completions.create(
                    model=target_model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                content = completion.choices[0].message.content
                if not content:
                    raise ValueError("AI 返回空结果")
                return content
            except Exception as e:
                last_error = e
                if attempt < self._max_retries:
                    delay = self._base_delay_ms * (2 ** (attempt - 1))
                    print(f"[LLM 调用失败，第 {attempt} 次重试] {e}，{delay}ms 后重试...")
                    await asyncio.sleep(delay / 1000)

        raise RuntimeError(f"LLM 调用彻底失败，已重试 {self._max_retries} 次: {last_error}")

    async def call_vision(
        self,
        image_base64: str,
        prompt: str,
        *,
        media_type: str = "image/jpeg",
        max_tokens: int = 1000,
        model: str | None = None,
    ) -> str:
        """调用视觉模型（MiniMax M3 Anthropic 格式）"""
        target_model = model or "MiniMax-M3"
        config = load_ai_config()

        for attempt in range(1, self._max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.post(
                        "https://api.minimaxi.com/anthropic/v1/messages",
                        headers={
                            "Content-Type": "application/json",
                            "x-api-key": config.get("apiKey", ""),
                            "anthropic-version": "2023-06-01",
                        },
                        json={
                            "model": target_model,
                            "max_tokens": max_tokens,
                            "messages": [{
                                "role": "user",
                                "content": [
                                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
                                    {"type": "text", "text": prompt},
                                ],
                            }],
                        },
                    )
                    resp.raise_for_status()
                    result = resp.json()

                if "error" in result:
                    raise ValueError(f"视觉 API 错误: {result['error']}")

                text_content = next((c for c in result.get("content", []) if c.get("type") == "text"), None)
                if not text_content or not text_content.get("text"):
                    raise ValueError("视觉模型返回空结果")
                return text_content["text"]
            except Exception as e:
                if attempt < self._max_retries:
                    delay = self._base_delay_ms * (2 ** (attempt - 1))
                    await asyncio.sleep(delay / 1000)
                else:
                    raise

        raise RuntimeError("视觉模型调用彻底失败")

    async def ping(self, timeout_ms: int = 3000) -> str:
        """探活"""
        from .config import LLM_PING_FAIL_MESSAGE, LLM_PING_USER_MESSAGE

        controller = httpx.AsyncClient(timeout=timeout_ms / 1000)
        try:
            async with controller:
                resp = await controller.post(
                    f"{self._client.base_url}/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self._client.api_key}",
                    },
                    json={
                        "model": self._model,
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
        except Exception as e:
            raise ValueError(LLM_PING_FAIL_MESSAGE) from e


# ==================== 工具函数 ====================


def clean_markdown_fence(text: str) -> str:
    """清理 <thinking> 标签和 markdown 代码围栏"""
    if not text:
        return ""

    trimmed = text.strip()

    # 剥离思考标签
    trimmed = re.sub(r"<thinking>[\s\S]*?</thinking>", "", trimmed, flags=re.IGNORECASE)
    trimmed = re.sub(r"[\s\S]*?</think>", "", trimmed)

    # 剥离 markdown 代码块包裹
    fenced = re.match(r"^```(?:json|markdown)?\s*\n([\s\S]*?)\n```\s*$", trimmed, re.IGNORECASE)
    if fenced:
        return fenced.group(1).strip()

    if re.match(r"^```(?:markdown|json)?\s*\n", trimmed, re.IGNORECASE) and trimmed.endswith("```"):
        first_newline = trimmed.index("\n")
        return trimmed[first_newline + 1 : -3].strip()

    return trimmed


def extract_first_json_object(text: str) -> str | None:
    """从 LLM 原始输出中提取首个 JSON 对象片段"""
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    return text[start : end + 1]


def parse_json_from_llm_reply(text: str) -> dict[str, Any]:
    """清理围栏 → 直接 parse → 暴力提取 JSON"""
    import json

    cleaned = clean_markdown_fence(text)

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    extracted = extract_first_json_object(cleaned)
    if extracted:
        try:
            parsed = json.loads(extracted)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    raise ValueError("无法从 LLM 输出解析 JSON 对象")

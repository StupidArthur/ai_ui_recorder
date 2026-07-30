"""测试统一 LLM 模块：7 种模型 × 统一接口。"""

import asyncio
from chat import chat, list_models, ChatResult

# 测试用 key 占位符，请通过环境变量或 ai.local.json 注入真实 key
KEYS = {
    "minimax": "",
    "mimo": "",
    "deepseek": "",
}

MSG = [{"role": "user", "content": "用一句话回答：1+1等于几？"}]


def get_key(model: str) -> str:
    if model.startswith("MiniMax"):
        return KEYS["minimax"]
    if model.startswith("mimo"):
        return KEYS["mimo"]
    if model.startswith("deepseek"):
        return KEYS["deepseek"]
    raise ValueError(f"未知模型: {model}")


async def main():
    print(f"可用模型: {list_models()}\n")

    for model in list_models():
        try:
            r: ChatResult = await chat(model, MSG, get_key(model))
            print(f"{'='*60}")
            print(f"  {model}")
            print(f"{'='*60}")
            print(f"  content:           {r.content}")
            print(f"  reasoning_content: {len(r.reasoning_content)} chars")
            if r.reasoning_content:
                print(f"    preview: {r.reasoning_content[:80]}")
            print(f"  finish_reason:     {r.finish_reason}")
            print(f"  prompt_tokens:     {r.prompt_tokens}")
            print(f"  completion_tokens: {r.completion_tokens}")
        except Exception as e:
            print(f"{'='*60}")
            print(f"  {model}")
            print(f"{'='*60}")
            print(f"  ERROR: {e}")


if __name__ == "__main__":
    asyncio.run(main())

"""独立翻译脚本 — 运行 Phase 1/2/4 翻译并输出结果"""

import asyncio
import logging
import shutil
import sys
from pathlib import Path

# 项目根目录
REPO_ROOT = Path(__file__).parent.parent

# 确保可以 import recorder_translate_server
sys.path.insert(0, str(REPO_ROOT))

from recorder_translate_server.backend.client import LLMClient
from recorder_translate_server.backend.preprocess import preprocess
from recorder_translate_server.backend.validate import validate_recording
from recorder_translate_server.backend.workflow import run_workflow

# ==================== 配置 ====================

# 录制数据目录
RUN_DIR = REPO_ROOT / "release1" / "output" / "run_2026-06-04T11-39-58"

# 结果输出目录（翻译完成后复制到这里方便对比）
OUTPUT_DIR = REPO_ROOT / "ana_data" / "python_v094"

# ==================== 日志 ====================

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("record_translate")


async def main():
    if not RUN_DIR.exists():
        print(f"录制目录不存在: {RUN_DIR}")
        return

    # 1. 校验
    print(f"加载录制数据: {RUN_DIR}")
    meta, raw_actions, version = validate_recording(RUN_DIR)
    print(f"  {meta.total_actions} 个操作, 格式版本={version}")

    # 2. 预处理
    print(f"预处理...")
    enriched = preprocess(RUN_DIR, meta, raw_actions, log_instance=logger)
    print(f"  {len(enriched)} 条富化数据")

    # 3. 翻译
    print(f"开始翻译（Phase 1 → 2 → 4，预计 3~5 分钟）...")
    print()
    client = LLMClient.from_config()
    result = await run_workflow(RUN_DIR, enriched, client=client, log_instance=logger)

    # 4. 输出结果
    print()
    print("=" * 50)
    print("翻译完成！")
    print("=" * 50)
    print(f"  结构化步骤: {result.steps_file}")
    print(f"  测试用例:   {result.cases_file}")
    if result.agent_txt_file:
        print(f"  Agent 用例: {result.agent_txt_file}")

    # 5. 复制结果到输出目录
    translate_dir = RUN_DIR / "translate"
    if translate_dir.exists():
        if OUTPUT_DIR.exists():
            shutil.rmtree(OUTPUT_DIR)
        shutil.copytree(translate_dir, OUTPUT_DIR / "translate")
        print(f"  结果已复制到: {OUTPUT_DIR}")

    # 6. 显示 agents.txt 预览
    agents_file = Path(result.agent_txt_file) if result.agent_txt_file else None
    if agents_file and agents_file.exists():
        content = agents_file.read_text("utf-8")
        steps = [l for l in content.split("\n") if l.startswith("步骤")]
        micros = [l for l in content.split("\n") if l.startswith("- ")]
        print()
        print(f"  Phase 4 指标:")
        print(f"    逻辑步骤: {len(steps)}")
        print(f"    micro-actions: {len(micros)}")
        print(f"    聚合比: {len(micros)/max(len(steps),1):.1f}:1")
        print()
        print("  --- agents.txt 预览 ---")
        for line in content.split("\n")[:50]:
            print(f"  {line}")
        if len(content.split("\n")) > 50:
            print(f"  ... (共 {len(content.split(chr(10)))} 行)")


if __name__ == "__main__":
    asyncio.run(main())

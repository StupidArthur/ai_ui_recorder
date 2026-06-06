"""翻译工具入口：双击 exe 即可使用"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

# 兼容 PyInstaller（__main__.py 被直接执行时相对 import 失败）
try:
    from .client import LLMClient
    from .config import GENERATE_LOG_REL
    from .preprocess import preprocess
    from .validate import validate_recording
    from .workflow import run_workflow
except ImportError:
    from record_translate.client import LLMClient
    from record_translate.config import GENERATE_LOG_REL
    from record_translate.preprocess import preprocess
    from record_translate.validate import validate_recording
    from record_translate.workflow import run_workflow

# ==================== 日志 ====================

_console_handler = logging.StreamHandler(sys.stdout)
_console_handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
logger = logging.getLogger("record_translate")
logger.addHandler(_console_handler)
logger.setLevel(logging.INFO)


# ==================== 录制目录扫描 ====================


def _get_search_dirs() -> list[Path]:
    """获取搜索目录列表（兼容开发环境和 EXE 环境）"""
    dirs = []
    cwd = Path.cwd()

    # EXE 场景：EXE 同级目录
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
        dirs.append(exe_dir / "output")
        dirs.append(exe_dir / "data_check")

    # 通用：CWD（EXE 运行时 CWD 可能是用户双击 exe 所在的目录）
    dirs.append(cwd / "output")
    dirs.append(cwd / "data_check")
    dirs.append(cwd / "release1" / "output")

    return dirs


def _scan_recordings() -> list[dict]:
    """扫描所有可翻译的录制目录，返回元信息列表（按名称去重）"""
    seen_names: set[str] = set()
    recordings = []

    for search_dir in _get_search_dirs():
        if not search_dir.exists():
            continue
        for d in sorted(search_dir.iterdir(), reverse=True):
            if not d.is_dir() or not d.name.startswith("run_"):
                continue
            if d.name in seen_names:
                continue
            meta_file = d / "meta.json"
            if not meta_file.exists():
                continue
            try:
                meta = json.loads(meta_file.read_text("utf-8-sig"))
                seen_names.add(d.name)
                recordings.append({
                    "dir": d,
                    "name": d.name,
                    "total_actions": meta.get("totalActions", 0),
                    "target_url": meta.get("targetUrl", ""),
                    "start_time": meta.get("recordStartTime", ""),
                    "page_title": meta.get("startPageTitle", ""),
                })
            except Exception:
                pass

    return recordings


# ==================== 交互式菜单 ====================


def _print_banner():
    print()
    print("=" * 50)
    print("  AI UI Recorder - 翻译工具")
    print("=" * 50)
    print()


def _select_recording() -> Path | None:
    """显示录制列表，让用户选择。返回选中的目录路径。"""
    recordings = _scan_recordings()

    if not recordings:
        print("未找到任何录制数据。")
        print("请先使用录制工具完成录制，或确认 output/ 目录下存在 run_* 文件夹。")
        return None

    if len(recordings) == 1:
        r = recordings[0]
        print(f"找到 1 个录制数据：{r['name']} ({r['total_actions']} 步)")
        print()
        return r["dir"]

    print(f"找到 {len(recordings)} 个录制数据：")
    print()
    for i, r in enumerate(recordings, 1):
        # 格式化时间
        time_str = r["start_time"][:10] if r["start_time"] else "未知日期"
        page = r["page_title"] or "未知页面"
        print(f"  [{i}] {r['name']}  ({r['total_actions']} 步, {time_str}, {page})")

    print()
    print("请输入编号选择（直接回车选最新）：")

    while True:
        try:
            choice = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            return None

        if choice == "":
            print(f"  → 选择最新: {recordings[0]['name']}")
            print()
            return recordings[0]["dir"]

        try:
            idx = int(choice)
            if 1 <= idx <= len(recordings):
                print(f"  → 选择: {recordings[idx - 1]['name']}")
                print()
                return recordings[idx - 1]["dir"]
            else:
                print(f"  请输入 1~{len(recordings)} 之间的数字")
        except ValueError:
            print(f"  请输入数字")


# ==================== 翻译执行 ====================


async def _run_translate(run_dir: Path):
    """执行翻译并输出结果"""
    # 添加文件日志
    log_file = run_dir / GENERATE_LOG_REL
    log_file.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s"))
    logger.addHandler(file_handler)

    # 1. 校验
    print(f"正在加载录制数据...")
    meta, raw_actions, version = validate_recording(run_dir)
    print(f"  录制数据: {meta.total_actions} 个操作, 格式版本={version}")
    print()

    # 2. 预处理
    print(f"正在预处理...")
    enriched = preprocess(run_dir, meta, raw_actions, log_instance=logger)
    print(f"  预处理完成: {len(enriched)} 条富化数据")
    print()

    # 3. 翻译
    print(f"正在翻译（需要调用 AI，预计 3~5 分钟）...")
    print()
    client = LLMClient.from_config()
    result = await run_workflow(run_dir, enriched, client=client, log_instance=logger)

    # 4. 输出结果
    print()
    print("=" * 50)
    print("  翻译完成！")
    print("=" * 50)
    print()
    print(f"  结构化步骤: {result.steps_file}")
    print(f"  测试用例:   {result.cases_file}")
    if result.agent_txt_file:
        print(f"  Agent 用例: {result.agent_txt_file}")
    if result.fallback_applied:
        print(f"  ⚠ 兜底补全: {result.cases_fallback_file}（缺失 {len(result.fallback_indices)} 步）")
    print()


# ==================== 主入口 ====================


def main():
    _print_banner()

    # 如果命令行指定了目录，直接用（兼容脚本调用）
    if len(sys.argv) > 1:
        target = sys.argv[1]
        search_dirs = _get_search_dirs()
        run_dir = None

        p = Path(target)
        if p.exists() and p.is_dir():
            run_dir = p
        else:
            for sd in search_dirs:
                candidate = sd / target
                if candidate.exists():
                    run_dir = candidate
                    break

        if run_dir is None:
            print(f"指定目录不存在: {target}")
            _wait_exit()
            return
    else:
        # 交互式选择
        run_dir = _select_recording()
        if run_dir is None:
            _wait_exit()
            return

    try:
        asyncio.run(_run_translate(run_dir))
    except KeyboardInterrupt:
        print("\n已取消。")
    except Exception as e:
        print(f"\n翻译失败: {e}")
        logger.error(f"翻译失败: {e}", exc_info=True)

    _wait_exit()


def _wait_exit():
    """等待用户按任意键退出"""
    print()
    try:
        input("按回车键退出...")
    except (EOFError, KeyboardInterrupt):
        pass


if __name__ == "__main__":
    main()

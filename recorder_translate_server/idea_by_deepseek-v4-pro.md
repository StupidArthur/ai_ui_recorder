# `recorder_translate_server` 独立评审

> 评审时间：2026-06-06
> 评审对象：`recorder_translate_server/README.md`
> 说明：本评审独立完成，有意避开已有评审（Gemini、MiniMax）已覆盖的视角。已有评审已充分讨论了状态机、并发控制、TTL 清理、上传安全、认证、SSE 队列、健康检查、指标等，本评审聚焦**翻译语义正确性、双轨维护、产物边界、跨平台、进度体验**等新视角。

---

## 一、🔴 关键问题

### 问题 1：JS/Python 双轨翻译的维护分歧风险

当前项目存在**两套并行的翻译实现**：

| 维度 | JS 版 (`src/case_translate/`) | Python 版 (`record_translate/`) |
|---|---|---|
| 行数 | ~2500 行 | ~1500 行 |
| 主线状态 | 最新提交都在修这里的 bug | 功能滞后于 JS 版 |
| Prompt 管理 | `prompts/md/*-skill.md` + 动态拼接 | 复刻了相同结构 |
| Phase 2 兜底 | `cases-document-appendix.js` 覆盖核对表 + 严格模式判定 | **无对等实现** |
| 最近修复 | `consumeStepCount` 覆盖 bug 已修 | **未确认是否同步修复** |

Server 方案说"复用 Python 包"，但 JS 版才是实际迭代的主线代码。风险：

1. **结果不一致**：同一份录制，CLI（JS）和 Web（Python）可能产出不同的 `cases.md`
2. **Bug 修复遗漏**：JS 版修的 Phase 2 覆盖 bug（见 `todo.md`），Python 版可能仍然存在
3. **长期维护成本**：每改一处 Prompt 或兜底逻辑，需要改两遍

**建议**：

- **短期**：在 `pyproject.toml` 中加对比测试（同一份 `data_check/run_*` 输入，比较两个实现的关键输出字段）
- **长期**：只保留一套实现。选项 A：Web 服务改为调用 JS standalone EXE（`npm run build:translate-standalone`）；选项 B：Python 版追平 JS 版后废弃 JS 版

---

### 问题 2：翻译任务缺失"取消"语义

整个设计只有 `queued → ... → done/error` 的单向状态流转。但 LLM 翻译一次要 3-5 分钟，期间：

- 用户传错了录制包 → 无法中止，只能等它跑完
- 翻译卡在某个轮次（LLM 返回异常但没崩溃）→ 没有超时熔断
- `asyncio.Task.cancel()` 只抛 `CancelledError`，`run_workflow` 内部循环没有检查取消信号的锚点

**建议**：

```python
class Job:
    cancelled: bool = False

# 在 Phase 1/2/4 的 while 循环里插入取消检查：
if job.cancelled:
    raise JobCancelledError()

# 全局超时保护
try:
    await asyncio.wait_for(run_workflow(...), timeout=600)  # 10 分钟硬超时
except asyncio.TimeoutError:
    job.status = JobStatus.TIMED_OUT

# DELETE /api/jobs/{id} → 标记取消 + 触发清理
```

---

### 问题 3：下载结果 zip 的内容边界未定义

README 只说"返回翻译结果的 zip，包含 `translate/` 目录"。但 `run_dir` 下的实际文件布局是：

```
run_dir/
├── meta.json          ← 用户原始录制元数据
├── record/            ← 用户原始快照/操作
│   ├── actions/
│   └── snapshots/
└── translate/         ← 翻译产物
    ├── preprocess/    ← 预处理中间数据
    ├── phase1/        ← 结构化步骤
    ├── phase2/        ← cases.md
    ├── phase4/        ← agents.txt
    └── llm_audit/     ← LLM 调用完整审计（含 API 原始回复、token 消耗）
```

问题：

- **`llm_audit/` 包含完整 LLM 请求/响应**，内部信息（token 消耗、API 返回细节）不应泄露给用户
- **`record/` 是否打包？** 如果用户录制了内部系统页面，快照中可能包含敏感业务数据
- **产物粒度过大**：用户通常只需要 `cases.md`，但下载得到一个包含所有预处理中间文件的 zip

**建议**：明确定义"外部可见产物"白名单：

```python
RESULT_WHITELIST = [
    "translate/phase1/structured_steps.json",
    "translate/phase2/cases.md",
    "translate/phase2/cases_fallback.md",
    "translate/phase2/coverage.md",
    "translate/phase4/agents.txt",
    # 明确不包含：llm_audit/、preprocess/、record/、meta.json
]
```

---

### 问题 4：LLM 失败的部分降级策略对 Server 层不可见

Python 版 `run_workflow` 内部有兜底（Phase 1 解析失败 → fallback step，Phase 2 LLM 异常 → 本地补全），但 `WorkflowResult` 把这些信息压扁成了简单的文件路径。Server 层**完全不知道翻译质量如何**：

- 翻译"完成"了，但有 40% 步骤是程序兜底而非 LLM 生成 → 前端应展示 `"completed_with_fallback"` 而非 `"completed"`
- Phase 4 失败时 workflow 只打 log 然后 `return None`，job 状态仍为 `completed`
- `LlmAudit.finalize()` 计算出的 `problemCalls` 数量**没有暴露在任何 API 中**

**建议**：让质量元数据流到 Server 层：

```python
@dataclass
class TranslationQuality:
    total_steps: int
    llm_generated: int
    fallback_steps: int       # 程序兜底的步骤数
    llm_errors: int           # LLM 调用失败次数
    phase4_generated: bool    # agent.txt 是否成功生成

@dataclass
class WorkflowResult:
    steps_file: Path | None
    cases_file: Path | None
    agent_txt_file: Path | None
    fallback_applied: bool
    fallback_indices: list[int]
    cases_fallback_file: str | None
    quality: TranslationQuality  # 新增
```

前端据此展示：`"翻译完成（AI 覆盖率 85%，5 步使用程序兜底，2 次 LLM 调用失败）"`

---

## 二、🟡 中等问题

### 问题 5：跨平台 zip 兼容性

用户在 Windows 上右键"发送到压缩文件夹"打包，上传到 Linux 服务器解压：

- **路径分隔符**：Windows zip 内文件名是 `run_xxx\meta.json`，`.extractall()` 在 Linux 上会创建含反斜杠的**文件名**而非目录结构
- **编码问题**：Windows 压缩工具常用 GBK 编码文件名，`zipfile` 默认 UTF-8，中文文件名可能乱码
- **macOS 垃圾文件**：`__MACOSX/` 资源 fork 目录和 `.DS_Store` 会混入 zip

**建议**：

```python
import zipfile

def safe_extract(zip_path: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            # 1. 统一路径分隔符，过滤危险路径
            safe_name = member.replace('\\', '/')
            if safe_name.startswith('/') or '..' in safe_name:
                continue
            # 2. 跳过 macOS 垃圾文件
            if safe_name.startswith('__MACOSX/') or safe_name.endswith('.DS_Store'):
                continue
            # 3. 处理编码问题（GBK fallback）
            try:
                info = zf.getinfo(member)
            except UnicodeEncodeError:
                member_bytes = member.encode('cp437')
                safe_name = member_bytes.decode('gbk').replace('\\', '/')
                info = zf.getinfo(member)
            info.filename = safe_name
            zf.extract(info, target_dir)
    return _find_run_dir(target_dir)
```

---

### 问题 6：翻译进度粒度不均导致前端"假死"体验

当前 SSE 进度依赖 `record_translate` 内部 logger 输出。各 Phase 的日志密度差异悬殊：

| 阶段 | 日志频率 | 用户感受 |
|---|---|---|
| 预处理 | 每秒几条（每个 action 一条） | 流畅 |
| Phase 1 | 每批 3 条一次 LLM 调用（约 2-5s/批） | 可接受 |
| **Phase 2** | 每窗 20 步一次 LLM 调用（约 5-15s/窗），窗口间**无中间日志** | **长时间无更新，像卡死了** |
| **Phase 4** | 同上 | 同上 |

Phase 2 在两次 LLM 调用之间没有任何事件。SSE 沉默了 10 秒以上，用户会刷新页面、重新上传、或者以为服务挂了。

**建议**：在 Phase 2/4 的 `while` 循环中显式推送进度，不依赖 logger：

```python
async def run_phase2(
    run_dir, steps, window_size, audit, log,
    on_progress: Callable[[dict], Awaitable[None]] | None = None,
):
    while cursor < total:
        if on_progress:
            await on_progress({
                "phase": "phase2",
                "round": round,
                "max_rounds": max_rounds,
                "progress": cursor / total,
            })
        ...
```

前端据此渲染进度条：`Phase 2: 窗口 3/8 (37%)`

---

### 问题 7：Server 与 CLI 共用 `config/ai.yaml` 的配置隔离隐患

Server 直接复用 `record_translate` 的 `load_ai_config()`，这意味着 Server 和 CLI 共用同一个配置文件。问题：

- 开发机用个人 API Key 调试 CLI → 部署到服务器时容易覆盖错文件
- Server 可能需要独立的 model 选择（例如 Server 用便宜的模型，CLI 调试用强模型）
- 没有环境变量覆盖机制来区分 Server 和 CLI 配置

**建议**：环境变量优先于配置文件：

```python
def load_ai_config():
    # Server 场景：环境变量优先
    if os.environ.get("SERVER_AI_BASE_URL"):
        return {
            "baseUrl": os.environ["SERVER_AI_BASE_URL"],
            "apiKey": os.environ["SERVER_AI_API_KEY"],
            "model": os.environ.get("SERVER_AI_MODEL", DEFAULT_MODEL),
        }
    # CLI 场景：配置文件
    ...
```

---

## 三、🟢 小问题

### 问题 8：前端用例预览的渲染方式不明确

README 提到"用例预览"，但 `cases.md` 是多级标题 + 表格 + 引用块的完整 Markdown。如果前端只用 `innerText` 展示，可读性很差。

**建议**：明确前端使用 `marked.js`（~30KB gzip）做 Markdown 渲染，或服务端在 `/api/jobs/{id}/preview` 端点返回预渲染的 HTML 片段。

---

## 四、总结

| 维度 | 评分 | 说明 |
|---|---|---|
| 双轨一致性 | ⭐⭐ | 两套翻译实现并行维护，结果可能不一致 |
| 任务生命周期 | ⭐⭐ | 缺取消、缺超时、缺质量反馈 |
| 产物边界 | ⭐⭐ | 下载内容白名单、审计隔离未定义 |
| 跨平台鲁棒性 | ⭐⭐ | zip 编码/路径/平台差异未考虑 |
| 进度体验 | ⭐⭐ | Phase 2/4 无中间进度，"假死"体验 |

**一句话**：已有的两份评审覆盖了"怎么把服务做稳"（并发/安全/运维），本评审补充的是"**翻译这件事在 Web 化后的语义正确性**"——双轨一致、失败降级、产物边界、跨平台、进度体验。建议把这 5 个视角纳入设计修正后再开工。

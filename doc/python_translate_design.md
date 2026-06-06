# 翻译模块 Python 重构设计文档

> **状态**：方案评审中
> **作者**：@yuzechao
> **日期**：2026-06-06
> **关联文档**：`doc/recording_data_spec.md`（录制数据格式规范 v1.0）

---

## 1. 背景与目标

### 1.1 现状

当前翻译模块（`src/case_translate/`）使用 Node.js 实现，包含以下子模块：

| 子模块 | 文件 | 职责 |
|--------|------|------|
| 预处理器 | `preprocessor/*.js` (6 个文件) | 语义归并、快照 diff、上下文提取、表单状态 diff、操作分类、噪声检测 |
| AI 客户端 | `ai-client.js` | LLM Chat/Vision 调用、重试、Markdown 围栏清理 |
| LLM 审计 | `llm-audit.js` | 每次 LLM 调用的全量审计落盘 |
| Phase 1 | `phase1/*.js` + `prompts/step-structured.js` | 微批处理生成结构化步骤 |
| Phase 2 | `phase2/*.js` + `prompts/case-generation.js` | 滑动窗口归纳测试用例 |
| Phase 4 | `phase4/*.js` + `prompts/agent-txt.js` | 生成 Agent 可执行用例 |
| 工作流编排 | `workflow.js` | Phase 1 → Phase 2 → Phase 4 串联 |
| 入口 | `index.js`、`standalone-cli.js` | CLI 入口、独立翻译启动器 |
| Prompt 模板 | `prompts/md/*.md` (4 个文件) | LLM Skill 提示词 |

### 1.2 目标

将上述翻译模块用 Python 重写为独立包 `ai_ui_translate/`，实现：

1. **录制端零改动**：Node.js 录制器继续按 `recording_data_spec.md` v1.0 产出数据
2. **翻译端独立实现**：Python 包按同一规范消费数据，产出相同的翻译结果
3. **共存期**：两套翻译实现并行存在，可互相验证结果一致性
4. **单机版**：不涉及服务端部署，CLI 工具形态

### 1.3 非目标

- 不删除现有 Node.js 翻译代码
- 不改变录制端的任何逻辑
- 不做 Web Server / API 化
- 不引入异步任务队列

---

## 2. 整体架构

### 2.1 代码位置

```
ai_ui_recorder/
├── src/                          # [不动] Node.js 代码
│   ├── recorder/                 # 录制器（不动）
│   ├── case_translate/           # [不动] Node.js 翻译（保留，与 Python 版共存）
│   └── ...
├── ai_ui_translate/              # [新增] Python 翻译包
│   ├── pyproject.toml
│   ├── ai_ui_translate/
│   │   ├── __init__.py
│   │   ├── __main__.py           # python -m ai_ui_translate 入口
│   │   ├── config.py             # 配置常量
│   │   ├── models.py             # Pydantic 数据模型
│   │   ├── client.py             # LLM 客户端
│   │   ├── audit.py              # LLM 审计
│   │   ├── prompts/              # Prompt 模板（直接复用 md 文件）
│   │   │   ├── loader.py
│   │   │   ├── step_structured.py
│   │   │   ├── case_generation.py
│   │   │   └── agent_txt.py
│   │   ├── preprocess/
│   │   │   ├── __init__.py
│   │   │   ├── merge.py          # 语义归并
│   │   │   ├── diff.py           # 快照 diff
│   │   │   ├── context.py        # 上下文提取
│   │   │   ├── form_state.py     # 表单状态 diff
│   │   │   ├── classify.py       # 操作分类
│   │   │   └── noise.py          # 噪声检测
│   │   ├── phases/
│   │   │   ├── __init__.py
│   │   │   ├── phase1.py         # 结构化步骤生成
│   │   │   ├── phase2.py         # 测试用例归纳
│   │   │   └── phase4.py         # Agent TXT 生成
│   │   ├── xml_parse.py          # XML 解析工具（替代正则链）
│   │   └── workflow.py           # 工作流编排
│   └── tests/
│       ├── conftest.py
│       ├── test_preprocess.py
│       ├── test_phase1.py
│       ├── test_phase2.py
│       ├── test_xml_parse.py
│       └── fixtures/             # 录制数据样本
│           └── run_sample/
├── doc/
│   ├── recording_data_spec.md    # [已有] 录制数据格式规范
│   └── python_translate_design.md  # [本文档]
```

### 2.2 依赖

```toml
[project]
name = "ai-ui-translate"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "openai>=1.0",        # LLM 调用（与 Node.js openai SDK 对等）
    "pydantic>=2.0",      # 数据模型定义与校验
    "httpx>=0.27",        # HTTP 客户端（Vision API 调用）
    "diff-match-patch",   # 文本 diff（替代 Node.js diff 包）
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "respx",              # httpx mock
]
```

### 2.3 数据流

```
录制数据目录（Node.js 产出）
  │
  │  recording_data_spec.md v1.0
  │
  ▼
┌─────────────────────────────────────────────────┐
│                  Python 翻译端                    │
│                                                   │
│  ① 校验入口（models.py: RecordingData.validate）  │
│     → 检查 formatVersion / 文件完整性 / 连续性     │
│                                                   │
│  ② 预处理（preprocess/）                          │
│     merge → diff → context → form_state           │
│     → classify → noise → List[EnrichedAction]     │
│                                                   │
│  ③ Phase 1（phases/phase1.py）                    │
│     EnrichedAction[] → LLM XML → StructuredStep[] │
│                                                   │
│  ④ Phase 2（phases/phase2.py）                    │
│     StructuredStep[] → LLM Markdown → cases.md    │
│                                                   │
│  ⑤ Phase 4（phases/phase4.py）                    │
│     StructuredStep[] → LLM XML → agents.txt       │
│                                                   │
│  ⑥ 写出翻译产物到 translate/ 子目录               │
└─────────────────────────────────────────────────┘
```

---

## 3. 数据模型设计（models.py）

使用 Pydantic v2 定义所有数据结构。这是本方案的**核心契约层**。

### 3.1 录制数据模型（输入）

```python
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ElementInfo(BaseModel):
    """action 中的目标元素信息"""
    tag: str
    xpath: str
    text: str = ""
    id: Optional[str] = None
    name: Optional[str] = None
    input_type: Optional[str] = Field(None, alias="inputType")
    placeholder: Optional[str] = None
    label: Optional[str] = None

    model_config = {"populate_by_name": True}


class ActionSummaryItem(BaseModel):
    """meta.json 中的操作摘要条目"""
    index: int
    type: str
    element_tag: str = Field(..., alias="elementTag")
    element_desc: str = Field(..., alias="elementDesc")
    page_title: str = Field(..., alias="pageTitle")
    timestamp: int


class RecordingMeta(BaseModel):
    """meta.json 的完整结构"""
    format_version: str = Field(..., alias="formatVersion")
    record_start_time: datetime = Field(..., alias="recordStartTime")
    record_end_time: datetime = Field(..., alias="recordEndTime")
    total_actions: int = Field(..., alias="totalActions")
    total_snapshots: int = Field(..., alias="totalSnapshots")
    target_url: str = Field(..., alias="targetUrl")
    start_page_title: str = Field(..., alias="startPageTitle")
    snapshot_poll_interval_ms: int = Field(300, alias="snapshotPollIntervalMs")
    action_summary: list[ActionSummaryItem] = Field(..., alias="actionSummary")

    model_config = {"populate_by_name": True}


class RawAction(BaseModel):
    """action_NNN.json 的完整结构"""
    index: int
    type: str
    timestamp: int
    url: str
    page_title: str = Field(..., alias="pageTitle")
    element: ElementInfo
    form_state: Optional[dict] = Field(None, alias="formState")

    model_config = {"populate_by_name": True}
```

### 3.2 预处理数据模型（中间态）

```python
class Classification(BaseModel):
    category: str
    element_type: str
    hints: list[str] = []


class EnrichedAction(BaseModel):
    """预处理后的富化 action"""
    index: int
    type: str
    original_type: Optional[str] = None
    input_value: Optional[str] = None
    element: ElementInfo
    key: Optional[str] = None
    url: str
    page_title: str
    timestamp: int
    form_state: Optional[dict] = None
    # 预处理追加字段
    snapshot_diff: Optional[str] = None
    pre_snapshot: Optional[str] = None
    post_snapshot: Optional[str] = None
    context_excerpt: Optional[str] = None
    form_state_changes: Optional[dict] = None
    form_state_change_text: Optional[str] = None
    classification: Classification = Classification(
        category="other", element_type="other"
    )
    skip: Optional[str] = None
    noise: Optional[bool] = None
    noise_reason: Optional[str] = None
```

### 3.3 翻译结果模型（输出）

```python
class StructuredStep(BaseModel):
    """Phase 1 输出：结构化步骤"""
    index: int
    status: str = "normal"  # normal | skip | noise | fallback
    description: str
    ui_change: str = "无可见变化"
    page: str = "未知"
    basis: list[str] = []
    action_kind: str = "other"
    target: str = ""
    input_text: str = ""
    key: str = ""
    assert_text: str = ""
    confidence: float = 0.7
    interval_from_previous_ms: Optional[int] = None
    url: str = ""
    source_type: str = "unknown"
```

### 3.4 设计优势

| 优势 | 说明 |
|------|------|
| **类型安全** | Pydantic 在数据入口做校验，字段缺失/类型错误在第一行就报错，不会传播到 LLM 调用层 |
| **alias 支持** | JSON 中的 camelCase 通过 `alias` 映射到 Python 的 snake_case，代码风格统一 |
| **可序列化** | `.model_dump(by_alias=True)` 直接输出 JSON，与 Node.js 产物格式一致 |
| **IDE 友好** | 属性自动补全、类型推导，减少查文档成本 |

---

## 4. 各模块详细设计

### 4.1 LLM 客户端（client.py）

#### 功能

与 Node.js `ai-client.js` 完全对等：

| 函数 | Node.js 对应 | 说明 |
|------|-------------|------|
| `call_chat(messages, **kwargs)` | `callChat()` | OpenAI Chat Completions |
| `call_vision(image_base64, prompt, **kwargs)` | `callVision()` | MiniMax M3 视觉模型 |
| `ping_llm()` | `pingLlm()` | 探活 |
| `clean_markdown_fence(text)` | `cleanMarkdownFence()` | 清理围栏 |
| `parse_json_from_llm_reply(text)` | `parseJsonFromLlmReply()` | JSON 解析 |

#### 实现要点

```python
import openai
import httpx

class LLMClient:
    """单例 LLM 客户端，与 Node.js 版行为一致"""

    def __init__(self, base_url: str, api_key: str, model: str):
        self._client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
        )
        self._model = model
        self._max_retries = 3
        self._base_delay_ms = 2000

    async def call_chat(
        self,
        messages: list[dict],
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
                    await asyncio.sleep(delay / 1000)

        raise RuntimeError(
            f"LLM 调用彻底失败，已重试 {self._max_retries} 次: {last_error}"
        )
```

**与 Node.js 版的关键差异**：

| 差异点 | Node.js | Python | 影响 |
|--------|---------|--------|------|
| HTTP 客户端 | openai npm 包内部用 node-fetch | openai Python 包内部用 httpx | 无功能差异 |
| 异步模型 | Promise + async/await | asyncio + async/await | 语义一致 |
| Vision API | 手写 fetch 调用 | 手写 httpx 调用 | 实现方式相同 |
| 重试 | for 循环 + setTimeout | for 循环 + asyncio.sleep | 语义一致 |

### 4.2 LLM 审计（audit.py）

#### 功能

与 Node.js `llm-audit.js` 完全对等。每次 LLM 调用落盘完整记录。

#### 接口

```python
class LlmAudit:
    def __init__(self, run_dir: str, log: Logger | None = None):
        self.audit_dir = run_dir / "translate" / "llm_audit"
        self.audit_dir.mkdir(parents=True, exist_ok=True)
        self._entries: list[dict] = []
        self._seq = 0

    async def call(
        self,
        meta: dict,         # {"phase": "phase1", "label": "batch 1~3", "extra": {...}}
        messages: list[dict],
        chat_options: dict | None = None,
    ) -> tuple[str, str]:
        """
        调用 LLM 并写入审计记录。
        返回 (call_id, raw_reply)。
        """
        ...

    def mark_outcome(
        self,
        call_id: str,
        outcome: dict,      # {"ok": True, "problems": [], "details": {...}}
    ) -> None:
        """标记调用结果"""
        ...

    def finalize(self) -> dict:
        """写出 problems.json / summary.json，返回摘要"""
        ...
```

#### 磁盘产物（与 Node.js 版格式一致）

```
translate/llm_audit/
├── call_0001.json     # 单次调用完整记录
├── call_0002.json
├── ...
├── index.json         # 全量调用索引
├── problems.json      # 失败调用列表
└── summary.json       # 汇总统计
```

**设计决策：审计文件的 JSON 格式与 Node.js 版完全一致**。这意味着两套实现的审计产物可以互相 diff，用于验证行为一致性。

### 4.3 预处理器（preprocess/）

#### 模块拆分

| Python 文件 | Node.js 对应 | 职责 |
|-------------|-------------|------|
| `merge.py` | `action-merge.js` | 双击去重 + 输入识别 + 密码脱敏 |
| `diff.py` | `snapshot-diff.js` | 行级快照 diff 计算 |
| `context.py` | `snapshot-context.js` | 上下文片段提取 |
| `form_state.py` | `formState-diff.js` | 表单状态 diff |
| `classify.py` | `action-classify.js` | 操作分类 + hints 生成 |
| `noise.py` | 嵌入在 `action-merge.js` 中 | 噪声检测 |
| `__init__.py` | `preprocessor/index.js` | 编排入口 |

#### 编排入口

```python
async def preprocess(
    run_dir: Path,
    log: Logger | None = None,
) -> tuple[list[EnrichedAction], RecordingMeta]:
    """
    预处理入口，与 Node.js preprocess() 输入输出对等。

    返回:
        enriched_actions: 富化后的 action 列表
        meta: 原始 meta 数据
    """
    # 1. 校验录制数据
    meta = validate_recording(run_dir)

    # 2. 读取原始 actions
    raw_actions = read_all_actions(run_dir, meta.total_actions, log)

    # 3. 语义归并
    merged_actions, merge_report = merge_actions(raw_actions, log=log)

    # 4. 计算快照 diff
    diffs = compute_all_diffs(run_dir, meta.total_snapshots, log=log)

    # 5. 逐条富化
    enriched = []
    prev_form_state = None
    for action in merged_actions:
        if action.skip:
            enriched.append(build_skipped_enriched(action))
            prev_form_state = action.form_state or prev_form_state
            continue

        snapshot_diff = diffs.get(action.index, "（diff 不可用）")
        context = extract_context(run_dir, action)
        form_changes = compute_form_state_changes(prev_form_state, action.form_state)
        classification = classify_action(action, snapshot_diff, form_changes)
        noise = detect_noise(action, snapshot_diff, form_changes)

        enriched.append(EnrichedAction(...))
        prev_form_state = action.form_state or prev_form_state

    # 6. 写出预处理产物
    write_preprocess_artifacts(run_dir, enriched, merge_report, log)

    return enriched, meta
```

#### 关键差异点：diff 计算

| 方面 | Node.js | Python |
|------|---------|--------|
| diff 库 | `npm diff`（`diffLines`） | `difflib`（标准库）或 `diff-match-patch` |
| 输出格式 | `+ line` / `- line` | 需要对齐到相同格式 |
| 截断策略 | 首尾各保留一半 | 相同策略 |

**建议**：使用 `difflib.unified_diff` 并自定义输出格式，使其与 Node.js 的 `+ line` / `- line` 格式完全一致。这是保证两端 diff 结果可比的关键。

```python
import difflib

def compute_diff(pre_text: str, post_text: str) -> str:
    """计算两段快照文本的行级 diff，输出格式与 Node.js 版一致"""
    pre_lines = pre_text.splitlines(keepends=True)
    post_lines = post_text.splitlines(keepends=True)

    diff = difflib.unified_diff(
        pre_lines, post_lines,
        lineterm='',
        n=0,  # 不输出上下文行，只输出变更行
    )

    result = []
    has_change = False
    for line in diff:
        if line.startswith('+') and not line.startswith('+++'):
            result.append(f"+ {line[1:].rstrip()}")
            has_change = True
        elif line.startswith('-') and not line.startswith('---'):
            result.append(f"- {line[1:].rstrip()}")
            has_change = True

    if not has_change:
        return "（preSnapshot 和 postSnapshot 完全相同，操作未引起可见的 UI 变化）"

    return '\n'.join(result)
```

### 4.4 XML 解析器（xml_parse.py）

#### 背景

当前 Node.js 版使用正则表达式解析 LLM 返回的 XML，存在以下问题：
- `boundedCrossLine(maxChars)` 构造的正则可能因 LLM 输出异常而回溯爆炸
- 多层正则嵌套（step block → action/observation）难以调试
- 新增 XML 标签需要手动拼接正则

#### Python 方案：混合策略

```python
import re
from xml.etree import ElementTree as ET

def parse_steps_xml(raw_reply: str) -> list[dict]:
    """
    解析 Phase 1 LLM 返回的 <steps> XML。

    策略：
    1. 先用正则预处理（去围栏、去 BOM、截断）
    2. 尝试 xml.etree 解析（快速路径）
    3. 失败时降级到正则提取（兼容路径）
    """
    text = preprocess_llm_output(raw_reply)

    # 快速路径：标准 XML 解析
    try:
        root = ET.fromstring(text)
        steps = []
        for step_el in root.findall('.//step'):
            step_id = int(step_el.get('id', '0'))
            action_el = step_el.find('action')
            obs_el = step_el.find('observation')
            steps.append({
                'id': step_id,
                'action': action_el.text.strip() if action_el is not None and action_el.text else '',
                'observation': obs_el.text.strip() if obs_el is not None and obs_el.text else '',
            })
        return steps
    except ET.ParseError:
        pass

    # 兼容路径：正则提取（与 Node.js 行为一致）
    return regex_extract_steps(text)
```

**优势**：
- 90% 的情况下 LLM 返回的 XML 是合法的，`ET.fromstring` 走快速路径
- 降级正则只在 LLM 返回畸形 XML 时触发，保证鲁棒性
- 新增标签只需修改 `findall()` 调用，不需拼正则

**风险**：
- `ET.fromstring` 对命名空间、CDATA 等处理与浏览器 DOM 不同，需要测试覆盖
- LLM 有时返回 `<step id=1>`（无引号），`ET.fromstring` 会失败，需降级

### 4.5 Prompt 管理（prompts/）

#### 方案：直接复用 .md 文件

```python
# prompts/loader.py
from pathlib import Path
import re

_MD_DIR = Path(__file__).parent.parent.parent / "src" / "case_translate" / "prompts" / "md"

def load_prompt_md(relative_path: str, vars: dict | None = None) -> str:
    """加载 Skill Prompt Markdown 文件"""
    full_path = _MD_DIR / relative_path
    text = full_path.read_text(encoding="utf-8-sig")  # 兼容 BOM

    if vars:
        for key, value in vars.items():
            text = text.replace(f"{{{{{key}}}}}", str(value))

    return text.strip()
```

**设计决策：不复制 .md 文件，而是从 Node.js 的 prompts/md/ 目录直接读取**。

| 优势 | 说明 |
|------|------|
| 单一真相源 | Prompt 修改只需改一处，两端同步生效 |
| 零维护成本 | 不需要维护两份 prompt 文件的同步 |
| 可回溯 | Git 历史中 prompt 变更只出现一次 |

| 风险 | 说明 |
|------|------|
| 路径耦合 | Python 包依赖 Node.js 的目录结构 |
| 打包困难 | 如果未来 Python 包独立分发，需要把 .md 文件复制过来 |

**缓解措施**：`_MD_DIR` 支持多路径查找，优先找 Python 包内的 `prompts/md/`，找不到再找 Node.js 目录：

```python
_MD_SEARCH_PATHS = [
    Path(__file__).parent / "md",                                    # Python 包内
    Path(__file__).parent.parent.parent / "src" / "case_translate" / "prompts" / "md",  # Node.js 目录
    Path.cwd() / "src" / "case_translate" / "prompts" / "md",       # CWD 回退
]
```

### 4.6 Phase 1：结构化步骤生成（phases/phase1.py）

#### 流程

```
EnrichedAction[]
    │
    ├─ skip/noise → 直接落地为 fallback step（不调 LLM）
    │
    ├─ 按 batchSize=3 分批
    │   │
    │   ├─ 构建 system prompt（snapshots-2-steps-skill.md）
    │   ├─ 构建 user prompt（历史上下文 + 本批 action JSON）
    │   ├─ 调用 LLM（经 llmAudit.call）
    │   ├─ 解析 XML（xml_parse.parse_steps_xml）
    │   ├─ 按 actionBatch[].index 对齐
    │   └─ 失败条目 → fallback step
    │
    └─ 写出 structured_steps.json + .xml + llm_raw_batches.xml
```

#### 接口

```python
async def run_phase1(
    run_dir: Path,
    enriched_actions: list[EnrichedAction],
    *,
    batch_size: int = 3,
    audit: LlmAudit,
    log: Logger | None = None,
) -> tuple[list[StructuredStep], list[dict]]:
    """
    Phase 1 入口。

    返回:
        steps: 结构化步骤列表
        errors: 解析失败的错误记录列表
    """
```

#### 与 Node.js 版的对齐要点

| 要点 | 说明 |
|------|------|
| context window | 取最近 10 条已生成 step 作为上下文 |
| XML 解析 | 先 etree 后正则，与 Node.js 的纯正则路径不同但结果一致 |
| fallback 逻辑 | skip/noise 直接落地，parse 失败逐条 fallback |
| 增量写盘 | 每批处理完立即写出 JSON + XML，支持中断恢复 |

### 4.7 Phase 2：测试用例归纳（phases/phase2.py）

#### 流程

```
StructuredStep[]
    │
    ├─ 过滤有效步骤（status=normal|fallback）
    │
    ├─ 瘦身（slim）：只保留 Phase 2 需要的字段
    │
    ├─ 按 windowSize=20 滑动窗口
    │   │
    │   ├─ 构建 system prompt（steps-2-cases-skill.md）
    │   ├─ 构建 user prompt（纯文本步骤 + index 列表）
    │   ├─ 调用 LLM
    │   ├─ 解析 Markdown + <case_meta/>
    │   ├─ consume 钳制（clamp）
    │   ├─ 全局 index 归一化
    │   ├─ 去重检查
    │   └─ 推进 cursor
    │
    ├─ 兜底判定：提取已覆盖 index → 找未覆盖 → 程序补全
    │
    ├─ 写出 cases.md + cases_fallback.md + coverage.md
    └─ 返回兜底元信息
```

#### 接口

```python
async def run_phase2(
    steps: list[StructuredStep],
    cases_file: Path,
    *,
    window_size: int = 20,
    audit: LlmAudit,
    log: Logger | None = None,
) -> Phase2Result:
    """
    Phase 2 入口。

    返回:
        fallback_applied: 是否触发兜底
        fallback_indices: 未覆盖的步骤 index
        fallback_file: 兜底文件路径
    """
```

#### 关键解析逻辑

```python
import re

def parse_case_meta(raw_reply: str) -> dict:
    """
    从 LLM 回复中解析 <case_meta consumeStepCount="N" lastIndex="M"/>。

    返回:
        {
            "consume_step_count": int | None,
            "last_index": int | None,
            "markdown_block": str,  # 去掉 meta 标签后的正文
        }
    """
    # 去围栏
    text = clean_markdown_fence(raw_reply)

    # 提取 consumeStepCount
    meta_pat = re.compile(
        r'<case_meta[^>]*\bconsumeStepCount\s*=\s*["\']?(\d+)["\']?[^>]*/?>',
        re.IGNORECASE,
    )
    meta_match = meta_pat.search(text)

    raw_consume = int(meta_match.group(1)) if meta_match else None

    # 提取 lastIndex
    last_index_pat = re.compile(r'\blastIndex\s*=\s*["\']?(\d+)["\']?', re.IGNORECASE)
    last_index_match = last_index_pat.search(text)
    raw_last_index = int(last_index_match.group(1)) if last_index_match else None

    # 去掉 meta 标签
    markdown_block = meta_pat.sub('', text).strip()

    return {
        "consume_step_count": raw_consume,
        "last_index": raw_last_index,
        "markdown_block": markdown_block,
    }
```

### 4.8 Phase 4：Agent TXT 生成（phases/phase4.py）

#### 流程

与 Phase 2 类似，但 LLM 输出 `<agent_chunk>` XML，程序渲染为纯文本。

```python
async def run_phase4(
    run_dir: Path,
    steps: list[StructuredStep],
    *,
    window_size: int = 20,
    audit: LlmAudit,
    log: Logger | None = None,
) -> Path | None:
    """
    Phase 4 入口。

    返回:
        agents.txt 文件路径，无有效步骤时返回 None
    """
```

### 4.9 工作流编排（workflow.py）

```python
async def run_workflow(
    run_dir: Path,
    enriched_actions: list[EnrichedAction],
    *,
    phase1_batch_size: int = 3,
    phase2_window_size: int = 20,
    log: Logger | None = None,
) -> WorkflowResult:
    """
    完整翻译工作流：Phase 1 → Phase 2 → Phase 4。
    """
    audit = LlmAudit(run_dir, log)

    # Phase 1
    steps, errors = await run_phase1(
        run_dir, enriched_actions,
        batch_size=phase1_batch_size, audit=audit, log=log,
    )

    # Phase 2
    phase2_result = await run_phase2(
        steps, cases_file=...,
        window_size=phase2_window_size, audit=audit, log=log,
    )

    # Phase 4
    agent_txt_file = await run_phase4(
        run_dir, steps,
        window_size=phase2_window_size, audit=audit, log=log,
    )

    audit.finalize()

    return WorkflowResult(
        steps_file=...,
        cases_file=...,
        agent_txt_file=agent_txt_file,
        fallback_applied=phase2_result.fallback_applied,
        fallback_indices=phase2_result.fallback_indices,
        cases_fallback_file=phase2_result.fallback_file,
    )
```

### 4.10 CLI 入口（__main__.py）

```python
# __main__.py
"""
用法:
    python -m ai_ui_translate                          # 翻译最新录制
    python -m ai_ui_translate run_2026-06-04T11-39-58  # 翻译指定录制
    python -m ai_ui_translate /path/to/run_dir         # 翻译指定路径
"""

import asyncio
import sys
from pathlib import Path

from .workflow import run_workflow
from .preprocess import preprocess

async def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None
    run_dir = resolve_run_dir(target)

    print(f"翻译目标: {run_dir}")

    # 预处理
    enriched, meta = await preprocess(run_dir)

    # 翻译
    result = await run_workflow(run_dir, enriched)

    print(f"结构化步骤: {result.steps_file}")
    print(f"测试用例: {result.cases_file}")
    if result.agent_txt_file:
        print(f"Agent 用例: {result.agent_txt_file}")

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 5. 配置管理（config.py）

```python
from pathlib import Path
import json
import os

# === 录制数据规范 ===
META_FILENAME = "meta.json"
FORMAT_VERSION = "1.0"

# === 预处理 ===
DIFF_TRUNCATE_THRESHOLD = 3000
CONTEXT_EXCERPT_MAX_SIBLINGS = 5
DBLCLICK_TIME_THRESHOLD_MS = 500
PASSWORD_MASK = "[MASKED]"

# === Phase 1 ===
PHASE1_BATCH_SIZE = 3
EVIDENCE_CONTEXT_WINDOW_SIZE = 10
PHASE1_LLM_RAW_MAX_CHARS = 60000

# === Phase 2 ===
PHASE2_WINDOW_SIZE = 20
PHASE2_WINDOW_MAX_TOKENS = 3500
PHASE2_GAP_TAG_LONG_GAP_MS = 45000
PHASE2_ASSERT_TEXT_MAX_CHARS = 200

# === Phase 4 ===
PHASE4_WINDOW_SIZE = 20

# === 滑动窗口安全 ===
SLIDING_WINDOW_MAX_ROUND_MULTIPLIER = 2


def load_ai_config() -> dict:
    """
    加载 AI 配置，查找顺序：
    1. CWD/config/ai.local.json
    2. CWD/release1/config/ai.local.json
    3. 环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL
    """
    candidates = [
        Path.cwd() / "config" / "ai.local.json",
        Path.cwd() / "release1" / "config" / "ai.local.json",
    ]
    for p in candidates:
        if p.exists():
            raw = p.read_text(encoding="utf-8-sig")
            return json.loads(raw)

    return {
        "baseUrl": os.environ.get("AI_BASE_URL", ""),
        "apiKey": os.environ.get("AI_API_KEY", ""),
        "model": os.environ.get("AI_MODEL", ""),
    }
```

**与 Node.js 版的差异**：配置查找路径增加了 `release1/config/ai.local.json`（因为当前 `release1/` 目录下有一份实际配置文件）。

---

## 6. 测试策略

### 6.1 单元测试

| 测试文件 | 覆盖范围 | 测试方法 |
|----------|----------|----------|
| `test_preprocess.py` | merge、diff、context、classify、noise | fixture 数据 + 断言输出 |
| `test_xml_parse.py` | XML 解析（快速路径 + 降级路径） | 合法 XML + 畸形 XML |
| `test_phase1.py` | Phase 1 解析 + fallback | mock LLM 返回 |
| `test_phase2.py` | Phase 2 解析 + consume 钳制 | mock LLM 返回 |
| `test_models.py` | Pydantic 模型校验 | 边界值 + 缺失字段 |

### 6.2 集成测试：双端一致性验证

```python
def test_result_consistency():
    """
    用同一份录制数据，分别用 Node.js 和 Python 翻译，
    比较 structured_steps.json 的关键字段是否一致。

    这是验证 Python 版正确性的终极手段。
    """
    # 1. 读取 Node.js 产物
    js_steps = json.loads(Path("data_check/run_.../translate/phase1/structured_steps.json").read_text())

    # 2. Python 翻译同一份数据
    enriched, meta = await preprocess(run_dir)
    py_steps, errors = await run_phase1(run_dir, enriched, ...)

    # 3. 比较关键字段
    for js, py in zip(js_steps, py_steps):
        assert js["index"] == py.index
        assert js["status"] == py.status
        assert js["actionKind"] == py.action_kind
        # description/uiChange 由 LLM 生成，不要求逐字一致
        # 但 status/actionKind/target 必须一致
```

### 6.3 Fixture 数据

```python
# tests/conftest.py
import pytest
from pathlib import Path

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "run_sample"

@pytest.fixture
def sample_run_dir():
    """返回样本录制数据目录"""
    return FIXTURE_DIR

@pytest.fixture
def sample_meta():
    """返回解析后的 meta 对象"""
    return RecordingMeta.model_validate_json(
        (FIXTURE_DIR / "meta.json").read_text()
    )
```

---

## 7. 优点总结

### 7.1 工程层面

| 优点 | 说明 |
|------|------|
| **类型安全** | Pydantic 模型在入口做校验，杜绝 "undefined is not a function" 类运行时错误 |
| **标准库 diff** | `difflib` 是标准库，零外部依赖，不会出现 npm 包版本冲突 |
| **XML 双路径** | etree 快速路径 + 正则降级，比纯正则更健壮 |
| **asyncio 原生** | Python 的 asyncio 对"多路并发"（如未来并行调 LLM）表达力更强 |
| **测试友好** | pytest + mock 对 "读文件→调 LLM→写文件" 的 pipeline 测试比 jest 更直觉 |

### 7.2 架构层面

| 优点 | 说明 |
|------|------|
| **Prompt 单一真相源** | 直接读 Node.js 的 .md 文件，改一处两端生效 |
| **审计格式一致** | llm_audit 的 JSON 格式与 Node.js 版完全一致，可互相 diff |
| **Pydantic 契约层** | 数据模型即文档，新成员看 models.py 就知道数据结构 |
| **录制端零改动** | 完全消费现有录制数据格式，录制端不需要任何修改 |

### 7.3 未来演进

| 优点 | 说明 |
|------|------|
| **AI 生态接入** | 未来加 RAG / fine-tune / 本地模型，Python 是唯一选择 |
| **数据处理能力** | 如果需要批量分析历史录制数据，pandas/polars 可直接用 |
| **独立分发** | 未来可独立打包为 Python 包（pip install），不依赖 Node.js 代码库 |

---

## 8. 风险与缓解

### 8.1 高风险

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| **LLM 输出非确定性** | 同一输入两次调用可能得到不同的 description/uiChange | 高 | 不比较自由文本字段；只比较 status/actionKind/target 等结构化字段；diff 结果做模糊匹配 |
| **difflib 输出与 Node.js diff 不完全一致** | 快照 diff 文本可能有微小差异（空行处理、换行符） | 中 | 统一换行符为 `\n`；diff 输出格式用自定义函数而非 `unified_diff` 的默认格式；用现有录制数据做回归测试 |
| **XML 解析行为差异** | etree 对畸形 XML 的容错方式与正则不同 | 中 | 用 Node.js 的 LLM 原始输出（`llm_raw_batches.xml`）作为测试 fixture，确保 Python 解析结果与 Node.js 一致 |

### 8.2 中风险

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| **Prompt 文件路径耦合** | Python 包依赖 Node.js 目录结构 | 中 | 多路径查找 + 首次运行时打印实际使用的 prompt 路径 |
| **Pydantic 性能** | 大量 action 的模型实例化可能有开销 | 低 | 38 个 action 的场景下无感知；超过 1000 个时考虑用 `model_validate` 批量模式 |
| **asyncio 学习成本** | 团队成员可能不熟悉 Python asyncio | 低 | 代码结构与 Node.js 版一一对应，注释中标注对应的 JS 文件名 |

### 8.3 低风险

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| **Python 版本兼容** | Pydantic v2 需要 Python 3.11+ | 低 | pyproject.toml 中明确声明 `requires-python = ">=3.11"` |
| **openai SDK 版本差异** | Python openai SDK 的行为可能与 Node.js 版有微小差异 | 低 | 都是 Chat Completions API，协议层一致 |

---

## 9. 实施计划

### Phase 0：基础设施（1 天）

- [ ] 创建 `ai_ui_translate/` 目录结构
- [ ] 编写 `pyproject.toml`
- [ ] 编写 `models.py`（所有 Pydantic 模型）
- [ ] 编写 `config.py`
- [ ] 编写 `__init__.py` 和 `__main__.py`（空壳）

### Phase 1：预处理器（2 天）

- [ ] `preprocess/diff.py` — 快照 diff 计算
- [ ] `preprocess/merge.py` — 语义归并
- [ ] `preprocess/context.py` — 上下文提取
- [ ] `preprocess/form_state.py` — 表单状态 diff
- [ ] `preprocess/classify.py` — 操作分类
- [ ] `preprocess/noise.py` — 噪声检测
- [ ] `preprocess/__init__.py` — 编排入口
- [ ] 单元测试：用 `data_check/run_2026-06-04T11-39-58/` 作为 fixture

### Phase 2：LLM 基础设施（1 天）

- [ ] `client.py` — LLM 客户端
- [ ] `audit.py` — LLM 审计
- [ ] `prompts/loader.py` — Prompt 加载器
- [ ] `xml_parse.py` — XML 解析器

### Phase 3：翻译工作流（3 天）

- [ ] `phases/phase1.py` — Phase 1
- [ ] `phases/phase2.py` — Phase 2
- [ ] `phases/phase4.py` — Phase 4
- [ ] `workflow.py` — 编排
- [ ] `prompts/step_structured.py` — Phase 1 prompt builder
- [ ] `prompts/case_generation.py` — Phase 2 prompt builder
- [ ] `prompts/agent_txt.py` — Phase 4 prompt builder

### Phase 4：集成验证（1 天）

- [ ] 用 `data_check/run_2026-06-04T11-39-58/` 做端到端测试
- [ ] 比较 Python 产物与 Node.js 产物的关键字段
- [ ] 修复 diff 格式差异
- [ ] 编写 `tests/` 下的集成测试

### 总计：约 8 个工作日

---

## 10. 附录：Node.js → Python 函数映射表

| Node.js 文件 | Node.js 函数 | Python 文件 | Python 函数 |
|-------------|-------------|-------------|-------------|
| `ai-client.js` | `callChat()` | `client.py` | `LLMClient.call_chat()` |
| `ai-client.js` | `callVision()` | `client.py` | `LLMClient.call_vision()` |
| `ai-client.js` | `pingLlm()` | `client.py` | `LLMClient.ping()` |
| `ai-client.js` | `cleanMarkdownFence()` | `client.py` | `clean_markdown_fence()` |
| `llm-audit.js` | `createLlmAudit()` | `audit.py` | `LlmAudit.__init__()` |
| `llm-audit.js` | `.call()` | `audit.py` | `LlmAudit.call()` |
| `llm-audit.js` | `.markOutcome()` | `audit.py` | `LlmAudit.mark_outcome()` |
| `llm-audit.js` | `.finalize()` | `audit.py` | `LlmAudit.finalize()` |
| `preprocessor/action-merge.js` | `mergeActions()` | `preprocess/merge.py` | `merge_actions()` |
| `preprocessor/action-merge.js` | `detectNoise()` | `preprocess/noise.py` | `detect_noise()` |
| `preprocessor/snapshot-diff.js` | `computeAllDiffs()` | `preprocess/diff.py` | `compute_all_diffs()` |
| `preprocessor/snapshot-diff.js` | `computeDiff()` | `preprocess/diff.py` | `compute_diff()` |
| `preprocessor/snapshot-context.js` | `extractContextExcerpt()` | `preprocess/context.py` | `extract_context()` |
| `preprocessor/formState-diff.js` | `computeFormStateChanges()` | `preprocess/form_state.py` | `compute_form_state_changes()` |
| `preprocessor/action-classify.js` | `classifyAction()` | `preprocess/classify.py` | `classify_action()` |
| `preprocessor/index.js` | `preprocess()` | `preprocess/__init__.py` | `preprocess()` |
| `workflow.js` | `runWorkflow()` | `workflow.py` | `run_workflow()` |
| `workflow.js` | `runPhase1Structured()` | `phases/phase1.py` | `run_phase1()` |
| `workflow.js` | `runPhase2FromStructured()` | `phases/phase2.py` | `run_phase2()` |
| `phase4/agent-txt-generator.js` | `generateAgentTxt()` | `phases/phase4.py` | `run_phase4()` |
| `phase1/xml-step-extractor.js` | `robustExtractSteps()` | `xml_parse.py` | `parse_steps_xml()` |
| `phase4/xml-agent-chunk-parser.js` | `parseAgentChunkXml()` | `xml_parse.py` | `parse_agent_chunk_xml()` |
| `xml-parse-utils.js` | `clampWindowConsume()` | `xml_parse.py` | `clamp_window_consume()` |
| `xml-parse-utils.js` | `maxSlidingWindowRounds()` | `xml_parse.py` | `max_sliding_window_rounds()` |
| `prompts/loader.js` | `loadPromptMd()` | `prompts/loader.py` | `load_prompt_md()` |
| `index.js` | `generate()` | `__main__.py` | `main()` |

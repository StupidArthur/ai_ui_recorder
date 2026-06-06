# AI UI Recorder 翻译平台设计文档（合并版）

> **状态**：可开工
> **作者**：@yuzechao
> **日期**：2026-06-06
> **supersede 范围**：本文档合并并取代 `doc/recording_data_spec.md`（录制数据格式）与 `doc/python_translate_design.md`（Python 翻译设计）的独立版本。旧两份文档保留为历史参考。
> **关联文档**：
> - `doc/run_directory_layout.md` — translate 产物路径权威来源（本文档直接引用，不重复定义）
> - `doc/design.md` / `doc/translate_design.md` — 旧总设，本文档 supersede 其中「录制数据格式」与「翻译管线」相关章节

---

## 1. 背景与目标

### 1.1 现状

翻译模块（`src/case_translate/`）当前使用 Node.js 实现，与录制器共享同一代码库。随着 AI 翻译能力的迭代（prompt 优化、新 Phase、未来 RAG/fine-tune），Python 的 AI 生态优势日益明显。

### 1.2 目标

将翻译模块用 Python 重写为独立包 `ai_ui_translate/`：

1. **录制端最小改动**：Node.js 录制器按本规范产出数据（见 §3 的 v0→v1 过渡策略）
2. **翻译端独立实现**：Python 包消费录制数据，产出翻译结果
3. **共存期**：两套翻译实现并行，可互相验证
4. **单机版 CLI 工具**：不涉及 Web Server

### 1.3 非目标

| 不做 | 原因 |
|------|------|
| 删除 Node.js 翻译代码 | 共存期保留，Dashboard 仍调用 Node translate |
| 改变录制端核心逻辑 | 仅做格式字段的小幅调整（见 §3.4） |
| Web Server / API 化 | 后续再议 |
| 异步任务队列 | 单机场景不需要 |

### 1.4 共存期职责划分

| 组件 | 调用的翻译端 | 场景 |
|------|-------------|------|
| Dashboard（`npm run dashboard`） | **Node translate** | 不变，用户体验无感知 |
| CLI（`npm run translate`） | **Node translate** | 不变 |
| Python CLI（`python -m ai_ui_translate`） | **Python translate** | 开发/对比/CI |
| 双端一致性测试 | 两端都调 | 回归验证 |

---

## 2. 总体架构

### 2.1 系统拓扑

```
┌─────────────────────────────────────────────────────────┐
│                    Node.js 录制器                        │
│  src/recorder/recorder.js + inject-script.js            │
│  产出：run_<timestamp>/record/{meta.json,actions/,snapshots/}  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │  文件契约（§3）
                       ▼
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │  Node.js 翻译     │    │  Python 翻译              │   │
│  │  src/case_translate│    │  ai_ui_translate/         │   │
│  │  （保留，不删）    │    │  （新增）                 │   │
│  └────────┬─────────┘    └────────┬─────────────────┘   │
│           │                       │                      │
│           ▼                       ▼                      │
│  ┌──────────────────────────────────────────────────────┐│
│  │  translate/ 产物（run_directory_layout.md）           ││
│  │  phase1/phase2/phase4/llm_audit/preprocess/          ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 2.2 Python 包目录结构

```
ai_ui_translate/
├── pyproject.toml
├── ai_ui_translate/
│   ├── __init__.py
│   ├── __main__.py               # python -m ai_ui_translate
│   ├── config.py                 # 配置常量 + AI 配置加载
│   ├── models.py                 # Pydantic 数据模型（契约层）
│   ├── adapter.py                # v0→v1 格式适配器
│   ├── validate.py               # 录制数据校验
│   ├── client.py                 # LLM 客户端（合并现有 ai_client.py）
│   ├── audit.py                  # LLM 审计
│   ├── xml_parse.py              # XML 解析工具
│   ├── prompts/
│   │   ├── loader.py             # Prompt 加载器（读 Node 的 prompts/md/）
│   │   ├── step_structured.py    # Phase 1 prompt builder
│   │   ├── case_generation.py    # Phase 2 prompt builder
│   │   └── agent_txt.py          # Phase 4 prompt builder
│   ├── preprocess/
│   │   ├── __init__.py           # 编排入口
│   │   ├── merge.py              # 语义归并
│   │   ├── diff.py               # 快照 diff
│   │   ├── context.py            # 上下文提取
│   │   ├── form_state.py         # 表单状态 diff
│   │   ├── classify.py           # 操作分类
│   │   └── noise.py              # 噪声检测
│   └── phases/
│       ├── __init__.py
│       ├── phase1.py             # 结构化步骤生成
│       ├── phase2.py             # 测试用例归纳
│       └── phase4.py             # Agent TXT 生成
└── tests/
    ├── conftest.py
    ├── test_validate.py
    ├── test_adapter.py
    ├── test_preprocess.py
    ├── test_phase1.py
    ├── test_phase2.py
    ├── test_xml_parse.py
    └── fixtures/
        └── run_sample/           # symlink 或复制 data_check/run_*
```

### 2.3 依赖

```toml
[project]
name = "ai-ui-translate"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "openai>=1.0",        # LLM Chat Completions
    "pydantic>=2.0",      # 数据模型
    "httpx>=0.27",        # Vision API 调用
]
# diff 使用标准库 difflib，不引入额外依赖

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "respx",
]
```

**关于 diff 依赖**：统一使用标准库 `difflib`（`SequenceMatcher`，`autojunk=False`），不引入 `diff-match-patch`。输出格式通过自定义 `compute_diff()` 对齐到 Node.js 的 `+ line` / `- line` 格式，并实现 `truncate_diff()` 截断超长 diff（见 §5.3）。验收标准为**变更行集合一致**（忽略分块/顺序）。

### 2.4 数据流

```
录制数据目录
  │
  ▼
① validate.py — 校验 + v0/v1 适配（adapter.py）
  │
  ▼
② preprocess/ — 语义归并 → diff → 上下文 → form_state → classify → noise
  │  输出：List[EnrichedAction]
  ▼
③ phases/phase1.py — LLM 微批处理 → StructuredStep[]
  │
  ▼
④ phases/phase2.py — LLM 滑动窗口 → cases.md + cases_fallback.md + coverage.md
  │
  ▼
⑤ phases/phase4.py — LLM 聚合 → agents.txt
  │
  ▼
⑥ 写出到 translate/ 子目录（路径由 run_directory_layout.md 定义）
```

---

## 3. 录制数据契约

### 3.1 目录与命名

```
run_<timestamp>/
├── meta.json                    # 录制元信息（唯一入口锚点）
├── record/
│   ├── recorder.log             # 录制日志
│   ├── actions/                 # action_001.json ~ action_NNN.json（1-based, 3 位零填充）
│   ├── snapshots/               # snapshot_000.txt ~ snapshot_NNN.txt（0-based, 3 位零填充）
│   └── screenshots/             # [可选] NNNN_action_N_type.format
└── translate/                   # 翻译产物（路径定义见 doc/run_directory_layout.md）
```

**快照与操作的关联**：

- `action_N` 的 preSnapshot = `snapshot_{N-1}`
- `action_N` 的 postSnapshot = `snapshot_{N}`
- 快照总数 = action 总数 + 1

### 3.2 meta.json Schema

```jsonc
{
  "formatVersion": "1.0",           // [v1.0 新增] 格式版本
  "recordStartTime": "2026-06-04T11:39:58.079Z",
  "recordEndTime": "2026-06-04T11:42:03.055Z",
  "totalActions": 38,
  "totalSnapshots": 39,              // [v1.0 新增] = totalActions + 1
  "targetUrl": "https://...",
  "startPageTitle": "TPT",
  "snapshotPollIntervalMs": 300,
  "pages": [                         // [v1.0 新增] 替代 pageCount
    { "title": "TPT", "url": "https://..." }
  ],
  "actionSummary": [
    {
      "index": 1,
      "type": "click",               // 原始 DOM 事件类型（click/dblclick/rightclick/keypress）
      "elementTag": "input",         // [v1.0 新增] 替代 desc 中的 <tag> 部分
      "elementDesc": "请输入用户名",  // [v1.0 新增] 替代 desc
      "pageTitle": "TPT",            // [v1.0 新增] 替代 page
      "timestamp": 1780573206937     // [v1.0 新增] Unix 毫秒
    }
  ]
}
```

### 3.3 action_NNN.json Schema

```jsonc
{
  "index": 1,
  "type": "click",                   // DOM 事件类型枚举：click | dblclick | rightclick | keypress
  "timestamp": 1780573206937,
  "url": "https://...",
  "pageTitle": "TPT",               // [v1.0] 替代 title
  "element": {
    "tag": "input",
    "xpath": "//*[@id='username']",
    "text": "",
    "id": "username",
    "name": null,
    "inputType": "text",             // [v1.0] 替代 type（避免与 action.type 混淆）
    "placeholder": "请输入用户名",
    "label": null
  },
  "formState": {                     // [v1.0] 替代 formStateDelta
    // 绝对快照：操作瞬间的全页面表单状态
    // 步骤间的变化由翻译端对比相邻 action 的 formState 计算
    "//*[@id='username']": {
      "value": "",
      "checked": null,
      "selectedIndex": null
    },
    // 以下为可选的 ARIA 状态（并非所有元素都有）
    "//div[normalize-space(.)='密码登录']": {
      "ariaSelected": "true"         // Tab/Segmented control 的选中状态
    }
  }
}
```

**formState 语义澄清**：

- `formState` 存储的是操作瞬间的**绝对状态快照**（不是差量）
- 两个相邻 action 之间的表单**变化**由翻译端的 `preprocess/form_state.py` 对比计算
- 字段名从 `formStateDelta` 改为 `formState` 是为了消除歧义
- formState 条目的值是**宽松 dict**，保留未知键（如 `ariaSelected`、`ariaExpanded`、`ariaChecked` 等 ARIA 状态）。Pydantic 模型中类型为 `dict[str, dict[str, Any]]`，不丢弃未显式定义的字段

### 3.4 snapshot_NNN.txt 格式

纯文本 YAML 风格缩进树，表示浏览器 Accessibility Tree 的裁剪版本：

```
- WebArea "TPT"
  - textbox "请输入用户名" [required, value="15700078644"]
  - textbox "请输入密码" [required, value="•••••••••••"]
  - button "立即登录"
```

裁剪规则：最大深度 8 层，跳过 `none`/`generic`/`presentation`/`StaticText` 等无意义叶子节点，只保留有值的属性。

### 3.5 recorder.log 格式

```
[ISO-8601-UTC] [LEVEL] message
```

### 3.6 翻译产物路径

翻译产物的目录结构和文件名由 `doc/run_directory_layout.md` 定义，Python 包通过 `run-layout.js` 的等价常量引用，**不在 Python 中硬编码路径字符串**。

Python 中的路径常量定义（`config.py`）：

```python
# 与 src/utils/run-layout.js 对齐的路径常量
TRANSLATE_SUBDIR = "translate"
PREPROCESS_SUBDIR = f"{TRANSLATE_SUBDIR}/preprocess"
PHASE1_SUBDIR = f"{TRANSLATE_SUBDIR}/phase1"
PHASE2_SUBDIR = f"{TRANSLATE_SUBDIR}/phase2"
PHASE4_SUBDIR = f"{TRANSLATE_SUBDIR}/phase4"
LLM_AUDIT_SUBDIR = f"{TRANSLATE_SUBDIR}/llm_audit"

STRUCTURED_STEPS_JSON = f"{PHASE1_SUBDIR}/structured_steps.json"
STRUCTURED_STEPS_XML = f"{PHASE1_SUBDIR}/structured_steps.xml"
LLM_RAW_BATCHES_XML = f"{PHASE1_SUBDIR}/llm_raw_batches.xml"
ERRORS_JSON = f"{PHASE1_SUBDIR}/errors.json"
CASES_MD = f"{PHASE2_SUBDIR}/cases.md"
CASES_FALLBACK_MD = f"{PHASE2_SUBDIR}/cases_fallback.md"
COVERAGE_MD = f"{PHASE2_SUBDIR}/coverage.md"
AGENTS_TXT = f"{PHASE4_SUBDIR}/agents.txt"
```

### 3.7 v0（现网）与 v1.0（目标）差异与过渡策略

#### 差异对照表

| 项目 | v0（现网 recorder 产出） | v1.0（目标） |
|------|------------------------|-------------|
| `formatVersion` | 无 | 必填 `"1.0"` |
| `totalSnapshots` | 无 | 必填 |
| `actionSummary[].desc` | 自由文本 `"点击 <input> \"...\""` | 拆为 `elementTag` + `elementDesc` |
| `actionSummary[].page` | 字段名 `page` | 字段名 `pageTitle` |
| `actionSummary[].timestamp` | 无 | 必填 |
| `actionSummary[].url` | 有 | 删除（action 文件中有） |
| `convention` | 有（自由文本） | 删除 |
| `pageCount` | 有 | 删除（由 `pages` 数组长度推导） |
| action `title` | 字段名 `title` | 字段名 `pageTitle` |
| action `formStateDelta` | 字段名 `formStateDelta` | 字段名 `formState` |
| element `type` | 字段名 `type` | 字段名 `inputType` |
| element `href` / `title` | 有（通常为 null） | 删除 |

#### 过渡策略：Python 支持 v0 + v1.0 双模式

**方案 A（采用）**：Python 端做适配层，同时兼容 v0 和 v1.0 格式。录制端后续再逐步升级到 v1.0。

```python
# adapter.py

def adapt_meta_v0_to_v1(raw: dict, run_dir: Path | None = None) -> dict:
    """
    将 v0 格式的 meta.json 适配为 v1.0 结构。

    Args:
        raw: 原始 meta.json 解析后的 dict
        run_dir: 录制目录路径（用于从 action 文件回填 timestamp）
    """
    adapted = dict(raw)

    # 补 formatVersion
    if "formatVersion" not in adapted:
        adapted["formatVersion"] = "0.0"

    # 补 totalSnapshots
    if "totalSnapshots" not in adapted:
        adapted["totalSnapshots"] = adapted["totalActions"] + 1

    # actionSummary 字段映射
    if "actionSummary" in adapted:
        for item in adapted["actionSummary"]:
            if "desc" in item and "elementTag" not in item:
                parsed = parse_desc(item["desc"])
                item["elementTag"] = parsed["tag"]
                item["elementDesc"] = parsed["desc"]
            if "page" in item and "pageTitle" not in item:
                item["pageTitle"] = item.pop("page")
            # timestamp：从 action 文件回填（v0 summary 中无此字段）
            if "timestamp" not in item and run_dir:
                action_file = run_dir / "record" / "actions" / f"action_{item['index']:03d}.json"
                if action_file.exists():
                    action_data = json.loads(action_file.read_text("utf-8"))
                    item["timestamp"] = action_data.get("timestamp")

    # convention → 删除
    adapted.pop("convention", None)

    return adapted


def adapt_action_v0_to_v1(raw: dict) -> dict:
    """将 v0 格式的 action_NNN.json 适配为 v1.0 结构"""
    adapted = dict(raw)

    # title → pageTitle
    if "title" in adapted and "pageTitle" not in adapted:
        adapted["pageTitle"] = adapted.pop("title")

    # element.type → element.inputType
    if "element" in adapted:
        el = dict(adapted["element"])
        if "type" in el and "inputType" not in el:
            el["inputType"] = el.pop("type")
        # 删除 v1.0 不需要的字段
        el.pop("href", None)
        el.pop("title", None)
        adapted["element"] = el

    # formStateDelta → formState（原样透传，不做脱敏）
    if "formStateDelta" in adapted and "formState" not in adapted:
        adapted["formState"] = adapted.pop("formStateDelta")

    return adapted
```

#### validate.py 校验入口

```python
def validate_recording(run_dir: Path) -> tuple[RecordingMeta, str]:
    """
    校验录制数据，返回 (meta, format_version)。

    format_version: "0.0"（现网）或 "1.0"（目标）
    """
    meta_path = run_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"meta.json 不存在: {meta_path}")

    raw = json.loads(meta_path.read_text("utf-8-sig"))

    # 适配 v0 → v1 结构（传入 run_dir 用于从 action 文件回填 timestamp）
    adapted = adapt_meta_v0_to_v1(raw, run_dir=run_dir)
    version = adapted["formatVersion"]

    # 解析
    meta = RecordingMeta.model_validate(adapted)

    # 校验
    actions_dir = run_dir / "record" / "actions"
    snapshots_dir = run_dir / "record" / "snapshots"

    actual_actions = len(list(actions_dir.glob("action_*.json")))
    actual_snapshots = len(list(snapshots_dir.glob("snapshot_*.txt")))

    if meta.total_actions != actual_actions:
        raise ValueError(
            f"totalActions 不一致: meta={meta.total_actions}, 实际={actual_actions}"
        )
    if meta.total_snapshots != actual_snapshots:
        raise ValueError(
            f"totalSnapshots 不一致: meta={meta.total_snapshots}, 实际={actual_snapshots}"
        )
    if meta.total_snapshots != meta.total_actions + 1:
        raise ValueError(
            f"totalSnapshots({meta.total_snapshots}) != totalActions({meta.total_actions}) + 1"
        )

    # action 文件连续性
    for i in range(1, meta.total_actions + 1):
        action_file = actions_dir / f"action_{i:03d}.json"
        if not action_file.exists():
            raise FileNotFoundError(f"action 文件缺失: {action_file}")

    # snapshot 文件连续性
    for i in range(0, meta.total_snapshots):
        snapshot_file = snapshots_dir / f"snapshot_{i:03d}.txt"
        if not snapshot_file.exists():
            raise FileNotFoundError(f"snapshot 文件缺失: {snapshot_file}")

    return meta, version
```

### 3.8 校验规则

#### 必须校验（不满足则拒绝处理）

| # | 校验项 | 规则 |
|---|--------|------|
| 1 | meta.json 存在 | `run_dir/meta.json` 可读 |
| 2 | formatVersion 可识别 | `"0.0"` 或 `"1.x"`（主版本号为 0 或 1） |
| 3 | totalActions 一致 | `meta.totalActions` == `actions/` 下文件数 |
| 4 | totalSnapshots 一致 | `meta.totalSnapshots` == `snapshots/` 下文件数 |
| 5 | totalSnapshots = totalActions + 1 | 快照比操作多一个 |
| 6 | action 文件连续 | `action_001.json` 到 `action_NNN.json` 无缺失 |
| 7 | snapshot 文件连续 | `snapshot_000.txt` 到 `snapshot_NNN.txt` 无缺失 |
| 8 | action index 一致 | 每个 action 文件的 `index` == 文件名中的数字 |

#### 建议校验（不满足则警告）

| # | 校验项 | 规则 |
|---|--------|------|
| 9 | 时间戳单调递增 | `action[i].timestamp >= action[i-1].timestamp` |
| 10 | snapshot 非空 | 每个 snapshot 文件至少 10 字节 |
| 11 | formState 类型 | 为 null 或 Object |
| 12 | element.xpath 非空 | 不为空字符串 |

### 3.9 安全约束

| # | 约束 | 说明 |
|---|------|------|
| 1 | URL 中的 token | 可选：录制端剥离 JWT；Python 端不处理 |

> **关于密码**：测试环境账号无需脱敏。formState 中的密码值原样透传，录制端与翻译端均不做脱敏处理。

### 3.10 扩展预留

| 扩展点 | 位置 | 说明 |
|--------|------|------|
| canvas 录制 | `record/canvas/` | 未来可存放 canvas 绘制操作序列 |
| 视频录制 | `record/video/` | 页面操作录屏 |
| formState 扩展 | `formState[xpath].*` | 可新增 ARIA 状态 |
| meta/action 新增字段 | 根对象 | 翻译端应忽略未知字段（开放-封闭原则） |

---

## 4. 翻译产物契约

翻译产物的目录结构和文件名由 `doc/run_directory_layout.md` 定义。此处仅列出关键产物的语义。

### 4.1 产物清单

| 产物 | 路径（相对 runDir） | 来源 | 说明 |
|------|---------------------|------|------|
| 结构化步骤 JSON | `translate/phase1/structured_steps.json` | Phase 1 | 下游主消费格式 |
| 结构化步骤 XML | `translate/phase1/structured_steps.xml` | Phase 1 | 排查用镜像 |
| LLM 原始批次 XML | `translate/phase1/llm_raw_batches.xml` | Phase 1 | 各批次 LLM 原始输出 |
| Phase 1 错误 | `translate/phase1/errors.json` | Phase 1 | 解析失败记录 |
| 测试用例 | `translate/phase2/cases.md` | Phase 2 | **仅**主流程 LLM 归纳结果 |
| 兜底用例 | `translate/phase2/cases_fallback.md` | Phase 2 | **仅**程序补全内容（有缺失时生成） |
| 覆盖核对 | `translate/phase2/coverage.md` | Phase 2 | index 覆盖表 |
| Agent 用例 | `translate/phase4/agents.txt` | Phase 4 | 供 Agent 执行的纯文本 |
| LLM 审计 | `translate/llm_audit/` | 全程 | 每次 LLM 调用的完整记录 |
| 预处理产物 | `translate/preprocess/{diffs,enriched,merged}/` | 预处理 | 中间产物 |

### 4.2 Phase 1 structured_steps.json Schema

```jsonc
[
  {
    "index": 1,
    "status": "normal",              // normal | skip | noise | fallback
    "description": "在「用户名」输入框中输入手机号",
    "uiChange": "输入框显示已填内容",
    "page": "TPT",
    "basis": ["xml:action", "xml:observation"],
    "actionKind": "input",           // click | doubleClick | rightClick | keyPress | input | assert | sleep | other
    "target": "用户名",
    "inputText": "15700078644",
    "key": "",
    "assertText": "",
    "confidence": 0.7,
    "intervalFromPreviousMs": null,
    "url": "https://...",
    "sourceType": "input"
  }
]
```

### 4.3 Phase 2 产物语义

**cases.md**：仅包含主流程 LLM 归纳的测试用例，多个 Case 用 `---` 分隔。

**cases_fallback.md**：仅当严格模式判定有未覆盖步骤时生成，内容为程序自动补全的用例段。与 cases.md **分离**，不混入主结果。

**coverage.md**：覆盖核对表，统计每个 index 是否出现在 cases.md 正文中。

---

## 5. Python 包详细设计

### 5.1 数据模型（models.py）

```python
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ElementInfo(BaseModel):
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
    index: int
    type: str
    element_tag: str = Field(..., alias="elementTag")
    element_desc: str = Field(..., alias="elementDesc")
    page_title: str = Field(..., alias="pageTitle")
    timestamp: Optional[int] = None  # v0 无此字段，adapter 从 action 文件回填
    model_config = {"populate_by_name": True}


class RecordingMeta(BaseModel):
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
    index: int
    type: str
    timestamp: int
    url: str
    page_title: str = Field(..., alias="pageTitle")
    element: ElementInfo
    form_state: Optional[dict] = Field(None, alias="formState")
    model_config = {"populate_by_name": True}


class Classification(BaseModel):
    category: str
    element_type: str
    hints: list[str] = []


class EnrichedAction(BaseModel):
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
    snapshot_diff: Optional[str] = None
    pre_snapshot: Optional[str] = None
    post_snapshot: Optional[str] = None
    context_excerpt: Optional[str] = None
    form_state_changes: Optional[dict] = None
    form_state_change_text: Optional[str] = None
    classification: Classification = Classification(category="other", element_type="other")
    skip: Optional[str] = None
    noise: Optional[bool] = None
    noise_reason: Optional[str] = None


class StructuredStep(BaseModel):
    index: int
    status: str = "normal"
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

### 5.2 LLM 客户端（client.py）

#### 与现有 ai_client.py 的关系

项目中已存在 `src/case_translate/ai_client.py`（Python 草稿），功能与 Node.js `ai-client.js` 对等。Python 翻译包的 `client.py` 将**合并并取代**该草稿：

- 复用其 `call_chat()` / `call_vision()` / `ping_llm()` / `clean_markdown_fence()` 的核心逻辑
- 将配置加载统一到 `config.py`
- 删除草稿中的 `_runtime_config` 全局变量，改为显式依赖注入

#### 接口

```python
class LLMClient:
    def __init__(self, base_url: str, api_key: str, model: str): ...

    async def call_chat(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.2,
        max_tokens: int = 2000,
        model: str | None = None,
    ) -> str:
        """调用 Chat Completions API，3 次指数退避重试"""
        ...

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
        ...

    async def ping(self, timeout_ms: int = 3000) -> str:
        """探活"""
        ...


def clean_markdown_fence(text: str) -> str:
    """清理 <thinking> 标签和 markdown 代码围栏"""
    ...

def parse_json_from_llm_reply(text: str) -> dict:
    """清理围栏 → 直接 parse → 暴力提取 JSON"""
    ...
```

### 5.3 预处理器（preprocess/）

#### diff.py — 快照 diff 计算

**算法要求**：Node.js `diff` 包的 `diffLines` 底层使用 Myers diff。Python 标准库 `difflib` 的 `SequenceMatcher` 使用 Ratcliff/Obershelp 算法，两者对同一输入可能产出**不同的 +/- 行分块与顺序**。

**方案（采用）**：用 `difflib.unified_diff`（内部也是基于 SequenceMatcher）配合自定义格式化，先跑通再看差异。如果回归测试发现分块不一致，改用第三方库 `diffsync` 或手写 Myers。验收标准是**变更行集合一致**（忽略分块顺序），而非逐行字节一致。

```python
import difflib

DIFF_TRUNCATE_THRESHOLD = 3000


def compute_diff(pre_text: str, post_text: str) -> str:
    """
    计算两段快照文本的行级 diff。
    输出格式：每行以 "+ " 或 "- " 前缀，与 Node.js diff 包一致。
    验收标准：变更行集合一致（忽略分块/顺序）。
    """
    pre_lines = pre_text.splitlines()
    post_lines = post_text.splitlines()

    result = []
    has_change = False

    matcher = difflib.SequenceMatcher(None, pre_lines, post_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            continue
        if tag in ('replace', 'delete'):
            has_change = True
            for line in pre_lines[i1:i2]:
                result.append(f"- {line}")
        if tag in ('replace', 'insert'):
            has_change = True
            for line in post_lines[j1:j2]:
                result.append(f"+ {line}")

    if not has_change:
        return "（preSnapshot 和 postSnapshot 完全相同，操作未引起可见的 UI 变化）"

    return '\n'.join(result)


def truncate_diff(diff_text: str, threshold: int = DIFF_TRUNCATE_THRESHOLD) -> str:
    """
    截断超长 diff，保留首尾各一半。
    与 Node.js truncateDiff() 行为一致：喂给 LLM 的是截断后的版本。
    """
    if not diff_text or len(diff_text) <= threshold:
        return diff_text
    half = threshold // 2
    head = diff_text[:half]
    tail = diff_text[-half:]
    return f"{head}\n\n... [diff 过长，已截断 {len(diff_text) - threshold} 字符] ...\n\n{tail}"
```

**验收标准**：对 `data_check/run_2026-06-04T11-39-58/` 的 38 对快照：
- **变更行集合**（所有 `+ line` 和 `- line` 去重后）必须一致
- 分块顺序不要求一致（算法差异导致的正常偏差）
- `truncate_diff()` 截断后的长度与 Node 版一致

#### merge.py — 语义归并

与 Node.js `action-merge.js` 对等：

```python
def merge_actions(raw_actions: list[RawAction], log=None) -> tuple[list[RawAction], dict]:
    """
    语义归并：双击去重 → 输入识别（不做密码脱敏）。
    返回 (merged_actions, merge_report)。
    """
    actions = [a.model_copy() for a in raw_actions]
    report = {"totalOriginal": len(actions), "inputRecognized": 0, "dblclickDeduped": 0, "details": []}

    deduplicate_double_clicks(actions, report, log)
    recognize_input_actions(actions, report, log)

    return actions, report
```

#### 其他预处理模块

| 模块 | 核心函数 | 说明 |
|------|---------|------|
| `context.py` | `extract_context(snapshot_text, element)` | 从快照中提取操作元素附近的上下文片段 |
| `form_state.py` | `compute_form_state_changes(prev, curr)` | 对比相邻 action 的 formState，输出 changed/added/removed；条目可能只有 `ariaSelected` 而无 `value`/`checked`，需容忍缺失键 |
| `classify.py` | `classify_action(action, diff, form_changes)` | 元素类型 + 业务场景分类 + hints |
| `noise.py` | `detect_noise(enriched, is_first, is_last)` | diff 为空 + formState 无变化 → 噪声 |

### 5.4 XML 解析器（xml_parse.py）

**策略：先 etree 后正则**

```python
import re
from xml.etree import ElementTree as ET


def parse_steps_xml(raw_reply: str) -> list[dict]:
    """
    解析 Phase 1 LLM 返回的 <steps> XML。

    快速路径：xml.etree（90% 情况）
    兼容路径：正则提取（畸形 XML）
    """
    text = preprocess_llm_output(raw_reply)

    # 快速路径
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

    # 兼容路径：正则（与 Node.js robustExtractSteps 行为一致）
    return regex_extract_steps(text)


def clamp_window_consume(raw_consume, window_length: int) -> tuple[int, int | None, str | None]:
    """
    钳制滑动窗口消费步数。
    返回 (safe_consume, raw_consume, clamp_reason)。
    """
    ...


def max_sliding_window_rounds(total_items: int, window_size: int) -> int:
    """滑动窗口最大允许轮次（保险丝）"""
    ...
```

### 5.5 LLM 审计（audit.py）

```python
class LlmAudit:
    def __init__(self, run_dir: Path, log=None):
        self.audit_dir = run_dir / TRANSLATE_SUBDIR / "llm_audit"
        self.audit_dir.mkdir(parents=True, exist_ok=True)
        self._entries: list[dict] = []
        self._seq = 0

    async def call(self, meta: dict, messages: list[dict], chat_options: dict | None = None) -> tuple[str, str]:
        """调用 LLM 并写入审计记录。返回 (call_id, raw_reply)。"""
        ...

    def mark_outcome(self, call_id: str, outcome: dict) -> None:
        """标记调用结果（ok/problems/details）"""
        ...

    def finalize(self) -> dict:
        """写出 problems.json / summary.json"""
        ...
```

**审计产物格式与 Node.js 版完全一致**（`call_NNNN.json`、`index.json`、`problems.json`、`summary.json`），两套实现的审计产物可互相 diff。

### 5.6 Prompt 管理（prompts/）

**直接读 Node.js 的 `prompts/md/*.md`，不复制**：

```python
_MD_SEARCH_PATHS = [
    Path(__file__).parent / "md",                                          # Python 包内（未来独立分发时）
    Path(__file__).parent.parent.parent.parent / "src" / "case_translate" / "prompts" / "md",  # Node.js 目录
    Path.cwd() / "src" / "case_translate" / "prompts" / "md",             # CWD 回退
]

def load_prompt_md(relative_path: str, vars: dict | None = None) -> str:
    """加载 Skill Prompt Markdown 文件"""
    for base in _MD_SEARCH_PATHS:
        full_path = base / relative_path
        if full_path.exists():
            text = full_path.read_text("utf-8-sig")
            if vars:
                for key, value in vars.items():
                    text = text.replace(f"{{{{{key}}}}}", str(value))
            return text.strip()
    raise FileNotFoundError(f"找不到 Prompt 文件: {relative_path}，已搜索: {_MD_SEARCH_PATHS}")
```

### 5.7 Phase 1（phases/phase1.py）

```python
async def run_phase1(
    run_dir: Path,
    enriched_actions: list[EnrichedAction],
    *,
    batch_size: int = 3,
    context_window_size: int = 10,  # 与 Node EVIDENCE_CONTEXT_WINDOW_SIZE 对齐
    audit: LlmAudit,
    log=None,
) -> tuple[list[StructuredStep], list[dict]]:
    """
    Phase 1：微批处理生成结构化步骤。

    流程：
    1. skip/noise → 直接落地为 fallback step
    2. 按 batchSize 分批
    3. 构建 prompt：
       - system: snapshots-2-steps-skill.md
       - user: 最近 context_window_size 条已生成 step 作为历史上下文 + 本批 action JSON
    4. 调用 LLM → 解析 XML → 按 index 对齐
    5. 失败条目 → fallback step
    6. 增量写出 JSON + XML

    返回: (steps, errors)
    """
```

**与 Node 对齐的上下文窗口**：每批 LLM 调用时，user prompt 中注入最近 `context_window_size`（默认 10）条已生成的 step 作为历史参考，帮助 LLM 理解操作连续性。与 Node.js `EVIDENCE_CONTEXT_WINDOW_SIZE = 10` 一致。

### 5.8 Phase 2（phases/phase2.py）

**关键语义（必须与已修复的 Node 行为一致）**：

```python
async def run_phase2(
    steps: list[StructuredStep],
    cases_file: Path,
    *,
    window_size: int = 20,
    audit: LlmAudit,
    log=None,
) -> Phase2Result:
    """
    Phase 2：滑动窗口归纳测试用例。

    关键行为（必须 port 的 Node 逻辑）：
    1. clampWindowConsume：不强制最小消费比例
    2. lastIndex 仅做校验 + 写入 audit/problems，不覆盖 consumeStepCount
    3. normalizeCaseMarkdownToGlobalIndices：窗内 1/2/3 → 全局 index
    4. isRedundantCaseBlock：跳过重复 Case
    5. 严格模式兜底：cases.md 与 cases_fallback.md 分离
    6. coverage.md 仅基于主流程正文统计
    """
```

**Phase 2 必须 port 的 Node 逻辑清单**（逐项验收）：

- [ ] `clampWindowConsume`（不强制最小消费比例）
- [ ] `lastIndex` 不覆盖 `consumeStepCount`（仅校验 + 审计）
- [ ] `normalizeCaseMarkdownToGlobalIndices`（窗内序号 → 全局 index）
- [ ] `isRedundantCaseBlock`（跳过重复 Case）
- [ ] 严格模式兜底 + `cases_fallback.md` 与 `cases.md` 分离
- [ ] `coverage.md` 仅基于主流程正文统计

### 5.9 Phase 4（phases/phase4.py）

```python
async def run_phase4(
    run_dir: Path,
    steps: list[StructuredStep],
    *,
    window_size: int = 20,
    audit: LlmAudit,
    log=None,
) -> Path | None:
    """
    Phase 4：生成 Agent 可执行用例。
    返回 agents.txt 路径，无有效步骤时返回 None。
    """
```

### 5.10 工作流编排（workflow.py）

```python
@dataclass
class WorkflowResult:
    steps_file: Path
    cases_file: Path
    agent_txt_file: Path | None
    fallback_applied: bool
    fallback_indices: list[int]
    cases_fallback_file: Path | None


async def run_workflow(
    run_dir: Path,
    enriched_actions: list[EnrichedAction],
    *,
    phase1_batch_size: int = 3,
    phase2_window_size: int = 20,
    log=None,
) -> WorkflowResult:
    """完整翻译工作流：Phase 1 → Phase 2 → Phase 4。"""
    audit = LlmAudit(run_dir, log)

    steps, errors = await run_phase1(run_dir, enriched_actions, batch_size=phase1_batch_size, audit=audit, log=log)
    phase2_result = await run_phase2(steps, cases_file=..., window_size=phase2_window_size, audit=audit, log=log)
    agent_txt_file = await run_phase4(run_dir, steps, window_size=phase2_window_size, audit=audit, log=log)

    audit.finalize()
    return WorkflowResult(...)
```

### 5.11 CLI 入口（__main__.py）

```python
"""
用法:
    python -m ai_ui_translate                              # 翻译最新录制
    python -m ai_ui_translate run_2026-06-04T11-39-58      # 翻译指定录制
    python -m ai_ui_translate /path/to/run_dir             # 翻译指定路径
"""

async def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None
    run_dir = resolve_run_dir(target)

    enriched, meta = await preprocess(run_dir)
    result = await run_workflow(run_dir, enriched)

    print(f"结构化步骤: {result.steps_file}")
    print(f"测试用例: {result.cases_file}")
```

---

## 6. 与 Node 版对齐要点

### 6.1 Phase 2 lastIndex 语义

**根因**：LLM 有时返回 `consumeStepCount=6` 但 `lastIndex=25`（跳步写）。旧逻辑将 consume 锚定为 20，导致步骤 6~19 丢失。

**已修复的 Node 语义**（Python 必须 port）：

- **以 `consumeStepCount` 推进 cursor**
- **`lastIndex` 仅校验 + 写入 audit/warn**，**不得**覆盖 consume

```python
# phase2.py 中的 lastIndex 处理
if raw_last_index is not None and raw_last_index > 0 and win_len > 0:
    pos = expected_indices.index(raw_last_index) if raw_last_index in expected_indices else -1
    tail_at_consume = expected_indices[safe_consume - 1] if safe_consume <= len(expected_indices) else None

    if pos < 0:
        clamp_reason = f"lastIndex={raw_last_index} 不在本窗 index 列表，忽略"
    elif tail_at_consume != raw_last_index:
        clamp_reason = f"lastIndex={raw_last_index} 与 consumeStepCount={safe_consume}(→index {tail_at_consume}) 不一致，以 consumeStepCount 为准"
        # 不覆盖 safe_consume
```

### 6.2 Phase 2 兜底双文件

| 文件 | 内容 | 何时生成 |
|------|------|----------|
| `cases.md` | 仅主流程 LLM 归纳结果 | 始终 |
| `cases_fallback.md` | 仅程序补全内容 | 严格模式有未覆盖步骤时 |
| `coverage.md` | index 覆盖核对表 | 始终 |

兜底触发条件：

```python
all_normal_steps = [s for s in steps if s.status in ("normal", "fallback")]
mentioned = extract_mentioned_step_indices(main_cases_text)
uncovered = [s for s in all_normal_steps if s.index not in mentioned]
fallback_applied = len(uncovered) > 0
```

### 6.3 与旧文档的关系

| 文档 | 状态 |
|------|------|
| `doc/design.md` | 保留；其中「录制数据格式」与「翻译管线」章节被本文档 supersede |
| `doc/translate_design.md` | 保留；其中翻译管线细节被本文档 supersede |
| `doc/run_directory_layout.md` | **权威来源**；本文档直接引用其 translate 产物路径 |
| `doc/recording_data_spec.md` | 保留为历史参考；内容已合并入本文档 §3 |
| `doc/python_translate_design.md` | 保留为历史参考；内容已合并入本文档 |

---

## 7. 测试与验收

### 7.1 Fixture run

| run | 用途 |
|-----|------|
| `run_2026-06-04T11-39-58` | 主回归：38 步、Phase2 四轮 consume、兜底未触发 |
| （待补）易触发兜底的 run | 验证 `cases_fallback.md` + Dashboard ⚠ |

### 7.2 双端一致性（Python vs Node）

**必须一致**：

| 项目 | 比较方式 |
|------|----------|
| preprocess merge 报告 | 字段级 diff |
| diff 文本格式 | 变更行集合一致（忽略分块/顺序） |
| `structured_steps` 的 `index` / `status` / `actionKind` / `target` | 精确匹配 |
| 审计产物 JSON 结构 | 结构一致（call_*.json、index.json） |

**不要求一致**（LLM 非确定性）：

| 项目 | 说明 |
|------|------|
| `description` / `uiChange` | LLM 自由文本 |
| Case 正文 | LLM 归纳结果 |
| `confidence` | 当前固定 0.7，未来可能变化 |

### 7.3 验收清单

- [ ] `validate_recording()` 能正确处理 v0 格式的 `data_check/run_*`
- [ ] `validate_recording()` 能正确处理 v1.0 格式（如果录制端已升级）
- [ ] 预处理产物与 Node 版数值级一致（diff 文本、merge 报告）
- [ ] Phase 1 `structured_steps.json` 的确定性字段与 Node 版一致
- [ ] Phase 2 lastIndex 不覆盖 consume（用 llm_audit/call_0015 类场景验证）
- [ ] Phase 2 兜底双文件分离（cases.md 不含兜底段）
- [ ] Phase 2 coverage.md 仅统计主流程正文
- [ ] Phase 4 agents.txt 生成成功
- [ ] 所有产物路径符合 `run_directory_layout.md`
- [ ] 审计产物 JSON 结构与 Node 版一致

---

## 8. 风险与缓解

### 8.1 高风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 输出非确定性 | 双端自由文本不一致 | 只比确定性字段；diff 做模糊匹配 |
| diff 分块差异 | SequenceMatcher 与 Node Myers 分块不同 | 验收标准为「变更行集合一致」，不要求逐行字节一致；如差异过大改用 Myers 等价库 |
| XML 解析行为差异 | etree 对畸形 XML 容错不同 | 双路径（etree + 正则）；用 llm_raw_batches.xml 做测试 fixture |

### 8.2 中风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Prompt 文件路径耦合 | Python 依赖 Node 目录结构 | 多路径查找 + 首次运行打印实际路径 |
| v0 adapter 遗漏边界 | 某些 v0 字段组合未覆盖 | 用多个真实 run 做 adapter 测试 |
| Phase 2 语义未完全 port | 复现旧 lastIndex bug | §6.1 清单逐项验收 + 集成测试 |

### 8.3 低风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Python 版本兼容 | Pydantic v2 需要 3.11+ | pyproject.toml 声明 |
| openai SDK 版本差异 | 微小行为差异 | 协议层一致 |

---

## 9. 实施计划

| 阶段 | 天数 | 内容 |
|------|------|------|
| Phase 0 | 1 天 | 目录结构、pyproject.toml、models.py、config.py、adapter.py、validate.py |
| Phase 1 | 2 天 | preprocess/ 全部模块 + 单元测试（用 data_check/run_* 做 fixture） |
| Phase 2 | 1 天 | client.py、audit.py、prompts/loader.py、xml_parse.py |
| Phase 3 | 3 天 | phases/phase1.py、phase2.py、phase4.py、workflow.py |
| Phase 4 | 1 天 | 端到端集成测试、双端一致性验证、修复 diff 格式差异 |
| **总计** | **8 天** | |

**Phase 0 验收**：`validate_recording()` 能读取并适配 `data_check/run_2026-06-04T11-39-58/`。

**Phase 1 验收**：预处理产物（diffs/enriched/merged）与 Node 版逐文件 diff 无实质差异。

**Phase 4 验收**：同一 run，Python 与 Node 的 `structured_steps.json` 中 `index/status/actionKind/target` 完全一致。

---

## 10. 附录：Node → Python 函数映射表

| Node.js 文件 | 函数 | Python 文件 | 函数 |
|-------------|------|-------------|------|
| `ai-client.js` | `callChat()` | `client.py` | `LLMClient.call_chat()` |
| `ai-client.js` | `callVision()` | `client.py` | `LLMClient.call_vision()` |
| `ai-client.js` | `pingLlm()` | `client.py` | `LLMClient.ping()` |
| `ai-client.js` | `cleanMarkdownFence()` | `client.py` | `clean_markdown_fence()` |
| `llm-audit.js` | `createLlmAudit()` | `audit.py` | `LlmAudit()` |
| `preprocessor/action-merge.js` | `mergeActions()` | `preprocess/merge.py` | `merge_actions()` |
| `preprocessor/action-merge.js` | `detectNoise()` | `preprocess/noise.py` | `detect_noise()` |
| `preprocessor/snapshot-diff.js` | `computeAllDiffs()` | `preprocess/diff.py` | `compute_all_diffs()` |
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
| `prompts/loader.js` | `loadPromptMd()` | `prompts/loader.py` | `load_prompt_md()` |
| `index.js` | `generate()` | `__main__.py` | `main()` |

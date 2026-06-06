# 录制数据格式规范 v1.0

> 本规范定义 AI UI Recorder 录制端与翻译端之间的数据契约。
> 录制端（Node.js）负责按本规范产出数据；翻译端（Python）负责按本规范消费数据。
> 两端独立实现、独立测试，仅通过本格式交互。

---

## 1. 总体目录结构

一次录制产出一个 `run_<timestamp>/` 目录，结构如下：

```
run_<timestamp>/
├── meta.json                    # 录制元信息（唯一入口锚点）
├── record/
│   ├── recorder.log             # 录制日志
│   ├── actions/                 # 操作数据（1-based, 3 位零填充）
│   │   ├── action_001.json
│   │   ├── action_002.json
│   │   └── ...
│   ├── snapshots/               # AX 快照（0-based, 3 位零填充）
│   │   ├── snapshot_000.txt     # 初始状态（录制开始时拍摄）
│   │   ├── snapshot_001.txt
│   │   └── ...
│   └── screenshots/             # [可选] 操作截图
│       ├── 0001_action_1_click.jpeg
│       └── ...
└── translate/                   # [可选] 翻译端产出（本规范不约束其内部格式）
    └── ...
```

### 命名约定

| 项目 | 命名规则 | 示例 |
|------|----------|------|
| action 文件 | `action_NNN.json`，NNN = 3 位零填充，1-based | `action_001.json` |
| snapshot 文件 | `snapshot_NNN.txt`，NNN = 3 位零填充，0-based | `snapshot_000.txt` |
| 截图文件 | `NNNN_action_N_type.format`，NNNN = 4 位零填充 | `0001_action_1_click.jpeg` |

### 快照与操作的关联关系

```
snapshot_000  →  录制初始状态（action 之前）
snapshot_001  →  action_1 之后 / action_2 之前
snapshot_002  →  action_2 之后 / action_3 之前
...
snapshot_N    →  action_N 之后 / action_{N+1} 之前
snapshot_last →  录制终态（最后一个 action 之后）
```

**公式**：
- `action_N` 的 preSnapshot = `snapshot_{N-1}`
- `action_N` 的 postSnapshot = `snapshot_{N}`
- 快照总数 = action 总数 + 1

---

## 2. meta.json Schema

```jsonc
{
  // === 必填字段 ===
  "formatVersion": "1.0",           // 格式版本号（语义化版本）
  "recordStartTime": "2026-06-04T11:39:58.079Z",  // ISO 8601 UTC
  "recordEndTime": "2026-06-04T11:42:03.055Z",    // ISO 8601 UTC
  "totalActions": 38,                // action 文件总数（= actions/ 下的文件数）
  "totalSnapshots": 39,              // snapshot 文件总数（= totalActions + 1）
  "targetUrl": "https://...",        // 录制起始 URL
  "startPageTitle": "TPT",           // 起始页面标题

  // === 可选字段 ===
  "snapshotPollIntervalMs": 300,     // 快照轮询间隔（毫秒）
  "pages": [                         // 录制过程中访问的页面列表（去重）
    { "title": "TPT", "url": "https://..." },
    { "title": "App", "url": "https://..." }
  ],

  // === 操作摘要 ===
  "actionSummary": [
    {
      "index": 1,                    // 1-based，与 action_NNN.json 的 index 一致
      "type": "click",               // 原始 DOM 事件类型
      "elementTag": "input",         // 目标元素标签名
      "elementDesc": "请输入用户名",  // 元素可读描述（label/text/placeholder 优先）
      "pageTitle": "TPT",            // 操作时的页面标题
      "timestamp": 1780573206937     // Unix 毫秒时间戳
    }
    // ...
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `formatVersion` | string | ✓ | 格式版本，当前 `"1.0"`。翻译端应检查此字段，不兼容时拒绝处理 |
| `recordStartTime` | string | ✓ | ISO 8601 UTC 时间戳 |
| `recordEndTime` | string | ✓ | ISO 8601 UTC 时间戳 |
| `totalActions` | integer | ✓ | action 文件总数 |
| `totalSnapshots` | integer | ✓ | snapshot 文件总数，必须等于 `totalActions + 1` |
| `targetUrl` | string | ✓ | 录制起始 URL |
| `startPageTitle` | string | ✓ | 起始页面标题 |
| `snapshotPollIntervalMs` | integer | | 快照轮询间隔 |
| `pages` | array | | 访问过的页面列表 |
| `actionSummary` | array | ✓ | 操作摘要，长度必须等于 `totalActions` |

### actionSummary 条目字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `index` | integer | ✓ | 1-based，与 action 文件的 index 一致 |
| `type` | string | ✓ | 原始 DOM 事件类型（click/dblclick/rightclick/keypress） |
| `elementTag` | string | ✓ | HTML 标签名 |
| `elementDesc` | string | ✓ | 元素可读描述，按 label > text > placeholder > name > id > xpath 优先级取值，截断至 80 字符 |
| `pageTitle` | string | ✓ | 操作时的页面标题 |
| `timestamp` | integer | ✓ | Unix 毫秒时间戳 |

### 与当前格式的差异

| 变更 | 原因 |
|------|------|
| 新增 `formatVersion` | 支持未来格式演进 |
| 新增 `totalSnapshots` | 显式声明快照总数，便于校验 |
| `convention` 字段删除 | 改为本文档作为权威规范 |
| `pageCount` 删除 | 由 `pages` 数组的长度推导 |
| `actionSummary[].desc` 拆为 `elementTag` + `elementDesc` | 结构化替代自由文本 |
| `actionSummary[].url` 删除 | 完整 URL 在 action 文件中有，摘要中不需要重复 |

---

## 3. action_NNN.json Schema

```jsonc
{
  // === 必填字段 ===
  "index": 1,                        // 1-based，与文件名 NNN 一致
  "type": "click",                   // DOM 事件类型
  "timestamp": 1780573206937,        // Unix 毫秒时间戳
  "url": "https://...",              // 操作时的页面完整 URL
  "pageTitle": "TPT",               // 操作时的页面标题

  // === 目标元素 ===
  "element": {
    "tag": "input",                  // HTML 标签名（小写）
    "xpath": "//*[@id='username']",  // 元素 XPath（主定位字段）
    "text": "",                      // 元素直接文本内容（截断 100 字符）
    "id": "username",                // HTML id 属性 | null
    "name": null,                    // HTML name 属性 | null
    "inputType": "text",             // input 元素的 type 属性 | null（非 input 元素为 null）
    "placeholder": "请输入用户名",   // placeholder 属性 | null
    "label": null                    // 关联的 <label> 文本 | null
  },

  // === 表单状态快照 ===
  "formState": {                     // 操作瞬间的全页面表单状态 | null
    "//*[@id='username']": {
      "value": "",
      "checked": null,               // checkbox/radio 时为 boolean，否则为 null
      "selectedIndex": null          // select 时为 integer，否则为 null
    }
    // ... 更多表单元素
  }
}
```

### type 枚举值

| 值 | 说明 | 来源事件 |
|----|------|----------|
| `click` | 左键单击 | `click` |
| `dblclick` | 双击 | `dblclick` |
| `rightclick` | 右键点击 | `contextmenu` |
| `keypress` | 键盘按键 | `keydown`（仅 Enter） |

### element 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `tag` | string | ✓ | HTML 标签名，小写 |
| `xpath` | string | ✓ | 元素 XPath，优先短形式（id/name/placeholder/text 锚定） |
| `text` | string | ✓ | 直接文本内容，截断 100 字符，无文本时为空字符串 |
| `id` | string\|null | | HTML id 属性 |
| `name` | string\|null | | HTML name 属性 |
| `inputType` | string\|null | | input/textarea 的 type 属性，非表单元素为 null |
| `placeholder` | string\|null | | placeholder 属性 |
| `label` | string\|null | | 关联的 `<label>` 文本（通过 for 属性、包裹关系、相邻兄弟查找） |

### formState 字段说明

| 场景 | 值 |
|------|-----|
| 操作瞬间成功捕获 | Object，键为元素 xpath，值为该元素的状态对象 |
| 捕获失败或未捕获 | `null` |
| 页面无表单元素 | `{}`（空对象） |

formState 中每个条目的结构：

```jsonc
{
  "value": "当前值",          // input/textarea/select 的值
  "checked": true|false|null, // checkbox/radio 的选中状态
  "selectedIndex": 2|null     // select 的选中索引
}
```

### 与当前格式的差异

| 变更 | 原因 |
|------|------|
| `formStateDelta` → `formState` | 语义更准确：这是操作瞬间的绝对状态快照，不是差量 |
| `element.type` → `element.inputType` | 避免与 action.type 混淆 |
| 删除 `element.href` | 当前始终为 null，且 href 信息已包含在 url 字段中 |
| 删除 `element.title` | 当前始终为 null，title 信息已包含在 pageTitle 字段中 |
| formState 密码脱敏 | type="password" 的 value 统一替换为 `"[MASKED]"` |

---

## 4. snapshot_NNN.txt 格式

纯文本，YAML 风格缩进树，表示浏览器 Accessibility Tree 的裁剪版本。

### 行格式

```
- <role> "<name>" [<attrs>]
```

| 部分 | 说明 |
|------|------|
| 缩进 | 2 空格为一级，表示层级关系 |
| `- ` | 固定前缀（短横线 + 空格） |
| `<role>` | AX 节点角色，如 `WebArea`、`textbox`、`button`、`text`、`link` |
| `"<name>"` | AX 节点名称（可选，有值时用双引号包裹） |
| `[<attrs>]` | 可选属性标记，逗号分隔 |

### 属性标记

| 标记 | 含义 |
|------|------|
| `[checked]` / `[unchecked]` | checkbox/radio 选中状态 |
| `[pressed]` / `[not-pressed]` | 按钮按下状态 |
| `[expanded]` / `[collapsed]` | 展开/折叠状态 |
| `[selected]` | 选中状态 |
| `[disabled]` | 禁用状态 |
| `[required]` | 必填状态 |
| `[level=N]` | 标题层级 |
| `[value="..."]` | 元素当前值 |

### 示例

```
- WebArea "TPT"
  - text "TPT"
  - radiogroup "segmented control"
    - radio "密码登录" [checked]
    - radio "验证码登录" [unchecked]
  - textbox "请输入用户名" [required, value="15700078644"]
  - textbox "请输入密码" [required, value="•••••••••••"]
  - checkbox " " [unchecked]
  - button "立即登录"
```

### 裁剪规则

| 规则 | 说明 |
|------|------|
| 最大深度 | 默认 8 层（可配置） |
| 跳过无意义角色 | `none`、`generic`、`presentation`、`LineBreak`、`StaticText` 等叶子节点在无 name/value/children 时丢弃 |
| 密码值掩码 | type="password" 的 value 显示为 `•••••••••••`（浏览器 Accessibility Tree 自带掩码） |
| 只保留有值属性 | 无值的属性不出现在输出中 |

---

## 5. recorder.log 格式

纯文本，每行一条日志：

```
[ISO-8601-UTC] [LEVEL] message
```

| 部分 | 说明 |
|------|------|
| 时间戳 | ISO 8601 UTC，精确到毫秒 |
| LEVEL | `INFO` / `WARN` / `ERROR` |
| message | 日志消息，可含换行（后续行缩进 2 空格） |

---

## 6. 截图格式（可选）

截图由录制端按需生成，翻译端不强制依赖。

### 命名

```
NNNN_action_N_<type>.<format>
```

- `NNNN`：4 位零填充序号
- `N`：action index
- `type`：操作类型（click/keypress/navigation 等）
- `format`：图片格式（jpeg/png）

### 示例

```
0001_action_1_click.jpeg
0002_action_2_click.jpeg
0003_action_3_click.jpeg
```

---

## 7. 校验规则

翻译端在处理录制数据前，应执行以下校验：

### 必须校验（不满足则拒绝处理）

| # | 校验项 | 规则 |
|---|--------|------|
| 1 | formatVersion 存在 | `meta.json` 必须包含 `formatVersion` 字段 |
| 2 | formatVersion 兼容 | 主版本号必须为 `1`（`"1.0"`、`"1.1"` 均兼容） |
| 3 | totalActions 一致 | `meta.json.totalActions` == `actions/` 下的文件数 |
| 4 | totalSnapshots 一致 | `meta.json.totalSnapshots` == `snapshots/` 下的文件数 |
| 5 | totalSnapshots = totalActions + 1 | 快照比操作多一个 |
| 6 | actionSummary 长度 | `len(meta.actionSummary)` == `totalActions` |
| 7 | action 文件连续 | `action_001.json` 到 `action_NNN.json` 无缺失 |
| 8 | snapshot 文件连续 | `snapshot_000.txt` 到 `snapshot_NNN.txt` 无缺失 |
| 9 | action index 一致 | 每个 action 文件的 `index` 字段 == 文件名中的数字 |

### 建议校验（不满足则警告）

| # | 校验项 | 规则 |
|---|--------|------|
| 10 | 时间戳单调递增 | `action[i].timestamp >= action[i-1].timestamp` |
| 11 | snapshot 非空 | 每个 snapshot 文件至少 10 字节 |
| 12 | formState 类型 | 为 null 或 Object，不为其他类型 |
| 13 | element.xpath 非空 | 每个 action 的 `element.xpath` 不为空字符串 |

---

## 8. 安全约束

| # | 约束 | 说明 |
|---|------|------|
| 1 | formState 密码脱敏 | type="password" 的 value 必须在录制端替换为 `"[MASKED]"` |
| 2 | URL 中的 token | 录制端可选：在保存 URL 前剥离 query 参数中的 JWT/token |
| 3 | 截图敏感信息 | 截图可能包含页面敏感信息，分发时需评估 |

---

## 9. 扩展预留

以下字段/目录在当前版本中不存在，但格式设计已预留扩展位：

| 扩展点 | 位置 | 说明 |
|--------|------|------|
| canvas 录制 | `record/canvas/` | 未来可存放 canvas 元素的绘制操作序列 |
| 视频录制 | `record/video/` | 未来可存放页面操作录屏 |
| formState 扩展 | `formState[xpath].*` | 可新增 `ariaExpanded`、`ariaChecked` 等 ARIA 状态 |
| meta.json 扩展 | 根对象 | 可新增字段，翻译端应忽略未知字段（开放-封闭原则） |
| action 扩展 | 根对象 | 可新增字段，翻译端应忽略未知字段 |

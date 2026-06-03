# LLM Prompt 模板目录

> **总纲（各 Prompt 何时使用）**：见 [总纲.md](./总纲.md)

后续提示词工程只需修改本目录下的 Markdown / JSON 文件，无需改业务代码。

## 目录说明

| 路径 | 用途 |
|------|------|
| `md/` | System / User Prompt 正文（System 采用 LangGPT 9 维，JSON 契约在 Output Format） |
| `schema/` | JSON Schema **参考副本**（与 System Output Format 同步，不传给 API） |
| `loader.js` | 读取 md、替换 `{{占位符}}` |
| `step-structured.js` 等 | 薄封装：组装动态数据 + 调用 loader |

## Markdown 文件清单

| 文件 | 业务 | 角色 |
|------|------|------|
| `phase1-structured-system.md` | Phase 1 结构化步骤 | system |
| `phase1-structured-user.md` | Phase 1 结构化步骤 | user（占位符见下） |
| `phase1-batch-repair-system.md` | Phase 1 JSON 修复 | system |
| `phase1-batch-repair-user.md` | Phase 1 JSON 修复 | user |
| `phase2-case-window-system.md` | Phase 2 Case 归纳 | system |
| `phase2-case-window-user.md` | Phase 2 Case 归纳 | user |
| `phase4-agent-txt-system.md` | Phase 4 Agent TXT | system |
| `phase4-agent-txt-user.md` | Phase 4 Agent TXT | user |
| `phase4-agent-txt-repair-system.md` | Phase 4 JSON 修复 | system |
| `phase4-agent-txt-repair-user.md` | Phase 4 JSON 修复 | user |
| `phase1-step-analysis-system.md` | 遗留逐条分析 | system |
| `phase1-step-analysis-user.md` | 遗留逐条分析 | user |

## 占位符

User Prompt 中动态部分使用 `{{key}}`，由对应 `*.js` 入口填入，例如：

- `phase1-structured-user.md`：`{{contextHistory}}` `{{actionCount}}` `{{actionBlocks}}`
- `phase2-case-window-user.md`：`{{windowStepsJson}}` `{{indexListText}}`
- `phase4-agent-txt-user.md`：`{{stepsJson}}`
- `*-repair-user.md`：`{{rawReply}}`

修改 Prompt 后若需立即生效，重启进程；开发中可调用 `clearPromptCache()` 清缓存。

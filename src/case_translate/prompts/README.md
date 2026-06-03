# LLM Prompt 模板目录

> **总纲（各 Prompt 何时使用）**：见 [总纲.md](./总纲.md)

- **Skill Prompt**：`md/*-skill.md`（LangGPT 9 维，改提示词工程主要改这里）
- **User Prompt**：各 `*.js` 内嵌字符串（仅为动态数据拼接）

## 目录说明

| 路径 | 用途 |
|------|------|
| `md/` | 仅 Skill Prompt（3 份精华） |
| `loader.js` | 读取 Skill md |
| `step-structured.js` 等 | Skill 走 loader；User 在代码中拼接 |

## Skill Markdown 清单

| 文件 | 业务 | 产物 |
|------|------|------|
| `snapshots-2-steps-skill.md` | 快照/操作 → 结构化步骤 | `step_2_structured_steps.json` |
| `steps-2-cases-skill.md` | 步骤 → 测试用例 | `AI_cases.md` |
| `case-4-agents-skill.md` | 用例 → Agent 文本 | `case_4_agents.txt` |

## User Prompt 代码位置

| 逻辑 | 文件 | 函数 |
|------|------|------|
| snapshots → steps | `step-structured.js` | `buildUserPrompt` |
| steps → cases | `case-generation.js` | `buildPhase2WindowUserPrompt` |
| case → agents | `agent-txt.js` | `buildAgentTxtUserPrompt` |

已移除 JSON repair 专用 Prompt 与二次 LLM 修复调用。

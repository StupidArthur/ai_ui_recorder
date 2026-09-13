# 翻译链路实测与下游格式评估

日期：2026-09-12
范围：Phase 3 格式契约、脱敏和状态/写盘回归；未修改原始录制数据。

## 结论

Phase 3 的确定性结构复测通过：历史 38 步分为 6 个 Case，最终产物输出 6 个 H3、44 个 H4（每 Case 一个执行约定、每 Step 一个标题）、38 组操作/预期。起始 URL 使用共享清理函数；敏感 URL 参数、密码样例和手机格式在脱敏评测产物中均未命中扫描。多 Case 边界和承接说明保留。

另增加了 attempt 失败状态、Phase 1 中间产物写盘错误传播的测试；并用完全人工构造的数据完成 MiniMax-M3 Phase 1/2 Prompt 冒烟，Phase 3 三种产物均成功生成。真实录制数据未发送给模型，因此这项语义检查只证明合成样例上的链路可用和输出与样例相符，不证明新旧 Prompt 在真实数据上的质量不回退。

## 执行记录

| 检查 | 结果 | 证据 |
|---|---|---|
| Go 测试 | 通过 | `GOCACHE` 指向仓库临时目录后执行 `go test ./...`。测试覆盖多 Case/多 Step 契约、URL 清理、敏感输入隐藏、attempt 的正常错误/恐慌失败状态、旧完成标志不误标、并发 Phase 1 写盘失败传播。 |
| 前端构建 | 通过 | `npm.cmd run build` 完成 TypeScript 检查和 Vite 生产构建。 |
| Wails 桌面编译与启动冒烟 | 通过 | Wails CLI 2.12.0 使用 `-skipbindings -m -nosyncgomod -s -nopackage` 编译成功。主代理另构建当前代码并启动 3 秒，进程保持存活、`Responding=True`；随后关闭进程并清理测试 EXE 和 Go 缓存。项目 go.mod 为 2.10.1；跳过重新生成 bindings / 前端 / go.mod，避免覆盖工作区既有模型配置相关修改。 |
| Phase 1 并发错误路径 race 检查 | 通过 | `go test -race ./internal/translator -run '^TestRunPhase1PropagatesConcurrentIntermediateWriteError$' -count=1` 通过。 |
| Phase 3 历史数据确定性复测 | 通过 | 从 `ana_data/server/translate/phase1/structured_steps.json` 读取 38 个历史 Step；从对应旧 `cases.md` 的分组计数采用 `[5, 8, 6, 5, 9, 5]`。结构化文本全部替换为通用脱敏描述后，调用三种 Phase 3 渲染器。 |
| MiniMax 合成语义冒烟 | 通过 | 仅向 MiniMax-M3 发送 9 条手工构造的 `example.test` 偏好设置动作；Phase 1 为 9 Step、0 fallback，Phase 2 为 3 Case、覆盖 9/9 Step，Phase 3 三种产物成功生成。未读取或发送真实录制内容。 |
| 真实录制模型翻译 | 未运行 | MiniMax 冒烟不是录制数据评测；新版 Prompt 在真实动作、目标、输入、按键、顺序和 Case 边界上的准确性/质量不回退仍待验收。 |
| 原始数据保护 | 通过 | 历史 Phase 3 复测仅读取旧 structured steps / cases，并将自由文本替换为占位描述；MiniMax 冒烟只使用人工构造输入。两条路径均只写 `.tmp-translation-eval-20260912/` 下的评测产物，未写入原始 run，也未把 API Key 写入产物或报告。 |

### MiniMax 合成语义冒烟

模型：`MiniMax-M3`；协议：`chat_completions`；Base URL：`https://api.minimaxi.com/v1`。API Key 从已有环境变量读取，仅作为请求认证头使用，没有回显或写入评测产物。一次性 harness 使用当前 Phase 1/2 prompt builder、XML/Case 解析器和 Phase 3 渲染器；harness 在运行后删除。

输入是 9 条纯人工构造的偏好设置动作：打开个人资料、输入昵称 `alice-demo`、保存；打开外观、选择深色模式、保存；打开通知、启用每周摘要、保存。URL 固定为 `https://example.test/preferences`。它不包含任何真实录制文本、URL、账号或身份信息。

请求参数：Phase 1 三个批次（批次大小 3，temperature=0，max_tokens=12000）；Phase 2 一个窗口（temperature=0.3，max_tokens=4000）。Phase 1 解析出 9/9 Step、fallback 为 0；Phase 2 切为 3 个连续 Case（个人资料/外观/通知，各 3 Step），完整覆盖 9/9 Step。人工对照合成输入后，动作、控件目标、昵称值、顺序和各 Case 预期均与构造事实一致；未发现额外动作或脱离输入依据的页面/状态断言。`runnable_case.md` 为 3 个 H3、12 个 H4（3 个执行约定 + 9 个 Step）及 9 组相邻操作/预期；另两种 Phase 3 格式也保留相同 Case 分组。

注意：`cases.md` 的既有模板会描述“录制实况/预期基线”。本次输入是合成数据，该措辞仅是格式模板，不可当作真实录制观察证据。该冒烟也只验证小型合成场景，不能替代真实录制样本的质量验收。

执行命令（在 `translate_gui`，运行时继承已有 `MINIMAX_API_KEY` 环境变量；没有将 Key 写入命令或日志）：

```powershell
$env:GOCACHE='G:\github\ai_ui_recorder\.tmp-translation-eval-20260912\gocache-minimax'
go test ./internal/translator -run '^TestTemporaryMiniMaxSyntheticSmoke$' -count=1 -v
```

临时 Go harness 已删除；Go 编译缓存也已清理。生成产物：

- [MiniMax 冒烟指标](../.tmp-translation-eval-20260912/minimax_synthetic/run/smoke_summary.json)
- [录制生成版 runnable_case.md](../.tmp-translation-eval-20260912/minimax_synthetic/run/translate/phase3/runnable_case.md)
- [Agent 文本 agents.txt](../.tmp-translation-eval-20260912/minimax_synthetic/run/translate/phase3/agents.txt)
- [人读表格 cases.md](../.tmp-translation-eval-20260912/minimax_synthetic/run/translate/phase3/cases.md)

执行命令：

```powershell
# 工作目录：translate_gui
$env:GOCACHE='G:\github\ai_ui_recorder\.tmp-go-cache-eval'; go test ./...
# 工作目录：translate_gui/frontend
npm.cmd run build
# 回到 translate_gui
$env:GOCACHE='G:\github\ai_ui_recorder\.tmp-go-cache-eval'; wails build -skipbindings -m -nosyncgomod -s -nopackage -o eval-translation-20260912.exe
$env:GOCACHE='G:\github\ai_ui_recorder\.tmp-go-cache-eval'; go test -race ./internal/translator -run '^TestRunPhase1PropagatesConcurrentIntermediateWriteError$' -count=1
$env:TPT_EVAL_STRUCTURED_STEPS='G:\github\ai_ui_recorder\ana_data\server\translate\phase1\structured_steps.json'
$env:TPT_EVAL_OUTPUT_DIR='G:\github\ai_ui_recorder\.tmp-translation-eval-20260912'
go test ./internal/translator -run '^TestEvalHistoricalPhase3Sanitized$' -v
```

最后一条由临时测试 harness 执行，生成完成后 harness 已删除。它只把步骤 ID、动作类型、原有有效/兜底状态和 Case 规模作为测试依据；动作描述、目标、输入、观察、断言、URL 均以安全占位内容代替。未将原始字段复制到评测目录。

## 复测指标与产物

脱敏产物目录：`.tmp-translation-eval-20260912/translate/`。

| 指标 | 复测结果 | 验收 |
|---|---:|---|
| 输入历史步骤 | 38 | 通过 |
| 历史 Case 数 / 边界 | 6 / `[5, 8, 6, 5, 9, 5]` | 通过 |
| 动作类型 | click 33、input 5 | 仅用于结构回归；文字已替换 |
| `runnable_case.md` H3 | 6 | 通过，每 Case 一个 H3 |
| `runnable_case.md` H4 | 44 | 通过，6 个执行约定 + 38 个 Step |
| 操作 / 预期块 | 38 / 38 | 通过，一步一组且相邻 |
| `cases.md` Case 标题 | 6 | 通过 |
| 敏感 URL 参数名 / 手机格式扫描 | 0 / 0 | 通过，仅针对已脱敏评测产物 |

产物链接：

- [录制生成版 runnable_case.md](../.tmp-translation-eval-20260912/translate/phase3/runnable_case.md)
- [Agent 文本 agents.txt](../.tmp-translation-eval-20260912/translate/phase3/agents.txt)
- [人读表格 cases.md](../.tmp-translation-eval-20260912/translate/phase3/cases.md)
- [脱敏 structured steps](../.tmp-translation-eval-20260912/translate/phase1/structured_steps.json)
- [脱敏 Case 边界](../.tmp-translation-eval-20260912/translate/phase2/case_slices.json)

初始评估时历史渲染的 H3/H4 结构不符合下游模板（1 个 H3，Case 标题被当成 H4 步骤）；新契约测试已改为多 Case、多 Step 断言，当前复测结果为上表指标。

旧 `ana_data/server/translate/phase2/cases.md` 含有录制历史中的个人输入文本。本次只从中提取 Case/Step 数量边界，不复制其自由文本；评测输出使用脱敏结构副本。不要将旧基线全文贴入新报告或下游执行产物。

## 质量评估边界与后续验收

格式按 `translate_gui/web-ui-case-debugger-skill/runnable-template.md`、`rewrite.md`、`rules.md` 核对：不使用 H1/H2 或表格作为 runnable 步骤；每个 Case 独立 H3，每个结构化步骤独立 H4，操作与预期分离。后续 Case 明确承接前一 Case 的页面/数据状态；不能验证的输入、目标、fallback 和结果关联具体步骤并标待确认。密码值使用凭据参数描述，不写入 Phase 3 文本。

起始 URL 由 `resolveSanitizedStartURL` 统一处理：大小写不敏感移除 token、tpt-token、access_token、refresh_token、auth、authorization、session/sessionid、code 等敏感 query key，保留普通参数和 hash 路由，解析失败时不输出。`agents.txt` 与 `runnable_case.md` 调用同一函数；`cases.md` 不输出起始 URL。契约测试覆盖 query、hash query 和解析失败场景。

这些结果只证明结构与脱敏逻辑，不等同于语义质量验收。尤其是 deterministic harness 对自由文本使用通用占位符，无法评判目标定位是否足够具体、输入事实是否准确、预期是否稳定，也不验证新旧 Prompt 的真实模型差异。正式质量验收仍需在不改动原始数据的脱敏工作副本上，以固定模型和 Prompt 做基线对比并人工核对动作、目标、输入、按键、顺序、结果、Case 边界和臆造风险。

仓库中既有历史产物的 Case 数量不一致（曾见 5–8 个）；旧文本不是唯一的边界金标准。`output/run_2026-06-04T11-39-58` 为 38 actions / 39 snapshots，`recorder/output/run_2026-07-03T03-16-17` 为 16 actions / 17 snapshots（含 2 个 keypress）；本次未在原始 run 上启动翻译，以避免因模型配置缺失而触发旧结果归档或写入。可继续用只读数据检查和脱敏副本补充语义标注。

评测目录包含受控的脱敏副本与输出；不要把该目录当作真实录制数据或翻译质量金标准提交给下游执行。

# Run 目录布局

录制端和翻译端共享 `output/run_<timestamp>/`，但分别拥有自己的目录：

```text
run_<timestamp>/
├── meta.json
├── record/                         # Node.js 录制端写入
│   ├── actions/action_001.json
│   ├── snapshots/snapshot_000.txt
│   ├── screenshots/                # 可选
│   └── recorder.log
└── translate/                      # Go/Wails 翻译端写入
    ├── attempt.json                # 本次翻译已启动
    ├── completed.json              # 全部必需产物成功后写入
    ├── logs/generate.log
    ├── preprocess/
    │   ├── diffs/
    │   ├── enriched/
    │   └── merged/
    ├── phase1/structured_steps.json
    ├── phase2/
    │   ├── case_slices.json
    │   └── coverage.md
    ├── phase3/
    │   ├── agents.txt
    │   ├── runnable_case.md
    │   └── cases.md
    └── llm_audit/
```

规则：

1. Node 端只写 `meta.json` 和 `record/`。
2. Go 端只读取原始录制数据，并重建或更新 `translate/`。
3. `meta.json` 保留在 run 根目录，作为发现录制记录的锚点。
4. `action_N` 的 pre snapshot 为 `snapshot_{N-1}`，post snapshot 为 `snapshot_N`。
5. 原始录制数据不可被翻译端覆盖。
6. 新翻译只生成 Phase 1～3；旧记录中的 `phase4/cases.md` 保持可读，不要求迁移。
7. 新版记录只有存在 `completed.json` 才显示为已翻译；部分产物不能代替完成标志。

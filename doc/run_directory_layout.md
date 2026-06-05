# run 目录布局说明

单次录制/翻译的输出目录统一为 `output/run_<timestamp>/`，由 `src/utils/run-layout.js` 定义路径（业务代码勿硬编码平铺文件名）。

## 目录树

```
run_<timestamp>/
├── meta.json                          # 元信息；翻译入口（meta.json 路径）
├── record/                            # 录制阶段
│   ├── actions/                       # action_001.json …
│   ├── snapshots/                     # snapshot_000.txt …
│   ├── screenshots/                   # 可选
│   └── recorder.log
└── translate/                         # 翻译阶段（无 LLM 的预处理也在此树下）
    ├── logs/
    │   └── generate.log
    ├── preprocess/
    │   ├── diffs/
    │   ├── enriched/
    │   └── merged/
    │       └── merge_report.json
    ├── phase1/
    │   ├── structured_steps.json      # 下游主消费
    │   ├── structured_steps.xml       # 排查用镜像
    │   ├── llm_raw_batches.xml        # LLM 原始 XML 批次
    │   └── errors.json
    ├── phase2/
    │   ├── cases.md      # 仅测试用例正文（多 Case 用 --- 分隔）
    │   └── coverage.md   # Case 与 Phase1 index 覆盖核对表（审计用）
    ├── phase4/
    │   └── agents.txt
    └── llm_audit/
        ├── call_0001.json
        ├── index.json
        ├── problems.json
        └── summary.json
```

## 设计原则

1. **录制与翻译分离**：`record/` 只放浏览器采集的原始数据；`translate/` 只放翻译流水线产物。
2. **按阶段分子目录**：Phase 1/2/4 不再与 `actions`、`llm_audit` 平铺在 run 根目录。
3. **文件名去冗余**：目录已表达阶段，文件用 `structured_steps.json`、`cases.md` 等短名。
4. **`meta.json` 保留在 run 根**：兼容「指定 meta 路径即可翻译」的入口约定。

## 代码入口

- 录制：`ensureRecordLayout(runDir)` → `getRecordPaths(runDir)`
- 翻译：`ensureTranslateLayout(runDir)` → `getTranslatePaths(runDir)`
- 配置层别名：`config.js` 将 `AI_STEPS_STRUCTURED_FILENAME` 等映射为上述相对路径

## 旧布局说明

2026-06 之前的 run 将 `actions/`、`step_2_*.json`、`AI_cases.md` 等平铺在 run 根目录；**新代码仅支持本布局**，旧 run 需重新录制或手动迁移。

# translate_platform_design.md 第三轮评审意见（check2）

> **评审对象**：`doc/translate_platform_design.md`（合并版，check1 修订后）
> **评审人**：AI 助手
> **日期**：2026-06-06
> **前序**：`doc/check.md`（第一轮）、`doc/check1.md`（第二轮）
> **结论摘要**：check1 的 7 条意见已实质修复。本轮基于现网真实数据复核，发现 check1 #4「密码脱敏」方案引入新矛盾；经决策**取消脱敏**，相关矛盾全部关闭。本文档记录决策与对应的文档/代码修改清单。

---

## 0. check1 修复确认（已落实）

| check1 条目 | 修复位置 | 核对结果 |
|-------------|----------|----------|
| #1 diff 等价性 | §5.3 `autojunk=False` + 验收降级「变更行集合一致」+ `truncate_diff` | ✅ 口径统一；`DIFF_TRUNCATE_THRESHOLD=3000` 与现网一致 |
| #2 ariaSelected | §3.3 schema 纳入 + 宽松 dict 保留未知键 | ✅ 与真实数据吻合 |
| #3 timestamp 必填 | §5.1 改 `Optional[int]` + adapter 回填 | ✅ action 文件确有 timestamp |
| #4 密码脱敏 | §3.7 `mask_form_state_passwords` 扫描全部条目 | ⚠️ 方向对但有硬伤 → 见 §1，已决策取消 |
| #5 Phase1 上下文窗口 | §5.7 `context_window_size=10` | ✅ 与现网 `EVIDENCE_CONTEXT_WINDOW_SIZE=10` 一致 |
| #6 编号重复 | 已改 §9/§10 | ✅ |
| #7 状态标注 | 改「待修订」 | ✅ |

---

## 1. 第三轮发现（密码脱敏方案的问题）

> 以下问题已被 §2 的「取消脱敏」决策整体关闭，仅作记录。

### A. Python adapter 脱敏 formState 会破坏「双端 form_state 一致」验收

现网 Node 的脱敏**只作用于 `inputValue`**，**不脱敏 `formStateDelta`**：

```186:190:src/case_translate/preprocessor/action-merge.js
    if (inputType === 'password') {
      curr.inputValue = PASSWORD_MASK;
    } else {
      curr.inputValue = nextValue;
    }
```

真实数据中明文密码位于 `formStateDelta`，Node 全程未处理：

```37:39:release1/output/run_2026-06-04T11-39-58/record/actions/action_003.json
    "//*[@id='pass64']": {
      "value": "Supcon@1304"
    },
```

若 Python adapter 脱敏 formState 而 Node 保留明文 → 两端 `form_state_changes` 在密码字段必然不同，与 §7.2「form_state 字段级一致」冲突。

### B. 脱敏判定靠字段名字符串（`pass64`），不可泛化

`PASSWORD_XPATH_PATTERNS = ['password','pass64','passwd','pwd']` 绑死当前站点字段名，换站点（`j_password`/`loginPwd` 等）会漏脱敏。更稳健的信号是操作密码框那条 action 的 `element.type === "password"`：

```5:13:release1/output/run_2026-06-04T11-39-58/record/actions/action_002.json
    "tag": "input",
    "id": "pass64",
    "type": "password",
    "xpath": "//*[@id='pass64']",
```

### C. formState 条目可能无 `value` 键

部分条目只有 `ariaSelected`，`form_state.py` 的对比逻辑需容忍缺失 `value`/`checked`，否则可能 KeyError。

---

## 2. 决策：取消脱敏

**决策（用户确认）**：测试环境账号无需脱敏，录制端与翻译端的脱敏功能一并去除，formState 原样接收。

**结论**：第三轮 A / B 两条因取消脱敏而**全部关闭**；C 条与脱敏无关，仍需在实现时注意（见 §4）。

---

## 3. translate_platform_design.md 修改清单

| # | 位置 | 修改动作 |
|---|------|----------|
| 1 | §3.7 `adapt_action_v0_to_v1` | 删除调用 `mask_form_state_passwords` 的那段，formState 原样透传 |
| 2 | §3.7 | 删除 `mask_form_state_passwords` 函数定义整段 |
| 3 | §3.2 / §3.3 schema | `"value": "[MASKED]"` 还原为真实示例值；删除「密码在录制端即脱敏」注释 |
| 4 | §3.7 差异对照表 | 删除「formState 密码：明文 → `[MASKED]`」一行 |
| 5 | §3.9 安全约束表 | 删除第 1 条「formState 密码脱敏」（保留 URL token 一条或整表删除） |

---

## 4. 录制端 / 翻译端代码清理清单

| # | 文件 | 位置 | 修改动作 |
|---|------|------|----------|
| 1 | `src/case_translate/preprocessor/action-merge.js` | L186-190、L202 | 去掉 `inputType === 'password'` 脱敏分支，`inputValue` 直接取 `nextValue` |
| 2 | `src/recorder/`（待确认） | 录制写入处 | 确认录制器本体是否对密码做脱敏，若有一并去除 |
| 3 | `src/case_translate/phase4/agent-txt-generator.js` | L31 | `step.inputText === '[MASKED]'` 判断变死代码，清理 |
| 4 | `src/case_translate/workflow.js` | L895、L1025、L1074 | `'[MASKED]'` 相关判断清理 |
| 5 | `action-merge.js` | `PASSWORD_MASK` 常量 | 若无其他引用则删除 |
| 6 | Python `form_state.py`（实现时） | `compute_form_state_changes` | 容忍只有 `ariaSelected`、无 `value`/`checked` 的条目（对应 §1.C） |

---

## 5. 总结

- check1 全部 7 条已实质修复。
- 第三轮 A/B 因「取消脱敏」决策关闭；C 留作实现注意项。
- 完成 §3 文档修改 + §4 代码清理后，`translate_platform_design.md` 无未决项，状态可由「待修订」转「可开工」。

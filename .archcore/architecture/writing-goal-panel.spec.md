---
title: "Writing goal panel: progress ring, streak, 7-day heatmap, settings and the visible save-failure line"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「写作目标这一格怎么摆、数字从哪来、算不清/存不下时说什么」有规范力：`apps/desktop/src/renderer/src/components/WritingGoalPanel.vue` 这一份组件——今日进度环（字数 + 百分比）、今日时长行（含进度条）、连续达标天数（当前 + 最长）、近 7 天热力图（七格）、目标设置（每日字数 / 每日时长两枚输入）、底栏统计（平均速度 / 今日时长），以及「失败要看得见」的那一条出口（落盘失败上屏），都在这一层。它是右侧的一枚浮层：**数字与判定一律不住 `<script setup>`**——进度、连续天数、速度的唯一算法住 `stores/useWritingGoalStore` 的 `progressForDate`，热力格与进度圈的颜色住 `utils/writing-goal-heat`，星期/号数住 `utils/goal-heat-labels`，落盘通路住 `composables/useBookFileData`，盘上那份的形状校验住 `utils/goal-shape`——这里只剩挂线。

Depended on by: `App.vue`（挂载 + `:visible="goalPanelOpen"` + `@close`；`goalPanelOpen` 是 App 的本地 ref，由键盘快捷键取反）、`App.vue` 的 `goalStore.recordWriting` / `goalStore.activity` 两处记账调用、`stores/useWritingGoalStore`（`goal` / `streak` / `todayProgress` / `recentProgress` / `averageSpeed` / `todayDurationSeconds` / `saveError` / `updateGoal`）、`composables/useModalFocus`（焦点与 Esc）、`utils/writing-goal-heat`、`utils/goal-heat-labels`、`utils/goal-shape`、`composables/useBookFileData`，以及 `goal-timer-wiring.test.ts` / `goal-heat-weekday-wiring.test.ts` / `writing-goal-color-token.test.ts` / `book-data-save-error-wiring.test.ts` / `writing-goal-ring-retired.test.ts`（按源码字面量钉接线）。

Out of scope:

- 进度、连续天数、平均速度、今日时长的**算法** —— 住 `stores/useWritingGoalStore` 的 `progressForDate` / `recomputeStreak` / `averageSpeed`；面板**只读**那些 computed，不自己再算一遍。
- 热力格与进度圈的颜色判定 —— 住 `utils/writing-goal-heat` 的 `heatFill` / `heatBorder` / `ringStroke`（面板 MUST NOT 抄十六进制字面量）。
- 星期与号数标签 —— 住 `utils/goal-heat-labels` 的 `weekdayLabelOfDateKey` / `shortDateLabelOfDateKey`（两枚共用同一次 parse）。
- 落盘通路与失败句 —— 住 `composables/useBookFileData`（写当前这本书的 `.mochen/data/writing-goal.json`，失败留一句人话）。
- 盘上那份的形状校验与默认值 —— 住 `utils/goal-shape`（`normalizeWritingGoalData` / `emptyWritingGoalData` / `isDefaultWritingGoalData`）。
- 可见态与快捷键 —— `goalPanelOpen` 住 `App.vue`（快捷键取反），本组件只读 `props.visible`。
- 焦点与 Esc —— 住 `composables/useModalFocus`（本组件不留第二份判定）。

## Surface

- `WritingGoalPanel.vue` — @apps/desktop/src/renderer/src/components/WritingGoalPanel.vue — 写作目标浮层壳；props `visible`；emit `close`。
- `panelRoot` + `useModalFocus({ root, close, isOpen })` — 同文件 — 焦点与 Esc 的唯一接线（不自留判定）。
- `todayProgress` / `streak` / `recentProgress` / `averageSpeed` / `todayDurationSeconds` — 由 `storeToRefs(useWritingGoalStore)` 取的只读视图 — 环、连续天数、热力图、底栏三处数字全从这里来。
- `RADIUS` / `CIRCUMFERENCE` / `dashOffset` — 同文件 — 进度环几何（`dashOffset = C * (1 - percentage / 100)`）。
- `heatDays` — 同文件 — = `recentProgress.value`，热力图的七格数据源。
- `settingsOpen` / `inputWordTarget` / `inputTimeTarget` / `saveSettings` — 同文件 — 设置区的开合、两枚输入的本地草稿与提交。
- `formatDuration` — 同文件 — 秒 → `N秒` / `N分钟` / `H小时M分` 的人话时长。
- `heatFill` / `heatBorder` / `ringStroke` — @apps/desktop/src/renderer/src/utils/writing-goal-heat.ts — 格色/描边/环色的真身。
- `weekdayLabelOfDateKey` / `shortDateLabelOfDateKey` — @apps/desktop/src/renderer/src/utils/goal-heat-labels.ts — 星期/号数标签的真身。
- `saveError` — @apps/desktop/src/renderer/src/stores/useWritingGoalStore.ts（经 `useBookFileData`）— 落盘失败的那句话；空串 = 正常。

States: 可见（真身 `App.vue` 的 `goalPanelOpen`，快捷键取反）→ 设置区（收起 / 展开）→ 今日达成（仅字数达成 / 仅时长达成 / 未达成）→ 时长目标（已设 / 未设）→ 落盘（正常 / 失败句上屏）。

## Normative Behavior

1. WHEN 开合面板，the 组件 MUST 只读 `props.visible`（可见态真身是 `App.vue` 的本地 ref `goalPanelOpen`，由快捷键切换），MUST NOT 自持第二份本地布尔。
2. WHEN 装焦点与 Esc，the 组件 MUST 走 `useModalFocus` 一处（`root` = `panelRoot`、`close` = emit close、`isOpen` = `toRef(() => props.visible)`），MUST NOT 在组件里留第二份 Esc / 焦点判定。
3. WHEN 面板转可见，the 组件 MUST 把两枚设置输入回填成当前目标值（`inputWordTarget` / `inputTimeTarget`），MUST NOT 让草稿停留在上一次的旧值。
4. WHEN 点保存，the 组件 MUST 先把输入取整并夹到非负（`Math.max(0, Math.round(...))`），且 MUST 只在某格 `> 0` 时才 `updateGoal` 那一格。
5. WHEN 渲染今日进度环，the 组件 MUST 读 `todayProgress` 的 computed 值（字数 / 目标 / 百分比），环色 MUST 经 `ringStroke(reached)` 取，MUST NOT 在模板里抄十六进制颜色。
6. WHEN 渲染今日时长行，若 `todayProgress.targetSeconds > 0`，the 组件 MUST 显示目标分钟数与时长进度条；否则 MUST 显示「未设目标」，MUST NOT 显示「0 / 0 分钟」这一类自欺样式。
7. WHEN 渲染热力格，the 七格 MUST 来自 `recentProgress`（近 7 天滚动窗口），格色 MUST 经 `heatFill(day.percentage, day.reached)` 与 `heatBorder(day.percentage)`，每格的星期标签 MUST 经 `weekdayLabelOfDateKey(day.date)`（按**那一格自己的日期**算），MUST NOT 按数组下标贴。
8. WHEN 渲染连续天数区，the 组件 MUST 读 `streak` 的 `currentStreak` / `longestStreak`，MUST NOT 在面板里重算连续。
9. WHEN 底栏渲染，the 组件 MUST 读 `averageSpeed` 与 `todayDurationSeconds`（时长经 `formatDuration` 落成人话），MUST NOT 自造一份内存态速度。
10. WHEN 点遮罩空白（`@click.self`），the 组件 MUST emit `close`。

## Constraints & Invariants

- Constraint: `WritingGoalPanel.vue` MUST 守住单文件 800 行硬上限（`conventions/source-line-budget.rule.md`；`tools/check-source-line-budget.mjs`）。
- Constraint: 颜色判定 MUST 住 `utils/writing-goal-heat`——五档 `heatFill`、空格描边 `heatBorder`、环色 `ringStroke` 一处一份；面板 MUST NOT 抄写死的十六进制（换主题时那几支不跟）。
- Constraint: 星期 / 号数 MUST 住 `utils/goal-heat-labels`，两枚标签共用同一次 `parseDateKey`（各 parse 一次迟早变成「号数对、星期偏一天」）。
- Constraint: 字号 MUST 一律用 `rem`（`:root` 的 font-size 就是 `--ui-font-size`），MUST NOT 写死 `px`（写死的话用户调字号这一格不动，会被判成「设置坏了」）。
- Invariant: 面板 MUST NOT 自算进度数字——`todayProgress` / `recentProgress` / `averageSpeed` / `todayDurationSeconds` 的唯一算法住 `useWritingGoalStore` 的 `progressForDate`（同一格在别的面板里不许显示成不同数字）。
- Invariant: 失败必须看得见（`conventions/failures-must-be-visible.rule.md`）—— 目标 / 会话 / 连续天数存不进这本书的目录时，MUST 由 `store.saveError` 在面板顶部上屏，MUST NOT 让进度环继续涨而盘上没东西。
- Invariant: 数据随书隔离 —— `goal` / `sessions` / `streak` 落**当前这本书**的 `.mochen/data/writing-goal.json`（通路 `useBookFileData`），MUST NOT 回落到不带书标识的全局键。

## Failure Behavior

1. IF 落盘失败（`store.saveError` 非空），THEN the 组件 MUST 在 `goal-body` 顶部显示它（`goal-save-error`，`role="status"` `aria-live="polite"`），MUST NOT 让进度环照样涨而屏上一个字都不说。
2. IF 某格输入被夹成 0（用户填 0 或负数），THEN 该格 MUST 不落盘（沿用 `if (… > 0)` 那道闸）——0 会被进度算法读成「已达标」，不是「未设」。
3. IF 用户没有设每日时长目标（`dailyTimeTarget = 0` / `targetSeconds = 0`），THEN 时长行 MUST 显示「未设目标」且 MUST NOT 渲染时长进度条（`v-if="todayProgress.targetSeconds > 0"`）。
4. IF 热力格那一格的日期键认不得，THEN 标签 MUST 回 `—` 占位（`utils/goal-heat-labels` 的 `UNKNOWN_LABEL`），MUST NOT 是空串（那格会塌）或 `NaN`。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 一本刚打开的书、每日字数目标 1000、今日已写 400 字
When  打开写作目标面板
Then  进度环显示「400 / 1000 字」「40%」，环色走 ringStroke（未达成 = --accent）
And   连续天数读 store.streak，热力七格来自 recentProgress 且每格标签按自己的日期算
And   落盘失败时 goal-save-error 那一行必须出现并把理由说出来
```

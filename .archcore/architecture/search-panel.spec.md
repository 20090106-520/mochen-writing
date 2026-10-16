---
title: "Full-text search overlay: debounce, hit grouping, jump wiring and the two-step replace"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「全文搜索这块浮层怎么接、两个键盘通路怎么不开第二份」有规范力：`apps/desktop/src/renderer/src/components/SearchPanel.vue` 这一份组件——整屏遮罩浮层、`visible` 开合、防抖检索、按文档分组的结果列表与统计、两种空态话术、↑↓/↵ 选择与跳转、搜索历史 chips、全书替换那一行（两步确认 + 精确命中才给）、页脚快捷键提示。它是渲染层搜索的**唯一组件壳**：**判定与实现一律不住这里**——检索住 store、替换住主进程与 `utils/book-replace`、焦点与 Esc 住 `useModalFocus`、组合态住 `imeOwnsKey`，组件只剩浮层与接线。

Depended on by: `App.vue`（挂载并接 `close`；快捷键 Ctrl+Shift+F 的判定在那边）、`stores/useSearchStore`（检索真身与历史）、`utils/book-replace`（`runBookReplace` / `bookReplaceNotice`）、`composables/useModalFocus`（焦点进出与 Esc）、`stores/useNotificationStore`（回执通知）、`utils/doc-checkup`（`loadAllDocContents`）、`utils/book-kinds`（`BOOK_KIND_LABELS`）、`utils/slash-commands`（`imeOwnsKey`）。

Out of scope:

- 检索本身（精确子串 / 整书零命中后的一字之差兜底 / 条数上限 / 历史去重）—— 住 `stores/useSearchStore`；容错判定真身住 `@mochen/contracts/search-match`（与主进程 `search_docs` 同一份）。
- 替换的执行 —— 逐篇读 / 换 / 写与回执照主进程那份契约；渲染层两层（递单 + 翻人话）住 `utils/book-replace`。
- 焦点接管与 Esc 唯一真身 —— 住 `composables/useModalFocus`（本组件 MUST NOT 留第二份）。
- 组合态判据 —— 住 `utils/slash-commands` 的 `imeOwnsKey`；拉全文 —— 住 `utils/doc-checkup`；文档类型名 —— 住 `utils/book-kinds`。
- 唤起快捷键 —— 住 `App.vue`（本组件只认 `visible` prop）。
- 样式 —— 组件内 `scoped`，不进全局样式表。

## Surface

- `visible` prop / `close` emit — 同文件 — 浮层开合由外部给；`@click.self` 点遮罩也 `close`。
- `panelRoot` / `useModalFocus({ root, close, isOpen })` — 同文件 — 焦点进出与 Esc 的唯一接管点。
- `search` / `book` / `layout` / `notif` — 同文件 — 四个 store 真身（检索 / 书 / 布局 / 通知）。
- `lastResult` / `isSearching` / `searchHistory` — 同文件 — `storeToRefs` 的投影（只读）。
- `localQuery` / `inputRef` / `selectedIndex` — 同文件 — 本地输入、输入框句柄、当前选中项。
- `localReplacement` / `replaceArmed` / `replacing` / `canReplace` — 同文件 — 替换词、第一步确认、替换中闸、入口判据（精确命中 + 查询 ≥2 字）。
- `watch([localQuery, localReplacement])` — 同文件 — 查询或替换词一变就撤确认。
- `watch(() => props.visible)` — 同文件 — 打开时把 `search.query` 灌进本地；收起撤确认。
- `onReplaceKeydown` / `onReplaceAll` — 同文件 — 替换框键盘与两步确认的唯一通路。
- `onInput`（防抖 200ms）/ `selectHistory` — 同文件 — 两个发检索的入口（都现拉全文）。
- `groupedHits` / `globalHitIndex` / `jumpToHit` / `onKeydown` — 同文件 — 分组、扁平编号、跳转分派与选择键。

States: 关（`visible` 假，整块不进 DOM）→ 打开（焦点进面板、`search.query` 灌入本地）→ 输入中（<2 字清空 / ≥2 字防抖 200ms 后检索）→ 有结果（分组列表 + 统计行 + `fuzzy` 标签 + 可替换行）→ 无结果（按 `mode` 分两种话术）→ 替换三态（未举起 / 已举起 / 替换中）→ 收起（撤确认）。

## Normative Behavior

1. WHEN 浮层开合，the 组件 MUST 只认外部的 `visible` prop，MUST NOT 自己存一份开关、MUST NOT 自己判唤起快捷键（那在 `App.vue`）。
2. WHEN 焦点进出与 Esc，the 组件 MUST 只经 `useModalFocus` 一处，MUST NOT 在输入框或面板上再挂第二份 Esc / 聚焦判定。
3. WHEN 面板打开，the 组件 MUST 把 `search.query` 灌进 `localQuery`；收起时 MUST 把两步确认撤掉（`replaceArmed = false`）。
4. WHEN 用户输入，the 组件 MUST 防抖 200ms 后才发检索，且防抖回调里 MUST 现拉全文（`loadAllDocContents(book.docs)`），MUST NOT 用缓存里的旧正文。
5. WHEN 查询 trim 后不足 2 字，the 组件 MUST NOT 发检索，也不 MUST NOT 留「输了没反应」的空结果；清到 0 字时 MUST 调 `search.clear()`。
6. WHEN 真发检索，the 组件 MUST 只经 `search.search(docs, q)`，MUST NOT 在组件里实现匹配、容错兜底或条数上限。
7. WHEN 渲染结果为空页，the 组件 MUST 按 `lastResult.mode` 分两种话术（`fuzzy` 说「连一字之差的近似匹配也试过了」）。
8. WHEN 渲染结果，the 组件 MUST 按 `docRelPath` 分组、显示 `totalHits` 与 `durationMs`，且 `mode === "fuzzy"` MUST 显式打「一字之差容错」标（相似不是相同，不标就是骗人）。
9. WHEN 显示文档类型名，the 组件 MUST 读 `BOOK_KIND_LABELS[group.docKind]`（带回退），MUST NOT 另写一份中文。
10. WHEN 按 ↑ / ↓ / ↵，the 组件 MUST 先经 `imeOwnsKey` 放行组合态，MUST NOT 把输入法选词那一下回车当「跳到这条命中」。
11. WHEN 移动 `selectedIndex`，the 组件 MUST 用 `Math.min` / `Math.max` 夹在 `[0, hits.length - 1]`；`lastResult` 为空时 MUST 直接返回。
12. WHEN 跳转某条命中，the 组件 MUST 经 `book.refOf(hit.docRelPath)`：`chapter` 走 `book.openDocTab`、其余走 `book.browse`，随后调 `layout.requestDocGroup(ref.kind)` 并 `emit("close")`。
13. WHEN 全书替换那一行是否出现，the 组件 MUST 只认 `canReplace`（`lastResult.mode === "exact"` 且 `localQuery.trim().length >= 2`），容错命中那一轮 MUST NOT 给按钮。
14. WHEN 点替换按钮，the 组件 MUST 两步确认：第一下只举起（文案变「确认替换全书 N 篇？」、样式一眼可分），第二下才真动手。
15. WHEN `localQuery` 或 `localReplacement` 变化，the 组件 MUST 立刻撤掉确认 —— MUST NOT 让已举起的那一下替一份没确认过的输入背书。
16. WHEN 真动手替换，the 组件 MUST 只经 `runBookReplace` 一枚入口、`caseSensitive: false`（与检索同一档），MUST NOT 直连 `window.mochen`、MUST NOT 自己拼通知话。
17. WHEN 替换框吃键盘，the 组件 MUST 只走 `onReplaceKeydown`（`imeOwnsKey` 先放行、Enter 才确认），且 `replacing` 期间 MUST NOT 重入。
18. WHEN 替换回执落地，the 组件 MUST 经 `notif.notify` 原样递出 `bookReplaceNotice` 的 `level` / `message`，MUST NOT 在组件里二次推断。
19. WHEN 本组件写样式，the 组件 MUST 用 `scoped`，MUST NOT 污染全局样式表。

## Constraints & Invariants

- Constraint: 本文件是 §候选池里 611 行 / 5 提交那一格 —— 检索与替换的实现一律住 store / utils，组件只做浮层与接线，见 `conventions/source-line-budget.rule.md`。
- Constraint: `caseSensitive: false` 是与检索口径绑死的一档 —— 面板找人时就不分大小写，换的时候也照同一档走。
- Invariant: 替换入口只有一枚（`runBookReplace`）—— 组件里出现 `window.mochen.` 就是绕开了那一层（它替你把 IPC 异常收成 `ok:false` 的真结果）。
- Invariant: 替换通知话只有一份（`bookReplaceNotice`）—— 组件里拼「已替换 N 处」就是第二份，而那句话正是唯一会骗人的地方。
- Invariant: Esc 与焦点只有一份真身（`useModalFocus`）—— 输入框上再挂 `@keydown.esc` 就是第二份（实测那处够不着，焦点压根没进面板）。
- Invariant: 组合态判据只有一份（`imeOwnsKey`）—— 组件层出现 `event.isComposing` / `keyCode === 229` 就是第二份实现。
- Invariant: `mode === "exact"` 是替换入口的唯一放行条件 —— 容错那一轮给按钮就是把「相似」当「相同」改盘上正文。

## Failure Behavior

1. IF 查询不足 2 字，THEN the 组件 MUST NOT 发检索，MUST NOT 渲染一张「0 处匹配」的表让人以为搜过了。
2. IF 命中为空，THEN the 组件 MUST 按 `fuzzy` / `exact` 给两种话术，MUST NOT 只甩一片空白。
3. IF `book.refOf` 取不到 ref，THEN 跳转 MUST 直接返回（不动盘、不切标签、不发请求）。
4. IF 这一轮是容错命中，THEN 替换入口 MUST NOT 进 DOM（不给假控件，也不给一句「点了没反应」）。
5. IF 只点了第一下，THEN the 组件 MUST 只举起确认，MUST NOT 动盘上一个字。
6. IF IPC 抛错（主进程没起 / 通道没注册），THEN `runBookReplace` MUST 回一个真结果（`ok:false` + 一句中文），MUST NOT 让异常穿过按钮的 await。
7. IF 回执里 `skipped` 非空，THEN 通知 MUST 报 `warning` 并列出前几篇，MUST NOT 报成一次干净的 success。
8. IF 替换词是空串，THEN 通知 MUST 按「删掉」那条话术说，MUST NOT 说成「换成（空）」。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 打开搜索浮层、输入两个字并命中若干篇，其中一篇是章节
When 用 ↓ 选中该条并回车
Then 章节走 openDocTab 打开、浮层关闭且右栏收到 requestDocGroup；
     同一轮里若命中口径是 fuzzy，替换那一行压根不进 DOM（相似不是相同）
```

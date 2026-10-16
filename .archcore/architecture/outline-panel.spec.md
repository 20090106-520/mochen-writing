---
title: "Outline panel: section grouping, the ↑↓ cursor and the sort/collapse toolbar"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「文档大纲这块左栏浮层怎么接、走位算术为什么不许写在组件里」有规范力：`apps/desktop/src/renderer/src/components/OutlinePanel.vue` 这一份组件——整屏遮罩浮层、`visible` 开合、统计行（篇数 / 总字数）、搜索框、工具栏（两档排序 + 全部展开 / 全部折叠）、按 `BOOK_KIND_ORDER` 分节的分组树（可折叠、节点可点）、页脚快捷键提示，以及 ↑↓ 浏览那条通路。它是大纲面板的**唯一组件壳**：**走位算术不住这里**——「往哪儿走」住 `utils/outline-navigation`（纯函数，9 条用例）；kind 的标签与顺序住 `utils/book-kinds`（唯一表）；字数格式化住 `utils/char-count`；焦点回场与 Esc 住 `useModalFocus`；组件只做分组视图、焦点搬运与接线。

Depended on by: `App.vue`（挂载并接 `close`）、`stores/useBookStore`（`docs` / `activeDocTab` / `openDocTab` / `browse`；`docs` 进来之前已按 `book.json` 的 `chapterOrder` 排过）、`utils/outline-navigation`（`visibleNavNodes` / `stepNavNode`）、`utils/book-kinds`（`BOOK_KIND_ORDER` / `BOOK_KIND_LABELS`）、`utils/char-count`（`formatCharCount`）、`utils/transientScrollbar`（`createTransientScrollbarController`）、`utils/slash-commands`（`imeOwnsKey`）、`composables/useModalFocus`（焦点回场与 Esc）。

Out of scope:

- ↑↓ 走位的算术（跳过折叠分节、越界停住、游标不在队列里时从一端起）—— 住 `utils/outline-navigation`（本组件 MUST NOT 重写一份）。
- kind 的标签、顺序与图标拼写覆盖面 —— 标签与顺序住 `utils/book-kinds` 唯一表；图标是渲染资产，本组件自持一份 `KIND_ICON`（与 `utils/kind-icons` 是同一概念的第二份，属未收口项，本规范如实登记、不假装已统一）。
- 字数格式化 —— 住 `utils/char-count`；滚动条显隐 —— 住 `utils/transientScrollbar`。
- 焦点回场与 Esc 唯一真身 —— 住 `composables/useModalFocus`。
- 章节次序的拖拽 —— 住 `LeftSidebar.vue`（那边调 `book.moveChapterByRelPath`，先落 `chapterOrder` 再上屏）；本组件**没有**拖拽，也不许留「视觉占位」的假承诺。
- 样式 —— 组件内 `scoped`，不进全局样式表。

## Surface

- `visible` prop / `close` emit — 同文件 — 浮层开合由外部给；`@click.self` 点遮罩也 `close`。
- `panelRoot` / `useModalFocus({ root, close, isOpen })` — 同文件 — 焦点回场与 Esc 的唯一接管点。
- `book` / `docs` / `activeDocTab` — 同文件 — store 真身与其 `storeToRefs` 投影。
- `KIND_ICON` — 同文件 — 本组件自持的图标表（13 行，`Record<BookKind, IconName>`）。
- `searchQuery` / `inputRef` / `cursorPath` — 同文件 — 过滤词、搜索框句柄、↑↓ 游标（`null` = 焦点还没进节点列表）。
- `sortMode` / `SORT_OPTIONS` / `sortDocs` — 同文件 — 两档排序的唯一档位表与那两个分派。
- `collapsedSections` / `toggleSection` / `expandAll` / `collapseAll` — 同文件 — 折叠状态的一处表达与三条动作。
- `filteredSections` — 同文件 — 分节视图模型（`{ id, label, icon, nodes }`），`outline-navigation` 收的就是它。
- `nodeEls` / `setNodeRef` / `navNodes` / `focusNode` / `moveCursor` / `onPanelKeydown` — 同文件 — ↑↓ 涉及的全部接线。
- `isSelected` / `activateDoc` — 同文件 — 选中判定与激活分派。
- `totalWords` / `totalCount` / `panelScrollbar` / `handleScroll` — 同文件 — 统计与滚动条显隐。
- `watch(() => props.visible)` — 同文件 — 打开落焦搜索框并把游标归 `null`；收起清过滤词与折叠态。

States: 关（`visible` 假，整块不进 DOM）→ 打开（搜索框拿到焦点、游标为 `null`）→ 过滤中（按标题 / 摘录筛）→ 分节两态（展开 / 折叠，缺省展开）→ 排序两档（章节顺序 / 按字数）→ 空态（无分节可显）→ 收起（清过滤词与折叠态）。

## Normative Behavior

1. WHEN 浮层开合，the 组件 MUST 只认外部的 `visible` prop，MUST NOT 自己存一份开关。
2. WHEN 焦点回场与 Esc，the 组件 MUST 只经 `useModalFocus` 一处，MUST NOT 在面板或搜索框上再挂 `@keydown.esc`（那一处已退役，不许复活）。
3. WHEN 面板打开，the 组件 MUST 把焦点落到搜索框（经 `inputRef`）并把 `cursorPath` 归 `null` —— 上一次的焦点位置 MUST NOT 决定这一次 ↓ 落在哪。
4. WHEN 面板收起，the 组件 MUST 清掉 `searchQuery` 与 `collapsedSections`，MUST NOT 让下次打开看见上一次的残态。
5. WHEN 列分节与顺序，the 组件 MUST 只取 `BOOK_KIND_ORDER`，标签 MUST 只取 `BOOK_KIND_LABELS`，MUST NOT 在组件里再列一份 kind 名单。
6. WHEN 出分节列表，the 组件 MUST 只保留 `nodes.length > 0` 的分节（空的那几节 MUST NOT 在屏上留一个空壳）。
7. WHEN 按搜索词筛，the 组件 MUST `trim` + 小写，命中 `title` 或 `excerpt`；空查询 MUST 原样不筛。
8. WHEN 排序，the 组件 MUST 只经 `sortDocs`：`chars` 按 `chars ?? 0` 降序，`order` MUST 原样返回（不另排，`docs` 进来前已按 `chapterOrder` 排过）。
9. WHEN 渲染排序档位，the 组件 MUST 用 `SORT_OPTIONS` 与 `SortMode` 双向对齐（加一档不实现、或留一枚没人实现的档位都视为重写）；「按类型」那一档 MUST NOT 复活。
10. WHEN 折叠状态，the 组件 MUST 只用一个 `collapsedSections` 对象表达（缺省＝展开）；`collapseAll` MUST 覆盖 `BOOK_KIND_ORDER` 全部，`expandAll` MUST 清成 `{}`。
11. WHEN 算 ↑↓ 往哪儿走，the 组件 MUST 只经 `visibleNavNodes` + `stepNavNode`，MUST NOT 在组件里夹下标或重写走位规则。
12. WHEN 有分节被折叠，the 组件 MUST 让它整个不参与 ↑↓（那几节的节点在 DOM 里不存在，焦点走进去等于「按了键没反应」）。
13. WHEN ↑↓ 落下来，the 组件 MUST 先经 `imeOwnsKey` 放行组合态，MUST NOT 在组件里散写 `event.isComposing` / `keyCode === 229`。
14. WHEN 真的走了一步，the 组件 MUST `preventDefault`；MUST NOT 在没处可去时吞掉按键（那时照常冒泡）。
15. WHEN 某枚节点拿到焦点，the 组件 MUST 把它滚进视野（`scrollIntoView({ block: "nearest" })`），MUST NOT 只搬焦点不滚屏。
16. WHEN 焦点落在哪枚节点，the 组件 MUST 由节点自己的 `@focus` 回写 `cursorPath`（不另设一套「谁被点了」的判定）。
17. WHEN ↵ 打开某一枚，the 组件 MUST NOT 另写 keydown —— 节点本来就是 `<button>`，回车 / 空格由浏览器派发 click。
18. WHEN 激活某一枚文档，the 组件 MUST 按 `kind` 分派：`chapter` 走 `book.openDocTab`、其余走 `book.browse`。
19. WHEN 判选中，the 组件 MUST 只认 `activeDocTab === relPath`。
20. WHEN 显示字数，the 组件 MUST 只经 `formatCharCount`，MUST NOT 在组件里再写一份格式化。
21. WHEN 滚动区滚动，the 组件 MUST 只经 `createTransientScrollbarController` 的 `reveal`，且 `onBeforeUnmount` MUST `dispose` 掉它。
22. WHEN 本组件的滚动区，the 组件 MUST NOT 出现 `draggable` / drop 处理或「可拖拽排序」的视觉占位注释 —— 这一层确实没有拖拽。
23. WHEN 本组件写样式，the 组件 MUST 用 `scoped`，MUST NOT 污染全局样式表。

## Constraints & Invariants

- Constraint: 本文件是 §候选池里 697 行 / 3 提交那一格 —— 走位算术住 `utils/outline-navigation` 出纯函数用例、接线住 `outline-nav-wiring.test.ts` 读源文件，见 `conventions/source-line-budget.rule.md`。
- Constraint: `.vue` 不进类型程序 —— 少写一个 import、少挂一个 `@keydown`，tsc 与 build 都不报，要到用户按键那一刻才发现（`CenterColumn.vue` 上真撞过同一类漏 import）。
- Invariant: 「往哪儿走」只有一份算术（`utils/outline-navigation`）—— 组件里出现 `Math.min/max` 夹下标就是第二份。
- Invariant: kind 的标签与顺序只有一份真身（`utils/book-kinds`）—— 组件里出现第二份中文标签或第二份 kind 名单就是重写。
- Invariant: `order` 档「不另排」是承诺行为，不是漏实现 —— 它是 `docs` 已按 `chapterOrder` 排过的延续；反过来补一层空转排序才是错的。
- Invariant: 「点下去什么也不变、且不是承诺行为」的档位是假控件 —— 处置是摘掉，不是补一层空转。
- Invariant: 本组件自持一份 `KIND_ICON`（`utils/kind-icons` 已收口 `LeftSidebar` 那份）—— 属未收口项，如实登记；新增 kind 时两处都要有。

## Failure Behavior

1. IF 全部折叠或筛不到任何节点，THEN 视图 MUST 进空态（`没有匹配「…」的文档`），且 ↑↓ MUST 一个焦点也不动、那一下按键 MUST NOT 被吞。
2. IF 游标所在的分节刚被折叠，THEN 下一步 MUST 从队列一端重新起走，MUST NOT 让一次折叠把键盘导航打死。
3. IF 越界（首条按 ↑ / 末条按 ↓），THEN MUST 停住不环回（文档列表不是轮播标签）。
4. IF 输入法处于组合态，THEN 那一下方向键 MUST NOT 被当作浏览（它是在选候选词）。
5. IF `nodeEls` 里取不到该节点的元素（它在 DOM 里不存在），THEN `focusNode` MUST 直接返回、一个焦点也不搬。
6. IF 某档排序点下去什么也不变且不是承诺行为，THEN MUST 摘掉那一档，MUST NOT 补一层空转排序。
7. IF 组件里出现第二份字数格式化 / 第二份档位名单 / 第二份走位算术，THEN 视为重写（违反单一真身）。
8. IF 面板卸载，THEN `panelScrollbar` MUST 被 `dispose`（MUST NOT 把监听留在页面上）。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 打开文档大纲面板，把全部分节都折叠起来
When 按 ↓
Then 按键 MUST 照常冒泡（一个节点都没得去，就不该吞那一下），
     焦点 MUST 仍停在原处，屏上 MUST 仍是折叠态
```

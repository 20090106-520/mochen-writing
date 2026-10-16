---
title: "Right-pane document shell: three modes, overlay anchors and the edit wiring"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「右栏这一格怎么出、怎么接、怎么不各说各话」有规范力：`apps/desktop/src/renderer/src/components/DocumentPane.vue` 这一份组件——右栏三态（文稿 / 浏览 / 作品资料）的摆态、六枚浮层的锚点与开合、正文 / 分栏预览 / 查找高亮三层、页脚两格与保存态、标题行的可编辑与提交，以及所有「判定住 utils、行为住 composable」的接线，都在这一层。它是渲染层右栏唯一的组件壳：**判定与文案一律不住 `<script setup>`**，这里只剩挂线。编辑面仍是 `<textarea>`，本仓右栏不做 WYSIWYG。

Depended on by: `App.vue`（挂右栏一格、接 `collapse` 事件）、`DocumentTabBar.vue` / `SnippetToolbar.vue` / `BookDossier.vue`（被它挂载、只渲染父侧喂进去的值）、六枚浮层（`ChangeHistoryPanel` / `SlopPanel` / `ReviewScorePanel` / `TimelineCheckPanel` / `VolumeOutlinePanel` / `ForeshadowPanel`，锚点由本组件提供）、`stores/useBookStore`（读写右栏三态与草稿）。

Out of scope:

- 判定的真身 —— 正文三态住 `utils/editor-readout`；浏览三态住 `utils/browse-body`；保存态文案住 `utils/save-state`；两张右栏文案表住 `utils/right-pane-labels`；高亮层 HTML 住 `utils/find-mirror`；撤销红线住 `utils/edit-undo`。
- 行为（撤销把哪份文本写回草稿、片段插入）—— 住 `composables/useEditUndo` 与 `composables/useSnippetToolbar`；排程（落后一拍）住 `composables/usePreviewDraft` 与 `composables/useTrailingValue`。
- 三档偏好怎么读写、变量挂法与断点 —— 住 `utils/editor-leading-preference` / `editor-text-preference` / `editor-measure-preference` 与 `styles/editor-pane.css`。
- 右栏三态的联合类型、开书 / 浏览 / 伏笔的落盘 —— 住 `stores/useBookStore.ts`，见 `architecture/use-book-store.spec.md`。

## Surface

- `DocumentPane.vue` — @apps/desktop/src/renderer/src/components/DocumentPane.vue — 右栏唯一组件壳；emit `collapse`。
- `mode` — 同文件 — 右栏三态的唯一读口（取 `book.rightPaneMode`）。
- `viewMode` — 同文件 — 文稿区本地视图态（edit / split / preview，写回 `book.editorViewMode`）。
- `bodyState` / `loadingLabel` / `SKELETON_LINES` — 同文件 — 骨架 / 空态 / 正文三态与话术的接线（喂事实、取结论）。
- `browseView` — 同文件 — 浏览那一格的三态视图（真身 `browseBodyViewOf`）。
- `previewDraft` / `previewHtml` — 同文件 — 分栏预览的落后一拍草稿与 HTML。
- `mirrorSource` / `highlightMirrorHtml` / `syncMirrorScroll` / `syncPreviewScroll` — 同文件 — 高亮层快照、HTML 与两层滚动同步。
- `useEditUndo` 产物（`replaceWithUndo` / `commitWithUndo` / `undoLastEdit` / `invalidateUndo` / `onEditorKeydown` / `undoNoticeText`）— 同文件 — 撤销栈的唯一接线。
- `useSnippetToolbar(editorEl, commit)` — 同文件 — 片段工具栏接的是同一份撤销栈（第二枚实参是 `commitWithUndo`）。
- `editorLayoutStyle` / `editorSpellcheck` — 同文件 — 行距 / 字号 / 列宽三档与拼写检查的挂载。
- `prose` / `characterCount` / `readingTimeLabel` — 同文件 — 页脚计数（先剥围栏、再数非空白码点）。
- `saveStateText` / `tabs` / `activeTabId` / `breadcrumbs` / `title` — 同文件 — 页脚保存态与标签 / 面包屑接线。
- `onTitleKeydown` / `commitTitle` / `revertTitle` / `blurTitle` — 同文件 — 标题行键盘裁决与提交。
- `switchMode` — 同文件 — 三枚页签的共用一个入口（dossier 判定住这里）。
- 六枚浮层的 `ref` + `XAnchor` computed — 同文件 — 面板锚在自己那颗按钮上。

States: 右栏三态（文稿 / 浏览 / 作品资料）→ 文稿态再分本地视图三档（编辑 / 分栏 / 预览）→ 正文三态（骨架 loading / 空态 empty / 正文 body）→ 浮层开合（跨组件的住 store，纯本地的住组件本地）。

## Normative Behavior

1. WHEN 渲染右栏三态，the 组件 MUST 只读 `book.rightPaneMode`（唯一真身），MUST NOT 在组件内自持第二份三态。
2. WHEN 三枚页签渲染或点击，the 组件 MUST 表驱动 `VIEW_TABS`，模板只留一处 `@click="switchMode(tab.mode)"`；切到作品资料 MUST 经 `switchMode` 的 dossier 分支调 `book.openDossier()`，MUST NOT 在模板里裸调。
3. WHEN 判正文三态（骨架 / 空态 / 正文），the 组件 MUST 调 `editorBodyState`，MUST NOT 在组件里写 `"loading"` / `"empty"` / `"body"` 字面量。
4. WHEN 正文在途，the 组件 MUST 在**编辑区与预览区各自的 v-if** 都挂同一条 `bodyState !== 'empty'` 判定——只挡一处，分栏右半边会先摆出上一篇的渲染结果。
5. WHEN 在途摆骨架，the 骨架 MUST 不含 textarea；空态 MUST 有自己的话术（不摆空输入框让人以为是自己写空了）。
6. WHEN 判浏览那一格该显示什么，the 组件 MUST 把 `book.browseContents` 与 `book.browseErrors` 一起交给 `browseBodyViewOf`，MUST NOT 用 `?? "正在读取…"` 一类的兜底。
7. WHEN 页脚出「正文 N 字」与阅读时长，the 组件 MUST 先 `splitFrontmatter(book.draft).body` 再取 `proseCharCount` 与时长，MUST NOT 直接数 `book.draft.length` 或换一套含空白口径。
8. WHEN 页脚出保存态，the 组件 MUST 走 `saveStateLabel`，且 `{{ book.notice || saveStateText }}` 全栏**只出现一处**（底栏）；栏头 MUST NOT 重新长出第二份保存状态或第十枚 `icon-button`（那 79px 的宽度账）。
9. WHEN 高亮层（mirror）挂载，the 组件 MUST 只在 `findVisible` 时挂——与 textarea 那层让位类（`document-editor--with-find`）**同一个开关、同一份判据**，两层必须同开同关。
10. WHEN 高亮层吃数据，the 组件 MUST 吃 `mirrorSource` 快照（草稿 + 位置 + 当前条三件同拍），MUST NOT 吃 live 的 `book.draft`。
11. WHEN 面板打开那一刻新挂上高亮层，the 组件 MUST `await nextTick()` 后补一次 `syncMirrorScroll()`——新挂的层 scrollTop 是 0，不跟一下高亮就错位。
12. WHEN 分栏预览吃草稿，the 组件 MUST 吃 `previewDraft`（落后一拍），MUST NOT 在 `.vue` 里再写 `setTimeout` 排程。
13. WHEN 三档偏好（行距 / 字号 / 列宽）落地，the 组件 MUST 把三枚变量**一起**挂 `.editor-document`（编辑面 / 预览面 / 浏览面 / 高亮层的共同祖先），MUST NOT 挂 textarea 或 `.editor-textarea-wrap`。
14. WHEN 用户手打一个字，the 组件 MUST 先 `invalidateUndo()`、再 `book.onEdit(target.value)`（顺序钉死：先作的栈、后写的稿）。
15. WHEN 替换 / 全部替换 / 撤销 / 片段插入，the 组件 MUST 只经 `useEditUndo` 那一份栈的产物，MUST NOT 在 `.vue` 里自建栈或自写草稿。
16. WHEN 键盘裁决（Ctrl+Z 归撤销、Enter / Esc 归标题），the 组件 MUST 把组合态闸门与 `preventDefault` 放进**同一个函数**里，且闸门排在 `preventDefault` 之前，MUST NOT 用模板 `.prevent` 修饰符。
17. WHEN 标题行提交，the 组件 MUST 只经 `blur` 一条路（Enter 只主动失焦、Esc 当场弹回、空名不发请求），并 MUST 在提交后无论成败都把显示值对齐 `title`。
18. WHEN 标题行可编辑，`:readonly` MUST 只收窄到「没开文稿」（`activeTabId === null`）。
19. WHEN 开合某枚浮层，the 组件 MUST 把开合态交给已有真身——跨组件的住 store（如 `timeline` / `volumeOutline` / `foreshadowsOpen` / `changeHistoryOpen`），纯本地的住组件本地 ref，MUST NOT 让两处各持一份。
20. WHEN 挂某枚浮层，the 组件 MUST 用 `v-if="X && XAnchor"`，且把锚点 computed 钉在那颗按钮的 `ref` 上。
21. WHEN 渲染面包屑与标签，the 组件 MUST 取 `BOOK_KIND_LABELS` 与 `BAND_LABELS` / `VIEW_TABS` 的真身，MUST NOT 在模板里抄第二份中文。
22. WHEN 组件内出现样式，the 组件 MUST NOT 写 `<style>`——本仓样式全在 `styles/` 下。

## Constraints & Invariants

- Constraint: 本文件 740 行、六份热点之后双判据最高 —— 纯判定往外拆 utils、有行为的往外拆 composable，见 `conventions/source-line-budget.rule.md`。
- Constraint: 右栏只有这一份组件壳 —— 三态、页签、页脚、标题行、浮层锚点都在这一层；`DocumentTabBar` / `SnippetToolbar` / `BookDossier` 只渲染父侧喂进去的值，自己不许读 store 或抄第二份文案。
- Constraint: 编辑器不许退回 `contenteditable` —— 右栏四株源文件一次都不许出现（不做 WYSIWYG）。
- Invariant: 右栏三态的联合类型只有一份真身（`useBookStore` 的 `RightPaneMode`）—— 组件只 import 类型，MUST NOT 留内联字面量。
- Invariant: 正文三态字面量 / 保存态五句 / 两张右栏文案表 / 分钟文案 —— 一律只在 utils 单一定义，组件不重述（铁律 6）。
- Invariant: 撤销栈与「写哪份草稿」只有一份真身（`composables/useEditUndo` + `utils/edit-undo`）—— `.vue` 里出现 `createEditUndoStack` / `takeUndoFor` 就是第二份栈。
- Invariant: 组合态判据只有一份（`utils/slash-commands` 的 `imeOwnsKey`）—— 组件层不许散写 `event.isComposing` 或 `keyCode === 229`。
- Invariant: 高亮层快照三件（`draft` / `positions` / `index`）必须同拍 —— 位置是照草稿算的，草稿新、位置旧就整体错位（「把 B 的内容记到 A 头上」的同族错），只给草稿套静默窗不够。
- Invariant: 三档偏好变量挂在 `.editor-document`（四个盒子的共同祖先）—— 挂任何单个盒子上，另外几个只吃样式表兜底（mirror 字号对不上 / 分栏左右两种字号，两症状真机量过）。
- Invariant: 保存态句子的唯一落点是底栏 —— 栏头再冒第二处就把那 79px 吃回去，右端按钮重新压进系统窗控带。

## Failure Behavior

1. IF 在途时把旧正文摆上屏，THEN the 组件 MUST 用骨架挡住编辑区与预览区两处，MUST NOT 摆出「新标题配旧稿」——那不是没内容，是撒谎。
2. IF 浏览那一格读盘失败，THEN the 组件 MUST 显示带理由与重试出路的告警句（`is-browse-failed` 走 `--danger-text`），MUST NOT 永远停在「正在读取…」。
3. IF `syncMirrorScroll` / `syncPreviewScroll` 拿到 null ref（面板关着、条件未挂、单栏模式），THEN the 组件 MUST 安静跳过，MUST NOT 抛。
4. IF 标题为空名，THEN the 组件 MUST 当场弹回旧值且一个 `renameDocTitle` 请求都不发。
5. IF 标题改失败，THEN the 组件 MUST 把显示值对齐 store 的真相（失败弹回旧值），MUST NOT 留着用户输错的值让界面撒谎。
6. IF 组合态里按下 Enter / Esc，THEN the 组件 MUST 放行给输入法，MUST NOT 把拼音当标题提交或当场弹回。
7. IF 一次自动保存失败或冲突，THEN 那句理由 MUST 经 `book.notice` 在底栏那一处上屏，MUST NOT 只在栏头显示（栏头已无副本）。
8. IF 偏好 storage 读不到（无 window / localStorage），THEN 三档变量与 `:spellcheck` MUST 退回样式表兜底（变量缺席即原值），MUST NOT 让组件读不到就改写死值。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 右栏打开一篇文稿、查找面板开着且用户刚手打了几个字
When 用户按下 Ctrl+Z
Then 撤销栈已被 invalidate 清空，那一下归 textarea 原生撤销（高亮层按快照跟上，落后一个静默窗）
```

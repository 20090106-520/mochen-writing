---
title: "Notes panel: scope tabs, annotation attach, tag intake and the two-way archive"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「笔记这块右栏浮层怎么接、四处判定为什么不许写在组件里」有规范力：`apps/desktop/src/renderer/src/components/NotesPanel.vue` 这一份组件——整屏遮罩浮层、`visible` 开合、四档页签、搜索框、新建表单（正文 + 标签 + 「附在当前章上」三件都能真落库）、笔记卡片列表（编辑态 / 展示态）、页脚动作（跳到原文 / 编辑 / 归档与取回）、底部标签集，以及落盘失败那一行。它是笔记面板的**唯一组件壳**：**判定一律不住这里**——档位筛选、搜索、空态文案、批注目标住 `utils/note-scope`，标签切法住 `utils/tag-input`，落库与视图（`activeNotes` / `archivedNotes` / `allTags` / `saveError`）住 store，焦点与 Esc 住 `useModalFocus`。

Depended on by: `App.vue`（挂载并接 `close`；`notesOpen` 的开关在那边）、`stores/useNotesStore`（落库、两条创建路、归档双向与 `saveError`）、`utils/note-scope`（`NOTE_SCOPES` / `notesForScope` / `filterNotesByQuery` / `scopeEmptyText` / `annotationTarget`）、`utils/tag-input`（`parseTags`）、`stores/useBookStore`（`activeDocTab` / `refOf` / `openDocTab` / `browse`）、`composables/useModalFocus`（焦点进出与 Esc）。

Out of scope:

- 落库通路与书内数据隔离 —— 住 `stores/useNotesStore` 与 `composables/useBookFileData`（笔记落在**当前这本书**的 `.mochen/data/notes.json`，A 本的批注不出现在 B 本）。
- 档位筛选 / 搜索匹配 / 空态两行 / 批注挂哪一章的判定 —— 住 `utils/note-scope`（本组件 MUST NOT 重写一份）。
- 标签录入的切法（中英文逗号、去空白、去空项、去重、保序）—— 住 `utils/tag-input`；本组件 MUST NOT 手抄 `.split(",")`。
- 焦点接管与 Esc 唯一真身 —— 住 `composables/useModalFocus`。
- 中将栏切章本身 —— 住 `stores/useBookStore`（本组件只在跳转时读 `refOf`）。
- 样式 —— 组件内 `scoped`，不进全局样式表。

## Surface

- `visible` prop / `close` emit — 同文件 — 浮层开合由外部给；`@click.self` 点遮罩也 `close`。
- `panelRoot` / `useModalFocus({ root, close, isOpen })` — 同文件 — 焦点进出与 Esc 的唯一接管点。
- `notes` / `book` — 同文件 — 两个 store 真身（笔记 / 书）。
- `activeNotes` / `archivedNotes` / `allTags` — 同文件 — `storeToRefs` 的投影；`notes.saveError` 直接在模板读（不另存一份）。
- `tab` / `searchQuery` / `editingId` / `editingContent` — 同文件 — 当前档位、搜索词、正在编辑的那条与其草稿。
- `newNoteText` / `newNoteTags` / `attachToCurrentDoc` / `showNewForm` / `notice` — 同文件 — 新建表单五态（正文、标签、勾选、表单开关、即时反馈）。
- `filteredNotes` / `emptyText` / `attachTarget` — 同文件 — 三处 computed，全部只调 `utils/note-scope`。
- `watch(() => props.visible)` — 同文件 — 收起清全部临时态；打开时撤掉挂不上的陈旧勾选。
- `startEdit` / `saveEdit` / `createNote` — 同文件 — 编辑与新建的唯一通路。
- `formatTime` / `docTitleOf` / `getDocTitle` / `jumpToDoc` — 同文件 — 时间格式化、篇名回退、跳到原文。

States: 关（`visible` 假，整块不进 DOM）→ 打开（四档页签 + 搜索 + 列表）→ 新建表单（正文 / 标签 / 勾选三件）→ 编辑态（只一条 `editingId === note.id`）→ 列表项三态（速记 / 批注 / 已归档）→ 空态（按 `scopeEmptyText` 两行）→ 收起（临时态全清）。

## Normative Behavior

1. WHEN 浮层开合，the 组件 MUST 只认外部的 `visible` prop，MUST NOT 自己存一份开关。
2. WHEN 焦点进出与 Esc，the 组件 MUST 只经 `useModalFocus` 一处，MUST NOT 在面板或输入框上再挂第二份 Esc / 聚焦判定。
3. WHEN 浮层收起，the 组件 MUST 把全部临时态清掉（`editingId` / `showNewForm` / `newNoteText` / `newNoteTags` / `attachToCurrentDoc` / `notice`），MUST NOT 让下次打开看见上一次的残稿。
4. WHEN 浮层打开且 `attachTarget.ok === false`，the 组件 MUST 撤掉「附在当前章上」的陈旧勾选（面板开着时用户可能去中将栏换了章）。
5. WHEN 显示哪一档的哪些条目，the 组件 MUST 只经 `notesForScope(tab, { active: activeNotes, archived: archivedNotes })`，MUST NOT 自己按 `kind` / `archived` 筛一遍。
6. WHEN 按搜索词筛，the 组件 MUST 只经 `filterNotesByQuery`（命中正文或标签、大小写不敏感），MUST NOT 在组件里实现匹配。
7. WHEN 渲染档位页签，the 组件 MUST 用 `NOTE_SCOPES` 当唯一数据源（`v-for` + `s.label`），MUST NOT 在模板里留第二份档位名单。
8. WHEN 渲染空态那两行，the 组件 MUST 只经 `scopeEmptyText`（带 `libraryEmpty` 与 `query`），且 MUST NOT 再出现「或在文档上添加批注」那句没有入口的承诺。
9. WHEN 点「＋」新建，the 组件 MUST 只切换 `showNewForm`，MUST NOT 在打开那一刻就往库里塞一条空笔记。
10. WHEN 提交新建，the 组件 MUST 先 `trim` 正文，空串 MUST 直接返回、不落库。
11. WHEN 提交新建，the 组件 MUST 只经 `parseTags(newNoteTags.value)` 切标签，MUST NOT 手抄逗号切分、MUST NOT 只切了不用（两条创建路都要把 `tags` 传给 store）。
12. WHEN 勾了「附在当前章上」，the 组件 MUST 只经 `annotationTarget(book.activeDocTab)` 拿目标，MUST NOT 自己拼 `book.activeDocTab` 的兜底。
13. WHEN 勾了附章却 `target.ok === false`，the 组件 MUST 把 `target.reason` 上屏并直接返回，MUST NOT 降级成一条速记（先判 ok、再落库，顺序不许反）。
14. WHEN 真建批注，the 组件 MUST 调 `notes.createAnnotation(content, target.docRelPath, undefined, tags)`；不勾则 MUST 调 `notes.createQuickNote(content, tags)`。
15. WHEN 落库成功，the 组件 MUST 清空正文与标签、清 `notice`、收起表单。
16. WHEN 归档在屏上的那一枚，the 组件 MUST 按 `note.archived` 分岔：已归档的给「取回」并调 `notes.unarchiveNote(note.id)`，未归档的给归档钮并调 `notes.archiveNote(note.id)`（两枚共用一个位置，MUST NOT 只留单向那一半）。
17. WHEN 有当前章那一条可跳，the 组件 MUST 把「跳到原文」做成 `<button>`（键盘可达），MUST NOT 用 `<div @click>`；篇名 MUST 经 `book.refOf(...)?.title` 回退到 `relPath`。
18. WHEN 跳转某条批注，the 组件 MUST 经 `book.refOf(note.docRelPath)`：`chapter` 走 `book.openDocTab`、其余走 `book.browse`，随后 `emit("close")`。
19. WHEN 收一条编辑，the 组件 MUST 只在 `editingId` 有效且 `editingContent.trim()` 非空时才 `updateNote`（传 trim 后的正文），随后无条件清掉 `editingId`。
20. WHEN 落盘失败（`notes.saveError` 非空），the 组件 MUST 把那一行渲染出来（它是一个动态状态：`role="status"` + `aria-live="polite"`），MUST NOT 让失败静默。
21. WHEN 点底部标签集某一枚，the 组件 MUST 把它填进 `searchQuery`（只筛，不改档位）。
22. WHEN 本组件写样式，the 组件 MUST 用 `scoped`，MUST NOT 污染全局样式表。

## Constraints & Invariants

- Constraint: 本文件是 §候选池里 717 行 / 3 提交那一格 —— 判定一律住 `utils/*.ts` 出纯函数用例、接线住 `*-wiring.test.ts` 读源文件，见 `conventions/source-line-budget.rule.md`。
- Constraint: `.vue` 不进类型程序、本仓也没有 jsdom / @vue/test-utils —— 少挂一个 `v-model`、少调一个 store 动作，tsc 与 build 都不报，只有接线用例抓得住。
- Invariant: 档位 / 筛选 / 空态 / 批注目标四件事只有一份真身（`utils/note-scope`）—— 组件里出现第二份 `kind === "annotation"` 筛选或第三份空态文案就是重写。
- Invariant: 标签切法只有一份（`utils/tag-input` 的 `parseTags`）—— 组件里出现 `.split(",")` 就是第二份。
- Invariant: 「挂不上就报 reason、绝不降级成速记」—— 降级会让用户在「批注」那一档找不到刚写的东西，比不建更糟。
- Invariant: 归档是双向门 —— 只留归档那一半，点完那条笔记从所有列表消失且再也回不来，在作者眼里等同「软件删了他的东西」。
- Invariant: 列表来源只有一处判定 —— 归档视图由 store 给（`activeNotes` / `archivedNotes` 两份都取到手），组件不自己滤 `archived`。

## Failure Behavior

1. IF 正文 trim 后为空，THEN 新建 MUST NOT 落库、MUST NOT 关表单装作存上了。
2. IF 勾了附章但中栏没开章，THEN 组件 MUST 把 `annotationTarget` 给的人话上屏并 MUST NOT 建任何笔记。
3. IF 勾选被禁（`attachTarget.ok === false`），THEN 复选框 MUST 是真的 `disabled` 且有禁用态样式，MUST NOT 只是灰一下还点得动。
4. IF `book.refOf` 取不到 ref，THEN 跳转 MUST 直接返回（不动盘、不切标签）；`note.docRelPath` 为空时同此。
5. IF 编辑草稿 trim 后为空，THEN MUST 放弃这次改动、关掉编辑态，MUST NOT 把这条笔记改成空内容。
6. IF `notes.saveError` 非空，THEN 面板 MUST 有且只有一条读它的提示（`v-if="notes.saveError"`），MUST NOT 让「列表照涨、屏上像已经存好了」这种静默重演。
7. IF 这一档或这个搜索词筛空了，THEN 空态 MUST 说清是「筛空」还是「库里本来就空」，MUST NOT 一句通吃。
8. IF 面板开着时用户切了章、原来那章挂不上批注了，THEN 打开表单前或下次打开面板时 MUST 把陈旧勾选撤掉，MUST NOT 留一个挂不上却仍勾着的框。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 中栏没开任何一章，打开笔记面板并展开新建表单
When 勾上「附在当前章上」后点保存
Then 面板 MUST 只把那句「先在中栏打开一章…」摆出来并停下，
     库里 MUST 一条新笔记都没有（不降级成速记——降级后它在「批注」档里就再也找不着）
```

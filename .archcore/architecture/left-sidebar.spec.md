---
title: "Left column: brand, primary nav groups, the book tree and the footer gear"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「左栏这一格怎么摆、点下去走哪条真身、怎么不各自捏一份」有规范力：`apps/desktop/src/renderer/src/components/LeftSidebar.vue` 这一份组件——品牌行、主操作（工作台 / 我的作品 / 功能导航四组）、文稿树（五类分组 + 行内新建 + 行尾菜单 + 行内改名 + 章节拖拽重排）、技能库 / 插件 / 皮肤广场三枚中栏入口、低频书务入口「更多」组、底部齿轮行、导航响应对话框，以及它们全部「判定住 utils、行为住 store」的接线。它是渲染层左栏唯一的组件壳：**判定与文案一律不住 `<script setup>`**，这里只剩挂线；左栏是恒定的导航（换的是中栏那一格，左栏不消失）。

Depended on by: `App.vue`（挂左栏一格、接 `collapse` 事件）、`stores/layoutStore`（轴：`currentView` / `centerView` / 各开合面板）、`LibraryNavRows.vue` / `ExtensionsNavRow.vue` / `SideNavNoticeDialog.vue`（被它挂载，只 emit 上来不乱读）、`utils/side-nav`（导航表与子项判定的唯一真身）。

Out of scope:

- 导航表与子项判定 —— 住 `utils/side-nav`（`SIDE_NAV_GROUPS` / `sideNavChildState` / `aiCheckOf` / `AI_CHECK_PROMPTS` / 各 hint 与标语）；分组与类型名住 `utils/book-kinds` 与 `utils/kind-icons`。
- 行内新建的判定 —— 住 `utils/new-doc`（`newDocPlan` / `newDocButtonTitle`）；两个行内输入框的键盘裁决 —— 住 `utils/text-row-keydown`。
- 数据统计的行数据 —— 住 `utils/stats-rows`（`statsRowsOf`）；滚动条显隐住 `utils/transientScrollbar`；减少动效档住 `utils/motion-preference`。
- 行为（开书 / 浏览 / 新建 / 改名 / 排序 / 回收 / 备份 / 面板）—— 一律住各 store 真身（`useBookStore` / `useTimelineStore` / `useAgentStore` / `useTrashStore` / `useBackupStore` / `layoutStore`）。
- 样式 —— 全在 `styles/left-nav.css`。

## Surface

- `LeftSidebar.vue` — @apps/desktop/src/renderer/src/components/LeftSidebar.vue — 左栏唯一组件壳；emit `collapse`。
- `sections` / `collapsedSections` / `toggleSection` — 同文件 — 五类分组的组装（表驱动 `BOOK_KIND_ORDER`）与折叠（放行正在新建的空分组）。
- `activate` / `isSelected` — 同文件 — 树行点击分派（chapter 进文稿标签、其余只浏览）与选中判定（`activeDocTab` / `activeBrowse`）。
- `worksOpen` / `openGroups` / `toggleGroup` — 同文件 — 「我的作品」组与功能导航四组的开合（初值取自表 `defaultOpen`）。
- `childState` / `needChapterState` / `onChildAction` / `navIdOf` — 同文件 — 子项四态判定（`sideNavChildState` 打底、UI 层补 book 上下文）、唯一分派与 `data-nav-id` 生成。
- `addingKind` / `newDocTitle` / `addingPlan` / `startAdding` / `cancelAdding` / `confirmAdding` / `setNewDocInput` — 同文件 — 行内新建的接线（判定读 `newDocPlan`）。
- `renamingPath` / `renameValue` / `startRenaming` / `cancelRenaming` / `confirmRenaming` / `setRenameInput` — 同文件 — 行内改名的接线（落盘读 `book.renameDocTitle`）。
- `onRenameKeydown` / `onAddKeydown` — 同文件 — 两个输入框共用的键盘裁决工厂 `textRowKeydown`。
- `actionMenuFor` / `toggleActionMenu` / `closeActionMenu` / `trashDocRow` — 同文件 — 行尾「…」菜单开合、Esc 关、移入回收站（读 `trash.trashDoc`）。
- `notice` / `requireBook` / `openStats` / `openLibraryDialog` / `openWorkdir` / `openNewBook` / `guideToDoc` — 同文件 — need-book 闸与书务入口的唯一分派（`statsRowsOf` 算行数据）。
- `workspace` — 同文件 — 书名与工作目录那一行（`book.meta && book.rootPath` 齐了才出现）。
- `openSettingsOverlay` / `revealAgentPanel` / `newThreadForActiveChapter` / `openChapterEditor` / `chapterEditorReady` — 同文件 — 各入口挂的 store 真身。
- `dragFromRelPath` / `dragOverRelPath` / `onChapterDragStart/DragOver/DragLeave/Drop/DragEnd` — 同文件 — 章节拖拽重排（仅 chapter 分组）。
- `sidebarScrollbar` / `handleSidebarScroll` — 同文件 — transient 滚动条控制器。
- `reducedMotion` — 同文件 — 减少动效档（`loadReducedMotion(motionPreferenceStorage())`）。

States: 左栏整体常驻 → 导航四组 ×开 / 收 → 文稿树五类分组 ×开 / 收 → 行内态（`addingKind` / `renamingPath` / `actionMenuFor` / 拖拽中）→ 响应对话框 `notice` 的六种形态（planned / need-book / stats / trash / backup / terms）。

## Normative Behavior

1. WHEN 换中栏或右栏，the 左栏 MUST 保持挂载恒常（导航不随中栏切换卸载），MUST NOT 让「设置 / 技能库」这类入口改用整页替换左栏。
2. WHEN 判工作台那枚的 active，the 组件 MUST 绑 `layout.currentView === 'workspace' && layout.centerView === 'chat'`——它与技能库 / 插件 / 皮肤广场争同一格高亮，MUST NOT 只绑 `currentView`。
3. WHEN 渲染功能导航四组，the 组件 MUST 表驱动 `SIDE_NAV_GROUPS`，组与子项的 label / icon / 开合 MUST 取自表，MUST NOT 在模板里抄第二份中文清单。
4. WHEN 组装文稿树分组，the 组件 MUST 表驱动 `BOOK_KIND_ORDER` 与 `BOOK_KIND_LABELS` / `KIND_ICON`，且 MUST 放行「正在新建的空分组」（`addingKind === section.id`），否则一篇文档都没有时树里没有新建入口。
5. WHEN 树行点击，the 组件 MUST 一律经 `activate`：`chapter` 走 `book.openDocTab`、其余走 `book.browse`——浏览 MUST NOT 动 `docTabs` 与草稿。
6. WHEN 判某树行是否选中，the 组件 MUST 取 `book.activeDocTab === relPath || book.activeBrowse === relPath`，MUST NOT 另立第二份选中态。
7. WHEN 功能子项渲染或点击，the 组件 MUST 表驱动 `group.children`，label / title / `data-nav-id` 分别读 `childState(child)` 与 `navIdOf(group, child)`，MUST NOT 在模板里写死子项。
8. WHEN 判子项响应，the 组件 MUST 用 `sideNavChildState` 打底、UI 层只在 action 类补 book 上下文（`needChapterState`），四种模式各给一个真响应；`planned` / `need-book` MUST 统一交给 `SideNavNoticeDialog`。
9. WHEN 子项是 AI 检查（`aiCheckOf`），the 组件 MUST `revealAgentPanel()` 后 `agent.prefillComposer(...)`，MUST NOT 自动发送（发送权留在用户）。
10. WHEN 子项是「伏笔台账 / 时间线核对」，the 组件 MUST 先展开右栏（锚点在那儿）再开台账并读盘，复用同一个 `revealAgentPanel`，MUST NOT 另写一份「展开某栏」。
11. WHEN 行内新建提交，the 组件 MUST 先读 `addingKind` / `newDocTitle`、再 `cancelAdding()`、后 `book.createDoc(...)`（顺序钉死），判定 MUST 只读 `newDocPlan`。
12. WHEN 行内改名提交，the 组件 MUST 先读 `renamingPath` / `renameValue`、再 `cancelRenaming()`、后 `book.renameDocTitle(...)`；进入改名态 MUST 先 `closeActionMenu()` 再 `focus()` + `select()`。
13. WHEN 两个行内输入框吃键盘，the 组件 MUST 只经 `textRowKeydown` 工厂产出的 handler（Enter 确认 / Esc 取消），MUST NOT 在模板挂 `.enter.prevent` 一类的无条件修饰符。
14. WHEN 行尾「…」菜单开合，the 组件 MUST 用单一 `actionMenuFor`（同一时间至多一行开着），Esc 直接关，且 `MorphIcon` 的 Ellipsis ↔ X MUST 与开合判定同一份。
15. WHEN 判「有没有打开作品」，the 组件 MUST 经唯一闸 `requireBook` 读 `book.hasBook`，MUST NOT 读 `docs.length`（那说的是「这本书还是空的」）。
16. WHEN 渲染数据统计，the 组件 MUST `rows: statsRowsOf(book.docs)`，MUST NOT 在组件里自算篇数与字数。
17. WHEN 低频书务入口，the 组件 MUST 把按钮本体交给 `LibraryNavRows`（连带「更多」壳）、响应留本文件（`@open="openLibraryDialog"` / `@stats="openStats"`），MUST NOT 把响应实现搬进子组件。
18. WHEN 章节拖拽重排，the 组件 MUST 只对 `chapter` 分组开放，`drop` MUST 按 `targetIndex` 调 `book.moveChapterByRelPath`，`dragleave` MUST 用 30ms 微延迟过滤子元素切换的闪烁。
19. WHEN 开书或换书（`book.rootPath` 变化），the 组件 MUST 调 `backup.ensureDaily()` 一次，失败 MUST 静默（自动的事不打扰写作，理由留给手动按钮）。
20. WHEN 设置入口，the 组件 MUST 只留 footer 齿轮一个门面 `openSettingsOverlay` → `layout.showSettings()`，且模板 / 脚本里 `layout.showSettings()` MUST 只此一处。
21. WHEN 渲染书名与工作目录行，the 组件 MUST 只在 `book.meta && book.rootPath` 齐了才显示，且它 MUST 是字不是按钮（没有动作就不长 button / a）。
22. WHEN 组件内出现样式，the 组件 MUST NOT 写 `<style>`——本仓样式全在 `styles/` 下。

## Constraints & Invariants

- Constraint: 本文件贴 800 行预算、双判据最高 —— 纯判定往外拆 utils（`side-nav` / `new-doc` / `stats-rows` / `text-row-keydown` / `kind-icons`），见 `conventions/source-line-budget.rule.md`。
- Constraint: 左栏是恒定导航 —— 技能库 / 插件 / 皮肤广场换的是中栏那一格，导航行不消失；`ExtensionsNavRow` 与工作台共争同一格高亮，所以那条绑定链必须在一处判一次。
- Invariant: 「同一格高亮」只有一条绑定链（`centerView`）—— 工作台亮 = 中栏在对话；分两处改会出现两枚同时亮（用户只会当成渲染坏了）。
- Invariant: 导航表唯一真身（`utils/side-nav`）—— 模板里出现 `世界观` / `审核检查` 一类子项中文就是第二份表。
- Invariant: 树行的判定与落盘只有一份真身（`book.openDocTab` / `book.browse` / `book.renameDocTitle` / `book.createDoc` / `book.moveChapterByRelPath`）—— 组件只做开合与聚焦，不写第二份逻辑。
- Invariant: 键盘裁决只有一份（`utils/text-row-keydown` + `utils/slash-commands` 的 `imeOwnsKey`）—— 组件层出现 `event.isComposing` / `keyCode === 229` 就是第二份实现。
- Invariant: need-book 闸只有一份真身（`requireBook` 读 `book.hasBook`）—— 各入口内联一份 `hasBook` 或 `docs.length` 判据就是同一闸的第二份实现。
- Invariant: 响应对话框的开合真身是组件的 `notice` ref —— `SideNavNoticeDialog` 那把 `dialogOpen` 是它的投影，不是第二份开关。

## Failure Behavior

1. IF 没打开作品就点书务入口（数据统计 / 回收站 / 整书备份 / 书稿体检 / 导入 TXT），THEN the 组件 MUST 弹 need-book 对话框（两枚按钮各挂 `book.pickAndOpen` 与 `layout.openNewBook` 现成真身），MUST NOT 摆一张全 0 的表让人以为坏了。
2. IF 输入法组合态里按下 Enter / Esc，THEN the 组件 MUST 放行给输入法，MUST NOT 把拼音当标题落盘。
3. IF 行内新建判定不过关（空 / 起不了文件名 / 重名），THEN the 组件 MUST 让确认钮 disabled 并显示 `newDocPlan.message` 那行理由，MUST NOT 让提交静默无反应。
4. IF 改名值为空名，THEN the 组件 MUST 让确认钮 disabled，且一个 `renameDocTitle` 请求都不发。
5. IF 行内输入框失焦，THEN the 组件 MUST 取消（清 `addingKind` / `renamingPath`），MUST NOT 把半截输入永久挂在树上。
6. IF 拖拽 drop 时源缺失、找不到 `chapter` 分组、或 `targetIndex === -1`，THEN the 组件 MUST 直接返回不动盘，MUST NOT 发一次错位的重排请求。
7. IF 一次每日自动备份失败，THEN the 组件 MUST 静默（`void` 不接 rejection 的状态写在字面上），MUST NOT 弹错打扰写作。
8. IF 减少动效档读不到（无 window / localStorage），THEN the 组件 MUST 退回样式表兜底，MUST NOT 让组件读不到就改写死值。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 没打开任何作品、左栏「更多」组已展开
When 用户点「数据统计」
Then 弹出的不是全 0 表格，而是 need-book 引导（打开作品目录 / 新建作品两枚按钮各走现成真身）
```

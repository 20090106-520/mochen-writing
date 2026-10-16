---
title: "The three-column layout store: view axes, pane widths, and the auto-collapse policy"
status: accepted
tags:
  - "architecture"
  - "renderer"
  - "store"
---

## Purpose & Scope

本规范对「渲染层三栏布局态的真身住哪、谁许写它」有规范力：`apps/desktop/src/renderer/src/stores/layoutStore.ts` 这一份 store——两个整页视图轴与中栏那一格（`currentView` / `centerView` / `settingsTab`）、三类对话框开合真身（新建作品 / 导入 TXT / 面板）、左栏与右栏的折叠与宽度、拖拽与键盘调宽、右栏按页签记忆宽度、视图过渡的发起口径、引导浮层的信号桥。它是布局态的**唯一**真身：**判定一律往外拆**（宽度默认档、窄窗判据、过渡、指针捕获、记忆读写都住各自 utils），这里只剩「把状态收在一处、把边界钉死」。

Depended on by: `App.vue`（唯一同时看得见 `book.hasBook` 与 layout 的地方——挂 `desktopShell`、接两条自动折叠 watch、调 `reconcilePaneWidths`）、`LeftSidebar.vue`（导航高亮与各入口）、`CenterColumn.vue` / `BookWorkbench.vue`（中栏那一格互斥）、`DocumentPane.vue` / `SettingsPage.vue` / `SkinGalleryPage.vue` / `ExtensionsPage.vue`（读开合与宽度）、`composables/useHotkeys.ts`（斜杠命令走 `showCenter` / `showSettings`）。

Out of scope:

- 右栏宽度记忆的读写与形状校验 —— 住 `utils/rightPanePreferences.ts`（键 `mochen:right-pane-preferences:v1`）。
- 视图过渡真身（在飞闸、减动效、`nextTick` 口径）—— 住 `utils/view-transition.ts`；指针捕获 —— 住 `utils/panePointerCapture.ts`；减动效判据 —— 住 `utils/motion-preference.ts`。
- 「有没有打开作品」判据 —— 住 `useBookStore` 的 getters（`hasBook` 已是五个读点统一用的单一 getter），本 store 不另写一份 meta 判据。
- 引导流程真身 —— 住 `useOnboardingStore`；本 store 只做「App 这边要不要展示浮层」的信号桥。
- 栅格 token 与窄档样式（`--center-pane-min` / `.desktop-shell` / `@media (max-width:1220px)`）—— 住 `styles.css`。

## Surface

- `LEFT_PANE_MIN` / `LEFT_PANE_MAX` / `RIGHT_PANE_MIN` / `RIGHT_PANE_MAX` / `CENTER_PANE_MIN_FALLBACK` / `NARROW_AUTO_COLLAPSE_WIDTH` — 同文件 — 各档边界常量（后两个分别指右栏上限与窄窗阈值）。
- `defaultLeftPaneWidth` / `defaultRightPaneWidth` — 同文件 — 纯函数：按视口宽给默认档（≤1220 左 262 / 右 395）。
- `shouldAutoCollapseRightPane` / `shouldAutoCollapseRightPaneWithoutBook` / `shouldAutoCollapseRightPaneWithoutDoc` — 同文件 — 三条纯函数判据：窄窗 / 无作品 / 有作品无文稿。
- `currentView` / `centerView` / `settingsTab` — 同文件 — 两个整页轴 + 中栏那一格 + 设置页签。
- `newBookOpen` / `importTxtOpen` / `panelVisibility`(`wordCount` / `export`) — 同文件 — 三类开合的唯一真身。
- `docGroupRequest` — 同文件 — 一次性信号（请求左栏引导到某一类并进入行内新建），消费后清空。
- `leftCollapsed` / `rightCollapsed` / `rightPaneManuallyToggled` / `leftPaneUserAdjusted` — 同文件 — 折叠态 + 两条「用户动过就交权」闸门。
- `leftPaneWidth` / `rightPaneWidth` / `rightPanePreferences` / `activeRightPanePreferenceKey` — 同文件 — 宽度与按页签记忆。
- `resizingPane` / `paneTransitionSuppressed` / `desktopShell` — 同文件 — 拖拽态 / 过渡抑制 / shell 句柄。
- `shellClasses` / `shellStyle` / `writingRightPaneViewModel` — 同文件 — 传给 App 与右栏的三个派生视图。
- `contentSlotSwitches` — 同文件 — 「那一格真换页面」的过渡前判据（三处切换共用）。
- `showSettings` / `openGoalsSettings` / `openProjectSettings` / `showWorkspace` / `showCenter` — 同文件 — 三轴切换的唯一入口（一律经过渡与复位）。
- `setPaneCollapsed` / `togglePane` / `setRightCollapsedByEmptyBook` / `setRightCollapsedByEmptyDoc` — 同文件 — 折叠写入口（手动 vs 自动两条）。
- `maximumPaneWidth` / `centerPaneMinWidth` / `clampPaneWidth` / `setPaneWidth` — 同文件 — 夹宽链（上限扣掉对面栏与中栏下限）。
- `preferredRightPaneWidth` / `restoreRightPaneWidth` / `restoreRightPaneWidthForNavigation` / `setActiveRightPanePreferenceKey` / `persistActiveRightPaneWidth` — 同文件 — 记忆读回、导航恢复与落盘。
- `reconcilePaneWidths` / `layoutViewportWidth` / `handleResizeMove` / `startPaneResize` / `stopPaneResize` / `handleResizeKeydown` — 同文件 — 窗口重算与两条调宽通路。
- `openPanel` / `closePanel` / `togglePanel` / `openWordCount` / `openExport` — 同文件 — 面板开合（键只留模板真读过的那两枚）。
- `showOnboarding` / `disposeLayout` / 两条 `watch` — 同文件 — 引导信号桥、卸载收尾、shell 挂上后补判。

States: 建时（按当时视口给默认档）→ shell 为空（只能退回 `innerWidth`）→ shell 挂上（两帧后按真实布局宽补判）→ 运行（拖拽中 `resizingPane` 非空、导航恢复期 `paneTransitionSuppressed` 为真）→ 用户动过（两条手动闸门置位，自动策略交权）→ 卸载（`disposeLayout` 停拖拽、取消帧、清 shell）。

## Normative Behavior

1. WHEN 全仓要判「整页换哪一页 / 中栏那一格」，the store MUST 是 `currentView` / `centerView` 的唯一真身，MUST NOT 在组件里各持一份布尔。
2. WHEN 判中栏那一格，the store MUST 只用一枚 `centerView`（`chat` / `skills` / `plugins` / `skins`），MUST NOT 拆成多个 boolean（那会出现「两个都 true」的无解态）。
3. WHEN 切中栏（`showCenter`），the store MUST 把 `currentView` 拨回 `workspace`（人在设置页时点左栏那两枚钮，不拨回来像没反应）。
4. WHEN `showSettings`，the store MUST 顺手把 `centerView` 复位为 `chat`，MUST NOT 让左栏那一枚停在原地亮着。
5. WHEN `showWorkspace`，the store MUST 把 `centerView` 复位为 `chat`（两枚都在说「你在这儿」时说错比不说更糟）。
6. WHEN 发起视图过渡，the store MUST 先经 `contentSlotSwitches` 判「那一格真换页面」（同页重入直接改状态，不起过渡），且切换 MUST 只经 `runViewTransition`，MUST NOT 就地 `document.startViewTransition`。
7. WHEN 三处换画面，the store MUST 用 `forward`（去）/ `back`（回）两个方向，MUST NOT 另立第三档。
8. WHEN 判窗口窄不窄，the store MUST 用 `layoutViewportWidth()`（`desktopShell` 的实测宽），MUST NOT 用 `window.innerWidth`（Electron 缩放下两者能差一倍以上）。
9. WHEN 无作品 / 无文稿要自动收右栏，the store MUST 经 `setRightCollapsedByEmptyBook` / `setRightCollapsedByEmptyDoc` 这两个唯一写入口，MUST NOT 在别处直接赋 `rightCollapsed`。
10. WHEN 走自动折叠，the store MUST 先查 `rightPaneManuallyToggled`（手动过就交权，此后一律不干预）。
11. WHEN 自动折叠的两档分岔，the store MUST 让空书档**只收不展**、空文稿档**双向**（开文稿要推回来，否则用户看到「点开了却什么都没发生」）。
12. WHEN 用户手动折右栏（`setPaneCollapsed('right')`），the store MUST 置 `rightPaneManuallyToggled`；自动折叠 MUST 直接赋 ref、MUST NOT 走 `setPaneCollapsed`（否则把自己锁死）。
13. WHEN 拖左栏或键盘调左栏，the store MUST 置 `leftPaneUserAdjusted`，此后的默认档重算 MUST NOT 覆盖用户亲手定的宽度。
14. WHEN `reconcilePaneWidths` 跑，the store MUST 用 `layoutViewportWidth()` 重算左栏默认档（与右栏窄窗判据同一口径），且右栏没折时 MUST `restoreRightPaneWidth()`。
15. WHEN 夹宽，the store MUST 经 `clampPaneWidth`，上限 MUST 由 `maximumPaneWidth`（扣掉对面栏与 `--center-pane-min`）算；`--center-pane-min` 读不到 MUST 退 `CENTER_PANE_MIN_FALLBACK`。
16. WHEN `desktopShell` 挂上、或左/右栏折叠或换页，the store MUST `nextTick(reconcilePaneWidths)` 补判一次（建 store 那一刻 shell 还是 null）。
17. WHEN 拖右栏结束，the store MUST 经 `persistActiveRightPaneWidth` 落盘，且 MUST 只在宽度真的变了时才写。
18. WHEN 换右栏页签 / 作品，the store MUST 经 `setActiveRightPanePreferenceKey(key, restore)`，key 变更且 `restore` 为真时 MUST `restoreRightPaneWidthForNavigation`（先置抑制、下一帧两帧后解除）。
19. WHEN 读写右栏宽度记忆，the store MUST 只经 `utils/rightPanePreferences` 那两只函数，MUST NOT 在 store 里自拼存储键或 JSON。
20. WHEN 维护 `panelVisibility`，the store MUST 只留模板真读过的键（`wordCount` / `export`），MUST NOT 复活无人读的键（`dead-panel-entry.test.ts` 会当场红）。
21. WHEN 打开引导浮层，the store MUST 只经 `showOnboarding` 这个信号桥读 `useOnboardingStore` 的真身，MUST NOT 自己存一份引导进度。
22. WHEN store 被卸载，the store MUST 经 `onScopeDispose(disposeLayout)` 停拖拽、递增抑制时钟、取消待放帧、清 `desktopShell`。

## Constraints & Invariants

- Constraint: 本文件贴 800 行预算、双判据之一（636 行 / 近 90 天 9 提交）—— 纯函数与真身一律往外拆（`rightPanePreferences` / `view-transition` / `panePointerCapture` / `motion-preference`），见 `conventions/source-line-budget.rule.md`。
- Constraint: `rightPanePreferences.widths` 按 workspace key 记宽度 —— 自动策略与手动拖拽共用同一条记录，不另开第二份。
- Invariant: 「窗口窄不窄」只有一份口径（`layoutViewportWidth`）—— `window.innerWidth` 与实测宽在缩放下会判反，写两处就会一半按旧口径。
- Invariant: 自动折叠与手动折叠共用**一条**手动闸门（`rightPaneManuallyToggled`）—— `setRightCollapsedByEmptyBook` / `ByEmptyDoc` 与 `reconcilePaneWidths` 都是它的下游。
- Invariant: 过渡「在飞」只有一份（`runViewTransition` 的 `inFlight`）—— store 不许复制一份自己的「在飞」，两份会各自放行。
- Invariant: 中栏互斥只有一枚 `centerView` —— 出现第二个控制中栏的布尔就是第二份真身。
- Invariant: 两条手动闸门（`rightPaneManuallyToggled` / `leftPaneUserAdjusted`）只在「用户亲手动过」时置位 —— 自动策略置位就是自我上锁。

## Failure Behavior

1. IF 文档不可见（窗口最小化）时起过渡，THEN `ready` 的拒绝 MUST 由 `runViewTransition` 接住（store 只负责照发，MUST NOT 自己吞 rejection）。
2. IF 引擎不认 `startViewTransition`，THEN 改动 MUST 照做（只是没有动画），MUST NOT 让用户点了左栏什么也没发生。
3. IF localStorage 读不到或存的是坏值，THEN 宽度记忆 MUST 退 `{ widths: {} }` 默认，MUST NOT 让坏 JSON 带崩 store。
4. IF 写 localStorage 失败（配额 / 隐私模式），THEN `persistActiveRightPaneWidth` MUST 返回 `false`，MUST NOT 抛。
5. IF 当前页签 key 为空、或没有 window，THEN 落盘 MUST 直接返回 `false`（不为空 key 造一条记录）。
6. IF 拖拽未开始、或 `desktopShell` 缺失，THEN `handleResizeMove` MUST 直接返回，MUST NOT 按半截坐标改宽。
7. IF `--center-pane-min` 读不到或不是有限数，THEN `centerPaneMinWidth` MUST 退 `CENTER_PANE_MIN_FALLBACK`，MUST NOT 让 `NaN` 流进夹宽。
8. IF 用户手动动过右栏，THEN 自动策略 MUST 一律不干预 —— 窄窗那条也 MUST NOT 再收（交权后连「只收不展」都不做）。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 宽窗、没打开作品、用户没动过右栏
When App.vue 把 book.hasBook 为假喂给 setRightCollapsedByEmptyBook(true)
Then 右栏收起且中栏拿到全宽；等用户打开作品（hasBook 转真）时右栏不会擅自推回来，
     而一旦用户手动折过右栏（rightPaneManuallyToggled 置位），此后窗口再窄也不再自动干预
```

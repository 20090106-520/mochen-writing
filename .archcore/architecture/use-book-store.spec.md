---
title: "Renderer book store: open book, drafts and meta write path"
status: accepted
tags:
  - "architecture"
  - "renderer"
  - "store"
---

## Purpose & Scope

本规范对「渲染层那唯一一本打开的书」有规范力：`apps/desktop/src/renderer/src/stores/useBookStore.ts` 这一份 store，开书 / 建书与书态填充、文稿标签与草稿、自动保存、book.json 可写档位的落盘、右栏三格（文稿 / 浏览 / 作品资料）与改稿历史、伏笔台账的摆态，全在这里。**纯判定都住 utils**（`draft-flush` / `meta-mode-step` / `doc-read` / `browse-read` / `doc-order` / `change-history` / `foreshadow`），本 store 只接线与摆态。

Depended on by: 中栏与右栏各组件（DocumentPane / CenterColumn / 树与面包屑）、`useAgentStore`（`absorbAgentWrite` 把智能体写盘吸收进右栏）、`composables/bookDataRegistry`（换书前把其它 store 的数据交回上一本）、`utils/quit-flush-client`（退出握手）。

Out of scope:

- 判定的真身 —— `saveOutcomeOf` / `flushDocBeforeDrop` / `flushIOFor` / `docStateOf` / `EMPTY_DOC` 住 `utils/draft-flush`；四档切法住 `utils/meta-mode-step`；切标签读盘住 `utils/doc-read`；浏览三闸住 `utils/browse-read`；重排住 `utils/doc-order`。
- 跨进程通道的形状 —— 见 `architecture/ipc-channel-contract.spec.md`。
- 主进程侧的落盘、指纹、备份与审批 —— 见 `architecture/agent-service.spec.md`。

## Surface

- `useBookStore` — @apps/desktop/src/renderer/src/stores/useBookStore.ts — 唯一的书态 store。
- `hasBook` getter — 同文件 — 「有没有打开作品」的单一真身（判据取 `meta !== null`）。
- `applyOpened(opened)` — 同文件 — 开书 / 建书成功后的唯一填态段。
- `persistMeta(patch, failPrefix)` — 同文件 — book.json 可写字段的唯一落盘通路。
- `saveActive` — 同文件 — 文稿落盘的唯一通路（手动按钮与自动保存共用）。
- `cancelAutoSave` — 同文件 — 清定时器句柄的唯一真身。
- `writeDocIpc` / `changePeekIpc` / `changeRestoreIpc` — 同文件（模块级）— 三扇 IPC 的薄封装，不捕 `this`。
- `draftsByPath` — 同文件 state — relPath → `DocState`（草稿 / 指纹 / dirty / conflict）。
- `AUTO_SAVE_DELAY_MS` / `autoSaveTimer` — 同文件 — 静默窗默认档与模块级定时器句柄（不进 pinia state）。

States: 未开书 → 开书（meta / docs / 标签就绪）→ 编辑与自动保存（draft 脏 / saving / conflict）→ 换书或新建（上述全部复位）→ 退出（`flushAllForQuit` 兜底）。

## Normative Behavior

1. WHEN 判定「有没有打开作品」，the store MUST 只读 `hasBook` getter，MUST NOT 另立 `rootPath !== null` 一类的口径。
2. WHEN 打开或新建一本书成功，the store MUST 经同一处 `applyOpened` 填态。
3. WHEN 换书，the store MUST 作废上一本的全部在途读（`bumpDocLoadToken` 与 `resetBrowseReadGates`）并清空 `draftsByPath`。
4. WHEN 切文稿标签，the store MUST 先 `cancelAutoSave`、再 `stashActive`、之后才 await 读盘。
5. WHEN 关一个标签，the store MUST 先 `flushDocBeforeDrop`，只有写成才允许它消失。
6. WHEN 退出前兜底落盘，the store MUST 走 `flushAllBeforeQuit`，且一篇失败不得中断其余。
7. WHEN 保存当前文稿，the store MUST 走唯一通路 `saveActive`，且 `saving` 由 `finally` 收尾。
8. WHEN 保存结果回来，the store MUST 用 `saveOutcomeOf` 摆 dirty / 指纹 / conflict，且只有自动语境才重排静默窗。
9. WHEN 把 live 四格存成或读成 `DocState`，the store MUST 走 `docStateOf` / `flushIOFor`，MUST NOT 自己手拼。
10. WHEN 写 book.json 那几格可写字段，the store MUST 只经 `persistMeta`，且写前先 `toRaw` 展开响应式代理。
11. WHEN `persistMeta` 失败，the store MUST 一个字都不改 `meta` 并把原因拼进 notice。
12. WHEN 切权限档 / 工作模式 / 阶段 / 档案，the store MUST 用 `meta-mode-step` 的判定，refuse 时只报话不落盘。
13. WHEN 右栏切到浏览或作品资料，the store MUST NOT 改动 `docTabs` / `activeDocTab` / `draft` / `dirty` / `saving`。
14. WHEN 智能体写入被吸收，the store MUST 让干净草稿重载、未保存手改挂冲突，且末尾重扫书稿清单。
15. WHEN 一次动作抛错（读改稿历史 / 伏笔 / 浏览），the store MUST 把理由上屏，MUST NOT 静默吞掉。
16. WHEN 装配退出握手监听，the store MUST 先摘旧监听再订新（屏上只允许一只）。
17. WHEN 用户编辑发生，the store MUST 先 `stashActive` 再排自动保存。

## Constraints & Invariants

- Constraint: 本文件正贴 800 行预算顶 —— 纯判定往外拆 utils，本 store 只留接线（见 `conventions/source-line-budget.rule.md`）。
- Constraint: 模块级 IPC 封装（`writeDocIpc` / `changePeekIpc` / `changeRestoreIpc`）不捕 `this`，store 与调用方走同一个口子。
- Constraint: `autoSaveTimer` 是模块级句柄，不进 pinia state（反应式代理包一层只添噪音）。
- Constraint: 换书前其它 store 的数据交回上一本由 `withBookDataFlush` 兜 —— 主进程的「当前书」在 IPC 落地那一刻就换了。
- Invariant: `hasBook` 是「有没有打开作品」的唯一真身 —— 组件与 store 一律读它，不许各抄一份。
- Invariant: `persistMeta` 是 book.json 可写字段的唯一落盘通路 —— 四档切法与章节重排都只能经它（铁律 6）。
- Invariant: `saveActive` 是文稿落盘的唯一通路，自动与手动共用同一条指纹链。
- Invariant: `draftsByPath` 的值只许由 `docStateOf` 产出 —— 手拼会漏掉 `conflict` 另造对象，两处共享同一冲突对象后被外部改动一起带跑。
- Invariant: 判据真身只许一处 —— `saveOutcomeOf` / `flushDocBeforeDrop` / `flushIOFor` / `meta-mode-step` 一律在 utils 单一定义，store 不重述。

## Failure Behavior

1. IF 切标签读盘失败，THEN the store MUST 清空正文（`EMPTY_DOC`）并说明哪一篇没打开，MUST NOT 留着上一篇的正文。
2. IF 保存的 IPC 抛错，THEN the store MUST 把理由上屏、指纹一步不推进，MUST NOT 重排自动保存（避免写盘风暴）。
3. IF 写盘返回 stale，THEN the store MUST 记 conflict，MUST NOT 覆盖。
4. IF 关标签时这一篇有未落盘的字或未了结的冲突，THEN the store MUST 拒绝关它并报那句统一的冲突 / 写失败文案。
5. IF 退出兜底有篇目没落盘，THEN the store MUST 点名哪几篇交给主进程对话框显示。
6. IF `persistMeta` 抛错，THEN the store MUST 落回 `metaSaving=false` 且一个字节都不改 `meta`（连点也不把按钮灰住）。
7. IF 改标题那一路 `writeDoc` 返回 stale，THEN the store MUST 报「文件刚被别处改动」而不动标签与草稿。
8. IF 改稿历史 / 伏笔读失败，THEN the store MUST 报一句理由并把对应列表置空。
9. WHEN peek 一条改稿历史失败，the store MUST 让那句 notice 先落地，再把在途标记落回。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 右栏正在编辑一篇有未保存手改的文稿
When 主进程回执是 stale
Then 右栏只挂 conflict、指纹不推进（不覆盖别人的改动），并可重载或覆盖由人定
```

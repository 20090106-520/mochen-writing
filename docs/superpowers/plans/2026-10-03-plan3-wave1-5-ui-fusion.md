# 墨宸 AI · Plan 3 波 1.5（UI 融合 F-A…F-G + 波 1 留下的三条真机缺陷）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把界面附录的七个改造面里属于本波的部分落成真能点的控件（中栏工作台、右栏「作品资料」、左栏三段主操作、输入区真开关 chip、md 片段工具栏、页脚阅读时长），并清掉波 1 真机冒烟撞出、当场没修的三条界面缺陷（设置浮层 Esc 不关、无书时档位标签捏造档位名、`stale` 不随回放存活）与六格「本波不自证通过」的留白。

**Architecture:** 判断继续一律下沉 `utils`/`stores`（本仓不引 `@vue/test-utils`，`.vue` 模板零自动化覆盖是既定事实）；新增四个纯函数模块（`permission-chip` / `book-dossier` / `workbench-state` / `composer-chips`）+ 两个小纯函数（`markdown-snippets` / `reading-time`），组件只接线。两处状态各收一处真身：**设置浮层可见性 = `layout.currentView === "settings"`**（删掉 `CenterColumn.vue:38` 那份局部 ref），**输入框的值 = `useAgentStore.composerDrafts`**（删掉 `ComposerBox.vue:9` 的局部 ref 与 `useHotkeys.ts:55-58` 的 DOM 写值 + 补发 `input` 那条脆弱同步）。回放侧只加两个**可选字段**（`error.proposalId?`、`DocRef.excerpt?`），不开新 IPC 通道。

**Tech Stack:** Node 24、pnpm 11（只用 `corepack pnpm`）、Electron 42.5.0、Vue 3.5.39、Pinia 3.0.4、TypeScript 6.0.3、zod 4.4.3、vitest 4.1.9。**零新增第三方依赖**，**不引入 `@vue/test-utils` / jsdom / happy-dom**。

**Spec:** `docs/superpowers/specs/2026-10-02-ui-fusion-direction-design.md`（下称「附录」）—— 实现其 §3 F-A / F-B / F-C / F-D / F-F / F-G 六面与 §5 验收。
上游依据：`2026-10-01-mochen-writing-workbench-design.md`（「总 spec」）§6 审批铁律与 §6.2 的 Esc 三态裁决、§7 键位表；`2026-10-02-plan3-interaction-and-assembly-design.md`（「Plan 3 spec」）§4 回放、§5 键位层、§7 权限档 UI。
本波同时认领 `2026-10-02-plan3-wave1-report.md` 的「真机撞出、本波没修的三条界面缺陷」与「本波不自证通过的 6 格」。

**依赖波 1 已交付的：** `utils/hotkeys.ts` 的 `resolveHotkey`、`composables/useHotkeys.ts` 薄壳、`utils/hotkey-markers.ts`、`utils/escape-policy.ts` 的 `resolveEscape`、`utils/timeline.ts` 的 `replayProposalStatuses` / `splitProposalCards`、`stores/useAgentStore.ts` 的 `ensureHydrated` / `clearThreadView` / `queued` / `runSlashCommand`、`components/PermissionMenu.vue`、`components/SlashPalette.vue`、`styles/interaction.css`。

---

## Global Constraints

每个任务都隐含满足以下约束（值逐字取自 spec/附录）：

- **模型永不直接写盘**。唯一落盘通路是「人审批通过 → 主进程写」，写前备份到 `.mochen/changes/<时间戳>/`，指纹不符即拒。本波新增的任何按钮、任何 chip、任何 md 片段工具，都只是**改 draft 字符串**，一律走既有 draft → 提案 → 备份 → 指纹链；**本波不新增任何写盘通路**。
- **「替我审批」是审批铁律的唯一例外，且只在「全开」档可开**（总 spec §6 的 2026-10-03 裁定）。**它的生效点在主进程审批链 ⇒ 不在本波**（归波 3）；本波 UI 也不发那枚 chip。
- 工具集**只有 5 个**：`read_doc`、`list_docs`、`search_docs`、`propose_patch`、`write_doc`。本波不得出现第 6 个工具，也不得给任何新控件挂联网搜索。
- 权限三档 `read-only` / `chapter-write` / `full-access`，默认最保守的 `read-only`；档位文案唯一来源是 `PERMISSION_LABELS`。拒绝一律回单句中文原因，不静默丢弃。
- **回放绝不复活「可批准的待审队列」**（Plan 3 spec D1）：本波 Task 3 只把一个已经失效的卡从 `expired` 改判成 `stale`（两者都是不可批准态），**不新增任何可批准态的回放路径**。
- **本波不新增 IPC 通道**：`IPC_CHANNELS` 键数与 `RendererApi` 方法数保持 **13**（波 2 抬到 17、波 3 抬到 19）。两处跨层改动只加**可选字段**（`agent-event.ts` 的 `error.proposalId?`、`book.ts` 的 `DocRef.excerpt?`），老盘上文件读出来语义不变。
- `book.json` 的 `schemaVersion` **保持 1**。规则：只有「老文件读出来会语义错误」时才升版本。
- `packages/contracts`、`packages/fs-store`、`packages/agent-runtime` 内**禁止** `import ... from "electron"`；`agent-runtime` 另禁止 `node:fs`；渲染层禁止 import `@mochen/agent-runtime`。由 `tools/check-package-boundary.mjs` 强制。
- 单文件（`.ts`/`.vue`）**≤ 800 行**（`tools/check-source-line-budget.mjs:5`）。本波自设的更紧预算：`CenterColumn.vue` 现 304 行 ⇒ **≤400**；`DocumentPane.vue` 现 197 行 ⇒ **≤220**。超限即拆新组件，不许在既有文件里堆 markup。
- **判定逻辑一律下沉 `utils`/`stores`**：`.vue` 只接线。任何「哪个控件在什么状态下可见/可点/文案是什么」的判断都要有对应的纯函数与单测。
- **枚举与映射只许一份实现**（铁律 6）：`as const` + 派生类型 + `Record<联合类型, string>` 标签表，禁止手抄三元链。`BookKind` 的中文标签本波从 `LeftSidebar.vue:14-20` 抽成 `utils/book-kinds.ts` 共一份，左栏与「作品资料」同读它。
- **名字与动作不符也算摆设**（附录 §2.7）：**任何一个卡 / 按钮 / chip，必须能当场报出它调用的函数名与（如涉及）通道名；报不出来就不进 UI。** 预填通路（Task 4）没落地之前，「主笔创作」卡不许叫那个名字。
- **品牌原图原样使用**：`apps/desktop/src/renderer/src/assets/brand/mochen-lockup.jpg` 只做整幅排版，**禁止裁切、重绘、另生成**；A 稿那条龙形横幅不在仓库里，用户没给原图就不做 hero 横幅（附录 §0）。
- **硬编码色值算 P1 缺陷**：新组件一律吃 `--accent` / `--focus` / `--surface-*` / `--text-*` token，样式并入 `styles/interaction.css`，不新开样式文件。
- 所有面向用户的文案为简体中文；错误可见（进对话流或 `notice`），不只进日志。
- **模型密钥纪律（不可协商）**：密钥只进主进程、只进 `Authorization: Bearer` 头、绝不进 URL query、绝不以明文落盘、绝不写进 spec/plan/仓库文件/日志/记忆。本波任何任务都不碰密钥；真机冒烟只用仓内 mock 桩的假串。
- 断言必须证明能失败：每个任务先写反向用例（红→绿），本波八条变异（W1–W8）**先提交再变异**、只用 `Edit` 改代码（禁 `perl -i`/`sed -i`）、评审者自己重跑。只报「全绿」不算验证。
- 门禁退出码不能被管道吞掉：`corepack pnpm verify` 必须**不经管道**跑一遍并回读日志尾部的 `VERIFY_EXIT=0` 与用例总数。`eslint .` 不吃 `.gitignore`，临时探针目录里的 `.js/.cjs` 也会被检查。
- 本机 dev 在跑时全量 vitest 会假红灯（每次红的文件不同）；一律 `--maxWorkers=4`，异常时按文件重跑复核。
- 测试写盘一律 `mkdtemp` 真临时目录；绝不拿真人书稿当测试对象，绝不在测试里跑 `dialog.showMessageBox`。
- **契约与其消费方必须在同一任务落地**：加可选字段 → 同任务改完主进程发送侧、回放消费侧与全部夹具；每个中间提交都要过 tsc。
- 一波一提交，本波 11 任务（≤12 上限内）；**真机 UI 操作与代码评审不委托给子代理**。

---

## 设计决定（附录没写死、本计划拍定的八条）

对着同一套口径，而不是各自猜。

1. **Esc 的裁决点收回全局唯一层，`ProposalCard.vue` 不再自带裁决。** 附录 §2.4 明写「Esc 裁决优先级（总 spec §6.2）不动」，而浮层优先级必须插进这条链——若两个调用点各自插一次，就长出两份优先级（波 1 裁定 G5 禁的就是这个）。现状 `ProposalCard.vue:32-49` 的卡内 `@keydown` 与 `useHotkeys.ts:60-85` 的 `escape()` 判的是**同一件事**，且卡内那份读得到的东西（卡状态、说明框是否有字）全局层用 `data-proposal-*` / `[data-guidance]` 两个标记同样读得到。故：卡内 handler 删掉，只留 `data-*` 标记与按钮；`settingsIsOpen` 只在全局层进 `resolveEscape`。
2. **设置浮层可见性的唯一真身是 `layout.currentView === "settings"`。** 现状有两处真相：`CenterColumn.vue:38` 的 `showSettings = ref(false)`（「模型设置」按钮只改它）与 `layout.currentView`（`Ctrl+,` 与 `/model` 改它），单向 watch 让「按钮开浮层 → `Ctrl+,` 关不掉」这类不对称必然发生，也正是浮层 Esc 缺陷的根。改法：`showSettings` 变 `computed`，按钮调 `layout.showSettings("general")`，`closeSettings` 调 `layout.showWorkspace()`；附录 F-C 要的左栏「模型配置」入口因此与它天然同源。
3. **输入框的值上收到 `useAgentStore.composerDrafts: Record<string, string>`，键是 `threadKey`。** 不动 `ThreadView` 的十字段形状（波 1 契约对账钉的是 10），改成 store 顶层的一张平行 map。这一条正是 `useHotkeys.ts:52-54` 注释里挂进台账的那句「durable 方案（composer 草稿进 store）进台账，不在本片做」——本波还这笔债，顺带把「切章不丢字」与 F-A 的预填通路一起解决。
4. **无书时档位那一格不报档位名。** 现状 `CenterColumn.vue:97-99` 用 `DEFAULT_PERMISSION_MODE` 兜底，等于在没开书时宣称「只读参考」这个档——波 1 报告记的「捏造」缺陷。改判：无书 ⇒ 文案「未打开作品目录」、`disabled`，且不挂 `PermissionMenu`。
5. **`DocRef.excerpt` 由 `scan.ts` 顺路取，不加盘 IO。** 现状 `titleOf()` 已经 `readFile` 并 `parseFrontmatter`（`scan.ts:50-60`），改成一次读取同时得 `{ title, excerpt }`；`parseFrontmatter` 本来就返回 `body`（`frontmatter.ts:6`），取第一段纯文本、按码点截 80。消费处一律 `?? ""`，缺字段不当异常（附录 F-B 的 (b) 案）。
6. **`BookKind` 的中文标签表抽到 `utils/book-kinds.ts`。** 左栏与「作品资料」页签是同一种分组的两个视图；两处各写一份 `Record<BookKind, string>` 就是铁律 6 禁的那类漂。图标（`IconName`）留在组件里，因为它是渲染资产而不是业务枚举。
7. **F-E（「墨宸 · 青金」preset）不在本波，挪到波 2 Task 19。** 理由：`themePresets` 今天全仓零消费者（附录 §6 已把它列为真摆设），本波加第四条仍然是零消费者 ⇒ 按 §2.7 就是新摆设计。Plan 3 spec §3 第 19 行的**主题三态 + `appearance.json` + `useAppearanceStore` + `AppearancePanel.vue` 会把整张预设表变成有消费者的数据**（spec §8 第 306 行明写外观页直接复用 `themePresets`），那才是 `mochen-ink` 该出生的地方。**附录 §3 F-E 与 §4 表格里「波 3 的三态开关」这句是排期笔误**：以 Plan 3 spec 为准，主题三态在**波 2**。
8. **md 片段工具栏只改字符串、只经 `book.onEdit()`。** 不改 DOM、不引 `contenteditable`、不做富文本（附录 §2.2）。片段结果与手打完全同路 ⇒ 不新增写盘路径。

---

## 与附录 / Plan 3 spec 的差异（本计划拍定，评审先看这里）

1. **F-E 挪波 2**（设计决定 7）。本波交付的是 F-A / F-B / F-C / F-D / F-F / F-G 六面，其中 F-D 只含**已有的两枚** chip。
2. **F-D 的三枚新 chip 一枚都不进本波**（附录 §4 的 2026-10-03 追加归属）：当前模型 → 波 2（要新主进程通道 `{baseURL}/v1/models`，IPC 计数连带）；替我审批 → 波 3（生效点在主进程审批链）；思考等级 → 未决（附录 §7 第 4 条：一期认哪几个厂商的出站字段格式没定案，**定案前不发**）。
3. **本波比附录多出三段「非新界面」的账**：Task 1–3 是波 1 报告「真机撞出、没修的三条界面缺陷」，Task 11 的冒烟矩阵含波 1 那 6 格「不自证通过」的认领。附录 §3 只列 F-A…F-G，没规定这些缺陷归谁——归本波，因为 Task 2 的纯函数与 Task 9 的 chip 是同一个判定的两次需求，拆开必然写两份。
4. **F-A 的预填通路在本波 Task 4 落地**，所以「主笔创作」卡按附录 §3 的要求**可以**叫真名字（预填一句指令再聚焦）；这条通路是附录点名的「前置缺口，不许糊过去」。
5. **`stale` 的修复只加一个可选字段**（`error.proposalId?`），不改 `PROPOSAL_STATUSES`（仍 7 条）、不改状态语义、不给任何卡恢复可批准。附录没写这条的落点，本计划拍定。
6. **裁定 A（合成期拍定，Task 3 落地）**：`agent-service.ts:347-351` 的「writeDoc 返回 stale」分支**现状没有任何 error publish**（只有 `pending.delete` + `return`），所以它不是「第三处带 proposalId 的 stale publish」，而是「第三处 stale 且当前静默」。本波给它**新增**一条带 `proposalId` 的 error publish——只复用既有 `publish(threadKey, event({type:"error",…}))` 形态，不加通道、不加写盘路径。理由与逐字代码在 Task 3 Step 3b / 反向钉在 Step 1d。
7. **裁定 C（合成期拍定，Task 9 落地）**：chip 行**不做排队徽标**（`composerChips` 直接返回 `ComposerChipView[]`，没有 `queueBadge`）。队列计数的唯一可见真身仍是 `composeStatusLine` 的「排队 N 条」；chip 行末只放一句静态提示 `运行中按 Tab 可排队指令`（不读计数、不带 click）。理由与反向钉在 Task 9 Step 1 第四条 / Step 8。

---

## 文件结构（先定边界，再切任务）

```
墨宸 AI/
  packages/contracts/src/
    agent-event.ts            error 事件 += `proposalId: id.optional()`（唯一改动，判别联合的最后一个成员）
    book.ts                   DocRef += `excerpt?: string`（interface，非 zod）
    test/agent.test.ts         追加 error 带/不带 proposalId 的两条 schema 用例
    test/contract.test.ts      不动计数断言（IPC 仍 13）；追加 DocRef 缺 excerpt 不抛的用例

  packages/fs-store/src/
    scan.ts                    titleOf() → docMetaOf()：一次 readFile 同时得 title + excerpt（≤80 码点）
    test/scan.test.ts          追加 excerpt 四类：正常段、只有 frontmatter、超长截断、markdown 记号剥离

  apps/desktop/src/main/
    agent-service.ts           三处 stale 的 error 事件带上 proposalId（:321 指纹不符、:341 锚点不唯一）；:348 写盘撞指纹那一支**当前无任何 publish**，本波补一条带 proposalId 的 error publish（裁定 A，见 Task 3 Step 3b）
    agent-service.test.ts      追加：stale 分支的 error 事件含 proposalId

  apps/desktop/src/renderer/src/
    utils/escape-policy.ts     EscapeAction += "close-overlay"；EscapeFocusState += settingsIsOpen
    utils/escape-policy.test.ts 追加优先级矩阵（说明框 > 取消该条 > 收浮层 > 打断 > 无动作）
    utils/permission-chip.ts   新增：NO_BOOK_CHIP_LABEL / PermissionChipView / permissionChipView()
    utils/permission-chip.test.ts 新增
    utils/timeline.ts          replayProposalStatuses 追加 error{proposalId} ⇒ expired 改判 stale（仅 expired 可改）
    utils/timeline.test.ts     追加三条：改判、已 written 不被改、无 proposalId 不动
    utils/book-kinds.ts        新增：BOOK_KIND_ORDER / BOOK_KIND_LABELS（Record<BookKind,string>）
    utils/book-dossier.ts      新增：DossierGroup / groupDocsForDossier(docs) / dossierSummary(meta, docs)
    utils/book-dossier.test.ts  新增
    utils/composer-draft.ts    新增：prefillText(current, incoming)（已有非空草稿时不覆盖）
    utils/composer-draft.test.ts 新增
    utils/workbench-state.ts   新增：WORKBENCH_PREFILL / WorkbenchCardId / workbenchVisible() / workbenchCards()
    utils/workbench-state.test.ts 新增
    utils/composer-chips.ts    新增：ComposerChipView / composerChips()（只出两枚真开关，队列数字不留第二份）
    utils/composer-chips.test.ts  新增
    utils/markdown-snippets.ts 新增：SNIPPET_KINDS / SNIPPET_LABELS / applySnippet()
    utils/markdown-snippets.test.ts 新增
    utils/reading-time.ts      新增：readingMinutes(text)（中文 300 字/分钟向上取整，空 ⇒ null）
    utils/reading-time.test.ts    新增
    composables/useHotkeys.ts  escape() 读 `layout.currentView === "settings"` 进 resolveEscape，新增 close-overlay 分支；
                               submit/newline/queue 三条改走 store 的草稿，删 setComposerText() 的 DOM 写值
    stores/useAgentStore.ts    state += composerDrafts: Record<string,string>；actions += draftOf() / setDraft() / prefillComposer()
    stores/useBookStore.ts     rightPaneMode 三态（+"dossier"）；actions += openDossier()
    stores/useBookStore.test.ts 追加三态往返：切 dossier 不动 docTabs / activeDocTab / draft / dirty
    components/CenterColumn.vue 接线改造：showSettings 变 computed、档位 chip 用 permissionChipView、空分支换成 BookWorkbench、
                               chip 行事件接回同一个 openPalette / togglePermissionMenu
    components/ComposerBox.vue v-model 改受控（props modelValue + emit update:modelValue）；下方加 chip 行
    components/ProposalCard.vue 删卡内 Esc 自裁决（保留三个 data-* 标记与按钮）
    components/BookWorkbench.vue 新增：品牌区 + 四张卡 + 无书降级
    components/BookDossier.vue   新增：小说信息 + 五类分组摘要卡
    components/DocumentPane.vue  第三页签「作品资料」+ md 片段工具栏 + 页脚阅读时长
    components/LeftSidebar.vue   primary-nav 三段 + 标签表换成 utils/book-kinds
    styles/interaction.css       chip 行、工作台卡、dossier 卡、片段工具栏样式（毛玻璃延续既有 token）
  docs/superpowers/plans/2026-10-03-plan3-wave1-5-report.md  新增：波 1.5 门禁台账 + 真机矩阵（含 6 格认领）
```

每个新增纯函数模块保持在 40–220 行；`useAgentStore.ts` 现 615 行、`useBookStore.ts` 现 282 行，若加完草稿与 dossier 态让前者逼近 700 行，把草稿三 action 拆到 `stores/useComposerDraftStore.ts`（行数门禁会告诉我们，届时接口总表的 `agent.draftOf` 改为该 store 的同名 action，其余不变）。

---

## 接口总表（跨任务签名，逐字照此实现）

任何任务用到别人的接口时**以本表为准**；本表没写的形状属于该任务内部细节。类型一律从 `@mochen/contracts` 或就近模块 import，不得就地复制一份结构体。

```ts
// packages/contracts/src/agent-event.ts（error 成员）
z.object({ ...turn, type: z.literal("error"), message: z.string().min(1), proposalId: id.optional() })

// packages/contracts/src/book.ts
export interface DocRef { relPath: string; kind: BookKind; title: string; excerpt?: string }

// packages/fs-store/src/scan.ts（内部改造，导出不新增）
// 消费方拿到的 DocRef 可能没有 excerpt（老夹具、假 fs），一律 `?? ""`

// apps/desktop/src/main/agent-service.ts（不改签名，只改三条 stale 分支的 publish）
// 带 proposalId 的只有三条：指纹不符 / 锚点不唯一 / writeDoc 撞 stale。
// permission-denied 与 io 分支**不带**：那两条 pending 没删，提案仍可批准，改判 stale 等于说谎。
// 裁定 A：第三支（`:347-351`）**现状根本没有 publish**——只有 `pending.delete` + `return`。
// 它与前两支同为「pending 已删、提案已失效」，却既不进对话流也不落 JSONL ⇒ 重启后那张卡回放成 expired（未处理组），
// 与前两支的行为不一致，也违反「错误可见」。故本波给它**新增**一条 error publish（文案与指纹不符那一支同源），
// 不新增任何写盘通路、不新增 IPC 通道。

// apps/desktop/src/renderer/src/utils/escape-policy.ts
export type EscapeAction = "keep-guidance" | "cancel-proposal" | "close-overlay" | "interrupt" | "none";
export interface EscapeFocusState {
  hasFocusedProposal: boolean;
  focusedProposalPending: boolean;
  guidanceIsDirty: boolean;
  turnRunning: boolean;
  settingsIsOpen: boolean;      // 新增：唯一喂入点 = layout.currentView === "settings"
}
export function resolveEscape(state: EscapeFocusState): EscapeAction
// 优先级（逐字）：说明框保字 > 取消该条 > 收设置浮层 > 打断 > 无动作

// apps/desktop/src/renderer/src/utils/permission-chip.ts
export const NO_BOOK_CHIP_LABEL = "未打开作品目录";
export interface PermissionChipView { text: string; disabled: boolean; title: string }
export function permissionChipView(input: {
  hasBook: boolean;
  mode: PermissionMode | null;
  saving: boolean;
}): PermissionChipView

// apps/desktop/src/renderer/src/utils/timeline.ts
export function replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus>
// 新增规则：type==="error" 且带 proposalId 且当前值是 "expired" ⇒ 改判 "stale"；其余状态一律不动

// apps/desktop/src/renderer/src/utils/book-kinds.ts
export const BOOK_KIND_ORDER: BookKind[]        // ["chapter","outline","character","plot","material"]
export const BOOK_KIND_LABELS: Record<BookKind, string>   // 逐字取 LeftSidebar.vue:14-20 现有标签

// apps/desktop/src/renderer/src/utils/book-dossier.ts
export interface DossierGroup { kind: BookKind; label: string; docs: DocRef[] }
export function groupDocsForDossier(docs: DocRef[]): DossierGroup[]     // 空组不出现
export interface DossierSummary { title: string; stageName: string; permissionLabel: string; chapterCount: number }
export function dossierSummary(meta: BookMeta | null, docs: DocRef[]): DossierSummary | null

// apps/desktop/src/renderer/src/utils/composer-draft.ts
export function prefillText(current: string, incoming: string): string
// current 去空白后非空 ⇒ 原样返回 current（不吞用户已打的字）；否则返回 incoming

// apps/desktop/src/renderer/src/stores/useAgentStore.ts
state.composerDrafts: Record<string, string>          // 不进 ThreadView，形状不动
draftOf(threadKey: string): string                     // 缺省 ""
setDraft(threadKey: string, value: string): void
prefillComposer(threadKey: string, value: string): void  // 走 prefillText；被挡时 notice 一句中文
clearDraft(threadKey: string): void                    // 发送成功后清这一格

// apps/desktop/src/renderer/src/stores/useBookStore.ts
rightPaneMode: "manuscript" | "browse" | "dossier"
openDossier(): void                                    // 只改 mode，绝不动 docTabs / activeDocTab / draft / dirty

// apps/desktop/src/renderer/src/utils/workbench-state.ts
export type WorkbenchCardId = "chief-write" | "character" | "world" | "outline";
export const WORKBENCH_CARD_LABELS: Record<WorkbenchCardId, string>;   // 主笔创作 / 角色塑造 / 世界构建 / 大纲规划
export const WORKBENCH_PREFILL = "我想改这一章：先读它，再给我三处可以动的地方。";
export interface WorkbenchCard { id: WorkbenchCardId; label: string; hint: string; enabled: boolean }
export function workbenchVisible(hasBook: boolean): boolean            // 无书 ⇒ false（不显示死卡）
export function workbenchCards(input: { hasBook: boolean; docs: DocRef[]; activeChapter: string | null }): WorkbenchCard[]
export function workbenchTarget(input: { id: WorkbenchCardId; docs: DocRef[]; activeChapter: string | null }): string | null
// chief-write ⇒ activeChapter ?? 第一个 chapter；character/world/outline ⇒ 对应 kind 的第一篇 relPath；找不到 ⇒ null（卡 disabled）

// apps/desktop/src/renderer/src/utils/composer-chips.ts
export type ComposerChipId = "permission" | "palette";
export interface ComposerChipView { id: ComposerChipId; text: string; disabled: boolean; title: string }
export function composerChips(input: {
  hasBook: boolean;
  mode: PermissionMode | null;
  saving: boolean;
}): ComposerChipView[]
// permission chip 的 text/disabled 一律调 permissionChipView，不再算第二遍（设计决定 4）
// 裁定 C：**没有 queueBadge**。排队计数的唯一可见真身是 `useAgentStore.composeStatusLine`（波 1 已交付、有单测、
// 真机拍到过「排队 1 条」）；chip 行再放一枚徽标就是同一个数字的两份「数字→文案」实现（铁律 6），
// 而附录 F-D 只要求「chip 行只放真开关」，没要求把状态行的数字搬一份过来。

// apps/desktop/src/renderer/src/utils/markdown-snippets.ts
export const SNIPPET_KINDS = ["bold", "heading", "list", "quote"] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];
export const SNIPPET_LABELS: Record<SnippetKind, string>;     // 加粗 / 标题 / 列表 / 引用
export interface SnippetSelection { value: string; start: number; end: number }
export function applySnippet(kind: SnippetKind, sel: SnippetSelection): { value: string; start: number; end: number }
// 空选区 ⇒ 插入成对标记并把光标放中间；跨行 ⇒ list/quote 逐行前缀、heading 只作用首行；
// start/end 一律用 UTF-16 码元下标（textarea 的 selectionStart/End 就是这个口径），内部按码点算内容

// apps/desktop/src/renderer/src/utils/reading-time.ts
export const READING_MINUTES_PER_WORD = 300;      // 中文按 300 字/分钟
export function readingMinutes(text: string): number | null    // 去空白后 0 字 ⇒ null

// apps/desktop/src/renderer/src/components/*（接线面的对外契约）
BookWorkbench.vue   props: { hasBook: boolean; agentLabel: string; cards: WorkbenchCard[] }  emits: { pick(id: WorkbenchCardId) }
BookDossier.vue     props: { summary: DossierSummary | null; groups: DossierGroup[] }
ComposerBox.vue     props: { running; ready; canContinue; modelValue: string; hasBook: boolean; permissionMode: PermissionMode | null; permissionSaving: boolean }  emits: { "update:modelValue"; send; stop; resume; "open-permission-menu"; "open-palette" }
DocumentPane.vue    片段按钮 emit 不外抛：直接读 textarea 选区 → applySnippet → book.onEdit(next.value)
```

---

## 契约变更总表（本波收尾自检）

| 项 | 波 1 后现值 | 波 1.5 期望 | 谁改 |
| --- | --- | --- | --- |
| `IPC_CHANNELS` 键数 / `RendererApi` 方法数 | 13 / 13 | **13 / 13（一条不加）** | 无人；Task 11 回读确认 `renderer-api.test.ts` 的两处字面量仍是 13 |
| `PROPOSAL_STATUSES` | 7 | 7 | 无人 |
| `error` 事件字段 | 3（id/ts/turnId）+ type + message | += `proposalId?`（可选） | Task 3 |
| `DocRef` | 3 字段 | 4 字段（`excerpt?`） | Task 5 |
| `ThreadView` 字段 | 10 | **10（不动）** | 无人；草稿是 store 顶层 map（设计决定 3） |
| `EscapeAction` | 4 | 5（+`close-overlay`） | Task 1 |
| `book.json` `schemaVersion` | 1 | 1 | 无人 |
| 单文件行数预算 | `CenterColumn.vue` 304 / `DocumentPane.vue` 197 | ≤400 / ≤220 | Task 7 / Task 10 当场回读 `wc -l` |

---

## 变异归属（本波 W1–W8，全部「先提交再变异」）

| 编号 | 变异动作 | 落点 | 该转红的断言 |
| --- | --- | --- | --- |
| W1 | `resolveEscape` 删掉 `close-overlay` 那一支 | `utils/escape-policy.ts` | 「设置浮层开着且回合运行中 ⇒ 先收浮层而不是打断」 |
| W2 | `permissionChipView` 的 `hasBook` 判断恒为真 | `utils/permission-chip.ts` | 「无书 ⇒ 文案不是任何档位名且 disabled」 |
| W3 | `replayProposalStatuses` 去掉 `=== "expired"` 守卫 | `utils/timeline.ts` | 「已 written 的卡不因后续 error 改判」 |
| W4 | `prefillText` 改成无条件返回 `incoming` | `utils/composer-draft.ts` | 「已有草稿时预填不吞字」 |
| W5 | `docMetaOf` 的 excerpt 永远返回 `""` | `packages/fs-store/src/scan.ts` | 「正常段落要带出第一段」 |
| W6 | `groupDocsForDossier` 删掉空组过滤 | `utils/book-dossier.ts` | 「没有人物文档时不出现人物组」 |
| W7 | `workbenchVisible` 不看 `hasBook` | `utils/workbench-state.ts` | 「无书 ⇒ 一张卡都不出」 |
| W8 | `applySnippet("list")` 只作用首行 | `utils/markdown-snippets.ts` | 「跨行选区每行都加 `- `」 |

---

## 任务地图与顺序

顺序即依赖。附录 §4 给的内部顺序是 F-B → F-A → F-C → F-D → F-F → F-G，本波把三段缺陷账放在最前面（Task 2 的纯函数是 Task 9 那枚 chip 的同一判定，Task 1 的浮层真身是 Task 8 左栏入口的前置）。

| # | 任务 | 面 | 主要落点 |
| --- | --- | --- | --- |
| 1 | 设置浮层单一真身 + Esc 收回浮层 | 缺陷① | `escape-policy.ts` / `useHotkeys.ts` / `CenterColumn.vue` / `ProposalCard.vue` |
| 2 | 无书时档位那一格说实话 | 缺陷② | 新 `utils/permission-chip.ts` / `CenterColumn.vue` |
| 3 | `stale` 随回放存活 | 缺陷③ | `contracts/agent-event.ts` / `agent-service.ts` / `timeline.ts` |
| 4 | 输入值上收 store（预填通路） | F-A 前置 | 新 `utils/composer-draft.ts` / `useAgentStore.ts` / `ComposerBox.vue` / `useHotkeys.ts` |
| 5 | `DocRef.excerpt`：扫描顺路带第一段 | F-B 数据面 | `contracts/book.ts` / `fs-store/src/scan.ts` |
| 6 | 右栏第三页签「作品资料」 | F-B 界面面 | 新 `utils/book-kinds.ts` / `book-dossier.ts` / `BookDossier.vue` / `DocumentPane.vue` / `useBookStore.ts` |
| 7 | 中栏空状态 = 作品工作台 | F-A | 新 `utils/workbench-state.ts` / `BookWorkbench.vue` / `CenterColumn.vue` |
| 8 | 左栏三段主操作 | F-C | `LeftSidebar.vue` |
| 9 | 输入区 chip 行只放真开关 | F-D | 新 `utils/composer-chips.ts` / `ComposerBox.vue` / `interaction.css` |
| 10 | md 片段工具栏 + 页脚阅读时长 | F-F + F-G | 新 `utils/markdown-snippets.ts` / `reading-time.ts` / `DocumentPane.vue` |
| 11 | 波 1.5 门禁、变异台账与真机冒烟（含 6 格认领） | 验收 | 全链 verify + `docs/superpowers/plans/2026-10-03-plan3-wave1-5-report.md` |

---

### Task 1：设置浮层单一真身 + Esc 收回浮层（缺陷①）

**Files:**
- Modify: `apps/desktop/src/renderer/src/utils/escape-policy.ts:1,3-8,14-19`
- Modify: `apps/desktop/src/renderer/src/composables/useHotkeys.ts:60-85`（`escape()` 函数体 + 第 70 行注释）
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue:38,133-144,187`
- Modify: `apps/desktop/src/renderer/src/components/ProposalCard.vue:10,31-49,53-63`
- Test: `apps/desktop/src/renderer/src/utils/escape-policy.test.ts`
- Test（连带回归，必须仍绿）: `apps/desktop/src/renderer/src/utils/hotkey-markers.test.ts`

**Interfaces:**
- Consumes（逐字抄自接口总表）：
  ```ts
  // apps/desktop/src/renderer/src/utils/escape-policy.ts
  export type EscapeAction = "keep-guidance" | "cancel-proposal" | "close-overlay" | "interrupt" | "none";
  export interface EscapeFocusState {
    hasFocusedProposal: boolean;
    focusedProposalPending: boolean;
    guidanceIsDirty: boolean;
    turnRunning: boolean;
    settingsIsOpen: boolean;      // 新增：唯一喂入点 = layout.currentView === "settings"
  }
  export function resolveEscape(state: EscapeFocusState): EscapeAction
  // 优先级（逐字）：说明框保字 > 取消该条 > 收设置浮层 > 打断 > 无动作
  ```
  `layout.showSettings(initialCategory)`（`stores/layoutStore.ts:89-92`）、`layout.showWorkspace()`（`:94-96`）、`layout.currentView`（`:53`）、`resolveEscape` 的消费方 `useHotkeys.ts:64`。
- Produces：`EscapeAction` 多出成员 `"close-overlay"`、`EscapeFocusState` 多出必填字段 `settingsIsOpen`；`resolveEscape` 的四态优先级链。后续 Task 8（左栏「模型配置」入口）复用「唯一真身 = `layout.currentView === "settings"`」这条判定。

- [ ] **Step 1：写失败的测试**

  在 `apps/desktop/src/renderer/src/utils/escape-policy.test.ts` 顶部先把 `state()` 默认对象补上新必填字段（否则所有既有用例在 tsc 下编译不过），再追加一整段 `describe`。

  把 `:4-12` 的 `state()` 改成（仅新增一行 `settingsIsOpen: false`）：
  ```ts
  function state(overrides: Partial<EscapeFocusState> = {}): EscapeFocusState {
    return {
      hasFocusedProposal: false,
      focusedProposalPending: false,
      guidanceIsDirty: false,
      turnRunning: false,
      settingsIsOpen: false,
      ...overrides
    };
  }
  ```

  在文件末尾（原 `describe("resolveEscape", ...)` 之后）追加：
  ```ts
  describe("resolveEscape 收设置浮层优先级（缺陷①）", () => {
    it("设置浮层开着且回合运行中：先收浮层，而不是打断", () => {
      expect(resolveEscape(state({ settingsIsOpen: true, turnRunning: true }))).toBe(
        "close-overlay"
      );
    });

    it("设置浮层开着但没在跑回合：收浮层", () => {
      expect(resolveEscape(state({ settingsIsOpen: true }))).toBe("close-overlay");
    });

    it("聚焦待审卡且浮层也开着：卡优先，取消该条而不是收浮层", () => {
      expect(
        resolveEscape(
          state({
            hasFocusedProposal: true,
            focusedProposalPending: true,
            settingsIsOpen: true
          })
        )
      ).toBe("cancel-proposal");
    });

    it("说明框有字且浮层开着：先保字（说明框保字 > 收浮层）", () => {
      expect(
        resolveEscape(
          state({
            hasFocusedProposal: true,
            focusedProposalPending: true,
            guidanceIsDirty: true,
            settingsIsOpen: true
          })
        )
      ).toBe("keep-guidance");
    });

    it("浮层没开、回合在跑：照旧打断", () => {
      expect(resolveEscape(state({ settingsIsOpen: false, turnRunning: true }))).toBe("interrupt");
    });
  });
  ```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

  命令：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/escape-policy.test.ts --maxWorkers=4`

  预期红（当前 `resolveEscape` 无 `settingsIsOpen` 分支，vitest/esbuild 不做类型检查，多余的覆盖字段被忽略）：
  ```
  FAIL … > 设置浮层开着且回合运行中：先收浮层，而不是打断
  AssertionError: expected 'interrupt' to be 'close-overlay' // Object.is equality
  ```
  「浮层开着但没在跑回合」那条也会红（`expected 'none' to be 'close-overlay'`）。既有的六条老用例（含 `:49` 「无动作」）应保持绿——证明新分支没挪动旧优先级。

- [ ] **Step 3：最小实现**

  3a. `apps/desktop/src/renderer/src/utils/escape-policy.ts` 整文件替换为：
  ```ts
  export type EscapeAction =
    | "keep-guidance"
    | "cancel-proposal"
    | "close-overlay"
    | "interrupt"
    | "none";

  export interface EscapeFocusState {
    hasFocusedProposal: boolean;
    focusedProposalPending: boolean;
    guidanceIsDirty: boolean;
    turnRunning: boolean;
    settingsIsOpen: boolean;
  }

  /**
   * spec §6.2 的唯一裁决入口，波 1.5 把「收设置浮层」插进这条链（设计决定 1：裁决点只有这一处）。
   * 优先级（逐字）：说明框保字 > 取消该条 > 收设置浮层 > 打断 > 无动作。
   * 说明框已有字时先保住字（只失焦）——绝不吞掉用户输入；审批卡永远优先于打断。
   */
  export function resolveEscape(state: EscapeFocusState): EscapeAction {
    if (state.hasFocusedProposal && state.focusedProposalPending)
      return state.guidanceIsDirty ? "keep-guidance" : "cancel-proposal";
    if (state.settingsIsOpen) return "close-overlay";
    if (state.turnRunning) return "interrupt";
    return "none";
  }
  ```

  3b. `apps/desktop/src/renderer/src/composables/useHotkeys.ts` 的 `escape()`（`:60-85`）替换为——喂入真值并新增 `close-overlay` 分支；`:70` 那句「卡内的 Esc 由 ProposalCard 自己处理」的旧注释一并改掉（卡内已不自裁决）：
  ```ts
  function escape(event: KeyboardEvent, card: HTMLElement | null): void {
    const guidance = card?.querySelector<HTMLTextAreaElement>(GUIDANCE_SELECTOR) ?? null;
    const cardId = card?.getAttribute(CARD_ID_ATTR) ?? "";
    // 四态裁决（说明框保字 > 取消该条 > 收浮层 > 打断 > 无动作）全在 resolveEscape，这里不复制口径。
    const action = resolveEscape({
      hasFocusedProposal: card !== null,
      focusedProposalPending: card?.getAttribute(CARD_STATUS_ATTR) === "pending",
      guidanceIsDirty: (guidance?.value.trim() ?? "") !== "",
      turnRunning: runningNow(),
      // 唯一喂入点：设置浮层的真身是 layout.currentView === "settings"（设计决定 2）。
      settingsIsOpen: layout.currentView === "settings"
    });
    if (action === "keep-guidance") {
      event.preventDefault();
      guidance?.blur();
      return;
    }
    if (action === "cancel-proposal" && cardId !== "") {
      event.preventDefault();
      void agent.decide(cardId, "cancel", "");
      return;
    }
    if (action === "close-overlay") {
      event.preventDefault();
      layout.showWorkspace();
      return;
    }
    if (action === "interrupt") {
      event.preventDefault();
      void agent.stop();
    }
  }
  ```
  同时把原 `:70` 那行注释（「卡内的 Esc 由 ProposalCard 自己处理并 stopPropagation，冒到这里的一律是「卡外」的 Esc。」）删除——卡内已无自裁决，冒泡上来的 Esc 现在是全局唯一裁决入口处理的。

  3c. `apps/desktop/src/renderer/src/components/CenterColumn.vue`：

  - `:38` `const showSettings = ref(false);` →
    ```ts
    const showSettings = computed(() => layout.currentView === "settings");
    ```
    （`computed` 已在 `:4` 导入；`ref` 仍被 `paletteOpen`（`:40`）用着，`ref` 不删。）
  - `:133-140` 那段桥接注释 + 单向 `watch(() => layout.currentView, ...)` 整块删除（局部真身与 watch 都随「单一真身」消失）：
    ```ts
    // Ctrl+, 的落点是 layout.currentView；App.vue 目前不渲染 settings 视图，模型设置的唯一真身
    // 是本组件的 ProviderSettings 浮层，故由这里桥接（波 2 若给 App.vue 加独立设置视图，改的是这个桥）。
    watch(
      () => layout.currentView,
      (view) => {
        if (view === "settings") showSettings.value = true;
      }
    );
    function closeSettings(): void {
      showSettings.value = false;
      layout.showWorkspace();
    }
    ```
    换成（`closeSettings` 只剩收回真身；`showSettings` 现在是 computed，由 `layout.currentView` 驱动，无需再手动置 false）：
    ```ts
    // 设置浮层可见性的唯一真身是 layout.currentView === "settings"（设计决定 2）：
    // 按钮、Ctrl+,、/model、Esc 收浮层全部读写同一个 currentView，不再有两处真相。
    function closeSettings(): void {
      layout.showWorkspace();
    }
    ```
  - `:187` 「模型设置」按钮的点击：`@click="showSettings = true"` → `@click="layout.showSettings('general')"`（computed 无 setter，写它必然报错；按钮从此与 `Ctrl+,` 同源）。
  - `:300` `<ProviderSettings v-if="showSettings" @close="closeSettings" />` 不动——`showSettings` 已变成 computed，读的还是同一个 `currentView`。

  3d. `apps/desktop/src/renderer/src/components/ProposalCard.vue`（设计决定 1：卡内不再自带裁决，Esc 冒泡到全局唯一层）：

  - 删除 `:10` 的 `import { resolveEscape } from "../utils/escape-policy";`（删掉 handler 后它成为未用导入，eslint 会红）。
  - 删除 `:31-49` 的 `onKeydown` 函数（含其上的 `/** 卡内 Esc … */` 注释块）。
  - 删除 `:63` `<article … @keydown="onKeydown">` 上的 `@keydown="onKeydown"` 绑定；**保留** `data-proposal-card`、`:data-proposal-id`、`:data-proposal-status` 三个标记（`hotkey-markers.test.ts` 的模板契约钉着它们）。
  - 把 `:53-55` 的模板注释（原文「自带的 @keydown 保留——卡内 Esc 已 stopPropagation…」）改成如实说明：Esc 的裁决已上收到全局唯一层，本卡只留 `data-*` 标记与按钮。改成：
    ```html
    <!-- 三个 data-* 是全局键位层（useHotkeys）找卡、判状态、取 id 的唯一依据（裁定 G5）：
         少任一个标记，审批四键与 Esc 的卡态裁决都会静默失效。卡内不再有 @keydown 自裁决——
         Esc 一律冒泡到全局唯一裁决入口 resolveEscape（设计决定 1），杜绝两份优先级。 -->
    ```
  - `props.running` 与 `emit("interrupt")` 的声明保留（CenterColumn 卡绑定仍传 `:running` / `@interrupt`，删声明会让属性变成裸 attr）；`guidance` ref、`decide()`、按钮全部不动。

- [ ] **Step 4：复跑到绿**

  命令：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/escape-policy.test.ts apps/desktop/src/renderer/src/utils/hotkey-markers.test.ts --maxWorkers=4`

  期望：`escape-policy.test.ts` 11 passed（原 6 + 新 5），`hotkey-markers.test.ts` 3 passed（删 handler 不影响标记契约）。合计 `14 passed`。

- [ ] **Step 5：连带清单**

  1. `resolveEscape` 的调用点只有两处：`useHotkeys.ts:64`（本任务改）与 `ProposalCard.vue:34`（本任务删）。Grep 复算，改完应只剩一处构造 `EscapeFocusState`：
     `corepack pnpm exec grep -rn "resolveEscape(" apps/desktop/src/renderer/src --include=*.ts --include=*.vue`
     期望命中：`escape-policy.ts`（定义）、`useHotkeys.ts:64`、`escape-policy.test.ts`（用例）。**`ProposalCard.vue` 不再出现**；`.vue` 里除注释外无 `resolveEscape`。
  2. `EscapeFocusState` 新增必填字段后，任何构造点都得带上 `settingsIsOpen`。上面 Grep 之外，确认无遗漏的裸对象字面量构造：
     `corepack pnpm exec grep -rn "hasFocusedProposal" apps/desktop/src/renderer/src`
     期望命中仅 `escape-policy.ts`（interface）、`useHotkeys.ts`（escape 构造）、`escape-policy.test.ts`（state 默认 + overrides）。
  3. `useHotkeys.ts` 现 199 行（当场回读 `wc -l`）；本任务 `escape()` 净增约 4 行，仍在 800 行硬门禁内，无需拆。回读：`wc -l apps/desktop/src/renderer/src/composables/useHotkeys.ts`（期望 ≈203）。
  4. `CenterColumn.vue` 现 304 行（当场回读），本任务净变化约 −4 行（删 watch 段 + 删注释多于一行），≤400 预算无压力。回读：`wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue`。
  5. 计划文本账：`CenterColumn.vue:127-129` 那段注释仍写「Esc = 打断」已被取代、「保留两处监听会变成两份 Esc 裁决（裁定 G5）」——此结论方向不变，但「三态裁决」的措辞可在本任务顺手改成「四态裁决（含收浮层）」，避免与 `escape-policy.ts` 文档漂移。仅注释，不动逻辑。

- [ ] **Step 6：局部门禁**

  按顺序，逐条不设管道：
  ```
  corepack pnpm prettier --check apps/desktop/src/renderer/src/utils/escape-policy.ts apps/desktop/src/renderer/src/utils/escape-policy.test.ts apps/desktop/src/renderer/src/composables/useHotkeys.ts apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/ProposalCard.vue
  corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json
  corepack pnpm eslint apps/desktop/src/renderer/src/utils/escape-policy.ts apps/desktop/src/renderer/src/utils/escape-policy.test.ts apps/desktop/src/renderer/src/composables/useHotkeys.ts apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/ProposalCard.vue --max-warnings=0
  ```
  期望：prettier「All matched files use Prettier code style!」；tsc 零诊断（web 项目覆盖整个 `src/renderer`，含三个 `.vue` 接线，`.vue` 因 `vue-shim` 不进 tsc——判定逻辑都在 `escape-policy.ts`/`useHotkeys.ts` 两个 `.ts` 里，被真正类型检查）；eslint 零告警（重点：ProposalCard 删干净的 `resolveEscape` 导入不残留未用告警）。

- [ ] **Step 7：提交**

  ```
  git add apps/desktop/src/renderer/src/utils/escape-policy.ts apps/desktop/src/renderer/src/utils/escape-policy.test.ts apps/desktop/src/renderer/src/composables/useHotkeys.ts apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/ProposalCard.vue
  git commit -m "fix(hotkeys): 设置浮层单一真身收归 currentView，Esc 增加收浮层优先级并删除卡内自裁决"
  ```

- [ ] **Step 8：变异 W1（先提交再变异）**

  落点 `apps/desktop/src/renderer/src/utils/escape-policy.ts`。用 Edit 删除 `resolveEscape` 里的这一行：
  ```ts
      if (state.settingsIsOpen) return "close-overlay";
  ```
  单跑：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/escape-policy.test.ts --maxWorkers=4`
  预期转红原文：
  ```
  FAIL … > 设置浮层开着且回合运行中：先收浮层，而不是打断
  AssertionError: expected 'interrupt' to be 'close-overlay' // Object.is equality
  ```
  （「浮层开着但没在跑回合」那条同样红 `expected 'none' to be 'close-overlay'`；其余用例不受影响。）
  用 Edit 把该行改回原位 → 复跑 `--maxWorkers=4` 回 `14 passed` → `git diff --exit-code` 必须干净。

  缺陷对应原文（波 1 报告 `2026-10-02-plan3-wave1-report.md`）：真机表「`Ctrl+B` / `Ctrl+,`」格记「浮层开着、composer 聚焦时按 Esc 没有收回 `currentView`，之后是靠别的操作关掉的 ⇒ 记进留底」，留底第 132 行「① 设置浮层开着且 composer 聚焦时，Esc 不收回浮层（要靠别的操作关）」。本任务把可见性收归单一真身、把收浮层插进唯一 Esc 链，正对这一条。

---

### Task 2：无书时档位那一格说实话（缺陷②）

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/permission-chip.ts`
- Create: `apps/desktop/src/renderer/src/utils/permission-chip.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue:5-11`（contracts import）、`:97-99`（`permissionLabel` computed）、`:176-185`（档位按钮与 `PermissionMenu` 挂载条件）
- Test: `apps/desktop/src/renderer/src/utils/permission-chip.test.ts`

**Interfaces:**
- Consumes（逐字抄自接口总表）：
  ```ts
  // apps/desktop/src/renderer/src/utils/permission-chip.ts
  export const NO_BOOK_CHIP_LABEL = "未打开作品目录";
  export interface PermissionChipView { text: string; disabled: boolean; title: string }
  export function permissionChipView(input: {
    hasBook: boolean;
    mode: PermissionMode | null;
    saving: boolean;
  }): PermissionChipView
  ```
  `PERMISSION_LABELS`（`packages/contracts/src/permission.ts:5-9`，`Record<PermissionMode, string>`）、`type PermissionMode`（`packages/contracts` barrel）。
- Produces：`permissionChipView()` / `PermissionChipView` / `NO_BOOK_CHIP_LABEL`。Task 9 的 `utils/composer-chips.ts` 里的 permission chip 的 `text`/`disabled` **必须调 `permissionChipView`**，不再算第二遍（接口总表 `composerChips` 注释与设计决定 4）。

- [ ] **Step 1：写失败的测试**

  新建 `apps/desktop/src/renderer/src/utils/permission-chip.test.ts`：
  ```ts
  import { describe, expect, it } from "vitest";
  import { PERMISSION_LABELS } from "@mochen/contracts";
  import { NO_BOOK_CHIP_LABEL, permissionChipView } from "./permission-chip";

  describe("permissionChipView（无书时档位那一格说实话，缺陷②）", () => {
    it("无书但传了真实档位：文案仍是「未打开作品目录」且 disabled，绝不报任何档位名", () => {
      const view = permissionChipView({ hasBook: false, mode: "read-only", saving: false });
      expect(view.text).toBe(NO_BOOK_CHIP_LABEL);
      expect(view.disabled).toBe(true);
      // 鉴别力：文案不得等于三档里任何一个（波 1 报告捏造的正是「只读参考」这一档名）。
      expect(Object.values(PERMISSION_LABELS)).not.toContain(view.text);
    });

    it("无书且 mode 为 null（波 1 报告实读 chipText=只读参考 / chipDisabled=false 的原始形状）：同样不报档位名、同样 disabled", () => {
      const view = permissionChipView({ hasBook: false, mode: null, saving: false });
      expect(view.text).toBe(NO_BOOK_CHIP_LABEL);
      expect(view.disabled).toBe(true);
    });

    it("有书且非保存态：文案是真实档位名、可点（disabled=false）", () => {
      const view = permissionChipView({ hasBook: true, mode: "chapter-write", saving: false });
      expect(view.text).toBe(PERMISSION_LABELS["chapter-write"]);
      expect(view.disabled).toBe(false);
      expect(view.title).toContain(PERMISSION_LABELS["chapter-write"]);
    });

    it("有书但正在保存：文案仍是真实档位名，只是 disabled=true", () => {
      const view = permissionChipView({ hasBook: true, mode: "full-access", saving: true });
      expect(view.text).toBe(PERMISSION_LABELS["full-access"]);
      expect(view.disabled).toBe(true);
    });
  });
  ```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

  命令：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/permission-chip.test.ts --maxWorkers=4`

  预期红：`permission-chip.ts` 尚不存在，模块解析失败：
  ```
  Error: Failed to load url ./permission-chip ... Does the file exist?
  ```
  （这是「因为想要的原因」——实现缺失。Step 3 落地后转绿。）

- [ ] **Step 3：最小实现**

  3a. 新建 `apps/desktop/src/renderer/src/utils/permission-chip.ts`：
  ```ts
  import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";

  /** 无书时档位那一格的诚实文案（设计决定 4：不开口冒充任何档位名）。 */
  export const NO_BOOK_CHIP_LABEL = "未打开作品目录";

  export interface PermissionChipView {
    text: string;
    disabled: boolean;
    title: string;
  }

  /**
   * 档位 chip 的显示判定，唯一一份（判定下沉 utils，`.vue` 只接线）。
   * 无书 ⇒ 报「未打开作品目录」、disabled、且不挂 PermissionMenu；
   * 有书 ⇒ 文案只读 PERMISSION_LABELS（不兜底 DEFAULT_PERMISSION_MODE，那是「没开书也报档位名」的根）。
   * hasBook 是第一裁决项：即便调用点误传了一个 mode，无书也绝不泄露档位名（对应波 1 报告的捏造缺陷）。
   */
  export function permissionChipView(input: {
    hasBook: boolean;
    mode: PermissionMode | null;
    saving: boolean;
  }): PermissionChipView {
    if (!input.hasBook || input.mode === null) {
      return {
        text: NO_BOOK_CHIP_LABEL,
        disabled: true,
        title: "还没打开作品目录，权限档改不了。"
      };
    }
    const label = PERMISSION_LABELS[input.mode];
    return {
      text: label,
      disabled: input.saving,
      title: input.saving ? "正在保存权限档…" : `当前权限档：${label}，点击切换`
    };
  }
  ```

  3b. `apps/desktop/src/renderer/src/components/CenterColumn.vue` 接线：

  - contracts import（`:5-11`）删掉不再用到的两个符号，`DEFAULT_PERMISSION_MODE`、`PERMISSION_LABELS` 移除（本组件此后只经 `permissionChipView`）：
    ```ts
    import {
      PROPOSAL_STATUS_LABELS,
      type AgentEvent,
      type ProposalDecision
    } from "@mochen/contracts";
    import { permissionChipView } from "../utils/permission-chip";
    ```
    （新增一行 import；`PROPOSAL_STATUS_LABELS` 仍用于空态/分组渲染。`PermissionMenu.vue:6,21` 仍各自读 `PERMISSION_LABELS`/`DEFAULT_PERMISSION_MODE`，`agent-service.ts:248`、`useAgentStore.ts:561` 亦仍读 `DEFAULT_PERMISSION_MODE`——**契约符号绝不删**，见 Step 5。）
  - `:97-99` 的 `permissionLabel` computed 整块换成 `permissionChip`：
    ```ts
    // 档位 chip 的判定唯一来自 permissionChipView（设计决定 4）：无书不报档位名、不冒充按钮。
    const permissionChip = computed(() =>
      permissionChipView({
        hasBook: book.meta !== null,
        mode: book.meta?.permissionMode ?? null,
        saving: book.metaSaving
      })
    );
    ```
    （删除原注释「档位文案的唯一来源是 contracts…这里手抄三元链…」，改由 util 单测钉住。）
  - `:176-185` 档位按钮块与 `PermissionMenu` 挂载条件：`:disabled` / `:title` 走纯函数结果，`v-if` 加「有书才挂」：
    ```html
        <div class="permission-menu-actions">
          <button
            class="permission-chip is-button"
            type="button"
            :disabled="permissionChip.disabled"
            :title="permissionChip.title"
            :aria-expanded="book.permissionMenuOpen"
            @click="book.togglePermissionMenu()"
          >
            {{ permissionChip.text }}
          </button>
          <PermissionMenu
            v-if="book.meta !== null && book.permissionMenuOpen"
            @close="book.closePermissionMenu()"
          />
        </div>
    ```
    原 `:disabled="book.metaSaving"`、`{{ permissionLabel }}`、`v-if="book.permissionMenuOpen"` 三处分别被 `permissionChip.disabled` / `permissionChip.text` / 带 `book.meta !== null` 的条件取代。

- [ ] **Step 4：复跑到绿**

  命令：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/permission-chip.test.ts --maxWorkers=4`
  期望：`4 passed`。

- [ ] **Step 5：连带清单**

  1. 确认没把契约符号 `DEFAULT_PERMISSION_MODE` 删掉——它还有多处消费方。命令：
     `corepack pnpm exec grep -rn "DEFAULT_PERMISSION_MODE" packages apps --include=*.ts --include=*.vue`
     期望仍命中：`packages/contracts/src/permission.ts:3`（定义）、`packages/contracts/test/contract.test.ts:3,58`、`apps/desktop/src/main/agent-service.ts:3,248`、`apps/desktop/src/renderer/src/stores/useAgentStore.ts:5,561`、`apps/desktop/src/renderer/src/components/PermissionMenu.vue:6,21`，以及若干测试夹具（`useBookStore.test.ts`、`agent-service*.test.ts`、`book-service.test.ts`、`turn-e2e.test.ts`、`agent-service-boundary.test.ts`）。**CenterColumn.vue 不再出现**（本任务清掉的就是它这一处）。
  2. `PERMISSION_LABELS` 同理仍在 `PermissionMenu.vue`、`useAgentStore.ts` 有消费，CenterColumn 移除后不伤别处。命令：
     `corepack pnpm exec grep -rn "PERMISSION_LABELS" apps/desktop/src/renderer/src --include=*.ts --include=*.vue`
     期望 `CenterColumn.vue` 不出现、`PermissionMenu.vue` 与 `useAgentStore.ts` 在列。
  3. 行数预算：`CenterColumn.vue` 改后回读 `wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue`，期望仍 ≤400（本任务净变化在 ±3 行）。
  4. `permission-chip.ts` 属新增纯函数模块，控制在接口总表「40–220 行」的精神内（实现约 30 行 + 注释，未越界）。

- [ ] **Step 6：局部门禁**

  按顺序，不设管道：
  ```
  corepack pnpm prettier --check apps/desktop/src/renderer/src/utils/permission-chip.ts apps/desktop/src/renderer/src/utils/permission-chip.test.ts apps/desktop/src/renderer/src/components/CenterColumn.vue
  corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json
  corepack pnpm eslint apps/desktop/src/renderer/src/utils/permission-chip.ts apps/desktop/src/renderer/src/utils/permission-chip.test.ts apps/desktop/src/renderer/src/components/CenterColumn.vue --max-warnings=0
  ```
  期望：prettier 全绿；tsc 零诊断（`permission-chip.ts`/`.test.ts` 被真正检查；web 项目 import `@mochen/contracts` 走源码，`PERMISSION_LABELS` 的 `Record<PermissionMode,string>` 穷尽性由类型层保证）；eslint 零告警（重点：CenterColumn 删干净 `DEFAULT_PERMISSION_MODE`/`PERMISSION_LABELS` 未用导入）。

- [ ] **Step 7：提交**

  ```
  git add apps/desktop/src/renderer/src/utils/permission-chip.ts apps/desktop/src/renderer/src/utils/permission-chip.test.ts apps/desktop/src/renderer/src/components/CenterColumn.vue
  git commit -m "fix(permission): 无书时档位格不报档位名并禁用，判定下沉 permissionChipView 纯函数"
  ```

- [ ] **Step 8：变异 W2（先提交再变异）**

  落点 `apps/desktop/src/renderer/src/utils/permission-chip.ts`。用 Edit 把守卫里的 `hasBook` 判断改「恒为真」：
  ```ts
    if (!input.hasBook || input.mode === null) {
  ```
  改成：
  ```ts
    if (false || input.mode === null) {
  ```
  单跑：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/permission-chip.test.ts --maxWorkers=4`
  预期转红原文（第一条「无书但传了真实档位」正是鉴别用例——mode 非 null，被强制走 else 分支泄露档位名）：
  ```
  FAIL … > 无书但传了真实档位：文案仍是「未打开作品目录」且 disabled，绝不报任何档位名
  AssertionError: expected '只读参考' to be '未打开作品目录' // Object.is equality
  ```
  （第二条 `mode:null` 仍被 `|| input.mode === null` 兜住 ⇒ 保持绿；这正说明 `hasBook` 是第一裁决项、不能被 `mode` 兜底替代。）
  用 Edit 改回 `if (!input.hasBook || input.mode === null) {` → 复跑 `--maxWorkers=4` 回 `4 passed` → `git diff --exit-code` 必须干净。

  缺陷对应原文（波 1 报告 `2026-10-02-plan3-wave1-report.md` 权限档表「没开书时切档」格）：「**缺陷**：计划要求「标签也 disabled」，实读 `{"chipText":"只读参考","chipDisabled":false}` ⇒ 无书时头部标签照样可点、还捏造出「只读参考」这个标签」；留底第 132 行「② 无书时头部档位标签仍 `disabled=false` 且文案捏造成「只读参考」」。本任务把 CenterColumn 的 `book.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE` 兜底换成 `permissionChipView`，无书 ⇒ 「未打开作品目录」+ disabled + 不挂菜单，正对这一条原始观测。

---

### Task 3：`stale` 随回放存活（缺陷③）

**Files:**
- Modify: `packages/contracts/src/agent-event.ts:69`（判别联合的 error 成员，文件中部）
- Modify: `apps/desktop/src/main/agent-service.ts:319-331`（指纹不符 publish）、`:339-343`（锚点不唯一 publish）、`:347-351`（写盘竞态：现状无 publish，裁定 A 新增一条）
- Modify: `apps/desktop/src/renderer/src/utils/timeline.ts:221-240`（`replayProposalStatuses`）
- Test: `packages/contracts/test/agent.test.ts`
- Test: `apps/desktop/src/main/agent-service.test.ts`
- Test: `apps/desktop/src/renderer/src/utils/timeline.test.ts`
- 不动（live 路径保持原样）：`apps/desktop/src/renderer/src/stores/useAgentStore.ts:336-338`（`reduceEvent` 的 error 分支只置 `lastError`）、`:399`（`decide` 的 `result.reason === "stale"` ⇒ `view.status = "stale"`）

**Interfaces:**
- Consumes（逐字抄自接口总表）：
  ```ts
  // packages/contracts/src/agent-event.ts（error 成员）
  z.object({ ...turn, type: z.literal("error"), message: z.string().min(1), proposalId: id.optional() })

  // apps/desktop/src/renderer/src/utils/timeline.ts
  export function replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus>
  // 新增规则：type==="error" 且带 proposalId 且当前值是 "expired" ⇒ 改判 "stale"；其余状态一律不动
  ```
  主进程侧规则（接口总表 `agent-service.ts` 段，逐字）：「带 proposalId 的只有三条：指纹不符 / 锚点不唯一 / writeDoc 撞 stale。permission-denied 与 io 分支**不带**：那两条 pending 没删，提案仍可批准，改判 stale 等于说谎。」
- Produces：`AgentEvent` 的 error 成员多出**可选**字段 `proposalId`（`PROPOSAL_STATUSES` 仍 7、语义不变、`IPC_CHANNELS` 仍 13、无新通道）。后续回放消费方 `replayProposalStatuses`。

- [ ] **Step 1：写失败的测试**

  1a. `packages/contracts/test/agent.test.ts` 末尾追加（复用文件内既有的 `agentEventSchema` import）：
  ```ts
  describe("error 事件的可选 proposalId（缺陷③）", () => {
    const base = { id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1" };

    it("error 带 proposalId 能解析，且解析结果留住该字段", () => {
      const parsed = agentEventSchema.parse({
        ...base,
        type: "error",
        message: "原稿已被改动，没有覆盖。",
        proposalId: "p1"
      });
      if (parsed.type !== "error") throw new Error("error 事件未被解析为 error");
      expect(parsed.proposalId).toBe("p1");
    });

    it("error 不带 proposalId 也能解析（老盘上的历史 error 事件）", () => {
      const parsed = agentEventSchema.parse({
        ...base,
        type: "error",
        message: "模型服务端返回 503：繁忙"
      });
      if (parsed.type !== "error") throw new Error("error 事件未被解析为 error");
      expect(parsed.proposalId).toBeUndefined();
    });
  });
  ```

  1b. `apps/desktop/src/renderer/src/utils/timeline.test.ts` 末尾追加（复用文件内既有的 `event()` 夹具函数与 `replayProposalStatuses` import）：
  ```ts
  describe("replayProposalStatuses 的 stale 改判（缺陷③）", () => {
    it("error 带 proposalId 且该卡当前是 expired ⇒ 改判 stale", () => {
      const events: AgentEvent[] = [
        event("proposal", { proposal: { id: "pStale" } }),
        event("error", { message: "原稿已被改动，没有覆盖。", proposalId: "pStale" })
      ];
      expect(replayProposalStatuses(events)).toEqual({ pStale: "stale" });
    });

    it("已 written 的卡不因后续 error{proposalId} 被改判（守卫：仅 expired 可改）", () => {
      const events: AgentEvent[] = [
        event("proposal", { proposal: { id: "pWrite" } }),
        event("decision", {
          proposalId: "pWrite",
          decision: "accept-once",
          guidance: "",
          auto: false
        }),
        event("written", {
          proposalId: "pWrite",
          docRelPath: "chapters/01.md",
          fingerprint: "b".repeat(64),
          backupRelPath: null
        }),
        event("error", { message: "写入失败：磁盘满", proposalId: "pWrite" })
      ];
      expect(replayProposalStatuses(events)).toEqual({ pWrite: "written" });
    });

    it("error 不带 proposalId：不动任何卡（未配对提案仍是 expired）", () => {
      const events: AgentEvent[] = [
        event("proposal", { proposal: { id: "pOpen" } }),
        event("error", { message: "模型服务端返回 503" })
      ];
      expect(replayProposalStatuses(events)).toEqual({ pOpen: "expired" });
    });
  });
  ```

  1c. `apps/desktop/src/main/agent-service.test.ts`：在既有 `it("提案生成后文件被外部改动 → 批准判 stale，绝不覆盖（反向用例）", ...)`（`:384-397`）里、`if (!result.ok) expect(result.reason).toBe("stale");` 之后补一条发送侧断言（复用文件内 `events()`）：
  ```ts
    expect(events().some((e) => e.type === "error" && e.proposalId === id)).toBe(true);
  ```

  1d. `apps/desktop/src/main/agent-service.test.ts` 追加**写盘竞态**用例（裁定 A 的反向钉：这一支现在静默）。「审批前指纹比对待通过、真正写盘时才发现被改」这条 TOCTOU 分支靠 `mkdtemp` 真目录不好复现，故就地构造一个必定返回 stale 的 book——构造方式照抄 `agent-service-boundary.test.ts:78-109`（同一个 `createBookService()` + `saveMeta({ permissionMode: "full-access" })` + `createAgentService({...})`），只把 `spied.writeDoc` 换成恒定返回：
  ```ts
    const spied: BookService = {
      ...book,
      async writeDoc() {
        return { ok: false, reason: "stale", message: "模拟写盘竞态" };
      }
    };
  ```
  断言（拿到 `pending` 里的提案 id 后调 `decide`）：
  ```ts
    it("写盘竞态返回 stale ⇒ 也发一条带 proposalId 的 error（裁定 A：这一支不再静默）", async () => {
      // ……先跑一轮 sseFetch(writeDocChunks(...)) 生成提案，再 decide(id, "accept-once", "")
      const result = await fixture.service.decide(id, "accept-once", "");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("stale");
      const errs = outbound.filter((o) => o.event.type === "error");
      expect(errs.map((o) => o.event.proposalId)).toContain(id);
      expect(errs.some((o) => o.event.message.includes("又被改动过"))).toBe(true);
    });
  ```
  本用例的 `outbound` 就是就地构造时传进去的 `emit` 收集数组。注意「`pending` 已删 + 无 publish」正是本分支的现状，所以这条断言在 Step 1 必然红。

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

  命令：`corepack pnpm vitest run packages/contracts/test/agent.test.ts apps/desktop/src/renderer/src/utils/timeline.test.ts apps/desktop/src/main/agent-service.test.ts --maxWorkers=4`

  预期红（vitest/esbuild 不做类型检查，运行期字段缺失 ⇒ 断言红，而非编译崩）：
  - `agent.test.ts > error 带 proposalId 能解析，且解析结果留住该字段`：`AssertionError: expected undefined to be 'p1'`（zod 未声明该键 ⇒ 剥掉）。
  - `timeline.test.ts > error 带 proposalId 且该卡当前是 expired ⇒ 改判 stale`：`AssertionError: expected { pStale: 'expired' } to deeply equal { pStale: 'stale' }`（当前 `replayProposalStatuses` 无 error 分支）。
  - `agent-service.test.ts > 提案生成后文件被外部改动 → 批准判 stale`：`AssertionError: expected false to be true`（stale publish 当前不带 proposalId）。
  - `agent-service.test.ts > 写盘竞态返回 stale ⇒ 也发一条带 proposalId 的 error`：`AssertionError: expected [] to include 'id…'`（该分支当前**一条 publish 都没有**，裁定 A 要补的就是它）。
  其余既有用例保持绿。

- [ ] **Step 3：最小实现**

  3a. `packages/contracts/src/agent-event.ts:69`，把 error 成员从：
  ```ts
    z.object({ ...turn, type: z.literal("error"), message: z.string().min(1) })
  ```
  改为（接口总表逐字）：
  ```ts
    z.object({
      ...turn,
      type: z.literal("error"),
      message: z.string().min(1),
      proposalId: id.optional()
    })
  ```

  3b. `apps/desktop/src/main/agent-service.ts`，只给**真正 `pending.delete` 之后**的 stale error publish 带上 `proposalId`（`proposalId` 是 `applyDecision` 的入参，作用域内直接可用）：

  - 指纹不符（`:319-331`：`pending.delete(proposalId)` 在 `:320`，publish 在 `:321-329`），把 publish 的 body 加上 `proposalId`：
    ```ts
        pending.delete(proposalId);
        publish(
          threadKey,
          event({
            type: "error",
            proposalId,
            message:
              `提案之后 ${proposal.docRelPath} 又被改动过，这条建议已失效；` +
              "我没有覆盖你的改动，请让模型基于最新正文重出一条。"
          })
        );
    ```
  - 锚点不唯一（`:339-343`：`pending.delete(proposalId)` 在 `:340`，publish 在 `:341`）：
    ```ts
        pending.delete(proposalId);
        publish(threadKey, event({ type: "error", proposalId, message: applied.message }));
    ```
  - **写盘撞指纹（`:347-351`）—— 裁定 A：这一支现状只有 `pending.delete(proposalId)` + `return`，没有任何 publish**，本波新增一条（不新增通道、不新增写盘路径；它是唯一「pending 已删却对用户不可见」的分支，缺它就等于让第三类失效静默）：
    ```ts
      if (!write.ok) {
        if (write.reason === "stale") {
          pending.delete(proposalId);
          publish(
            threadKey,
            event({
              type: "error",
              proposalId,
              message:
                `写入时 ${proposal.docRelPath} 又被改动过，这条建议已失效；` +
                "我没有覆盖你的改动，请让模型基于最新正文重出一条。"
            })
          );
          return { ok: false, reason: "stale", message: "原稿已被改动，没有覆盖。" };
        }
    ```
    文案与前一支同构（「……又被改动过，这条建议已失效；我没有覆盖你的改动，请让模型基于最新正文重出一条。」），差别只在触发时刻是写盘竞态而非审批前比较。
  - **不动**：permission-denied（`:296-303`，pending 未删）、io 读失败（`:306-316`，pending 未删）、writeDoc 的 io 分支（`:352-354`，pending 未删）。这三条带上 proposalId 就等于谎报失效。

  3c. `apps/desktop/src/renderer/src/utils/timeline.ts:221-240`，在 `replayProposalStatuses` 的 for 循环内、`written` 分支之后追加 error 分支（仅 expired 可改判）：
  ```ts
      if (event.type === "error") {
        // 缺陷③：error{stale} 在盘上没有配对的 decision，回放派生扫描会把这类卡归到 expired（未处理组）。
        // 规则：仅当当前值是 expired 才改判 stale；已 written / cancelled / rejected / failed 一律不动。
        if (event.proposalId !== undefined && status[event.proposalId] === "expired")
          status[event.proposalId] = "stale";
        continue;
      }
  ```
  渲染层 live 路径不动：`useAgentStore.ts:336-338` 的 `reduceEvent` error 分支仍只 `thread.lastError = event.message`；`:399` 的 `decide` 仍靠 `result.reason === "stale"` 把当前卡打成 stale。回放侧 `useAgentStore.ts:511` 调 `replayProposalStatuses`，新规则让重开后已失效卡落在「已失效」而非「未处理」。

- [ ] **Step 4：复跑到绿**

  命令：`corepack pnpm vitest run packages/contracts/test/agent.test.ts packages/contracts/test/contract.test.ts apps/desktop/src/renderer/src/utils/timeline.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/agent-service-boundary.test.ts apps/desktop/src/main/agent-service-load-session.test.ts --maxWorkers=4`
  期望：四条新用例（1a/1b/1c/1d）+ 全部既有 error 夹具用例转绿；`agent.test.ts` 计数 = 原用例 + 2，`timeline.test.ts` = 原 + 3，`agent-service.test.ts` = 原 + 1（1d）。既有不带 proposalId 的 error 夹具（`agent.test.ts:84`、`packages/agent-runtime/test/rollout.test.ts:152`）因字段可选，仍应绿。

- [ ] **Step 5：连带清单**

  全仓 `type: "error"` 构造点逐一核对（可选字段，向后兼容 ⇒ 只列不改的都不必动）：
  `grep -rn 'type:\s*"error"' packages apps --include=*.ts`（直接用 Bash 的 grep，`pnpm exec` 里没有 grep 这个包）
  逐条判定：
  1. `packages/contracts/src/agent-event.ts:69` — 本任务改（加 `proposalId: id.optional()`）。
  2. `apps/desktop/src/main/agent-service.ts:167`（persist 落盘失败的 error emit） — 不带，与提案失效无关。
  3. `:180`（`emitOnly` 未开书/未配置/空输入的 error） — 不带。
  4. `:300`（permission-denied） — **刻意不带**（pending 未删）。
  5. `:311`（io 读失败） — **刻意不带**（pending 未删）。
  6. `:324`（指纹不符） — 本任务带。
  7. `:341`（锚点不唯一） — 本任务带。
  8. `:353`（writeDoc 返回 io） — **刻意不带**（pending 未删）。
  8b. `:347-351`（writeDoc 返回 stale） — 本任务**新增**一条带 proposalId 的 error publish（裁定 A：它是三条「pending 已删」分支里唯一不发消息的那一条）。
  9. `:474`（turn-end 前的收尾 error emit） — 不带。
  10. `packages/agent-runtime/src/tool-loop.ts:93,134,154,197,219` — 这是 agent-runtime **内部** 的 `{ type: "error"; message }` 判别（非 `AgentEvent`），与本契约无关，不动。
  11. 夹具：`packages/contracts/test/agent.test.ts:84`（省略 proposalId，解析仍成功）、`packages/agent-runtime/test/rollout.test.ts:152`（落盘往返夹具，可选字段缺省即可）——不改。

  计数/文档账：
  - `PROPOSAL_STATUSES` 仍 7（`packages/contracts/test/agent.test.ts:263-273` 整表 `toEqual` 不动）。
  - `IPC_CHANNELS` / `RendererApi` 仍 13（本任务不加通道，`renderer-api.test.ts` 两处 13 字面量不动）。
  - 契约变更总表对应行：「`error` 事件字段 += `proposalId?`（可选）」——本任务落地即为该行的收尾。
  - 行号预算：三个改动文件均远离 800 行硬门禁；`agent-service.ts` 净增约 13 行（两支加 `proposalId` 字段 + 裁定 A 新增一支完整 publish）、`timeline.ts` 净增 6 行、`agent-event.ts` 净增约 4 行（把单行 error 成员展成多行）。

- [ ] **Step 6：局部门禁**

  按顺序，不设管道：
  ```
  corepack pnpm prettier --check packages/contracts/src/agent-event.ts apps/desktop/src/main/agent-service.ts apps/desktop/src/renderer/src/utils/timeline.ts packages/contracts/test/agent.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/renderer/src/utils/timeline.test.ts
  corepack pnpm tsc --noEmit -p packages/contracts/tsconfig.json
  corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json
  corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json
  corepack pnpm eslint packages/contracts/src/agent-event.ts apps/desktop/src/main/agent-service.ts apps/desktop/src/renderer/src/utils/timeline.ts packages/contracts/test/agent.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/renderer/src/utils/timeline.test.ts --max-warnings=0
  ```
  期望：prettier 全绿；三个 tsc 项目零诊断（contracts 项目检查新 error 成员与其测试；node 项目检查 agent-service 发送侧 `proposalId` 落进 error body 及 agent-service.test 的 `e.type === "error" && e.proposalId` 窄化；web 项目检查 `timeline.ts` 里 `event.proposalId` 的 `string | undefined` 与 `noUncheckedIndexedAccess` 下的 `status[event.proposalId]` 读取）；eslint 零告警。

- [ ] **Step 7：提交**

  ```
  git add packages/contracts/src/agent-event.ts packages/contracts/test/agent.test.ts apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/renderer/src/utils/timeline.ts apps/desktop/src/renderer/src/utils/timeline.test.ts
  git commit -m "fix(replay): error 事件带可选 proposalId，回放把已失效卡从 expired 改判为 stale"
  ```

- [ ] **Step 8：变异 W3（先提交再变异）**

  落点 `apps/desktop/src/renderer/src/utils/timeline.ts`。用 Edit 去掉 error 分支里的 `=== "expired"` 守卫：
  ```ts
        if (event.proposalId !== undefined && status[event.proposalId] === "expired")
          status[event.proposalId] = "stale";
  ```
  改成（无守卫，任何带 proposalId 的 error 都把卡打成 stale）：
  ```ts
        if (event.proposalId !== undefined) status[event.proposalId] = "stale";
  ```
  单跑：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/timeline.test.ts --maxWorkers=4`
  预期转红原文（第二条「已 written 的卡不因后续 error 改判」正是守卫的反向钉）：
  ```
  FAIL … > 已 written 的卡不因后续 error{proposalId} 被改判（守卫：仅 expired 可改）
  AssertionError: expected { pWrite: 'stale' } to deeply equal { pWrite: 'written' }
  ```
  （第一条改判 stale 仍绿；第三条无 proposalId 仍绿。）
  用 Edit 把守卫改回 → 复跑 `--maxWorkers=4` 回绿 → `git diff --exit-code` 必须干净。

  缺陷对应原文（波 1 报告 `2026-10-02-plan3-wave1-report.md`）：无法归因节留底「附带发现（留底，不在本波修）：`stale` 这个已裁决态**不随回放存活**——盘上有 `error{stale}` 但没有对应的 `decision`，回放派生扫描把这类卡归到「未处理」组而不是「已失效」。这是波 1.5 的账」；留底第 132 行「③ `stale` 不随回放存活」。本任务给已删 pending 的 stale 分支的 error publish 带 `proposalId`、并让回放扫描据此把 expired→stale，正对这一条。

**裁定 A（控制方拍定，执行者不再自行判断）**：接口总表与文件结构原把「writeDoc 撞 stale」（`agent-service.ts:347-351`）列为第三处「带 proposalId 的 stale publish」，但回读代码确认该分支**现状只有 `pending.delete(proposalId)` + `return { ok:false, reason:"stale" }`，没有任何 error publish**。裁定：**采纳「新增一条带 proposalId 的 error publish」**，理由三条——① 它与另两支同属「pending 已删、提案确定失效」，静默等于对用户隐瞒（总 spec「错误可见」）；② 不发的话这条链上的卡在重启后回放成 `expired`（未处理组），与已修的两支行为不一致，缺陷③只闭三分之二；③ 新增的只是既有 `publish(threadKey, event({type:"error",…}))` 形态的一次复用，**不加通道、不加写盘路径、不动 `PROPOSAL_STATUSES`**。落点逐字在 Step 3b 第三小点，反向钉在 Step 1d。

---

### Task 4：输入值上收 store —— F-A 预填前置通路（变异 W4）

把「输入框的值」这件事从组件局部 `ref` 与 `useHotkeys.ts` 的 DOM 写值，上收到 `useAgentStore.composerDrafts`（按 `threadKey` 存的一张顶层 map）。这是附录 F-A 点名的「一条前置缺口，不许糊过去」，也是 `useHotkeys.ts:52-54` 注释里挂进台账的那笔债（durable 方案（composer 草稿进 store））——本任务还这笔债，顺带把「切章不丢字」与「点卡预填一句指令」两条通路的真身铺好。**不动 `ThreadView` 的十字段形状**（波 1 契约对账钉的是 10，见「契约变更总表」）。

**风险（先讲清楚）**：本仓零 jsdom，`useHotkeys.ts` 与所有 `.vue` 无自动化覆盖（vitest `environment: "node"`、include 只收 `.test.ts`）。因此本任务的**判定全部落在纯函数 `prefillText` 与 store 的 `composerDrafts` 读写**，这两处有真单测；「textarea 受控接线、快捷键三支改走 store」的 DOM 通路只能靠 Task 11 真机矩阵兜。故接线改动保守到不能再保守：只换数据源、不改判定，`composerTextAfterQueue(text, accepted)` 的既有调用形状与「先问 store 才回写」的顺序原样保留（评审 X1 的数据丢失修复，不许倒退）。

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/composer-draft.ts`
- Create: `apps/desktop/src/renderer/src/utils/composer-draft.test.ts`
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（`state` 加 `composerDrafts`；`actions` 加 `draftOf`/`setDraft`/`prefillComposer`/`clearDraft`；顶部 import 加 `prefillText`；现 615 行，加完约 640 行，仍 ≤800）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`（在 `describe("useAgentStore")` 内追加草稿四 action 用例；沿用 `agent-store-fixture.ts` 的 `setupAgentFixture()`、`store()`、`CH`、`OTHER`、`openChapter`）
- Modify: `apps/desktop/src/renderer/src/components/ComposerBox.vue`（`:1-16` 改受控 props `modelValue` + emit `update:modelValue`，删组件内 `ref("")` 与 `submit()` 里的 `text.value = ""`；`:25-35` textarea 由 `v-model="text"` 改 `:value` + `@input`；`:55` 发送按钮 disabled 改读 `modelValue`；`data-mochen-composer` 保留）
- Modify: `apps/desktop/src/renderer/src/composables/useHotkeys.ts`（`:52-58` 删 `setComposerText`；`:93-113` 的 submit/newline/queue 三支改走 `agent.draftOf`/`setDraft`/`clearDraft`；`composerTextAfterQueue` 的调用形状与「先问 store 才回写」顺序原样保留）
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue`（`:291-298` 的 ComposerBox 挂载加 `:model-value` 与 `@update:model-value`，`@send` 改调一个先 `agent.send` 再 `agent.clearDraft` 的方法）

**Interfaces:**
- Consumes: 接口总表逐字 ——
  ```ts
  // apps/desktop/src/renderer/src/utils/composer-draft.ts
  export function prefillText(current: string, incoming: string): string
  // current 去空白后非空 ⇒ 原样返回 current（不吞用户已打的字）；否则返回 incoming

  // apps/desktop/src/renderer/src/stores/useAgentStore.ts
  state.composerDrafts: Record<string, string>          // 不进 ThreadView，形状不动
  draftOf(threadKey: string): string                     // 缺省 ""
  setDraft(threadKey: string, value: string): void
  prefillComposer(threadKey: string, value: string): void  // 走 prefillText；被挡时 notice 一句中文
  clearDraft(threadKey: string): void                    // 发送成功后清这一格
  ```
  另消费既有：`threadKeyFor`（`useAgentStore.ts:83`）、`composerTextAfterQueue`（`hotkey-queue.ts:11`）、`COMPOSER_SELECTOR`（`hotkey-markers.ts:17`）。
- Produces: `prefillText`（Task 7「主笔创作」卡的预填动作直接调 `agent.prefillComposer(threadKey, WORKBENCH_PREFILL)`）；store 的 `draftOf/setDraft/prefillComposer/clearDraft` 四个 action 名与形状；`ComposerBox.vue` 的受控 props `modelValue: string` + emit `update:modelValue`（接口总表里 ComposerBox 的 `open-permission-menu`/`open-palette` 两枚 emit 属 Task 9 的 chip 行，本任务不加）。

- [ ] **Step 1：写失败的测试**

新建 `apps/desktop/src/renderer/src/utils/composer-draft.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { prefillText } from "./composer-draft";

/**
 * F-A 前置通路的唯一判定点：预填绝不吞掉用户已经在输入框里打的字。
 * 变异 W4 靶：把实现改成无条件 `return incoming;` ⇒ 第 1/2 条同时转红。
 */
describe("prefillText · 已有草稿时预填不吞字（F-A 前置）", () => {
  it("current 有内容 ⇒ 原样返回 current，incoming 一个字都不进", () => {
    expect(prefillText("我写了一半", "我想改这一章：先读它。")).toBe("我写了一半");
  });

  it("current 前后带空白也算有字 ⇒ 逐字节原样返回（不 trim、不替换）", () => {
    expect(prefillText("   草稿   ", "预填指令")).toBe("   草稿   ");
  });

  it("current 为空串 ⇒ 返回 incoming（预填真正落地）", () => {
    expect(prefillText("", "我想改这一章：先读它。")).toBe("我想改这一章：先读它。");
  });

  it("current 为纯空白 ⇒ 视作空，返回 incoming", () => {
    expect(prefillText("   \n\t ", "预填指令")).toBe("预填指令");
  });

  it("current 空、incoming 也空 ⇒ 返回空串而不是 undefined", () => {
    expect(prefillText("", "")).toBe("");
  });
});
```

在 `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts` 的 `describe("useAgentStore", () => { … })` 收尾前追加：

```ts
  it("草稿上收 store：draftOf 缺省空串，setDraft/draftOf 按 threadKey 各归各", () => {
    expect(store().draftOf(CH)).toBe("");
    store().setDraft(CH, "第一章的草稿");
    store().setDraft(OTHER, "第二章的草稿");
    expect(store().draftOf(CH)).toBe("第一章的草稿");
    expect(store().draftOf(OTHER)).toBe("第二章的草稿");
  });

  it("prefillComposer：空草稿时写入预填，已有字时不覆盖并给中文提示（W4 联动）", () => {
    store().prefillComposer(CH, "我想改这一章：先读它，再给我三处可以动的地方。");
    expect(store().draftOf(CH)).toBe("我想改这一章：先读它，再给我三处可以动的地方。");
    // 已有字 ⇒ 再预填被挡，草稿一字不改，且写一句中文（错误可见，不静默）
    store().prefillComposer(CH, "第二条预填指令");
    expect(store().draftOf(CH)).toBe("我想改这一章：先读它，再给我三处可以动的地方。");
    expect(store().notice).toContain("预填");
  });

  it("clearDraft 只清那一格，别的线程草稿不动", () => {
    store().setDraft(CH, "a 章的字");
    store().setDraft(OTHER, "b 章的字");
    store().clearDraft(CH);
    expect(store().draftOf(CH)).toBe("");
    expect(store().draftOf(OTHER)).toBe("b 章的字");
  });

  it("/clear 清的是历史显示，绝不清掉输入框里还没发出去的草稿", async () => {
    await openChapter();
    store().setDraft(CH, "还没发出去的一句话");
    store().clearThreadView(CH);
    expect(store().draftOf(CH)).toBe("还没发出去的一句话");
  });
```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/composer-draft.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4
```

预期失败原文形状：
- `composer-draft.test.ts`：`Failed to load ./composer-draft` / `Cannot find module` —— 模块尚不存在。
- `useAgentStore.test.ts`：`store().draftOf is not a function`（追加用例的第一条即此，其余三条被首条截断）。

- [ ] **Step 3：最小实现**

新建 `apps/desktop/src/renderer/src/utils/composer-draft.ts`：

```ts
/**
 * F-A 预填的唯一判定：输入框已有内容时绝不覆盖用户正在写的字（附录 §2.7「名字与动作不符也算摆设」的对偶——
 * 预填按钮按下去不能把人已打的字吞掉）。判定只这一处，store 与工作台卡都调它，不各写一份三元链（铁律 6）。
 * 语义按码点无关：只做「去空白后是否非空」的判断，返回原串，不 trim、不改写。
 */
export function prefillText(current: string, incoming: string): string {
  return current.trim() === "" ? incoming : current;
}
```

`apps/desktop/src/renderer/src/stores/useAgentStore.ts` 顶部 import 追加一行（`../utils/timeline` 同层）：

```ts
import { prefillText } from "../utils/composer-draft";
```

`state`（`:208-216`）里 `hydrateInflight` 之后加一格：

```ts
    /** 输入框的值上收到的顶层 map（设计决定 3）：键是 threadKey，不进 ThreadView，切章不丢字。 */
    composerDrafts: {} as Record<string, string>
```

`actions` 里 `viewOf`（`:244-249`）之后加四个 action：

```ts
    /** 读某一格输入框的当前值；缺省空串（老状态从未写过草稿）。 */
    draftOf(threadKey: string): string {
      return this.composerDrafts[threadKey] ?? "";
    },

    setDraft(threadKey: string, value: string): void {
      this.composerDrafts[threadKey] = value;
    },

    /**
     * F-A 预填唯一入口：判定在 prefillText（一处实现），这里只负责「被挡时写一句中文」。
     * 被挡 = 已有非空草稿、预填没进去（prefillText 原样还回 current）。
     */
    prefillComposer(threadKey: string, value: string): void {
      const current = this.draftOf(threadKey);
      const next = prefillText(current, value);
      this.composerDrafts[threadKey] = next;
      if (next === current && current.trim() !== "")
        this.notice = "输入框里已经有内容，预填没有覆盖你正在写的字。";
    },

    /** 发送成功后清这一格（残留会把上一句带进下一次输入）。 */
    clearDraft(threadKey: string): void {
      delete this.composerDrafts[threadKey];
    },
```

`apps/desktop/src/renderer/src/components/ComposerBox.vue` 整文件替换为受控版（`open-permission-menu`/`open-palette` 两枚 emit 留待 Task 9）：

```vue
<!-- 输入区：发送 / 打断 / 断流后续写。这里不含业务判断，一切交给 store；输入值本身也由 store 持有（F-A 前置）。 -->
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  running: boolean;
  ready: boolean;
  canContinue: boolean;
  modelValue: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [text: string];
  stop: [];
  resume: [];
}>();

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

// 发送只抛事件，清格由装配处（CenterColumn）负责：那里才是「发出去 = 清这一格」的唯一收口。
function submit(): void {
  const value = props.modelValue.trim();
  if (value === "") return;
  emit("send", value);
}

// 回车提交 / Shift+Enter 与 Ctrl+J 换行 / 运行中 Tab 排队全在 utils/hotkeys + composables/useHotkeys 判定，
// 值经 store 的 composerDrafts 与本 textarea 同源（受控 :value + @input），不再有第二份监听（裁定 G5）。
</script>

<template>
  <footer class="agent-composer">
    <textarea
      :value="modelValue"
      data-mochen-composer
      class="composer-box"
      rows="3"
      :placeholder="
        ready
          ? '想改哪一段？说给人话，别贴整篇正文——它会自己读文件。'
          : '先在左栏打开作品，或在右上角设置里配好模型。'
      "
      @input="onInput"
    />
    <div class="composer-actions">
      <span class="composer-hint">Enter 发送 · Shift+Enter 换行 · Esc 打断</span>
      <button v-if="running" class="composer-stop" type="button" @click="emit('stop')">
        <AppIcon name="stop" :size="14" />
        <span>打断</span>
      </button>
      <button
        v-if="canContinue && !running"
        class="composer-resume"
        type="button"
        title="接着上一轮未写完的地方继续（残字已经在对话里）"
        @click="emit('resume')"
      >
        <AppIcon name="redo" :size="14" />
        <span>继续</span>
      </button>
      <button
        class="composer-send"
        type="button"
        :disabled="running || modelValue.trim() === ''"
        @click="submit()"
      >
        <AppIcon name="arrow-up" :size="15" />
        <span>发送</span>
      </button>
    </div>
  </footer>
</template>
```

`apps/desktop/src/renderer/src/composables/useHotkeys.ts`：删除 `:52-58` 整个 `setComposerText` 函数与其上方那条台账注释块；把 `dispatch` 里 `:93-113` 的三支改成走 store（保留 `composerTextAfterQueue` 调用与「先问 store 才回写」顺序）：

```ts
    if (action === "submit" || action === "newline" || action === "queue") {
      // 输入值的真身在 store.composerDrafts（F-A 前置）：不再读/写 textarea 的 DOM value，
      // 也就不再需要 setComposerText 的「写值 + 补发 input」脆弱同步（原 :52-58 台账债在此还清）。
      const key = threadKeyFor(book.activeDocTab);
      const text = agent.draftOf(key);
      if (action === "newline") {
        event.preventDefault();
        agent.setDraft(key, `${text}\n`);
        return;
      }
      if (text.trim() === "") return;
      event.preventDefault();
      if (action === "submit") {
        agent.send(text.trim());
        agent.clearDraft(key);
        return;
      }
      // 评审 X1（数据丢失）：先问 store，拿到 accepted 才决定回写——队列满时 queueText 那句中文
      // 要用户重发的就是这些字，先清空等于把提示要保的字删了。回写值仍出自 utils/hotkey-queue。
      const accepted = agent.queueText(key, text);
      agent.setDraft(key, composerTextAfterQueue(text, accepted));
      return;
    }
```

> `onKey` 里 `targets.composer`（`document.querySelector(COMPOSER_SELECTOR)`）与 `sources.composer` 保留不动：焦点判定（`hotkey-focus.ts` 的 `composerHasText`/`composerIsFocused`）仍要读这枚 textarea 与它的 `data-mochen-composer` 标记。本改动只停止「用 DOM 当输入值真身」，不改「用 DOM 判焦点」。`import { composerTextAfterQueue } from "../utils/hotkey-queue";`（`:8`）保留。

`apps/desktop/src/renderer/src/components/CenterColumn.vue` 的 ComposerBox 挂载（`:291-298`）改为：

```html
    <ComposerBox
      :running="running"
      :ready="ready"
      :can-continue="agent.canContinue(threadKey)"
      :model-value="agent.draftOf(threadKey)"
      @update:model-value="agent.setDraft(threadKey, $event)"
      @send="onComposerSend"
      @stop="agent.stop()"
      @resume="agent.continueTurn()"
    />
```

`CenterColumn.vue` `<script setup>` 里加一个方法（就近放在其它 handler 定义处）：

```ts
/** 发送 = 投递这一轮 + 清掉这一格草稿（值已进对话流，留着会把上一句带进下一次输入）。 */
function onComposerSend(text: string): void {
  agent.send(text);
  agent.clearDraft(threadKey.value);
}
```

- [ ] **Step 4：复跑到绿**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/composer-draft.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4
```

预期：`composer-draft.test.ts` 5 passed；`useAgentStore.test.ts` 在既有用例数之上 +4 passed（新增四条全绿），无 failed。

- [ ] **Step 5：连带清单**

1. `ThreadView` 十字段形状未动：`grep -n "hydrated:\|hydrating:\|queued:" apps/desktop/src/renderer/src/stores/useAgentStore.ts` —— `newThread()`（`:67-80`）仍只那 10 个字段，`composerDrafts` 是 state 顶层格、不在 `ThreadView` 上。
2. `data-mochen-composer` 保留：`grep -n "data-mochen-composer" apps/desktop/src/renderer/src/components/ComposerBox.vue` —— 命中一行；`hotkey-markers.ts:10` 的 `COMPOSER_MARKER` 与 `hotkey-markers.test.ts` 的源码契约用例不转红（焦点判定仍吃这个标记）。
3. `setComposerText` 已消失：`grep -rn "setComposerText" apps/desktop/src/renderer/src` —— 期望无输出（0 命中）。
4. `composerTextAfterQueue` 仍被引用：`grep -n "composerTextAfterQueue" apps/desktop/src/renderer/src/composables/useHotkeys.ts` —— import 行 + queue 支调用行各一次，形状 `composerTextAfterQueue(text, accepted)` 未改。
5. `hotkey-queue.test.ts` 不受影响（本任务没碰它）：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/hotkey-queue.test.ts --maxWorkers=4` —— 4 passed。
6. IPC 计数不动：`grep -n "toBe(13)" apps/desktop/src/preload/renderer-api.test.ts` —— 仍命中（本任务不加通道，`RendererApi` 方法数保持 13）。
7. 行数预算：`wc -l apps/desktop/src/renderer/src/stores/useAgentStore.ts` —— 期望 ≤700（若逼近 700，按计划「文件结构」末段把草稿四 action 拆到 `stores/useComposerDraftStore.ts`，届时接口总表 `agent.draftOf` 等改指该 store；本任务实测约 640 行，不拆）。

- [ ] **Step 6：局部门禁**（顺序：prettier → 相关 tsc 项目 → eslint 点名文件；命令后面一律不接管道）

```
corepack pnpm exec prettier --check apps/desktop/src/renderer/src/utils/composer-draft.ts apps/desktop/src/renderer/src/utils/composer-draft.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/composables/useHotkeys.ts apps/desktop/src/renderer/src/components/CenterColumn.vue
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm exec eslint apps/desktop/src/renderer/src/utils/composer-draft.ts apps/desktop/src/renderer/src/utils/composer-draft.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/composables/useHotkeys.ts apps/desktop/src/renderer/src/components/CenterColumn.vue --max-warnings=0
```

预期：prettier 全 `All matched files use Prettier code style!`；tsc 退出码 0 无输出；eslint 退出码 0 无告警。若 prettier 报某文件不符，先 `corepack pnpm exec prettier --write <该文件>` 再复跑 `--check`。

- [ ] **Step 7：提交**

```
git add apps/desktop/src/renderer/src/utils/composer-draft.ts apps/desktop/src/renderer/src/utils/composer-draft.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/composables/useHotkeys.ts apps/desktop/src/renderer/src/components/CenterColumn.vue
git commit -m "$(cat <<'EOF'
feat(renderer): 输入框草稿上收 useAgentStore，预填通路落地并删掉 DOM 写值

F-A 前置：composerDrafts 按 threadKey 存进 store，ComposerBox 改受控，
快捷键 submit/newline/queue 三支改走 store，还清 setComposerText 的补发 input 台账债。
保留 composerTextAfterQueue 的先问后写顺序（评审 X1）与 data-mochen-composer 焦点标记。
EOF
)"
```

- [ ] **Step 8：变异 W4（先提交再变异）**

用 `Edit` 把 `apps/desktop/src/renderer/src/utils/composer-draft.ts` 的实现行
`  return current.trim() === "" ? incoming : current;`
改成
`  return incoming;`
（即「无条件覆盖」，正是 F-A 要防的吞字行为）。然后单跑：

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/composer-draft.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4
```

预期红原文形状：
- `prefillText · 已有草稿时预填不吞字` 里的「current 有内容 ⇒ 原样返回」：`expected "我想改这一章：先读它，再给我三处可以动的地方。" to be "我写了一半"`。
- `prefillComposer：… 已有字时不覆盖并给中文提示`：草稿被覆盖成第二条 ⇒ `expected "第二条预填指令" to be "我想改这一章…"`，且 `notice` 不含「预填」。

改回原实现（`Edit` 复原为 `return current.trim() === "" ? incoming : current;`），复跑到绿：

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/composer-draft.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4
```

确认工作区干净：`git diff --exit-code` —— 退出码 0，无输出。

---

### Task 5：`DocRef.excerpt` —— 扫描顺路带第一段（变异 W5）

给 `packages/contracts/src/book.ts` 的 `DocRef` 加**可选** `excerpt?: string`（它是 `interface` 不是 zod schema），由 `packages/fs-store/src/scan.ts` 在**已有那次** `readFile` + `parseFrontmatter` 之上顺手取第一段纯文本（≤80 码点）。这是附录 F-B 的 (b) 案：现读每篇正文再截断要发 N 次读盘、否掉；改成扫描顺路带出。硬约束：**不加盘 IO**——现状 `titleOf()` 对每个 `.md` 已经 `readFile` 一次（`scan.ts:50-60`），换成 `docMetaOf()` 一次读取同时得 `{ title, excerpt }`，读盘次数一字不减一字不加，本任务用桩计数把这条钉死。本任务只加可选字段，`book.json` `schemaVersion` 保持 1，IPC 计数不动（13）。

**跨 IPC 消费口径**：`excerpt` 可选 ⇒ 老夹具与假 fs（`agent-store-fixture.ts:42-46`、`useBookStore.test.ts:25-29` 的 `docs` 都没有 `excerpt`）会给 `undefined`，消费处一律 `?? ""`，不把缺字段当异常。本任务无渲染层消费者（第一个读 `excerpt` 的是 Task 6 的 `BookDossier.vue`，那里落实 `?? ""`）；本任务侧的证据是「真扫描产出的 `excerpt` 恒为字符串（含空正文 ⇒ `""`）」，从而 `?? ""` 只兜老夹具而不是掩盖新缺陷。

**Files:**
- Modify: `packages/contracts/src/book.ts`（`:22-26` `DocRef` 加 `excerpt?: string`）
- Modify: `packages/fs-store/src/scan.ts`（`:40` 的 `titleOf` 调用与 `:50-60` 的 `titleOf` 函数换成 `docMetaOf`；内部加纯辅助 `excerptOf`/`firstParagraph`/`plainTextFromMarkdown`/`clipCodePoints`；导出不新增——`scanBook`/`sortChapters`/`DOC_DIRS` 形状不变）
- Test: `packages/fs-store/test/scan-excerpt.test.ts`（新建；`scan.test.ts` 现有用例一字不动）

**Interfaces:**
- Consumes: 接口总表逐字 ——
  ```ts
  // packages/contracts/src/book.ts
  export interface DocRef { relPath: string; kind: BookKind; title: string; excerpt?: string }

  // packages/fs-store/src/scan.ts（内部改造，导出不新增）
  // 消费方拿到的 DocRef 可能没有 excerpt（老夹具、假 fs），一律 `?? ""`
  ```
  消费 `parseFrontmatter(raw): { data, body }`（`frontmatter.ts:6`，确认返回 `body`）、`readFile`（`scan.ts:1`）。
- Produces: `DocRef.excerpt?: string` —— Task 6 的 `BookDossier.vue` 用 `doc.excerpt ?? ""` 渲染摘要卡；Task 7 的工作台不读它。

- [ ] **Step 1：写失败的测试**

新建 `packages/fs-store/test/scan-excerpt.test.ts`。用 `vi.mock` 把 `node:fs/promises` 的 `readFile` 包成「转发真实实现的 spy」，既真读盘又数得着次数——这条就是「不加盘 IO」的直接证据：

```ts
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { scanBook } from "../src/scan.js";

// readFile 换成「转发真实实现」的 spy：仍然真读盘（下面的正文断言靠它），同时可数调用次数证明没多加一次 IO。
// 其余导出（readdir/mkdtemp…）用 importOriginal 原样透出，readFile 用 as 保持重载签名，避免 tsc 在 test 目录报类型不符。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) as typeof actual.readFile };
});
const readFileMock = readFile as unknown as Mock;

let root = "";
/** 按 relPath 取扫描结果里那一篇。 */
function find(docs: DocRef[], relPath: string): DocRef {
  const hit = docs.find((doc) => doc.relPath === relPath);
  if (!hit) throw new Error(`扫描结果里没有 ${relPath}`);
  return hit;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-excerpt-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, "chapters", "正常.md"), "夜色沉下去，海雾从崖底涌上来。\n");
  await writeFile(path.join(root, "chapters", "仅元数据.md"), "---\ntitle: 只有一行元数据\n---\n\n");
  await writeFile(path.join(root, "chapters", "超长.md"), `${"深渊之下海雾翻涌".repeat(20)}\n`);
  await writeFile(
    path.join(root, "chapters", "带记号.md"),
    "---\ntitle: 意象\n---\n# 世界观\n\n海是**深蓝**的，雾*很*浓。\n"
  );
  await writeFile(
    path.join(root, "chapters", "表情符.md"),
    `${"字".repeat(79)}\u{1F409}尾巴\n`
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanBook · excerpt 顺路带出第一段", () => {
  it("正常段落 ⇒ 带出第一段纯文本（变异 W5 靶）", async () => {
    const docs = await scanBook(root);
    expect(find(docs, "chapters/正常.md").excerpt).toBe("夜色沉下去，海雾从崖底涌上来。");
  });

  it("只有 frontmatter、正文为空 ⇒ excerpt 是空串而不是 undefined", async () => {
    const docs = await scanBook(root);
    expect(find(docs, "chapters/仅元数据.md").excerpt).toBe("");
  });

  it("markdown 记号与标题行被剥掉，只留正文", async () => {
    const docs = await scanBook(root);
    expect(find(docs, "chapters/带记号.md").excerpt).toBe("海是深蓝的，雾很浓。");
  });

  it("超长段落按码点截 80 并在末尾加一个省略号", async () => {
    const docs = await scanBook(root);
    const excerpt = find(docs, "chapters/超长.md").excerpt ?? "";
    expect(excerpt).toBe(`${"深渊之下海雾翻涌".repeat(10)}…`);
    expect(Array.from(excerpt).length).toBe(81); // 80 码点 + 1 省略号
  });

  it("截断按码点不按 UTF-16 码元：代理对要么整留要么整去", async () => {
    const docs = await scanBook(root);
    const excerpt = find(docs, "chapters/表情符.md").excerpt ?? "";
    // 前 79 个「字」+ 1 枚龙 emoji（代理对）正好占满 80 码点，再加省略号。
    expect(excerpt).toBe(`${"字".repeat(79)}\u{1F409}…`);
    // 反向保护：绝不留孤立高代理（slice(0,80) 按码元切就会劈开 emoji，留下半个代理对）。
    expect(excerpt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("不加盘 IO：readFile 次数恰等于扫出的文稿数（titleOf→docMetaOf 一次读取）", async () => {
    readFileMock.mockClear();
    const docs = await scanBook(root);
    expect(docs.length).toBe(5);
    expect(readFileMock.mock.calls.length).toBe(docs.length); // 若多读一次会变成 10 ⇒ 红
  });
});
```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

```
corepack pnpm vitest run packages/fs-store/test/scan-excerpt.test.ts --maxWorkers=4
```

预期失败原文形状（`DocRef` 尚无 `excerpt`、`scan.ts` 未产出，故真扫描回来该字段是 `undefined`）：
- 「正常段落…」：`expected undefined to be '夜色沉下去，海雾从崖底涌上来。'`。
- 「不加盘 IO…」这一条**此刻是绿的**（现状 `titleOf` 本就读一次），它是回归护栏不是驱动红的用例——红由前四条驱动即可。

- [ ] **Step 3：最小实现**

`packages/contracts/src/book.ts` 的 `DocRef`（`:22-26`）加可选字段：

```ts
export interface DocRef {
  relPath: string;
  kind: BookKind;
  title: string;
  /** 正文第一段纯文本（≤80 码点），由 scan 顺路带出；跨 IPC 消费处一律 `?? ""`。 */
  excerpt?: string;
}
```

`packages/fs-store/src/scan.ts`：把 `walk` 里 `:40` 的一行改为一次读取同时得 title+excerpt：

```ts
    const meta = await docMetaOf(full, rel);
    out.push({ relPath: rel, kind, title: meta.title, excerpt: meta.excerpt });
```

把 `:50-60` 的 `titleOf` 整体换成 `docMetaOf` 加四个内部纯辅助（模块内私有，不新增对外导出；`excerptOf` 起的都是纯字符串运算）：

```ts
/** 摘录正文按码点截这么长，超出加一个省略号（与 timeline.ts 的 Array.from 同律：按码点不按 UTF-16 码元）。 */
const EXCERPT_MAX = 80;

async function docMetaOf(
  full: string,
  rel: string
): Promise<{ title: string; excerpt: string }> {
  const base = path.basename(rel, ".md");
  const fallback = (base.match(/^\d*[-_]?(.*)$/)?.[1] ?? "").trim() || rel;
  try {
    // 只读这一次：frontmatter 出 title，body 出 excerpt，与旧 titleOf 的 readFile 次数完全一致。
    const { data, body } = parseFrontmatter(await readFile(full, "utf8"));
    const raw = data.title;
    const title = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
    return { title, excerpt: excerptOf(body) };
  } catch {
    return { title: fallback, excerpt: "" };
  }
}

/** 取正文里第一段非空的纯文本，按码点截断；整篇空（或只有 frontmatter）⇒ 空串。 */
function excerptOf(body: string): string {
  for (const paragraph of body.split(/\r?\n[ \t]*\r?\n/)) {
    const text = plainTextFromMarkdown(paragraph);
    if (text !== "") return clipCodePoints(text, EXCERPT_MAX);
  }
  return "";
}

/**
 * 剥 markdown 记号：标题行整行丢弃，其余行去图片/链接壳、去强调与行内代码记号、去引用与列表前缀，
 * 再把行内空白折叠成单个空格。刻意保守——只做「让第一段可读」，不追求还原语义。
 */
function plainTextFromMarkdown(paragraph: string): string {
  const kept: string[] = [];
  for (const raw of paragraph.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^#{1,6}\s/.test(line)) continue; // 标题行：整行丢
    const text = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片 → alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 文本
      .replace(/^>\s?/, "") // 引用前缀
      .replace(/^[-+*]\s+/, "") // 无序列表前缀
      .replace(/^\d+[.)]\s+/, "") // 有序列表前缀
      .replace(/[*_~`]+/g, "") // 强调 / 删除线 / 行内代码记号
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") kept.push(text);
  }
  return kept.join(" ");
}

/** 按码点（不是 UTF-16 码元）截断，超出加省略号；代理对要么整留要么整去。 */
function clipCodePoints(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}
```

- [ ] **Step 4：复跑到绿**

```
corepack pnpm vitest run packages/fs-store/test/scan-excerpt.test.ts packages/fs-store/test/scan.test.ts --maxWorkers=4
```

预期：`scan-excerpt.test.ts` 6 passed；`scan.test.ts` 现有 6 passed（含 `sortChapters`）不回归；无 failed。

- [ ] **Step 5：连带清单**

1. 导出一字未增：`grep -n "^export" packages/fs-store/src/scan.ts` —— 仍只有 `DOC_DIRS`、`scanBook`、`sortChapters` 三个（`docMetaOf`/`excerptOf` 等都是模块私有）。
2. 消费方 `?? ""` 落点核对：`grep -rn "\.excerpt" apps/desktop/src/renderer/src` —— 本任务后仍为 0（Task 6 才引入 `BookDossier.vue` 的 `doc.excerpt ?? ""`），确认本任务没在渲染层留裸读字段。
3. 假 fs / 老夹具不给 `excerpt` 仍能过类型：`grep -n "relPath:.*kind:.*title:" apps/desktop/src/renderer/src/stores/agent-store-fixture.ts` —— 命中（`docs` 里没有 `excerpt`），因为字段可选，`satisfies RendererApi` 不报错。
4. IPC 计数与 schemaVersion 不动：`grep -rn "schemaVersion: z.literal(1)\|schemaVersion: 1" packages/contracts/src/book.ts` —— `bookMetaSchema` 仍锁 1；`toBe(13)` 那条（见 Task 4 Step 5）不受影响。
5. `packages/contracts` 现有用例不回归：`corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4` —— 全绿（`DocRef` 非 zod、`bookMetaSchema` 不含 DocRef，加可选字段不触任何解析）。

- [ ] **Step 6：局部门禁**（顺序：prettier → 相关 tsc 项目 → eslint 点名文件；命令后面一律不接管道）

```
corepack pnpm exec prettier --check packages/contracts/src/book.ts packages/fs-store/src/scan.ts packages/fs-store/test/scan-excerpt.test.ts
corepack pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json
corepack pnpm exec tsc --noEmit -p packages/fs-store/tsconfig.json
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm exec eslint packages/contracts/src/book.ts packages/fs-store/src/scan.ts packages/fs-store/test/scan-excerpt.test.ts --max-warnings=0
```

预期：prettier 全 `All matched files use Prettier code style!`；三条 tsc 均退出码 0 无输出（web 项目重编以确认 `DocRef` 变更后渲染层无未兜住的裸读）；eslint 退出码 0。不符先 `corepack pnpm exec prettier --write <该文件>` 再复跑 `--check`。

- [ ] **Step 7：提交**

```
git add packages/contracts/src/book.ts packages/fs-store/src/scan.ts packages/fs-store/test/scan-excerpt.test.ts
git commit -m "$(cat <<'EOF'
feat(fs-store): 扫描顺路带出第一段摘录，DocRef 加可选 excerpt

titleOf 换成 docMetaOf：同一次 readFile + parseFrontmatter 同时得出 title 与 excerpt，
读盘次数不变（scan-excerpt.test.ts 用 spy 计数钉死）。excerpt 取正文第一段纯文本、
剥 markdown 记号与标题行、按码点截 80 加省略号，空正文给空串。字段可选，消费处一律 ?? ""。
EOF
)"
```

- [ ] **Step 8：变异 W5（先提交再变异）**

用 `Edit` 把 `packages/fs-store/src/scan.ts` 里 `docMetaOf` 成功分支的返回行
`    return { title, excerpt: excerptOf(body) };`
改成
`    return { title, excerpt: "" };`
（即「excerpt 永远空」，正是 W5 定义的变异）。单跑：

```
corepack pnpm vitest run packages/fs-store/test/scan-excerpt.test.ts --maxWorkers=4
```

预期红原文形状：
- 「正常段落…」：`expected '' to be '夜色沉下去，海雾从崖底涌上来。'`。
- 「markdown 记号…」：`expected '' to be '海是深蓝的，雾很浓。'`。
- 「超长…」「表情符…」：`expected '' to be '深渊……'` / `expected '' to be '字…🐉…'`。
- 「只有 frontmatter…⇒ 空串」仍绿（空串本就对），「不加盘 IO…」仍绿——被驱动红的是内容四条。

改回（`Edit` 复原为 `return { title, excerpt: excerptOf(body) };`），复跑到绿：

```
corepack pnpm vitest run packages/fs-store/test/scan-excerpt.test.ts --maxWorkers=4
```

确认工作区干净：`git diff --exit-code` —— 退出码 0，无输出。

---

### Task 6：右栏第三页签「作品资料」—— F-B 界面面（变异 W6）

在右栏「文稿 / 浏览」两页签之外加第三格**「作品资料」**，内容区抽成新组件 `BookDossier.vue`：小说信息摘要 + 按 `BookKind` 分组的文档摘要卡（标题 + `doc.excerpt ?? ""`）。数据全用现成的 `book.meta` 与 `book.docs`，**不新增 IPC 通道**。分组标签与顺序从 `LeftSidebar.vue:14-22` 的现状抽成唯一实现 `utils/book-kinds.ts`，左栏改读它（铁律 6：一份实现，两视图同表）。`rightPaneMode` 联合类型加 `"dossier"`，action `openDossier()` **只改 mode，绝不动 `docTabs`/`activeDocTab`/`draft`/`dirty`**（浏览侧已有的隔离纪律在这里同样成立，给反向用例）。

**术语硬约束（Plan 3 spec §2 第 6 条 / 附录 §2 第 6 条）**：UI 上的「档案」永远只指 agent profile（波 2 的六档案）；右栏这一格定名**「作品资料」**，页签名与所有文案一律用「作品资料」，**不许出现「档案」二字指代这一格**。

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/book-kinds.ts` + `apps/desktop/src/renderer/src/utils/book-kinds.test.ts`
- Create: `apps/desktop/src/renderer/src/utils/book-dossier.ts` + `apps/desktop/src/renderer/src/utils/book-dossier.test.ts`
- Create: `apps/desktop/src/renderer/src/components/BookDossier.vue`
- Modify: `apps/desktop/src/renderer/src/components/LeftSidebar.vue`（`:14-22` 删本地 `KIND_META`/`SECTION_ORDER`，标签/顺序改读 `utils/book-kinds`，图标留组件内）
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.ts`（`:41` `rightPaneMode` 加 `"dossier"`；`actions` 加 `openDossier()`；现 282 行）
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.test.ts`（`describe("useBookStore")` 追加三态往返反向用例）
- Modify: `apps/desktop/src/renderer/src/components/DocumentPane.vue`（`view-tabs` 加第三格页签、`editor-document` 加 dossier 分支；现 197 行，预算 ≤220）

**Interfaces:**
- Consumes: 接口总表逐字 ——
  ```ts
  // apps/desktop/src/renderer/src/utils/book-kinds.ts
  export const BOOK_KIND_ORDER: BookKind[]        // ["chapter","outline","character","plot","material"]
  export const BOOK_KIND_LABELS: Record<BookKind, string>   // 逐字取 LeftSidebar.vue:14-20 现有标签

  // apps/desktop/src/renderer/src/utils/book-dossier.ts
  export interface DossierGroup { kind: BookKind; label: string; docs: DocRef[] }
  export function groupDocsForDossier(docs: DocRef[]): DossierGroup[]     // 空组不出现
  export interface DossierSummary { title: string; stageName: string; permissionLabel: string; chapterCount: number }
  export function dossierSummary(meta: BookMeta | null, docs: DocRef[]): DossierSummary | null

  // apps/desktop/src/renderer/src/stores/useBookStore.ts
  rightPaneMode: "manuscript" | "browse" | "dossier"
  openDossier(): void                                    // 只改 mode，绝不动 docTabs / activeDocTab / draft / dirty

  // apps/desktop/src/renderer/src/components/BookDossier.vue
  BookDossier.vue     props: { summary: DossierSummary | null; groups: DossierGroup[] }
  ```
  消费 `BookKind`/`BookMeta`/`DocRef`/`PERMISSION_LABELS`（`@mochen/contracts`）、Task 5 的 `DocRef.excerpt?`。
- Produces: `BOOK_KIND_ORDER`/`BOOK_KIND_LABELS`（左栏与本任务 dossier 共读；后续任何按 kind 分组的 UI 都读它，不再手抄）；`groupDocsForDossier`/`dossierSummary`/`DossierGroup`/`DossierSummary`；`useBookStore.openDossier`/`rightPaneMode: "dossier"`；`BookDossier.vue` 组件（DocumentPane 挂载）。

- [ ] **Step 1：写失败的测试**

新建 `apps/desktop/src/renderer/src/utils/book-kinds.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { BOOK_KINDS, type BookKind } from "@mochen/contracts";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "./book-kinds";

describe("book-kinds · 唯一一份 kind 顺序与中文标签", () => {
  it("标签键与 BOOK_KINDS 完全一致（铁律 6：穷尽键，加一类不写标签就编译/测试双红）", () => {
    expect(Object.keys(BOOK_KIND_LABELS).sort()).toEqual([...BOOK_KINDS].sort());
  });

  it("顺序与中文标签逐字钉死自左栏现状", () => {
    expect(BOOK_KIND_ORDER).toEqual(["chapter", "outline", "character", "plot", "material"]);
    expect(BOOK_KIND_LABELS).toEqual({
      chapter: "章节",
      outline: "大纲",
      character: "人物",
      plot: "剧情",
      material: "素材库"
    });
  });

  it("每个顺序项都在标签表里有对应中文（不留空标签）", () => {
    for (const kind of BOOK_KIND_ORDER) expect(BOOK_KIND_LABELS[kind as BookKind]).toBeTruthy();
  });
});
```

新建 `apps/desktop/src/renderer/src/utils/book-dossier.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS, type BookMeta, type DocRef } from "@mochen/contracts";
import { dossierSummary, groupDocsForDossier } from "./book-dossier";

const meta: BookMeta = {
  id: "b1",
  title: "深渊之下",
  schemaVersion: 1,
  stages: [
    { id: "draft", name: "正文" },
    { id: "revise", name: "修订" }
  ],
  activeStage: "draft",
  permissionMode: "chapter-write",
  chapterOrder: ["chapters/01.md", "chapters/02.md"]
};

function doc(relPath: string, kind: DocRef["kind"], title: string): DocRef {
  return { relPath, kind, title };
}

describe("groupDocsForDossier · 空组不出现", () => {
  it("五类里只出现的两类按固定顺序归组，缺的类绝不冒出来（W6 靶）", () => {
    const groups = groupDocsForDossier([
      doc("chapters/01.md", "chapter", "第一章"),
      doc("outline/a.md", "outline", "大纲A")
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["chapter", "outline"]);
  });

  it("没有人物文档时绝不出现人物组", () => {
    const groups = groupDocsForDossier([doc("chapters/01.md", "chapter", "第一章")]);
    expect(groups.some((g) => g.kind === "character")).toBe(false);
  });

  it("标签取自 book-kinds 唯一表", () => {
    const groups = groupDocsForDossier([doc("characters/李深.md", "character", "李深")]);
    expect(groups[0]?.label).toBe("人物");
  });

  it("同组内多篇按传入顺序收齐", () => {
    const groups = groupDocsForDossier([
      doc("chapters/01.md", "chapter", "一"),
      doc("chapters/02.md", "chapter", "二")
    ]);
    expect(groups[0]?.docs.map((d) => d.relPath)).toEqual(["chapters/01.md", "chapters/02.md"]);
  });

  it("空数组 ⇒ 零组（一张卡都不出）", () => {
    expect(groupDocsForDossier([])).toEqual([]);
  });
});

describe("dossierSummary", () => {
  it("没开书（meta 为 null）⇒ null，不捏造任何字段", () => {
    expect(dossierSummary(null, [])).toBeNull();
  });

  it("章节数只数 chapter，档位取 PERMISSION_LABELS，阶段取活动阶段名", () => {
    const summary = dossierSummary(meta, [
      doc("chapters/01.md", "chapter", "一"),
      doc("chapters/02.md", "chapter", "二"),
      doc("materials/雾.md", "material", "雾")
    ]);
    expect(summary?.chapterCount).toBe(2);
    expect(summary?.permissionLabel).toBe(PERMISSION_LABELS["chapter-write"]);
    expect(summary?.stageName).toBe("正文");
    expect(summary?.title).toBe("深渊之下");
  });
});
```

在 `apps/desktop/src/renderer/src/stores/useBookStore.test.ts` 的 `describe("useBookStore", () => { … })` 收尾前追加（`saveMeta` 已在文件顶层 `:44` 定义）：

```ts
  it("openDossier 只把右栏切到作品资料，文稿标签/活动章/草稿/脏位一字不动", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("还没保存的一段\n");
    saveMeta.mockClear();
    const draftBefore = store.draft;
    store.openDossier();
    expect(store.rightPaneMode).toBe("dossier");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe(draftBefore);
    expect(store.dirty).toBe(true);
    expect(saveMeta).not.toHaveBeenCalled();
  });

  it("从作品资料切回文稿/浏览是三态往返，标签与草稿仍不受影响", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.openDossier();
    store.rightPaneMode = "manuscript";
    expect(store.rightPaneMode).toBe("manuscript");
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe("正文\n");
  });
```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/book-kinds.test.ts apps/desktop/src/renderer/src/utils/book-dossier.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4
```

预期失败原文形状：
- `book-kinds.test.ts` / `book-dossier.test.ts`：`Cannot find module './book-kinds'`、`Cannot find module './book-dossier'` —— 模块尚不存在。
- `useBookStore.test.ts` 的 `openDossier` 用例：`store.openDossier is not a function`。

- [ ] **Step 3：最小实现**

新建 `apps/desktop/src/renderer/src/utils/book-kinds.ts`（标签逐字取自 `LeftSidebar.vue:14-20`；顺序取自 `:22`；图标是渲染资产不进此表，留组件）：

```ts
import type { BookKind } from "@mochen/contracts";

/** 分组的固定展示顺序（左栏与「作品资料」共用同一条序列，不留两份）。 */
export const BOOK_KIND_ORDER: BookKind[] = ["chapter", "outline", "character", "plot", "material"];

/** BookKind 的中文标签唯一来源（铁律 6：Record<联合类型, string>，加一类不写标签编译不过）。 */
export const BOOK_KIND_LABELS: Record<BookKind, string> = {
  chapter: "章节",
  outline: "大纲",
  character: "人物",
  plot: "剧情",
  material: "素材库"
};
```

新建 `apps/desktop/src/renderer/src/utils/book-dossier.ts`：

```ts
import { PERMISSION_LABELS, type BookKind, type BookMeta, type DocRef } from "@mochen/contracts";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "./book-kinds";

export interface DossierGroup {
  kind: BookKind;
  label: string;
  docs: DocRef[];
}

/**
 * 按固定 kind 顺序分组，空组直接不出现（W6 靶：删掉 length===0 过滤就会冒出一堆空标题）。
 * 不改分类：materials/ 下按 scanBook 既有归并仍算 material（附录 F-B「不改分类」）。
 */
export function groupDocsForDossier(docs: DocRef[]): DossierGroup[] {
  const groups: DossierGroup[] = [];
  for (const kind of BOOK_KIND_ORDER) {
    const inKind = docs.filter((doc) => doc.kind === kind);
    if (inKind.length === 0) continue;
    groups.push({ kind, label: BOOK_KIND_LABELS[kind], docs: inKind });
  }
  return groups;
}

export interface DossierSummary {
  title: string;
  stageName: string;
  permissionLabel: string;
  chapterCount: number;
}

/** 没开书 ⇒ null，不捏造书名/阶段/档位（缺陷②「无书时档位捏造」的同一条纪律）。 */
export function dossierSummary(
  meta: BookMeta | null,
  docs: DocRef[]
): DossierSummary | null {
  if (!meta) return null;
  const stage = meta.stages.find((item) => item.id === meta.activeStage);
  return {
    title: meta.title,
    stageName: stage?.name ?? "无",
    permissionLabel: PERMISSION_LABELS[meta.permissionMode],
    chapterCount: docs.filter((doc) => doc.kind === "chapter").length
  };
}
```

新建 `apps/desktop/src/renderer/src/components/BookDossier.vue`（全吃 token，不写死色值；只读视图，不挂任何写盘通路）：

```vue
<!-- 右栏「作品资料」只读摘要：小说信息 + 按 kind 分组的文档卡。判断都在 utils，本组件只接线。 -->
<script setup lang="ts">
import type { DossierGroup, DossierSummary } from "../utils/book-dossier";

defineProps<{ summary: DossierSummary | null; groups: DossierGroup[] }>();
</script>

<template>
  <section class="book-dossier transient-scrollbar" aria-label="作品资料">
    <div v-if="!summary" class="dossier-empty">
      <p>还没打开作品目录。在左栏点「打开作品目录」，这里就会列出这本书的资料。</p>
    </div>
    <template v-else>
      <header class="dossier-meta">
        <h2 class="dossier-title">{{ summary.title }}</h2>
        <p class="dossier-facts">
          当前阶段：{{ summary.stageName }} · 权限档：{{ summary.permissionLabel }} · 章节
          {{ summary.chapterCount }} 篇
        </p>
      </header>
      <div v-if="groups.length === 0" class="dossier-empty">
        <p>这本书里还没有归类好的文稿。</p>
      </div>
      <section v-for="group in groups" :key="group.kind" class="dossier-group">
        <h3 class="dossier-group-heading">{{ group.label }}</h3>
        <ul class="dossier-doc-list">
          <li v-for="doc in group.docs" :key="doc.relPath" class="dossier-doc-card">
            <span class="dossier-doc-title">{{ doc.title }}</span>
            <span class="dossier-doc-excerpt">{{ doc.excerpt ?? "" }}</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
```

`apps/desktop/src/renderer/src/stores/useBookStore.ts`：`state` 的 `rightPaneMode`（`:41`）类型加 `"dossier"`：

```ts
    /** 右栏这一格当前展示文稿 / 浏览 / 作品资料；后两者永不改写文稿侧状态。 */
    rightPaneMode: "manuscript" as "manuscript" | "browse" | "dossier",
```

`actions` 里 `browse`（`:130`）之前加 `openDossier`（只搬 mode，与 `openPermissionMenu` 同律：绝不做多余副作用）：

```ts
    /**
     * 打开右栏「作品资料」页签：只改 rightPaneMode。
     * 绝不动 docTabs / activeDocTab / draft / dirty / saving——切过去再切回来，草稿与标签不受影响（反向用例守着）。
     */
    openDossier(): void {
      this.rightPaneMode = "dossier";
    },
```

`apps/desktop/src/renderer/src/components/LeftSidebar.vue`：把 `:14-22` 的 `KIND_META`/`SECTION_ORDER` 删掉，改成 import 唯一表 + 组件内只留图标映射：

```ts
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "../utils/book-kinds";

// 图标是渲染资产不是业务枚举（设计决定 6）：标签/顺序来自 utils/book-kinds 唯一表，这里只留 icon。
const KIND_ICON: Record<BookKind, IconName> = {
  chapter: "book",
  outline: "list",
  character: "user",
  plot: "ledger",
  material: "library"
};

const sections = computed(() =>
  BOOK_KIND_ORDER.map((kind) => ({
    id: kind,
    label: BOOK_KIND_LABELS[kind],
    icon: KIND_ICON[kind],
    nodes: book.docs.filter((doc) => doc.kind === kind)
  })).filter((section) => section.nodes.length > 0)
);
```

`apps/desktop/src/renderer/src/components/DocumentPane.vue`：`<script setup>` 顶部 import 加：

```ts
import BookDossier from "./BookDossier.vue";
import { dossierSummary, groupDocsForDossier } from "../utils/book-dossier";
```

在 `title`/`characterCount` 等 computed 附近加两格（判定都在 utils，组件只算一次并缓存）：

```ts
const dossier = computed(() => dossierSummary(book.meta, book.docs));
const dossierGroups = computed(() => groupDocsForDossier(book.docs));
```

`tabs`（`:41-48`）的三元补 dossier 分支（作品资料页不显示文件标签条）：

```ts
const tabs = computed(() =>
  mode.value === "manuscript"
    ? book.docTabs.map((relPath) => ({
        id: relPath,
        title: book.refOf(relPath)?.title ?? relPath
      }))
    : mode.value === "browse"
      ? book.browseTabs.map((doc) => ({ id: doc.relPath, title: doc.title }))
      : []
);
```

`view-tabs`（`:131-150`）里「浏览」按钮之后加第三格（直接调 store 的 `openDossier`，不动 switchMode，省行数）：

```html
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'dossier'"
          :class="{ 'is-active': mode === 'dossier' }"
          @click="book.openDossier()"
        >
          作品资料
        </button>
```

`editor-document`（`:154-179`）的浏览预览 `<article v-else>` 改成 `v-else-if="mode === 'browse'"`，并在其后加 dossier 分支：

```html
      <BookDossier v-if="mode === 'dossier'" :summary="dossier" :groups="dossierGroups" />
```

> 三处内容分支顺序：`BookDossier v-if="mode==='dossier'"` → `textarea v-else-if="mode==='manuscript'"` → `article v-else`（browse）。footer 的保存按钮 `:disabled` 条件 `mode !== 'manuscript'`（`:189`）不改：dossier 态本就禁用保存。

- [ ] **Step 4：复跑到绿**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/book-kinds.test.ts apps/desktop/src/renderer/src/utils/book-dossier.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4
```

预期：`book-kinds.test.ts` 3 passed；`book-dossier.test.ts` 7 passed；`useBookStore.test.ts` 在既有用例数之上 +2 passed；无 failed。

- [ ] **Step 5：连带清单**

1. 术语硬约束——UI 上「作品资料」格绝不出现「档案」二字：`grep -n "档案" apps/desktop/src/renderer/src/components/BookDossier.vue apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/utils/book-dossier.ts` —— 期望无输出（0 命中）。
2. 「作品资料」命名到位：`grep -n "作品资料" apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/components/BookDossier.vue` —— 各命中（页签与 `aria-label`）。
3. 左栏读唯一表、无本地标签残留：`grep -n "KIND_META\|SECTION_ORDER" apps/desktop/src/renderer/src/components/LeftSidebar.vue` —— 期望无输出；`grep -n "BOOK_KIND_LABELS\|BOOK_KIND_ORDER" apps/desktop/src/renderer/src/components/LeftSidebar.vue` —— 命中 import 与使用两处。全仓标签第二份抄写检查：`grep -rn "素材库" apps/desktop/src/renderer/src` —— 只在 `book-kinds.ts` 命中（唯一实现）。
4. DocumentPane 行数预算 ≤220：`wc -l apps/desktop/src/renderer/src/components/DocumentPane.vue` —— 期望 ≤220。若因第三分支越线，把 `section-tabs-bar`（`:103-128` 的文件标签条）抽成 `components/DocumentTabBar.vue` 子组件（不新开样式文件，样式仍走 `interaction.css`），再复跑 `wc -l` 确认回落。
5. `excerpt` 消费处已兜底：`grep -n "excerpt" apps/desktop/src/renderer/src/components/BookDossier.vue` —— 命中 `doc.excerpt ?? ""`（Task 5 的跨 IPC 消费口径在此落地，缺字段不当异常）。
6. `rightPaneMode` 现有两态用例不回归：`corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4` 里「点素材把右栏切到浏览」「再点章节把右栏切回文稿」两条仍绿（`browse`/`openDocTab` 未改）。

- [ ] **Step 6：局部门禁**（顺序：prettier → 相关 tsc 项目 → eslint 点名文件；命令后面一律不接管道）

```
corepack pnpm exec prettier --check apps/desktop/src/renderer/src/utils/book-kinds.ts apps/desktop/src/renderer/src/utils/book-kinds.test.ts apps/desktop/src/renderer/src/utils/book-dossier.ts apps/desktop/src/renderer/src/utils/book-dossier.test.ts apps/desktop/src/renderer/src/components/BookDossier.vue apps/desktop/src/renderer/src/components/LeftSidebar.vue apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/stores/useBookStore.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm exec eslint apps/desktop/src/renderer/src/utils/book-kinds.ts apps/desktop/src/renderer/src/utils/book-kinds.test.ts apps/desktop/src/renderer/src/utils/book-dossier.ts apps/desktop/src/renderer/src/utils/book-dossier.test.ts apps/desktop/src/renderer/src/components/BookDossier.vue apps/desktop/src/renderer/src/components/LeftSidebar.vue apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/stores/useBookStore.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --max-warnings=0
corepack pnpm run lint:budget
```

预期：prettier 全 `All matched files use Prettier code style!`；tsc 退出码 0（`.vue` 走 web 项目，`BookDossier.vue` 的 props 形状须与 `DossierSummary`/`DossierGroup` 对齐）；eslint 退出码 0；`check-source-line-budget.mjs` 打印「行数预算通过」（本任务所有文件远低于 800）。不符先 `corepack pnpm exec prettier --write <该文件>` 再复跑 `--check`。样式并入 `styles/interaction.css` 的 dossier 卡样式留给 Task 9/10 那道改 css 的任务统一做，本任务不新开样式文件、不改 css 门禁。

- [ ] **Step 7：提交**

```
git add apps/desktop/src/renderer/src/utils/book-kinds.ts apps/desktop/src/renderer/src/utils/book-kinds.test.ts apps/desktop/src/renderer/src/utils/book-dossier.ts apps/desktop/src/renderer/src/utils/book-dossier.test.ts apps/desktop/src/renderer/src/components/BookDossier.vue apps/desktop/src/renderer/src/components/LeftSidebar.vue apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/stores/useBookStore.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts
git commit -m "$(cat <<'EOF'
feat(renderer): 右栏第三页签「作品资料」，kind 标签顺序抽成唯一实现

新增 BookDossier.vue 只读摘要（小说信息 + 按 kind 分组带 Task 5 的 excerpt ?? ""），
rightPaneMode 加 dossier 与 openDossier()（只改 mode，不动标签/草稿/脏位）。
LeftSidebar 的 kind 标签与顺序抽到 utils/book-kinds 一份实现，左栏与作品资料共读。
页签名与文案统一「作品资料」，UI 上「档案」只指 agent profile。
EOF
)"
```

- [ ] **Step 8：变异 W6（先提交再变异）**

用 `Edit` 把 `apps/desktop/src/renderer/src/utils/book-dossier.ts` 里 `groupDocsForDossier` 的空组过滤行
`    if (inKind.length === 0) continue;`
删掉（该行整体移除，即「空组也 push」）。单跑：

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/book-dossier.test.ts --maxWorkers=4
```

预期红原文形状：
- 「五类里只出现的两类按固定顺序归组…」：`expected [ 'chapter', 'outline', 'character', 'plot', 'material' ] to deeply equal [ 'chapter', 'outline' ]`。
- 「没有人物文档时绝不出现人物组」：`expected true to be false`。
- 「空数组 ⇒ 零组」：`expected [ …5 个空组… ] to deeply equal []`。

改回（`Edit` 复原为在 `for` 循环体内保留 `if (inKind.length === 0) continue;`），复跑到绿：

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/book-dossier.test.ts --maxWorkers=4
```

确认工作区干净：`git diff --exit-code` —— 退出码 0，无输出。

---

### Task 7：中栏空状态 = 作品工作台（F-A）

**Files:**

- Create：`apps/desktop/src/renderer/src/utils/workbench-state.ts`（新纯函数模块，40–120 行）
- Create：`apps/desktop/src/renderer/src/utils/workbench-state.test.ts`
- Create：`apps/desktop/src/renderer/src/components/BookWorkbench.vue`（新组件，≤90 行）
- Modify：`apps/desktop/src/renderer/src/components/CenterColumn.vue`
  - 空分支 body：`:205-225`（当前 `<div v-if="items.length===0 && …" class="conversation-empty">` 里的品牌 `<span class="empty-agent-mark">` `:216-218`、`<h1>` `:219`、说明 `<p>` `:220-223`、`orphanError` `:224`）整块 body 换成 `<BookWorkbench>` + 一行 `orphanError` 承接；`v-if` 条件本身不动。
  - 脚本：新增 `hasBook` / `workbenchCards` 两个 computed、`onWorkbenchPick(id)` 派函数、`BookWorkbench` 与 `workbench-state` 的 import（`agentLabel` computed 已存在于 `:86-89`，直接透传）。
- Test：`utils/workbench-state.test.ts`（判断全在 utils，`.vue` 零覆盖是既定事实）

**Interfaces:**

- Consumes（逐字抄自接口总表）：
  - `packages/contracts/src/book.ts` 的 `DocRef { relPath: string; kind: BookKind; title: string }`（`:22-26`；**不依赖 `excerpt?`**，那是 Task 5 才加的可选字段）。
  - `useBookStore` 现成动作：`openDocTab(relPath: string)`（`:81`）、`browse(ref: DocRef)`（`:130`）、`refOf(relPath: string): DocRef | null`（`:77`）、`pickAndOpen()`（`:52`）、state `docs: DocRef[]`（`:28`）/ `activeDocTab: string | null`（`:30`）。
  - `useAgentStore` 的 `prefillComposer(threadKey: string, value: string): void` —— **Task 4 落地的接口总表签名**（总表 `useAgentStore` 段）；预填通路没到位之前「主笔创作」这张卡不配叫这个名字（附录 §2.7 / 设计决定）。
  - `threadKeyFor(activeDocTab: string | null): string`（`useAgentStore.ts:83`）。
  - 品牌原图 `apps/desktop/src/renderer/src/assets/brand/mochen-lockup.jpg` —— 整幅 `<img>` 排版，**禁止裁切/重绘/另生成，禁止 ImageGen**。
- Produces：
  - `utils/workbench-state.ts`：`WorkbenchCardId`、`WORKBENCH_CARD_LABELS`、`WORKBENCH_PREFILL`、`WorkbenchCard`、`workbenchVisible(hasBook)`、`workbenchCards({hasBook,docs,activeChapter})`、`workbenchTarget({id,docs,activeChapter})`。
  - `components/BookWorkbench.vue`：`props: { hasBook: boolean; agentLabel: string; cards: WorkbenchCard[] }`、`emits: { pick(id: WorkbenchCardId) }`（总表逐字）。四张卡的点击协调（跨 `book` 与 `agent` 两个 store）留在 `CenterColumn`，`BookWorkbench` 只在无书降级里直接调 `book.pickAndOpen()`（单一真身，与 `Ctrl+O` 同源）。

- [ ] **Step 1：写失败的测试**

```ts
// apps/desktop/src/renderer/src/utils/workbench-state.test.ts
import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import {
  WORKBENCH_CARD_LABELS,
  WORKBENCH_PREFILL,
  workbenchCards,
  workbenchTarget,
  workbenchVisible
} from "./workbench-state";

const chapters: DocRef[] = [
  { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" }
];
const fullDocs: DocRef[] = [
  ...chapters,
  { relPath: "characters/林晚.md", kind: "character", title: "林晚" },
  { relPath: "materials/海洋.md", kind: "material", title: "海洋" },
  { relPath: "outline/第一幕.md", kind: "outline", title: "第一幕" }
];

describe("workbench-state · 无书不显示死卡（F-A）", () => {
  it("workbenchVisible：无书 false、有书 true", () => {
    expect(workbenchVisible(false)).toBe(false);
    expect(workbenchVisible(true)).toBe(true);
  });

  it("无书 ⇒ workbenchCards 一张卡都不出（W7 变异目标：不看 hasBook 就红）", () => {
    expect(workbenchCards({ hasBook: false, docs: fullDocs, activeChapter: null })).toEqual([]);
  });
});

describe("workbench-state · 四张卡是真动作", () => {
  it("有书 ⇒ 恰好四张，顺序与中文标签逐字钉死", () => {
    const cards = workbenchCards({
      hasBook: true,
      docs: fullDocs,
      activeChapter: "chapters/01-开局.md"
    });
    expect(cards.map((card) => card.id)).toEqual(["chief-write", "character", "world", "outline"]);
    expect(cards.map((card) => card.label)).toEqual([
      "主笔创作",
      "角色塑造",
      "世界构建",
      "大纲规划"
    ]);
    expect(cards.every((card) => card.enabled)).toBe(true);
  });

  it("world 卡取 materials/（material kind）第一篇，而不是 character/outline", () => {
    expect(workbenchTarget({ id: "world", docs: fullDocs, activeChapter: null })).toBe(
      "materials/海洋.md"
    );
  });

  it("character/outline 卡分别取 characters/、outline/ 分组第一篇", () => {
    expect(workbenchTarget({ id: "character", docs: fullDocs, activeChapter: null })).toBe(
      "characters/林晚.md"
    );
    expect(workbenchTarget({ id: "outline", docs: fullDocs, activeChapter: null })).toBe(
      "outline/第一幕.md"
    );
  });

  it("chief-write：有活动章用活动章，否则回落第一篇 chapter", () => {
    expect(workbenchTarget({ id: "chief-write", docs: fullDocs, activeChapter: null })).toBe(
      "chapters/01-开局.md"
    );
    expect(
      workbenchTarget({ id: "chief-write", docs: fullDocs, activeChapter: "chapters/09-结尾.md" })
    ).toBe("chapters/09-结尾.md");
  });

  it("缺对应分组 ⇒ 目标 null 且该卡 disabled（反向鉴别：不是恒 enabled）", () => {
    const cards = workbenchCards({ hasBook: true, docs: chapters, activeChapter: null });
    expect(workbenchTarget({ id: "character", docs: chapters, activeChapter: null })).toBeNull();
    expect(cards.find((card) => card.id === "character")?.enabled).toBe(false);
    expect(cards.filter((card) => !card.enabled).map((card) => card.id)).toEqual([
      "character",
      "world",
      "outline"
    ]);
  });

  it("WORKBENCH_PREFILL 与 WORKBENCH_CARD_LABELS 逐字（Task 4 预填通路消费同一串）", () => {
    expect(WORKBENCH_PREFILL).toBe("我想改这一章：先读它，再给我三处可以动的地方。");
    expect(WORKBENCH_CARD_LABELS).toEqual({
      "chief-write": "主笔创作",
      character: "角色塑造",
      world: "世界构建",
      outline: "大纲规划"
    });
  });
});
```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/workbench-state.test.ts --maxWorkers=4
```

预期：`Cannot find module './workbench-state'`（模块尚未创建），红在 import 那一行，而不是恒真。

- [ ] **Step 3：最小实现**

`utils/workbench-state.ts`（完整）：

```ts
import type { BookKind, DocRef } from "@mochen/contracts";

export type WorkbenchCardId = "chief-write" | "character" | "world" | "outline";

export const WORKBENCH_CARD_LABELS: Record<WorkbenchCardId, string> = {
  "chief-write": "主笔创作",
  character: "角色塑造",
  world: "世界构建",
  outline: "大纲规划"
};

/** 主笔创作卡的预填指令；只在 Task 4 的 prefillComposer 通路落地后才随卡出现（§2.7）。 */
export const WORKBENCH_PREFILL = "我想改这一章：先读它，再给我三处可以动的地方。";

export interface WorkbenchCard {
  id: WorkbenchCardId;
  label: string;
  hint: string;
  enabled: boolean;
}

const CARD_ORDER: WorkbenchCardId[] = ["chief-write", "character", "world", "outline"];

// world 卡落 materials/ 分组（scan.ts:45 把 materials/ 归 material kind）；character→characters、outline→outline。
const CARD_TARGET_KIND: Record<Exclude<WorkbenchCardId, "chief-write">, BookKind> = {
  character: "character",
  world: "material",
  outline: "outline"
};

const CARD_HINTS: Record<WorkbenchCardId, string> = {
  "chief-write": "打开当前章，预填一句改稿指令，再交给你逐条审批。",
  character: "浏览人物分组第一篇，落到右栏浏览态。",
  world: "浏览素材库分组第一篇，落到右栏浏览态。",
  outline: "浏览大纲分组第一篇，落到右栏浏览态。"
};

/** 无书 ⇒ false：整块降级成引导，不显示任何死卡。 */
export function workbenchVisible(hasBook: boolean): boolean {
  return hasBook;
}

export function workbenchTarget(input: {
  id: WorkbenchCardId;
  docs: DocRef[];
  activeChapter: string | null;
}): string | null {
  if (input.id === "chief-write") {
    const active = input.activeChapter?.trim() ?? "";
    if (active !== "") return active;
    return input.docs.find((doc) => doc.kind === "chapter")?.relPath ?? null;
  }
  const kind = CARD_TARGET_KIND[input.id];
  return input.docs.find((doc) => doc.kind === kind)?.relPath ?? null;
}

export function workbenchCards(input: {
  hasBook: boolean;
  docs: DocRef[];
  activeChapter: string | null;
}): WorkbenchCard[] {
  if (!workbenchVisible(input.hasBook)) return [];
  return CARD_ORDER.map((id) => ({
    id,
    label: WORKBENCH_CARD_LABELS[id],
    hint: CARD_HINTS[id],
    enabled:
      workbenchTarget({ id, docs: input.docs, activeChapter: input.activeChapter }) !== null
  }));
}
```

`components/BookWorkbench.vue`（完整但紧凑；图标名全部走 AppIcon.vue 已绘制分支：`wand`:43 / `user`:102 / `globe`:98 / `list`:78 / `directory`:29）：

```vue
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import type { IconName } from "../types/icons";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { useBookStore } from "../stores/useBookStore";
import type { WorkbenchCard, WorkbenchCardId } from "../utils/workbench-state";

defineProps<{ hasBook: boolean; agentLabel: string; cards: WorkbenchCard[] }>();
const emit = defineEmits<{ pick: [id: WorkbenchCardId] }>();

const book = useBookStore();
const CARD_ICONS: Record<WorkbenchCardId, IconName> = {
  "chief-write": "wand",
  character: "user",
  world: "globe",
  outline: "list"
};
// 无书降级的「打开作品目录」走 book.pickAndOpen() —— 与左栏、Ctrl+O 同一真身，不复制逻辑。
async function openBook(): Promise<void> {
  await book.pickAndOpen();
}
</script>

<template>
  <div class="book-workbench">
    <span class="empty-agent-mark">
      <img :src="brandMark" alt="" width="52" height="52" />
    </span>
    <h1>{{ agentLabel }}</h1>
    <p class="workbench-lead">
      说人话就行——它会自己读文档、给出逐条待审的改稿提案；你不点批准，它一个字也写不进作品目录。
    </p>

    <nav v-if="hasBook" class="workbench-cards" aria-label="作品工作台">
      <button
        v-for="card in cards"
        :key="card.id"
        class="workbench-card"
        type="button"
        :disabled="!card.enabled"
        :title="card.hint"
        @click="emit('pick', card.id)"
      >
        <AppIcon :name="CARD_ICONS[card.id]" :size="18" />
        <span class="workbench-card-label">{{ card.label }}</span>
        <span class="workbench-card-hint">{{ card.hint }}</span>
      </button>
    </nav>

    <div v-else class="workbench-empty-book">
      <p>还没有打开作品目录。先打开一个，工作台的四张卡才会各就各位。</p>
      <button class="workbench-open-book" type="button" @click="openBook">
        <AppIcon name="directory" :size="16" />
        <span>打开作品目录</span>
      </button>
    </div>
  </div>
</template>
```

`CenterColumn.vue` 脚本接线（紧凑）：

```ts
import BookWorkbench from "./BookWorkbench.vue";
import { workbenchCards, workbenchTarget, WORKBENCH_PREFILL, type WorkbenchCardId } from "../utils/workbench-state";

const hasBook = computed(() => book.rootPath !== null);
const cards = computed(() =>
  workbenchCards({ hasBook: hasBook.value, docs: book.docs, activeChapter: book.activeDocTab })
);
// 四张卡逐张的真动作（跨 book / agent 两个 store 的协调只在这一处）：
function onWorkbenchPick(id: WorkbenchCardId): void {
  const target = workbenchTarget({ id, docs: book.docs, activeChapter: book.activeDocTab });
  if (target === null) return; // disabled 卡点不到；防御性早退。
  if (id === "chief-write") {
    void book.openDocTab(target); // 右栏进文稿态，线程随 threadKeyFor 绑定
    agent.prefillComposer(threadKeyFor(target), WORKBENCH_PREFILL); // Task 4 通路
    return;
  }
  const ref = book.refOf(target); // character / world / outline ⇒ 浏览，不动 docTabs / 草稿
  if (ref) book.browse(ref);
}
```

模板：把 `:205-225` 那段空分支 body 换成

```html
<BookWorkbench
  :has-book="hasBook"
  :agent-label="agentLabel"
  :cards="cards"
  @pick="onWorkbenchPick"
/>
<p v-if="orphanError" class="error-line">{{ orphanError }}</p>
```

第五张「灵感激发」卡**刻意不做**：它唯一能配的动作是 `/status`（附录 §2.7 已删），要等波 2 的 agent profile（换一个人格来出题）才有真身，届时另立任务——本波不留占位 markup、不留 TODO。样式（`.book-workbench` / `.workbench-cards` / `.workbench-card`）本任务先在 `interaction.css` 落最小版（见 Task 9 一并并入 chip 行样式，均吃 token）。

- [ ] **Step 4：复跑到绿**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/workbench-state.test.ts --maxWorkers=4
```

期望：`10 passed`（两个 describe 合计 10 个 `it`）。

- [ ] **Step 5：连带清单**
  - 行号预算当场回读：`wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue` —— 现状 304，替换掉 20 行 markup 但加 ~12 行脚本，预期 **≤400**（自设硬预算，超限即拆）。
  - 图标名 Grep 证据：`wand` → AppIcon.vue:43、`user` → :102、`globe` → :98、`list` → :78、`directory` → :29（均在 `<template v-else-if="name === '…'">` 里有绘制分支）。写不出分支的名字一律不用。
  - 品牌图核对：`BookWorkbench.vue` 只 `<img :src="brandMark">` 整幅引用，未裁切、未重绘、未 ImageGen；`mochen-lockup.jpg` 沿用现有 `empty-agent-mark` 的 `object-fit: cover` 展示（conversation-pane.css:171）。
  - 术语：UI 上「档案」一词只指 agent profile；本任务不出现「档案」字样（灵感激发归属用「agent profile / 人格」表述）。
  - 文档口径：附录 §3 F-A 卡表四行调用链逐字对齐（openDocTab / browse / pickAndOpen）；`prefillComposer` 依赖 Task 4，若 Task 4 未先落地，「主笔创作」卡文案须回退为「打开当前章」（设计决定 / §2.7）。

- [ ] **Step 6：局部门禁**（顺序固定，命令后不接管道）

```
corepack pnpm exec prettier --check apps/desktop/src/renderer/src/utils/workbench-state.ts apps/desktop/src/renderer/src/utils/workbench-state.test.ts apps/desktop/src/renderer/src/components/BookWorkbench.vue apps/desktop/src/renderer/src/components/CenterColumn.vue
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm exec eslint apps/desktop/src/renderer/src/utils/workbench-state.ts apps/desktop/src/renderer/src/utils/workbench-state.test.ts apps/desktop/src/renderer/src/components/BookWorkbench.vue apps/desktop/src/renderer/src/components/CenterColumn.vue --max-warnings=0
```

tsc 不进 `.vue`（vue-shim），故 `BookWorkbench.vue`/`CenterColumn.vue` 只由 utils 测试 + Task 11 真机兜底；`.ts` 侧 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` 由 `.find()?.` 与不依赖 `excerpt` 满足。

- [ ] **Step 7：提交**

```
git add apps/desktop/src/renderer/src/utils/workbench-state.ts apps/desktop/src/renderer/src/utils/workbench-state.test.ts apps/desktop/src/renderer/src/components/BookWorkbench.vue apps/desktop/src/renderer/src/components/CenterColumn.vue
git commit -m "feat(中栏): 空状态换作品工作台（F-A 四张真动作卡与无书降级）"
```

- [ ] **Step 8：变异 W7（先提交再变异）**

变异动作：把 `workbenchVisible` 改成 `return true;`（不看 `hasBook`）。落点 `utils/workbench-state.ts`，只用 `Edit`。
预期转红：`workbench-state · 无书不显示死卡` 的「无书 ⇒ workbenchCards 一张卡都不出（W7 变异目标）」——`expected [ …4 卡… ] to deeply equal []`。
复跑：`corepack pnpm vitest run apps/desktop/src/renderer/src/utils/workbench-state.test.ts --maxWorkers=4` → 改回后 `10 passed`，`git diff --exit-code` 干净。

---

### Task 8：左栏三段主操作（F-C）

**Files:**

- Modify：`apps/desktop/src/renderer/src/components/LeftSidebar.vue`
  - `<nav class="primary-nav new-book-nav">` 的 `:75-81` 从一段扩成三段（打开作品目录已在位、不动；新增模型配置、本章新对话）。
  - 脚本新增 `useLayoutStore` / `useAgentStore` 与 `CLEAR_VIEW_SENTENCE` / `threadKeyFor` 的 import，两个 handler 函数。
- Test：`apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts`（源码契约测试，沿用 `utils/hotkey-markers.test.ts` 的 `readFileSync` 读 `.vue` 源模式）

**Interfaces:**

- Consumes（逐字抄自接口总表 / 现状回读）：
  - `layoutStore.showSettings(initialCategory = "general")`（`layoutStore.ts:89`）、`layoutStore.currentView`（`:53`）——设计决定 2 之后「设置浮层唯一真身 = `layout.currentView === 'settings'`」，左栏「模型配置」与中栏头部两处入口调同一个 `showSettings("general")`。
  - `useAgentStore` 的 `clearThreadView(threadKey: string)`（`useAgentStore.ts:586`）、`CLEAR_VIEW_SENTENCE`（`:159`）、`threadKeyFor(activeDocTab)`（`:83`）。
  - `useBookStore` 的 `activeDocTab`（`:30`）、`pickAndOpen()`（`:52`，段①沿用现有 `pickBook`）。
  - 图标（AppIcon.vue 已绘制）：`directory`:29 / `settings`:162 / `plus`:20。
- Produces：`LeftSidebar.vue` 三段 `primary-nav`，每段带 `data-nav-id`（`open-book` / `model-config` / `new-thread`）供真机探针定位。无新增纯函数（判定简单，见下）。

- [ ] **Step 1：写失败的测试**

`.vue` 运行时够不着，且本任务**不抽新纯函数**（「无书时第三段 disabled」就是 `book.activeDocTab === null` 一行布尔，为它单开 util 是为抽而抽，明说不抽）。可失败的断言落在**源码契约**：钉死两段新入口调的是**真身函数名**，而不是捏造一个新动作（§2.7：报不出函数名就不进 UI）。

```ts
// apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(join(SRC_DIR, "components/LeftSidebar.vue"), "utf8");
const script = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? "";
const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? "";

describe("LeftSidebar · 三段主操作各调一个真身（F-C，§2.7）", () => {
  it("段①打开作品目录仍在位且 Ctrl O 键标已接通（核对现状：附录 §3 的账）", () => {
    expect(template).toContain('data-nav-id="open-book"');
    expect(template).toContain("<kbd>Ctrl O</kbd>");
    expect(script).toContain("book.pickAndOpen()");
  });

  it("段②模型配置调 layout.showSettings(\"general\")，与中栏头部同源", () => {
    expect(template).toContain('data-nav-id="model-config"');
    expect(script).toContain('showSettings("general")');
  });

  it("段③本章新对话调 agent.clearThreadView(threadKeyFor(...))，只清渲染层", () => {
    expect(template).toContain('data-nav-id="new-thread"');
    expect(script).toContain("clearThreadView(threadKeyFor(book.activeDocTab))");
  });

  it("文案诚实：新对话一段复用 CLEAR_VIEW_SENTENCE 作 title，绝不写「新建会话线程」", () => {
    expect(script).toContain("CLEAR_VIEW_SENTENCE");
    expect(template).toContain('data-nav-id="new-thread"');
    expect(template).not.toContain("新建会话线程");
    // 反向鉴别：无书时第三段 disabled 的判定必须真出现（不是恒可点）。
    expect(template).toMatch(/data-nav-id="new-thread"[\s\S]*?:disabled="book\.activeDocTab === null"/);
  });
});
```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts --maxWorkers=4
```

预期：`model-config` / `new-thread` / `showSettings("general")` / `clearThreadView(...)` / `:disabled=...` 全部 `toContain`/`toMatch` 失败（当前只有一段 `open-book`），红在缺的东西上，而不是恒真。

- [ ] **Step 3：最小实现**

`LeftSidebar.vue` 脚本段（在现有 import 与 `pickBook` 之外补齐）：

```ts
import { CLEAR_VIEW_SENTENCE, threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useLayoutStore } from "../stores/layoutStore";

const layout = useLayoutStore();
const agent = useAgentStore();

// 段②：与中栏头部两处入口同一个真身（设计决定 2 之后 showSettings 是唯一路径）。
function openModelSettings(): void {
  layout.showSettings("general");
}

// 段③：只清渲染层视图，不碰 JSONL、不碰 pending —— clearThreadView 的真实边界。
function newThreadForActiveChapter(): void {
  agent.clearThreadView(threadKeyFor(book.activeDocTab));
}
```

`primary-nav` 三段（`:75-81` 替换；`class` 去掉单段专用的 `new-book-nav`，留 `primary-nav` 走 left-nav.css:80）：

```html
<nav class="primary-nav" aria-label="作品">
  <button class="nav-row" type="button" data-nav-id="open-book" @click="pickBook">
    <AppIcon name="directory" :size="17" />
    <span>打开作品目录</span>
    <kbd>Ctrl O</kbd>
  </button>
  <button class="nav-row" type="button" data-nav-id="model-config" @click="openModelSettings">
    <AppIcon name="settings" :size="17" />
    <span>模型配置</span>
  </button>
  <button
    class="nav-row"
    type="button"
    data-nav-id="new-thread"
    :disabled="book.activeDocTab === null"
    :title="CLEAR_VIEW_SENTENCE"
    @click="newThreadForActiveChapter"
  >
    <AppIcon name="plus" :size="17" />
    <span>本章新对话</span>
  </button>
</nav>
```

诚实口径：第三段标签是「本章新对话」而不是「新建会话线程」（总 spec §5.1 约束 1：一条章永远一条线程）；`title` 直接复用 `CLEAR_VIEW_SENTENCE`——「这只清空本页显示；盘上的会话历史不动，重启后仍会完整回放。」一句，用户当场读得到它清的是屏幕。附录 §3 记的那处「已完成的账」：`Ctrl O` 键标此前是空标、本批已接通 `open-book` ⇒ `book.pickAndOpen()`——回读现状：`LeftSidebar.vue:76-80` 的 `data-nav-id="open-book"` + `<kbd>Ctrl O</kbd>` + `pickBook`→`book.pickAndOpen()` 三件都已在位，故段①**原样保留不动**，测试仅核对不回改。

- [ ] **Step 4：复跑到绿**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts --maxWorkers=4
```

期望：`4 passed`。

- [ ] **Step 5：连带清单**
  - 行号预算当场回读：`wc -l apps/desktop/src/renderer/src/components/LeftSidebar.vue` —— 现状 131，加两按钮 + 两函数约 +22 行，预期 **≈153**（远低于 800 门禁，且左栏无更紧的自设预算）。
  - 图标名 Grep 证据：`settings` → AppIcon.vue:162、`plus` → :20、`directory` → :29（均已绘制）。
  - 唯一真身核对：`grep -n "showSettings(\"general\")" apps/desktop/src/renderer/src/components/CenterColumn.vue` 应命中头部「模型设置」按钮（Task 1 已把它从局部 `showSettings.value = true` 改成 `layout.showSettings("general")`）；左栏这一处是**第二个入口、同一函数**，不复制打开逻辑（设计决定 2）。若 Task 1 尚未把头部改成走 `layout.showSettings`，本任务的同源断言要在 Step 6 前先在头部对齐——不在此复制局部 ref。
  - 术语：段③叫「新对话」不叫「新档案」；「档案」在本仓 UI 只指 agent profile。
  - 文档口径：附录 §3 F-C 三段与总 spec §5.1「一条章一条线程」对齐；`clearThreadView` 边界口径同 `useAgentStore.ts:586` 注释。

- [ ] **Step 6：局部门禁**

```
corepack pnpm exec prettier --check apps/desktop/src/renderer/src/components/LeftSidebar.vue apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm exec eslint apps/desktop/src/renderer/src/components/LeftSidebar.vue apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts --max-warnings=0
```

- [ ] **Step 7：提交**

```
git add apps/desktop/src/renderer/src/components/LeftSidebar.vue apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts
git commit -m "feat(左栏): primary-nav 扩为三段主操作（模型配置与本章新对话同源真身）"
```

- [ ] **Step 8：变异归属**

本任务无独立变异（`.vue` 模板零覆盖、无新纯函数，不硬造变异）。联动用例见 Step 1 的「LeftSidebar · 三段主操作各调一个真身」——其中「段③只清渲染层」与「文案诚实」两断言防的是接线指错真身；`clearThreadView` 本身「只动渲染层、不碰 JSONL 与 pending」的行为断言在波 1 的 store 测试里已钉（`useAgentStore.ts:586` 的 `/clear` 边界）。真机验证在 Task 11 冒烟矩阵第 2 行（左栏三段逐段点一次：段①开书、段②弹设置浮层且 Esc 能关、段③清屏后重启仍回放）。

---

### Task 9：输入区 chip 行只放真开关（F-D）

**Files:**

- Create：`apps/desktop/src/renderer/src/utils/composer-chips.ts`（新纯函数模块，40–90 行）
- Create：`apps/desktop/src/renderer/src/utils/composer-chips.test.ts`
- Modify：`apps/desktop/src/renderer/src/components/ComposerBox.vue`（`:24-62` footer 内 textarea 下加一排 chip；props 加 `modelValue`、emits 加 `update:modelValue` / `open-permission-menu` / `open-palette`；受控改造与 Task 4 的草稿上收同批，本任务只加 chip 行）
- Modify：`apps/desktop/src/renderer/src/components/CenterColumn.vue`
  - `ComposerBox` 挂载 `:291-298` 加 `@open-permission-menu="book.togglePermissionMenu()"`、`@open-palette="paletteOpen = true"`、`@update:model-value`；`:131` 的 `useGlobalHotkeys({ openPalette: () => (paletteOpen.value = true) })` 就是 chip 要接回的同源 `paletteOpen`（`:40` 定义）。
- Modify：`apps/desktop/src/renderer/src/styles/interaction.css`（chip 行样式并入，不新开文件）
- Test：`utils/composer-chips.test.ts`

**Interfaces:**

- Consumes（逐字抄自接口总表）：
  - `utils/permission-chip.ts`（Task 2 新建）：`permissionChipView(input: { hasBook: boolean; mode: PermissionMode | null; saving: boolean }): PermissionChipView`（`PermissionChipView { text; disabled; title }`）、`NO_BOOK_CHIP_LABEL = "未打开作品目录"`。**权限 chip 内部只调它一次，绝不算第二遍**（设计决定 4）。
  - `packages/contracts/src/permission.ts` 的 `PermissionMode`（`:2`）；档位文案唯一来源 `PERMISSION_LABELS`（`:5`）——本模块不出现第二份中文档名。
  - `useBookStore.togglePermissionMenu()`（`:237`）：弹层真身仍只有一处、仍挂在 `CenterColumn.vue:185` 的头部 `PermissionMenu`，**不复制第二个 `PermissionMenu` 实例**。
  - `CenterColumn.vue` 的 `paletteOpen`（`:40`）与 `openPalette`（`:131`），与**裸 `/` 键**同源（`utils/hotkeys.ts:98-100`）。2026-10-03 勘误：原写「与 `Ctrl+K` 同源」是假键位——`:78-96` 的全局 Ctrl 族只有 `b`/`,`/`o`/`PageDown`/`PageUp`/`1-9`/`j`，全仓无 `Ctrl+K`；「是否补真 `Ctrl+K`」是键位表变更，登记为独立开放项，不在本波。
  - 图标（AppIcon.vue 已绘制）：`/` chip 用 `terminal`:191；权限 chip 无图标（与头部 `permissionLabel` 按钮同姿态，`:176-184` 也是纯文本）。
- Produces：
  - `utils/composer-chips.ts`：`ComposerChipId`（`"permission" | "palette"`）、`ComposerChipView { id; text; disabled; title }`、`composerChips({ hasBook, mode, saving }) => ComposerChipView[]`（裁定 C：返回值就是数组，不含队列字段）。
  - `ComposerBox.vue` 对外契约（总表逐字）：`props: { running; ready; canContinue; modelValue: string; hasBook: boolean; permissionMode: PermissionMode | null; permissionSaving: boolean }`、`emits: { "update:modelValue"; send; stop; resume; "open-permission-menu"; "open-palette" }`。

- [ ] **Step 1：写失败的测试**

```ts
// apps/desktop/src/renderer/src/utils/composer-chips.test.ts
import { describe, expect, it } from "vitest";
import { permissionChipView } from "./permission-chip";
import { composerChips } from "./composer-chips";

describe("composer-chips · 只放真开关，排队不做按钮（F-D）", () => {
  it("恰好两枚 chip，id 逐字 permission/palette（第三枚排队按钮不许长出来）", () => {
    expect(composerChips({ hasBook: true, mode: "read-only", saving: false }).map((c) => c.id)).toEqual(
      ["permission", "palette"]
    );
  });

  it("联动用例：permission chip 与 permissionChipView 逐字段同值（防两份判定漂移）", () => {
    const inputs = [
      { hasBook: true, mode: "chapter-write" as const, saving: false },
      { hasBook: true, mode: "full-access" as const, saving: true },
      { hasBook: false, mode: null, saving: false }
    ];
    for (const input of inputs) {
      const view = permissionChipView(input);
      const chip = composerChips(input).find((item) => item.id === "permission");
      expect(chip).toEqual({
        id: "permission",
        text: view.text,
        disabled: view.disabled,
        title: view.title
      });
    }
  });

  it("无书 ⇒ permission chip disabled 且文案不是任何档位名（透传 permissionChipView 的诚实）", () => {
    const chip = composerChips({ hasBook: false, mode: null, saving: false }).find(
      (item) => item.id === "permission"
    );
    expect(chip?.disabled).toBe(true);
    expect(chip?.text).toBe("未打开作品目录");
    expect(chip?.text).not.toBe("只读参考"); // 波 1 缺陷②「捏造档位名」的反向钉
  });

  it("排队数字不在 chip 行出现（裁定 C：唯一真身是 composeStatusLine，不留第二份「数字→文案」）", () => {
    const chips = composerChips({ hasBook: true, mode: "read-only", saving: false });
    expect(chips.every((chip) => !chip.text.includes("排队"))).toBe(true);
    expect(Object.keys(chips[0] ?? {}).sort()).toEqual(["disabled", "id", "text", "title"]);
  });
});
```

- [ ] **Step 2：跑它，确认它因为想要的原因而红**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/composer-chips.test.ts --maxWorkers=4
```

预期：`Cannot find module './composer-chips'` 红在 import；若先补 composer-chips 再漏补 permission-chip（Task 2 未落地），则红在 `Cannot find module './permission-chip'`——两种红都指向「想要但还没建」的模块，不是恒真。

- [ ] **Step 3：最小实现**

`utils/composer-chips.ts`（完整）：

```ts
import type { PermissionMode } from "@mochen/contracts";
import { permissionChipView } from "./permission-chip";

export type ComposerChipId = "permission" | "palette";

export interface ComposerChipView {
  id: ComposerChipId;
  text: string;
  disabled: boolean;
  title: string;
}

export function composerChips(input: {
  hasBook: boolean;
  mode: PermissionMode | null;
  saving: boolean;
}): ComposerChipView[] {
  // 权限 chip 只调 permissionChipView 一次，不重算（设计决定 4）。
  const permission = permissionChipView(input);
  return [
    {
      id: "permission",
      text: permission.text,
      disabled: permission.disabled,
      title: permission.title
    },
    {
      id: "palette",
      text: "/ 命令",
      disabled: false,
      title: "打开 / 命令面板（与直接按 / 键同一个入口）"
    }
  ];
  // 裁定 C：这里**不返回**队列数字。排队列数唯一的可见真身是 useAgentStore 的 composeStatusLine
  // （useAgentStore.ts:144，「排队 N 条」，波 1 已有单测与真机观察）；chip 行再显示一次就是同一个数两份文案。
}
```

`ComposerBox.vue` chip 行（在 footer 内 textarea 与 `.composer-actions` 之间插一排；chip 用 `<button>`；图标名 `terminal` 已绘制，权限 chip 无图标）：

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { PermissionMode } from "@mochen/contracts";
import { composerChips } from "../utils/composer-chips";
// props 增 modelValue（受控，Task 4 草稿上收后 v-model 走它）；本任务先把 chip 行接上。
const props = defineProps<{
  running: boolean;
  ready: boolean;
  canContinue: boolean;
  modelValue: string;
  hasBook: boolean;
  permissionMode: PermissionMode | null; // 档位联合一律从 contracts 来，不在组件里手抄三元（铁律 6）
  permissionSaving: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [text: string];
  stop: [];
  resume: [];
  "open-permission-menu": [];
  "open-palette": [];
}>();
const chips = computed(() =>
  composerChips({ hasBook: props.hasBook, mode: props.permissionMode, saving: props.permissionSaving })
);
</script>
```

```html
<div class="composer-chips" role="group" aria-label="输入区开关">
  <button
    v-for="chip in chips"
    :key="chip.id"
    class="composer-chip"
    type="button"
    :disabled="chip.disabled"
    :title="chip.title"
    @click="chip.id === 'permission' ? emit('open-permission-menu') : emit('open-palette')"
  >
    {{ chip.text }}
  </button>
  <span class="composer-chip-hint">运行中按 Tab 可排队指令</span>
</div>
```

（chip 行只有那两枚 `<button>` 是开关；后面那句 `<span>` 是**纯静态说明**，不读任何计数、不带 click、不是徽标——它只是把「运行中 Tab 排队」这条键位摆在输入区旁边。`/` chip 若要带 `terminal` 图标，`@click` 分派与 emit 名称不变，图标只是渲染资产。）

`CenterColumn.vue` `ComposerBox` 挂载（`:291-298`）加：

```html
:has-book="book.rootPath !== null"
:permission-mode="book.meta?.permissionMode ?? null"
:permission-saving="book.metaSaving"
@update:model-value="agent.setDraft(threadKey, $event)"
@open-permission-menu="book.togglePermissionMenu()"
@open-palette="paletteOpen = true"
```

`interaction.css` 追加（**零硬编码色值**，一律 token）：

```css
.composer-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 6px 10px 0;
}
.composer-chip {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
}
.composer-chip:hover:not(:disabled) {
  background: var(--hover);
}
.composer-chip:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.composer-chip:disabled {
  color: var(--text-faint);
  cursor: not-allowed;
}
.composer-chip-hint {
  color: var(--text-soft);
  font-size: 12px;
}
```

三枚 2026-10-03 追加的 chip **本波一枚都不做**，各一行注明归属，不写代码不留占位 markup：
- 「当前模型」chip —— 归**波 2**（要新主进程通道 `{baseURL}/v1/models`，IPC 计数连带）。
- 「思考等级」chip —— 归**未决**（附录 §7.4：一期认哪几家厂商的 reasoning 出站字段格式没定案，定案前不发）。
- 「替我审批」chip —— 归**波 3**（生效点在主进程审批链，且只在「全开」档可开）。

- [ ] **Step 4：复跑到绿**

```
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/composer-chips.test.ts --maxWorkers=4
```

期望：`4 passed`。

- [ ] **Step 5：连带清单**
  - 行号预算当场回读：`wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue`（chip 事件与四个新绑定只加几行，仍 **≤400**）、`wc -l apps/desktop/src/renderer/src/components/ComposerBox.vue`（现状 63，加 chip 行与受控 props 后 **≤120**，远离 800）。
  - 图标名 Grep 证据：`terminal` → AppIcon.vue:191；权限 chip 无图标（头部 `permissionLabel` 按钮 CenterColumn.vue:176-184 本就纯文本，两处一致）。写不出分支就不加图标。
  - 样式 token 检查：`grep -n "#[0-9a-fA-F]\{3,6\}" apps/desktop/src/renderer/src/styles/interaction.css` 期望**无输出**（现有 `.slash-mask` 的 `#000` 在 `color-mix` 里且非本任务新增行；本任务新写的 chip/hint 规则只用 `--line-soft`/`--text`/`--hover`/`--focus`/`--text-faint`/`--text-soft`）；若门禁把整文件的 `#000` 计入，改用 `color-mix(in srgb, var(--shadow-color) …)` 等 token 表达，不引新色值。硬编码色值算 P1。
  - 不新开样式文件：并入 `styles/interaction.css`（`styles.css:8` 已 `@import`，无需改 import 结构）。
  - **裁定 C 的收尾账**：`grep -rn "queueBadge\|composer-queue-badge" apps/desktop/src` 期望**无输出**（草稿里的徽标 prop、`<span class="composer-queue-badge">` 与 `:queue-badge` 绑定全部删掉，不留死 prop）。
  - 弹层真身唯一：确认全仓 `PermissionMenu` 实例计数仍为 1——`grep -rn "<PermissionMenu" apps/desktop/src/renderer/src/components` 只命中 `CenterColumn.vue:185`；chip 的 `open-permission-menu` 只是调 `togglePermissionMenu()`，不新增挂载。
  - 文档口径：附录 §3 F-D 的「排队」那一格按**裁定 C** 落为静态提示句（不读计数、不带 click），队列数字仍只在状态行出现；三枚新 chip 归属与「与附录/Plan 3 spec 的差异」第 2 条一致。

- [ ] **Step 6：局部门禁**

```
corepack pnpm exec prettier --check apps/desktop/src/renderer/src/utils/composer-chips.ts apps/desktop/src/renderer/src/utils/composer-chips.test.ts apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/styles/interaction.css
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm exec eslint apps/desktop/src/renderer/src/utils/composer-chips.ts apps/desktop/src/renderer/src/utils/composer-chips.test.ts apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/components/CenterColumn.vue --max-warnings=0
```

`.css` 不被 eslint 管、prettier 管其格式；`.ts` 侧受 tsc 约束，`.vue` 仍只由 chip 契约 + Task 11 真机兜底。

- [ ] **Step 7：提交**

```
git add apps/desktop/src/renderer/src/utils/composer-chips.ts apps/desktop/src/renderer/src/utils/composer-chips.test.ts apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/styles/interaction.css
git commit -m "feat(输入区): chip 行只放权限与斜杠两枚真开关，排队只做静态提示不做徽标（F-D）"
```

- [ ] **Step 8：变异归属**

本任务无独立变异编号（本波 W1–W8 已在别处占满，chip 无对应号）。联动用例见 Step 1 的「联动用例：permission chip 与 permissionChipView 逐字段同值」——它钉的是「两份权限判定必然漂移」这条铁律（若 `composerChips` 里另算一遍 text/disabled，三组输入里至少一组对不上）；配合「无书 ⇒ 文案不是任何档位名」把波 1 缺陷②的反例也挡在 chip 侧。真机验证在 Task 11 冒烟矩阵第 3 行（两枚 chip 各点一次：权限 chip 弹出且**只有一处** `PermissionMenu`、改档真写 `book.json` 重启保持；`/` chip 打开面板与**裸 `/` 键**同源；chip 行末尾那句静态提示读得出 `运行中按 Tab 可排队指令`、**不是 `<button>`、不带数字**）。

**裁定 C（控制方拍定，执行者不再自行判断）**：草稿指出接口总表的 `composerChips({hasBook, mode, saving})` 与 `ComposerBox` props 都不含队列计数，`queueBadge` 取不到真数。裁定：**chip 行不做排队徽标**，`composerChips` 直接返回 `ComposerChipView[]`（不加 `queueCount` 入参、不加徽标 prop）。理由三条——① 排队计数已经有唯一可见真身 `composeStatusLine`（「排队 N 条」，`useAgentStore.ts:144`，波 1 有单测、真机拍到过），再显示一次就是同一个数字两份「数字→文案」实现，触铁律 6；② 附录 F-D 的原话是「chip 行只放真开关」，从没要求把状态行的数字搬一份过来；③ 加 `queueCount` 入参等于给一个纯视图函数塞进它判定不了的输入，是让摆设长得更像真开关。**替代做法（本波落地的就是它）**：chip 行尾放一句**静态**说明 `<span class="composer-chip-hint">运行中按 Tab 可排队指令</span>`——不读计数、不带 click、不是徽标，只做键位可发现性；反向钉是 Step 1 第四条用例（任何 chip 文案里出现「排队」二字即红）。

---

### Task 10：右栏「插入 md 片段」工具栏 + 页脚「约 N 分钟阅读」（F-F + F-G，变异 W8）

> **为什么两面合并成一个任务**：`DocumentPane.vue` 现 197 行（`wc -l` 当场回读），本波自设预算 ≤220（共头「Global Constraints」），而 F-F 与 F-G 都改这一个文件——拆两个任务就是两次顶撞预算，第二次必然被迫做「为省行数而省样式」的丑事。合并后一次接线、一次实测。
>
> **口径（附录 F-F / F-G + 设计决定 8，逐条落实）**：
>
> 1. **不引 `contenteditable`、不做 WYSIWYG**（附录 §2.2 明写不做）：右栏继续是 `textarea`（HEAD `DocumentPane.vue:162-170`），本任务**不改 DOM 结构**，只在既有 `editor-toolbar`（`:130-152`）的 `toolbar-spacer` 之后追加一排按钮、在既有页脚（`:181-195`）的 `editor-footer-meta` 里追加一格。
> 2. **不新增写盘通路**（设计决定 8）：片段按钮只做「读选区 → 纯函数改字符串 → `book.onEdit(next.value)`」。`onEdit`（`stores/useBookStore.ts:148-152`）是手打键盘路径用的同一个 action，它只置 `draft`/`dirty` 与暂存快照，**不碰 `window.mochen.writeDoc`**；落盘仍只有「提案 → 人批准 → 主进程写 + `.mochen/changes/<时间戳>/` 备份」这一条。
> 3. **下标口径 UTF-16 码元、内容口径码点**：`textarea.selectionStart/End` 给的就是码元（本仓 `lib.dom.d.ts:11607` 起 `HTMLTextAreaElement.selectionStart: number`），返回值必须能直接喂回 `setSelectionRange`；而「一个字」的判定按码点走，绝不把代理对劈成两半——这条教训在本仓已有原文（`utils/timeline.ts:157-160` 的 `Array.from` 注释）。
> 4. **只插入、不反解析**：已有前缀的行不重复加，但点第二下不会把标记摘掉。按钮文案是「列表」而不是「列表开关」，所以「不摘掉」与名字相符（附录 §2.7）。
> 5. **算术与判定一律出模板**：阅读时长的换算在 `utils/reading-time.ts`，工具栏的可见/可点判定在 `utils/markdown-snippets.ts::snippetToolbarState`；模板里只有一句插值。**页脚那一格永不出现 `{{ ... ? ... : ... }}`。**
> 6. **样式并入 `styles/interaction.css`**（它在本波已被 Task 9 追加过，`styles.css:8` 的 import 顺序在最后，能覆盖 `editor-pane.css`），**不新开样式文件**；只补字号/内边距，**一个色值都不写**——按钮直接复用 `editor-pane.css:265-295` 已存在的 `.format-button`（它自带 `var(--text-secondary)` / `var(--surface-hover)` token，且本仓强调色必须走 `--focus`，见 `styles/agent-pane.css:2-3` 的告警）。
> 7. **按钮用文字标签，不挂图标**（当场回读：`types/icons.ts` 的 48 个 `IconName` 含 `bold`/`italic`/`list`/`quote`，**没有任何「标题」形状**；`AppIcon.vue` 的绘制分支同为 48 条）。给「标题」硬套 `book`/`ledger` 就是名字与动作不符，而本波不许新增绘制分支（不引依赖、不动资产），故四个按钮一律显示 `SNIPPET_LABELS` 的两个汉字。副收益：真机冒烟能按可读文本精确定位这四个按钮。

**Files:**

- Create: `apps/desktop/src/renderer/src/utils/markdown-snippets.ts`
- Create: `apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts`
- Create: `apps/desktop/src/renderer/src/utils/reading-time.ts`
- Create: `apps/desktop/src/renderer/src/utils/reading-time.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/DocumentPane.vue`（工具栏 + 页脚一格 + textarea 挂 ref；预算 ≤220）
- Modify: `apps/desktop/src/renderer/src/styles/interaction.css`（末尾追加一段，只补尺寸与字号）
- 条件性 Create（只在 Step 6 削减阶梯触发时）：`apps/desktop/src/renderer/src/components/DocumentTabBar.vue`
- **不动**：`package.json`、`tools/*`、`vitest.config.ts`、`.prettierignore`、`eslint.config.js`、`styles/editor-pane.css`、`contracts`、`fs-store`、任何 store。

**Interfaces:**

- Consumes: `useBookStore` 的 `draft` / `dirty` / `activeDocTab` / `onEdit`（`stores/useBookStore.ts:148-152`）、Task 6 的 `rightPaneMode` 三态、`styles/editor-pane.css` 的 `.editor-toolbar` / `.toolbar-spacer` / `.editor-text-tools` / `.format-button` / `.editor-footer-meta`。
- Produces（**签名逐字照共头「接口总表」**；`snippetToolbarState` 与 `SnippetButton` 是总表未写的本任务内部细节，按共头「本表没写的形状属于该任务内部细节」落）：

  ```ts
  // apps/desktop/src/renderer/src/utils/markdown-snippets.ts
  export const SNIPPET_KINDS = ["bold", "heading", "list", "quote"] as const;
  export type SnippetKind = (typeof SNIPPET_KINDS)[number];
  export const SNIPPET_LABELS: Record<SnippetKind, string>;     // 加粗 / 标题 / 列表 / 引用
  export interface SnippetSelection { value: string; start: number; end: number }
  export function applySnippet(kind: SnippetKind, sel: SnippetSelection): { value: string; start: number; end: number };
  export type SnippetToolbarMode = "manuscript" | "browse" | "dossier";
  export interface SnippetButton { kind: SnippetKind; label: string; disabled: boolean }
  export function snippetToolbarState(input: {
    mode: SnippetToolbarMode;
    hasActiveDoc: boolean;
  }): { visible: boolean; buttons: SnippetButton[] };

  // apps/desktop/src/renderer/src/utils/reading-time.ts
  export const READING_MINUTES_PER_WORD = 300;
  export function readingMinutes(text: string): number | null;
  ```

  > 若 Task 6 落地时把右栏三态抽成了具名类型（例如 `RightPaneMode`），`SnippetToolbarMode` 改成 import 那个类型，**不留两份字面量**；仍是行内联合类型就照上面写。

- [ ] **Step 1：前置实测（不实测就写代码 = 猜）**

```bash
wc -l apps/desktop/src/renderer/src/components/DocumentPane.vue
grep -n "toolbar-spacer\|editor-text-tools\|format-button\|editor-footer-meta" apps/desktop/src/renderer/src/styles/editor-pane.css
grep -o "name === '[a-z-]*'" apps/desktop/src/renderer/src/components/AppIcon.vue | wc -l
node -e 'const t=require("fs").readFileSync("apps/desktop/src/renderer/src/types/icons.ts","utf8");console.log("IconName 数="+(t.match(/^\s{2}"[a-z-]+"$/gm)||[]).length)'
grep -n "rightPaneMode" apps/desktop/src/renderer/src/stores/useBookStore.ts
```

把四个数抄进提交说明前的工作笔记：`DocumentPane.vue` 当前行数（HEAD 是 197，Task 6 之后会变，记实际值）、`.editor-text-tools`/`.format-button` 是否已在 `editor-pane.css:258-295` 在位（**必须在位**，本任务靠它免掉新样式）、图标分支数（HEAD 48）、`IconName` 数（HEAD 48，且 `grep -n '"heading"' apps/desktop/src/renderer/src/types/icons.ts` 必须**无输出**——这条就是「按钮用文字标签」的证据）。最后一行确认 `rightPaneMode` 已含 `"dossier"`（Task 6 已落地）。

- [ ] **Step 2：`utils/markdown-snippets.ts` 先写红**

新建 `apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts`（全文，勿删注）：

```ts
import { describe, expect, it } from "vitest";
import { SNIPPET_KINDS, SNIPPET_LABELS, applySnippet, snippetToolbarState } from "./markdown-snippets";

/** 三行夹具：行首分别在 0 / 9 / 22（UTF-16 码元下标），总长 25。 */
const THREE_LINES = "雾从海面涌上来。\n海雾涌上来，铁锈味很冲。\n第三行";

describe("md 片段表（铁律 6：标签只一份，模板不再抄）", () => {
  it("SNIPPET_KINDS 四条有序，SNIPPET_LABELS 键与之一致且中文逐字钉死", () => {
    expect(SNIPPET_KINDS).toEqual(["bold", "heading", "list", "quote"]);
    expect(Object.keys(SNIPPET_LABELS).sort()).toEqual([...SNIPPET_KINDS].sort());
    expect(SNIPPET_LABELS).toEqual({ bold: "加粗", heading: "标题", list: "列表", quote: "引用" });
  });
});

describe("applySnippet · 加粗（成对标记）", () => {
  it("非空选区：标记包在两端，返回下标把原文原样留给 setSelectionRange", () => {
    expect(applySnippet("bold", { value: "先读它", start: 0, end: 3 })).toEqual({
      value: "**先读它**",
      start: 2,
      end: 5
    });
  });

  it("空选区：两个标记相邻，光标落在正中（不是留在标记之前）", () => {
    expect(applySnippet("bold", { value: "海雾涌上来。", start: 0, end: 0 })).toEqual({
      value: "****海雾涌上来。",
      start: 2,
      end: 2
    });
  });

  it("跨行只包两端，不在每一行各加一对标记", () => {
    const next = applySnippet("bold", { value: THREE_LINES, start: 0, end: THREE_LINES.length });
    expect(next.value.slice(2, next.value.length - 2)).toBe(THREE_LINES);
    expect(next).toEqual({ value: `**${THREE_LINES}**`, start: 2, end: THREE_LINES.length + 2 });
  });

  it("下标口径是码元、内容口径是码点：光标停在表情正中也不把代理对劈开", () => {
    const next = applySnippet("bold", { value: "🐋海雾", start: 1, end: 1 });
    expect(next.value).toBe("**🐋海雾**");
    expect(next.value.slice(next.start, next.end)).toBe("🐋");
  });
});

describe("applySnippet · 标题（只作用首行）", () => {
  it("选区跨三行也只在首行行首加 ##，第二、三行行首不是 #", () => {
    const next = applySnippet("heading", { value: THREE_LINES, start: 0, end: THREE_LINES.length });
    expect(next.value).toBe(`## ${THREE_LINES}`);
    expect(next.start).toBe(3);
    expect(next.end).toBe(THREE_LINES.length + 3);
    const lines = next.value.split("\n");
    expect(lines[1]?.startsWith("#")).toBe(false);
    expect(lines[2]?.startsWith("#")).toBe(false);
  });
});

describe("applySnippet · 列表与引用（逐行前缀）", () => {
  it("跨行选区每行都加“- ”（变异 W8 的落点）", () => {
    expect(applySnippet("list", { value: THREE_LINES, start: 0, end: THREE_LINES.length })).toEqual({
      value: "- 雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。\n- 第三行",
      start: 2,
      end: THREE_LINES.length + 6
    });
  });

  it("选区从行中段起：被覆盖的行都加，没被碰到的首行不加", () => {
    const next = applySnippet("list", { value: THREE_LINES, start: 12, end: 23 });
    expect(next.value).toBe("雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。\n- 第三行");
    expect(next.start).toBe(14);
    expect(next.end).toBe(27);
  });

  it("已有“- ”的行不重复加（点两下不会变出“- - ”）", () => {
    const already = "- 雾\n- 海";
    expect(applySnippet("list", { value: already, start: 0, end: already.length })).toEqual({
      value: already,
      start: 0,
      end: already.length
    });
  });

  it("空选区时前缀落在当前行行首，光标随内容一起前移", () => {
    expect(applySnippet("list", { value: "雾从海面。\n次行", start: 4, end: 4 })).toEqual({
      value: "- 雾从海面。\n次行",
      start: 6,
      end: 6
    });
  });

  it("文档以换行开头且光标在 0：前缀插在第 0 行行首，不是插到换行之后", () => {
    expect(applySnippet("list", { value: "\n次行", start: 0, end: 0 })).toEqual({
      value: "- \n次行",
      start: 2,
      end: 2
    });
  });

  it("引用同样逐行，且与列表互不串标记", () => {
    const next = applySnippet("quote", { value: "第一段\n第二段", start: 0, end: 7 });
    expect(next.value).toBe("> 第一段\n> 第二段");
    expect(next).toEqual({ value: "> 第一段\n> 第二段", start: 2, end: 9 });
  });
});

describe("applySnippet · 下标归一化（反向与越界先能红）", () => {
  it("start > end 的倒选区与正选区结果逐字相同（不因方向产生两种形状）", () => {
    const forward = applySnippet("bold", { value: "先读它", start: 2, end: 3 });
    const backward = applySnippet("bold", { value: "先读它", start: 3, end: 2 });
    expect(backward).toEqual(forward);
    expect(forward.value).toBe("先读**它**");
  });

  it("下标越界被钳到文档两端，而不是抛异常或产出负下标", () => {
    expect(applySnippet("bold", { value: "先读它", start: -10, end: 999 })).toEqual({
      value: "**先读它**",
      start: 2,
      end: 5
    });
  });
});

describe("snippetToolbarState（附录 F-F：浏览态隐藏）", () => {
  it("浏览态与作品资料态都不显示工具栏——只读视图里点得出事的按钮不存在", () => {
    for (const mode of ["browse", "dossier"] as const) {
      expect(snippetToolbarState({ mode, hasActiveDoc: true }).visible).toBe(false);
    }
  });

  it("文稿态 + 有活动文稿：四个按钮按 SNIPPET_KINDS 顺序出，全部可点", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: true });
    expect(view.visible).toBe(true);
    expect(view.buttons.map((btn) => btn.label)).toEqual(["加粗", "标题", "列表", "引用"]);
    expect(view.buttons.map((btn) => btn.disabled)).toEqual([false, false, false, false]);
  });

  it("文稿态但没有活动文稿：按钮在位却 disabled（textarea 本就 readonly，不许假装改得动）", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: false });
    expect(view.visible).toBe(true);
    expect(view.buttons.map((btn) => btn.disabled)).toEqual([true, true, true, true]);
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts --maxWorkers=4`
Expected: FAIL —— `Cannot find module './markdown-snippets'`（17 条用例一条都不许绿）。

- [ ] **Step 3：`markdown-snippets.ts` 落地**

新建 `apps/desktop/src/renderer/src/utils/markdown-snippets.ts`（全文）：

```ts
/**
 * 右栏「插入 md 片段」的纯字符串改写（附录 F-F）。三条口径逐条有用例钉着：
 * 1. 下标口径 = UTF-16 码元：textarea 的 selectionStart/End 就是这个口径，返回的 start/end 要能直接喂回
 *    setSelectionRange，否则点一次按钮光标就跑到别处。
 * 2. 内容按码点算：一个表情是一个字，绝不把代理对劈成两半（本仓同类教训的原文见 timeline.ts 的 Array.from 注释）。
 * 3. 只插入、不反解析：已有前缀的行不再重复加，但点第二下不把标记摘掉——按钮文案是「列表」，
 *    不是「列表开关」（附录 §2.7：名字与动作不符也算摆设）。
 */

export const SNIPPET_KINDS = ["bold", "heading", "list", "quote"] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

/** 片段按钮的中文标签唯一来源：模板里不许出现第二个「加粗」。 */
export const SNIPPET_LABELS: Record<SnippetKind, string> = {
  bold: "加粗",
  heading: "标题",
  list: "列表",
  quote: "引用"
};

/** 成对标记：包在选区两端；空选区时两个标记相邻，光标落正中。 */
const PAIRED_MARKS: Partial<Record<SnippetKind, string>> = { bold: "**" };

/** 行首标记：文稿标题在 document-title-input 里另存，正文只用二级，别再顶出一个一级跟它抢。 */
const LINE_MARKS: Partial<Record<SnippetKind, string>> = {
  heading: "## ",
  list: "- ",
  quote: "> "
};

/** 逐行还是只作用首行：列表与引用逐行；标题即使选区跨三段也只加首行。变异 W8 改的就是这张表。 */
const PER_LINE: Record<SnippetKind, boolean> = {
  bold: false,
  heading: false,
  list: true,
  quote: true
};

export interface SnippetSelection {
  value: string;
  start: number;
  end: number;
}

export interface SnippetResult {
  value: string;
  start: number;
  end: number;
}

/** 右栏三态（Task 6 的 useBookStore.rightPaneMode）。那一波若抽出具名类型，这里改 import，不留第二份字面量。 */
export type SnippetToolbarMode = "manuscript" | "browse" | "dossier";

export interface SnippetButton {
  kind: SnippetKind;
  label: string;
  disabled: boolean;
}

/**
 * 工具栏「谁可见、谁可点」（附录 F-F 明写浏览态隐藏）。
 * 作品资料态同样是只读视图，按钮在那儿点不出任何事 ⇒ 一并隐藏；
 * 没有活动文稿时按钮在位但 disabled：草稿还不存在，点了改谁？
 */
export function snippetToolbarState(input: {
  mode: SnippetToolbarMode;
  hasActiveDoc: boolean;
}): { visible: boolean; buttons: SnippetButton[] } {
  const visible = input.mode === "manuscript";
  const disabled = visible && !input.hasActiveDoc;
  const buttons = SNIPPET_KINDS.map((kind) => ({
    kind,
    label: SNIPPET_LABELS[kind],
    disabled
  }));
  return { visible, buttons };
}

function isHighSurrogate(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 该下标是否正好落在一对代理中间（会把一个表情劈成两半的位置）。 */
function splitsPair(value: string, index: number): boolean {
  return (
    index > 0 &&
    index < value.length &&
    isHighSurrogate(value, index - 1) &&
    isLowSurrogate(value, index)
  );
}

/** 起点前移、终点后移：整个码点让给选区，绝不用半截代理去拼字符串。 */
function snapStart(value: string, index: number): number {
  return splitsPair(value, index) ? index - 1 : index;
}

function snapEnd(value: string, index: number): number {
  return splitsPair(value, index) ? index + 1 : index;
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/**
 * 与选区相交的行首（码元下标，升序，至少一个）。
 * everyLine=false 只要首行；空选区只要光标那一行。
 * 只按 "\n" 找行首：换行永远是一个码元，代理对里不可能含它，故这条通路不会因码点/码元混用而错位。
 */
function lineHeads(value: string, start: number, end: number, everyLine: boolean): number[] {
  const first = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const heads = [first];
  if (!everyLine || start === end) return heads;
  let cursor = first;
  while (cursor < end) {
    const newline = value.indexOf("\n", cursor);
    if (newline === -1 || newline >= end) break;
    heads.push(newline + 1);
    cursor = newline + 1;
  }
  return heads;
}

/**
 * 纯函数：不改入参、不抛异常、返回新字符串与新下标。
 * 成对标记（加粗）作用于选区两端；行首标记（标题/列表/引用）插在行首，已有的不重复加。
 */
export function applySnippet(kind: SnippetKind, sel: SnippetSelection): SnippetResult {
  const value = sel.value;
  let start = clamp(sel.start, value.length);
  let end = clamp(sel.end, value.length);
  if (end < start) {
    const swap = start;
    start = end;
    end = swap;
  }
  start = snapStart(value, start);
  end = snapEnd(value, end);
  if (end < start) end = start;

  const paired = PAIRED_MARKS[kind];
  if (paired !== undefined) {
    const wrapped = `${paired}${value.slice(start, end)}${paired}`;
    return {
      value: `${value.slice(0, start)}${wrapped}${value.slice(end)}`,
      start: start + paired.length,
      end: end + paired.length
    };
  }

  const mark = LINE_MARKS[kind];
  if (mark === undefined) return { value, start, end };
  const heads = lineHeads(value, start, end, PER_LINE[kind]);
  let nextValue = value;
  let addedTotal = 0;
  let addedBeforeStart = 0;
  // 从后往前插：前面的插入会把后面的行首下标顶歪，倒着走就不必重算。
  for (const head of heads.slice().reverse()) {
    if (nextValue.slice(head, head + mark.length) === mark) continue;
    nextValue = `${nextValue.slice(0, head)}${mark}${nextValue.slice(head)}`;
    addedTotal += mark.length;
    if (head <= start) addedBeforeStart += mark.length;
  }
  return { value: nextValue, start: start + addedBeforeStart, end: end + addedTotal };
}
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts --maxWorkers=4`
Expected: PASS —— `Test Files 1 passed (1)` / `Tests 17 passed (17)`。
Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断（`tsconfig.base.json` 有 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`：所以逐行循环走 `for (const head of heads.slice().reverse())` 而不是 `heads[i]`）。

- [ ] **Step 4：`utils/reading-time.ts` 先写红，再落地**

新建 `apps/desktop/src/renderer/src/utils/reading-time.test.ts`（全文）：

```ts
import { describe, expect, it } from "vitest";
import { READING_MINUTES_PER_WORD, readingMinutes } from "./reading-time";

describe("readingMinutes（附录 F-G：中文 300 字/分钟，向上取整）", () => {
  it("换算常数就是 300，别哪天漂成 200", () => {
    expect(READING_MINUTES_PER_WORD).toBe(300);
  });

  it("整除不多取：900 字是 3 分钟", () => {
    expect(readingMinutes("雾".repeat(900))).toBe(3);
  });

  it("向上取整：901 字进到 4 分钟，绝不四舍五入成 3", () => {
    expect(readingMinutes("雾".repeat(901))).toBe(4);
  });

  it("一个字也是 1 分钟，不许出现 0 分钟", () => {
    expect(readingMinutes("雾")).toBe(1);
  });

  it("空串返回 null 而不是 0：模板据此显示「— 分钟」", () => {
    expect(readingMinutes("")).toBeNull();
  });

  it("只有空白返回 null：全角空格、制表、换行都不算字", () => {
    expect(readingMinutes("   \n\t 　 \r\n")).toBeNull();
  });

  it("空白不计入字数：900 个字夹 900 个空白仍是 3 分钟", () => {
    expect(readingMinutes("雾 雾\n雾\t雾" + "雾".repeat(896))).toBe(3);
  });

  it("按码点数而不是 UTF-16 码元：300 个表情是 1 分钟，按码元会算成 2 分钟", () => {
    expect(readingMinutes("🐋".repeat(300))).toBe(1);
    expect(readingMinutes("雾".repeat(300))).toBe(1);
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/reading-time.test.ts --maxWorkers=4`
Expected: FAIL —— `Cannot find module './reading-time'`（8 条用例一条都不许绿）。

新建 `apps/desktop/src/renderer/src/utils/reading-time.ts`（全文）：

```ts
/** 中文阅读速度：300 字/分钟（附录 F-G 定死的口径，改它要有理由，不许模板里另算一遍）。 */
export const READING_MINUTES_PER_WORD = 300;

/**
 * 估算阅读时长，向上取整：读不完一分钟也算一分钟，「约 0 分钟阅读」是句假话。
 * 「字」= 去掉空白之后的**码点**：按 UTF-16 码元数会把一个表情算成两个字（本仓教训见 timeline.ts 的 Array.from 注释）。
 * 去空白后一个字都没有 ⇒ null，由模板显示「— 分钟」：这里不返回字符串，
 * 免得换算与文案互相夹带（页脚那一格的口径是「算术不在模板里写」，反过来也一样）。
 */
export function readingMinutes(text: string): number | null {
  let count = 0;
  for (const ch of Array.from(text)) {
    if (ch.trim() !== "") count += 1;
  }
  if (count === 0) return null;
  return Math.ceil(count / READING_MINUTES_PER_WORD);
}
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/reading-time.test.ts apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts --maxWorkers=4`
Expected: PASS —— `Test Files 2 passed (2)` / `Tests 25 passed (25)`。

- [ ] **Step 5：`DocumentPane.vue` 接线（一次把两面都接上，并当场把三枚页签表格化省行）**

脚本区四处改动（锚点是 HEAD 原文，Task 6 之后按内容找）：

1. `import { computed } from "vue";` 改成：

```ts
import { computed, nextTick, ref } from "vue";
```

2. `import { useBookStore } from "../stores/useBookStore";` 之后加两行：

```ts
import { applySnippet, snippetToolbarState, type SnippetKind } from "../utils/markdown-snippets";
import { readingMinutes } from "../utils/reading-time";
```

3. `const characterCount = computed(() => book.draft.length);` 之后加（`editorEl` 挂在 textarea 上，见下）：

```ts
const editorEl = ref<HTMLTextAreaElement | null>(null);

/** 工具栏的可见/可点判定全在 utils/markdown-snippets.ts，模板只接线（本仓 .vue 零自动化覆盖）。 */
const snippetToolbar = computed(() =>
  snippetToolbarState({ mode: mode.value, hasActiveDoc: book.activeDocTab !== null })
);

/** 页脚那一格只拼文案：字数与时长都算 book.draft，与浏览/作品资料页无关——与「字」那一格同源。 */
const readingTimeLabel = computed(() => {
  const minutes = readingMinutes(book.draft);
  return minutes === null ? "— 分钟" : `约 ${minutes} 分钟阅读`;
});
```

4. `function onContentInput(event: Event): void { ... }` 之后加（**这条就是「片段结果与手打完全同路」的全部内容**）：

```ts
/** 读 textarea 真实选区 → 纯函数改写 → book.onEdit → 回设光标；除此之外不做任何事，不写盘、不碰 DOM 结构。 */
function applyToSelection(kind: SnippetKind): void {
  const el = editorEl.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const next = applySnippet(kind, { value: el.value, start, end });
  book.onEdit(next.value);
  void nextTick(() => {
    el.focus();
    el.setSelectionRange(next.start, next.end);
  });
}
```

模板三处改动：

5. `editor-toolbar` 里的页签块——Task 6 落地后是三段手写的 `<button>`（文稿 / 浏览 / 作品资料，约 31 行）。**本步把它换成一张表 + 一个 `v-for`**，标签文案逐字沿用 Task 6 落地的三个字面量，一字不许改：

```ts
/** 右栏三枚页签的唯一标签表（Task 6 落地的三个字面量搬进这里，模板不再各写一遍）。 */
const viewTabs: { mode: SnippetToolbarMode; label: string }[] = [
  { mode: "manuscript", label: "文稿" },
  { mode: "browse", label: "浏览" },
  { mode: "dossier", label: "作品资料" }
];
```

```html
      <div class="view-tabs" role="tablist" aria-label="右栏内容来源">
        <button
          v-for="tab in viewTabs"
          :key="tab.mode"
          type="button"
          role="tab"
          :aria-selected="mode === tab.mode"
          :class="{ 'is-active': mode === tab.mode }"
          @click="switchMode(tab.mode)"
        >
          {{ tab.label }}
        </button>
      </div>
```

> `switchMode` 的入参类型必须是 Task 6 落地后的三态（HEAD 的 `function switchMode(next: "manuscript" | "browse")` 要已含 `"dossier"`）。若 Task 6 是用 `book.openDossier()` 直连第三枚按钮、`switchMode` 仍只收两态：把 `@click` 写成 `@click="tab.mode === 'dossier' ? book.openDossier() : switchMode(tab.mode)"` 的那一行**不许出现**（模板里做判断），改为把 `switchMode` 补成收三态、内部 `if (next === "dossier") return book.openDossier();`——判断回到函数里，行数只多一行。

6. `<span class="toolbar-spacer" />` 之后加工具栏（附录 F-F 的「右侧、浏览态隐藏」）：

```html
      <div v-if="snippetToolbar.visible" class="editor-text-tools" aria-label="插入 md 片段">
        <button
          v-for="btn in snippetToolbar.buttons"
          :key="btn.kind"
          class="format-button"
          type="button"
          :disabled="btn.disabled"
          :title="btn.label"
          @click="applyToSelection(btn.kind)"
        >
          {{ btn.label }}
        </button>
      </div>
```

7. textarea（HEAD `:162-170`，属性一行一个）加一行 `ref="editorEl"`；页脚 `editor-footer-meta`（HEAD `:182-185`）里「字」那一格之后加：

```html
        <span class="reading-time">{{ readingTimeLabel }}</span>
```

样式：`styles/interaction.css` 末尾追加（**不写任何色值**，颜色全交给已存在的 `.format-button` 规则）：

```css
/* 右栏 md 片段工具栏（Task 10 / F-F）：复用 editor-pane.css 的 .format-button 尺寸与 token，
   只把「两个汉字标签」需要的字号与内边距补上。不新开样式文件、不写死色值。 */
.editor-text-tools .format-button {
  width: auto;
  min-width: 27px;
  padding: 0 5px;
  font-size: 0.678571rem;
  font-weight: 600;
}

.editor-footer .reading-time {
  flex: 0 0 auto;
}
```

- [ ] **Step 6：行数预算实测与削减阶梯（这一格不许「大约」）**

```bash
wc -l apps/desktop/src/renderer/src/components/DocumentPane.vue
corepack pnpm exec prettier --check apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/utils/markdown-snippets.ts apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts apps/desktop/src/renderer/src/utils/reading-time.ts apps/desktop/src/renderer/src/utils/reading-time.test.ts apps/desktop/src/renderer/src/styles/interaction.css
corepack pnpm exec eslint apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/utils/markdown-snippets.ts apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts apps/desktop/src/renderer/src/utils/reading-time.ts apps/desktop/src/renderer/src/utils/reading-time.test.ts --max-warnings=0
corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm vitest run apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts apps/desktop/src/renderer/src/utils/reading-time.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4
node tools/check-source-line-budget.mjs
```

**预算规则**：`DocumentPane.vue` 必须 `wc -l` ≤220（共头「契约变更总表」最后一行；800 行的机器门禁在 `tools/check-source-line-budget.mjs:5`，本波自设的更紧预算靠人跑 `wc -l`）。Step 5 的净增量按 HEAD 估算是 +39（脚本 23 / 模板 16），Step 5 第 5 项的页签表格化回收约 −15，Task 6 的净增约 +17 ⇒ 落在 215–235 之间，**必须实测**。

- [ ] 实测 ≤220 ⇒ 抄下数字，进 Step 7。
- [ ] 实测 >220 ⇒ **按顺序**执行下列削减，每做完一档就复跑 `wc -l`，回落即停（不许一次做三档然后回过头来猜）：

  **档 1（省约 24 行）**：把 `section-tabs-bar`（HEAD `:103-128` 的文件标签条）抽成 `components/DocumentTabBar.vue`——这正是 Task 6 的 Step 5 第 4 条预留的同一个 seam，**不另造新 seam、不新开样式文件**。新组件全文：

  ```vue
  <!-- 右栏文件标签条（从 DocumentPane.vue 抽出，纯展示：判定与 store 调用都留在父组件）。 -->
  <script setup lang="ts">
  import AppIcon from "./AppIcon.vue";

  defineProps<{ tabs: { id: string; title: string }[]; activeId: string | null }>();
  const emit = defineEmits<{ select: [id: string]; close: [] }>();
  </script>

  <template>
    <nav class="section-tabs-bar" aria-label="右栏标签">
      <div class="section-tabs-scroll" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="section-tab"
          :class="{ 'is-active': tab.id === activeId }"
          type="button"
          role="tab"
          :aria-selected="tab.id === activeId"
          :title="tab.title"
          @click="emit('select', tab.id)"
        >
          {{ tab.title }}
        </button>
      </div>
      <button
        v-if="tabs.length"
        class="section-tabs-remove"
        type="button"
        aria-label="关闭当前标签"
        @click="emit('close')"
      >
        <AppIcon name="minus" :size="16" />
      </button>
    </nav>
  </template>
  ```

  父侧只留两行：`<DocumentTabBar :tabs="tabs" :active-id="activeTabId" @select="selectTab" @close="closeActiveTab" />`（prettier 会把它折成 7 行，仍净省 ~17 行）+ 一行 import。`aria-label` 原本按 mode 分「文稿标签 / 浏览标签」，抽出后这句文案**不许丢**：把它做成 prop `label: string`，父侧 `:label="mode === 'manuscript' ? '文稿标签' : '浏览标签'"`（这是模板里的三元，属于文案选择而非判定逻辑，与本仓既有页脚写法同例；若评审坚持下沉，就在 `markdown-snippets.ts` 之外单开一个函数——本任务选择保留在父侧并如实记账）。

  **档 2（省约 6 行）**：`breadcrumbs`（HEAD `:18-26`）压成 `filter` + `join` 的形状，语义一字不变（面包屑仍是 书名 / kind / 标题）。
  **档 3（省约 12 行，最后手段）**：把工具栏那 14 行 markup 拆成 `components/SnippetToolbar.vue`（props `{ buttons: SnippetButton[] }`，`emits: { pick: [kind: SnippetKind] }`）。**读选区 → `applySnippet` → `book.onEdit` 仍留在 DocumentPane**（共头接口总表那条：「DocumentPane.vue 片段按钮 emit 不外抛」= 事件只到父级 DocumentPane，不再往外），父侧只剩 `<SnippetToolbar :buttons="snippetToolbar.buttons" @pick="applyToSelection" />`。

- [ ] 削减阶梯走完仍 >220 ⇒ **停手，不许把按钮砍成三个、不许把注释删了凑数、不许私改预算数字**。在提交说明里写清实测行数与卡在哪一步，交控制方裁定（这一条是「超限即拆」的铁律，不是软目标）。

- [ ] **Step 7：提交**

```bash
git status --porcelain
git add apps/desktop/src/renderer/src/utils/markdown-snippets.ts apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts apps/desktop/src/renderer/src/utils/reading-time.ts apps/desktop/src/renderer/src/utils/reading-time.test.ts apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/styles/interaction.css
corepack pnpm verify > scratch/verify-wave15-task10.log 2>&1; echo "VERIFY_EXIT=$?"
grep -nE "VERIFY_EXIT=0|Test Files|Tests |边界检查通过|行数预算通过" scratch/verify-wave15-task10.log
```

- [ ] `VERIFY_EXIT=0`（链尾自印与 shell 侧各一道，**`verify` 命令本身不许接管道**；上面那条 `grep` 扫的是日志文件，不是门禁命令）。
- [ ] 确认没有新增写盘通路：`git diff --cached -U0 -- apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/utils | grep "^+.*writeDoc"` —— 期望无输出。片段改动只经 `onEdit`（`useBookStore.ts:148-152`）。
- [ ] 确认没有 `contenteditable`：`git diff --cached -U0 -- apps/desktop/src/renderer/src | grep "^+.*contenteditable"` —— 期望无输出（附录 §2.2 不做 WYSIWYG）。
- [ ] 确认没有新增样式文件、没有硬编码色值：`git diff --cached --name-only` 里样式文件只许出现 `styles/interaction.css`；`git diff --cached -U0 -- apps/desktop/src/renderer/src/styles/interaction.css apps/desktop/src/renderer/src/components/DocumentPane.vue | grep -E "^\+.*#[0-9a-fA-F]{3,8}"` —— 期望无输出。

```bash
git commit -m "feat(ui): 右栏 md 片段工具栏与页脚阅读时长（波 1.5 Task 10 / F-F + F-G）"
```

> 若档 1/档 3 触发，把新建的 `DocumentTabBar.vue` / `SnippetToolbar.vue` 一并 `git add`（按文件名加，不用 `git add -A`）。

- [ ] **Step 8：变异 W8（先提交再变异，评审者自己重跑，不采信转录）**

手法照波 1 台账：只用 `Edit` 改代码（**禁 `perl -i` / `sed -i`**），单跑点名文件带 `--maxWorkers=4`（本机 dev 常年常年在跑，全量 vitest 会假红且每次红的文件不同），改回后复跑绿，最后 `git diff --exit-code` 必须干净。

| 编号 | 变异动作 | 单跑命令 | 该转红的断言 |
| --- | --- | --- | --- |
| W8 | `utils/markdown-snippets.ts` 的 `PER_LINE` 里把 `list: true` 改成 `list: false`（等价于「`applySnippet("list")` 只作用首行」） | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts --maxWorkers=4` | `FAIL … > 跨行选区每行都加“- ”（变异 W8 的落点）` 与 `FAIL … > 选区从行中段起：被覆盖的行都加，没被碰到的首行不加`——后者转红的形状是 `AssertionError: expected '雾从海面涌上来。\n- 海雾…' to be '雾从海面涌上来。\n- 海雾…'`（第 3 行少前缀 ⇒ 字符串不等） |

- [ ] 红证据与改回绿证据都贴进台账原文（**两条**都转红才算 W8 有鉴别力；只红一条说明另一条断言写虚了，回去补）。
- [ ] 追加自证（同法，各跑一遍再改回，用来证明「表外不可达」与「码点口径不是装饰」）：
  ① `LINE_MARKS` 里把 `heading: "## "` 改成 `heading: "# "` ⇒ 标题用例红（证明中文层级钉在断言里，不是随手写的）；
  ② `snapStart` 的返回值改成 `index`（即取消代理对归整）⇒ 「光标停在表情正中」用例红，红形是 `AssertionError: expected '**\udcae海雾**' …`（出现孤立代理即证这条断言真能失败）。
- [ ] 变异全部改回后：`git diff --exit-code` 与 `git status --porcelain` 都干净（`scratch/` 在 `.gitignore` 里，日志不进版本库）。

**验收口径（本任务交付定义，Task 11 的真机矩阵照此点）**：四个按钮在文稿态可点、在浏览与作品资料态不出现；点「加粗」后右栏出现 `**…**` 且光标停在原文两端，`dirty` 变 true；点「列表」把跨行选区每一行都变成 `- `；页脚同时出现「N 字」与「约 M 分钟阅读」，清空正文后页脚出现「— 分钟」；这一改动随后能走通「提案 → 批准 → `.mochen/changes/<时间戳>/` 备份」。

---

### Task 11：波 1.5 门禁、变异台账与真机冒烟（不写新功能，含波 1 六格留白的认领）

> 本任务只做四件事：**跑对全链门禁两遍并回读**、**照共头「契约变更总表」逐行对账**、**W1–W8 台账自跑**、**按附录 §5 真机实操并落一份台账文档**。
> 三条硬纪律：① 门禁命令后面不许接任何管道（管道吞退出码，波 1 报告第 6 行的取码姿势照抄）；② 真机 UI 操作与代码评审**不委托给子代理**，由控制方本人执行（共头 Global Constraints 末条）；③ **凡只有单测证据、没做真机操作的格子，一律明写「未证」**——mock 的绿不是真机的绿（波 1 报告第 60 行「端点差异（先说清）」那种写法）。

**Files:**

- Create: `docs/superpowers/plans/2026-10-03-plan3-wave1-5-report.md`（格式照 `docs/superpowers/plans/2026-10-02-plan3-wave1-report.md`）
- Modify: `docs/superpowers/plans/2026-10-03-plan3-wave1-5-ui-fusion.md`（本波 11 个任务的 `- [ ]` 逐条勾成 `- [x]`，只勾真做完并验证过的；没闭合的留着并在旁边一行说明为什么——波 1 计划/报告的两段式做法）
- Modify: `docs/superpowers/plans/README.md`（本波条目回改，见 Step 7 第 3 项）
- 只读核对：`packages/contracts/src/ipc.ts:11,44`、`packages/contracts/src/patch.ts:16`、`packages/contracts/src/book.ts:15,22,34`、`packages/contracts/test/agent.test.ts`、`apps/desktop/src/preload/renderer-api.test.ts:102,135`、`apps/desktop/src/renderer/src/utils/escape-policy.ts:1`、`apps/desktop/src/renderer/src/stores/useAgentStore.ts:39`、`tools/check-source-line-budget.mjs:5`
- **不改**：任何源码、任何门禁脚本、`.prettierignore`、`eslint.config.js`、`package.json`。发现红 ⇒ 回对应任务修，不许关规则。

**Interfaces:**

- Consumes: Task 1–10 的全部落地物。
- Produces: 无新接口，只产台账与勾选状态。

- [ ] **Step 1：前置检查**

```bash
git log --oneline -12
git status --porcelain
corepack pnpm install --frozen-lockfile
node -e 'const t=require("fs").readFileSync("apps/desktop/src/renderer/src/stores/useAgentStore.ts","utf8");console.log("QUEUED_MAX=",/export const QUEUED_MAX = (\d+)/.exec(t)?.[1])'
```

- [ ] `git log --oneline -12` 里必须能看到 Task 1–10 的十个功能提交（缺一个就还没到门禁，回去做完）。
- [ ] `git status --porcelain` 干净（`scratch/`、`out/`、`node_modules/`、`.mochen/` 都在 `.gitignore` 里；`.mochen/` 与冒烟用书**永远不进版本库**）。
- [ ] 确认没有别的 `vitest` / `electron` 在跑：Windows 上重启 dev 与收冒烟实例用带进程树的方式，Git Bash 里双斜杠转义——`taskkill //F //T //IM electron.exe`（没有残留进程时它会报错，不拦路）。**只杀自己起的实例**：用户正在用的 9223 实例（如果他还开着）不要当成垃圾杀掉，本波冒烟另起端口。
- [ ] `node` 版本与用例基线复核：`node -e 'console.log(process.version)'`（要求 v24）；静态数一遍当前用例数（只数 `it(`/`test(` 出现次数，两处 `it.each` 各自展开会多算，落账以 Step 2 日志为准）：

```bash
grep -rhoE "^[[:space:]]*(it|test)(\.each|\.skip)?\(" --include=*.test.ts --include=*.test.mjs packages apps/desktop/src tools | wc -l
find packages -name "*.test.ts" -path "*/test/*" | wc -l
find apps/desktop/src -name "*.test.ts" | wc -l
find tools -maxdepth 1 -name "*.test.mjs" | wc -l
```

HEAD（本波开工前）实测：`471` 个 `it(`/`test(` 行（含两条 `it.each` 各计一次）+ `it.each` 展开的 5 次 = **476 用例**；文件数 `15 + 26 + 2 = 43`。与波 1 报告第 7 行记录的 `Test Files 43 passed (43)` / `Tests 476 passed (476)` 对得上 ⇒ 基线成立。

- [ ] **Step 2：全链门禁两遍（第一遍可落日志，第二遍不经任何管道）**

第一遍（允许把日志落文件后再随便 `grep`/`tail` 那个**文件**）：

```bash
corepack pnpm verify > scratch/verify-wave15-1.log 2>&1; echo "VERIFY_EXIT=$?"
grep -nE "VERIFY_EXIT=0|Test Files|Tests |边界检查通过|行数预算通过" scratch/verify-wave15-1.log
```

第二遍（**同一条命令再跑一遍**，取码姿势是 `; echo "VERIFY_EXIT=$?"`，命令与本波计划里钉死的写法逐字一致、后面不接任何管道）：

```bash
corepack pnpm verify > scratch/verify-wave15-final2.log 2>&1; echo "VERIFY_EXIT=$?"
grep -nE "VERIFY_EXIT=0|Test Files|Tests |All matched files|边界检查通过|行数预算通过" scratch/verify-wave15-final2.log
```

必须回读四样并抄进报告（**逐字，不许写「全绿」**）：

1. shell 侧打印的退出码 `VERIFY_EXIT=0` 与日志尾部链自印的 `VERIFY_EXIT=0`（`package.json:24` 的 `verify` 串最后一步才 `echo` 它，两道都在案才算退出码没被吞）。
2. `Test Files N passed (N)` 与 `Tests N passed (N)` 两行原文。
3. prettier 段 `All matched files use Prettier code style!`，且 `grep -c "\[warn\]" scratch/verify-wave15-final2.log` 回读为 `0`。
4. 五个 tsc 项目零诊断 + `eslint . --max-warnings=0` 无告警 + `边界检查通过` + `行数预算通过`。

**用例数基线与本波净增下限**（不许拍脑袋：下表每一格都能指回共头「文件结构」点名的用例，指不出来的不算进下限）：

| 任务 | 新增测试文件 | 用例下限（共头点名的最少几条） | 点名出处 |
| --- | --- | --- | --- |
| Task 1（Esc 收浮层） | 0（追加进 `escape-policy.test.ts`） | 5 | 「追加优先级矩阵（说明框 > 取消该条 > 收浮层 > 打断 > 无动作）」五行 |
| Task 2（档位 chip 说实话） | 1（`permission-chip.test.ts`） | 4 | `permissionChipView` 的无书 / 有书 / saving / disabled 四态 |
| Task 3（`stale` 随回放存活） | 0（追加三处） | 8 | `timeline.test.ts`「追加三条」+ `agent.test.ts`「两条」+ `agent-service.test.ts`「一条」+ 判别联合一条 + **裁定 A**「写盘竞态也发 error」一条（Step 1d） |
| Task 4（预填通路） | 1（`composer-draft.test.ts`） | 3 | `prefillText` 三向：已有草稿不吞 / 空则填 / 纯空白算空 |
| Task 5（`excerpt`） | 0（追加两处） | 5 | `scan.test.ts`「四类」+ `contract.test.ts`「缺 excerpt 不抛」一条 |
| Task 6（作品资料） | 1（`book-dossier.test.ts`） | 5 | 五类分组 / 空组不出现（W6）/ 摘要 / 顺序 + `useBookStore.test.ts`「三态往返」一条 |
| Task 7（工作台） | 1（`workbench-state.test.ts`） | 4 | `workbenchVisible` 两向（W7）+ 四卡标签 + `workbenchTarget` 回落 |
| Task 8（左栏三段） | 1（`left-sidebar-nav.test.ts`，源码契约） | 4 | 三段各调一个真身（`pickAndOpen` / `showSettings("general")` / `clearThreadView(threadKeyFor(...))`）+ 文案诚实与 `:disabled` 判定 |
| Task 9（chip 行） | 1（`composer-chips.test.ts`） | 4 | 两枚 chip + 权限 chip 复用 `permissionChipView` + 无书诚实 + **裁定 C**「排队」二字不出现在 chip 文案 |
| Task 10（片段 + 时长） | 2（`markdown-snippets.test.ts` + `reading-time.test.ts`） | 25 | Step 2/Step 4 的文件全文，逐条数出来：17 + 8 |
| **合计下限** | **+8 文件** | **+67 用例** | 5+4+8+3+5+5+4+4+4+25，逐行相加 |

- [ ] 期望：**`Test Files` = 51**（43 + 8），**`Tests` ≥ 543**（476 + 67）；上限不设（各任务评审轮通常会补反向与越界案，波 1 就是这样从估算 451 涨到实测 476）。
- [ ] 实测落在下限之下 ⇒ **按缺口回对应任务补**，最容易被省的是 Task 1 的浮层优先级矩阵与 Task 6 的「空组不出现」；**不许把下限改小来迁就实测**。
- [ ] `行数预算通过` 之外另跑一次点名文件（机器门禁只管 800 行，本波自设的 220/400 要靠人）：

```bash
node tools/check-source-line-budget.mjs
node tools/check-package-boundary.mjs
wc -l apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/utils/markdown-snippets.ts apps/desktop/src/renderer/src/utils/reading-time.ts
```

期望逐字：`行数预算通过`、`边界检查通过`；`DocumentPane.vue` ≤220、`CenterColumn.vue` ≤400、其余单文件 ≤800。实测值抄进报告「行号与预算」节，**并写清哪些行号是本波改过的**（Task 9 报告里那份「本波改动的行号清单」格式：`文件名:行号 改动一句话`）。

- [ ] **Step 3：契约变更表对账（共头「契约变更总表」逐行给命令与实测值）**

本机 `python` 不可用，切片一律 `node -e`（下面六条在 HEAD 上实测可用，输出逐字附后）。

```bash
node -e 'const s=require("fs").readFileSync("packages/contracts/src/ipc.ts","utf8");const b=s.slice(s.indexOf("IPC_CHANNELS"),s.indexOf("} as const"));console.log("IPC键数="+(b.match(/:\s*"[a-z-]+:/g)||[]).length)'
node -e 'const s=require("fs").readFileSync("packages/contracts/src/ipc.ts","utf8");const i=s.indexOf("export interface RendererApi");const b=s.slice(i,s.indexOf("\n}",i));console.log("RendererApi方法数="+(b.match(/^ {2}\w+/gm)||[]).length)'
node -e 'const s=require("fs").readFileSync("packages/contracts/src/patch.ts","utf8");const i=s.indexOf("export const PROPOSAL_STATUSES");const b=s.slice(i,s.indexOf("];",i));console.log("PROPOSAL_STATUSES="+(b.match(/"[a-z-]+"/g)||[]).length)'
node -e 'const s=require("fs").readFileSync("apps/desktop/src/renderer/src/stores/useAgentStore.ts","utf8");const b=s.slice(s.indexOf("export interface ThreadView"),s.indexOf("export interface ProposalView"));console.log("ThreadView字段数="+(b.match(/^\s{2}\w+/gm)||[]).length)'
node -e 'const s=require("fs").readFileSync("apps/desktop/src/renderer/src/utils/escape-policy.ts","utf8");const i=s.indexOf("export type EscapeAction");const b=s.slice(i,s.indexOf(";",i));console.log("EscapeAction="+(b.match(/"[a-z-]+"/g)||[]).length)'
node -e 'const s=require("fs").readFileSync("packages/contracts/src/book.ts","utf8");const i=s.indexOf("export interface DocRef");const b=s.slice(i,s.indexOf("\n}",i));console.log("DocRef字段数="+(b.match(/^ {2}\w+/gm)||[]).length)'
grep -nE "expect\(calls\.length\)\.toBe\([0-9]+\)|渲染层只拿到这" apps/desktop/src/preload/renderer-api.test.ts
grep -n "schemaVersion" packages/contracts/src/book.ts
grep -rn "proposalId" packages/contracts/src/agent-event.ts
```

HEAD（本波开工前）实测输出：`IPC键数=13`、`RendererApi方法数=13`、`PROPOSAL_STATUSES=7`、`ThreadView字段数=10`、`EscapeAction=4`、`DocRef字段数=3` —— 后两项是本波要抬的，前四项必须**一动不动**。

对账表（报告里照此逐行填实测值；与期望不符就是本波未完成）：

| 项 | 波 1 后现值 | 波 1.5 期望 | 实际 |
| --- | --- | --- | --- |
| `IPC_CHANNELS` 键数 / `RendererApi` 方法数 | 13 / 13 | **13 / 13（一条不加）**，且 `renderer-api.test.ts:102` 的 `toBe(13)` 与 `:135` 的「渲染层只拿到这 13 个方法」两处字面量仍是 13 | |
| `PROPOSAL_STATUSES` | 7 | 7（`expired` 语义不动，`stale` 改判不开新状态） | |
| `error` 事件字段 | 3（id/ts/turnId）+ type + message | += `proposalId?`（可选，Task 3） | |
| `DocRef` | 3 字段 | 4 字段（`excerpt?`，Task 5） | |
| `ThreadView` 字段 | 10 | **10（不动）**：草稿是 store 顶层 map（设计决定 3） | |
| `EscapeAction` | 4 | 5（+`close-overlay`，Task 1） | |
| `book.json` `schemaVersion` | 1 | 1 | |
| 单文件行数 | `CenterColumn.vue` 304 / `DocumentPane.vue` 197 | ≤400 / ≤220（Step 2 末的 `wc -l` 原文） | |

- [ ] 附加两条「不许有」的检查（本波不开新通道、不新增工具、不新增写盘通路）：
  `grep -rn "IPC_CHANNELS\[" packages apps/desktop/src` 与 `grep -rEn "writeDoc|saveMeta" apps/desktop/src/renderer/src/utils` —— 后者期望无输出（utils 里绝不出现写盘调用）。
  工具集仍 5 个：`node -e 'const t=require("fs").readFileSync("packages/contracts/src/agent-tool.ts","utf8");console.log((t.match(/"[a-z_]+"/g)||[]).join(" "))'`，期望恰好 `read_doc list_docs search_docs propose_patch write_doc`（若该常量不在 `agent-tool.ts`，先 `grep -rn "AGENT_TOOL_NAMES" packages/contracts/src` 定位再切片，别改文件）。

- [ ] **Step 4：变异台账 W1–W8（控制方本人一次跑完，不转录实现者的话）**

统一手法（逐条照做，顺序不许多不许少）：`git status --porcelain` 干净 → 只用 `Edit` 做变异（**禁 `perl -i`/`sed -i`**）→ 单跑点名的测试文件带 `--maxWorkers=4` → 粘贴 `FAIL` 与 `AssertionError` 原文 → `Edit` 改回 → 复跑绿 → 下一条。八条跑完再 `git diff --exit-code`，必须干净。

| 编号 | 变异动作（共头原文） | 单跑命令 | 该转红的断言（用例名） | 实测转红原文（当场粘贴） | 改回 |
| --- | --- | --- | --- | --- | --- |
| W1 | `resolveEscape` 删掉 `close-overlay` 那一支 | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/escape-policy.test.ts --maxWorkers=4` | 设置浮层开着且回合运行中 ⇒ 先收浮层而不是打断 | | |
| W2 | `permissionChipView` 的 `hasBook` 判断恒为真 | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/permission-chip.test.ts --maxWorkers=4` | 无书 ⇒ 文案不是任何档位名且 disabled | | |
| W3 | `replayProposalStatuses` 去掉 `=== "expired"` 守卫 | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/timeline.test.ts --maxWorkers=4` | 已 written 的卡不因后续 error 改判 | | |
| W4 | `prefillText` 改成无条件返回 `incoming` | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/composer-draft.test.ts --maxWorkers=4` | 已有草稿时预填不吞字 | | |
| W5 | `docMetaOf` 的 excerpt 永远返回 `""` | `corepack pnpm vitest run packages/fs-store/test/scan.test.ts --maxWorkers=4` | 正常段落要带出第一段 | | |
| W6 | `groupDocsForDossier` 删掉空组过滤 | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/book-dossier.test.ts --maxWorkers=4` | 没有人物文档时不出现人物组 | | |
| W7 | `workbenchVisible` 不看 `hasBook` | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/workbench-state.test.ts --maxWorkers=4` | 无书 ⇒ 一张卡都不出 | | |
| W8 | `applySnippet("list")` 只作用首行 | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/markdown-snippets.test.ts --maxWorkers=4` | 跨行选区每行都加 `- `（Task 10 Step 8 实测还会带红第二条） | | |

- [ ] 八条都要有「红证据 + 改回绿证据」两段；某条改不动（比如那一支已并入别的表达式）就写清为什么，**不许拿「等价」当没跑**。
- [ ] 台账里保留一句硬话（波 1 报告第 43 行的同款）：本波所有 `.vue` 模板接线（工具栏按钮是否显示、chip 是否 disabled、工作台卡片是否出屏）**没有任何自动化覆盖**——`vitest.config.ts` 的 include 只有 `*.test.ts`/`*.test.mjs` 且 `environment: "node"`，`tsconfig.web.json` 走 `renderer/vue-shim.d.ts` 的 `declare module "*.vue"`，tsc 不进 `.vue`。⇒ 这些格子的证据只有真机肉眼 + 行号，不许写成「单测覆盖」。

- [ ] **Step 5：真机矩阵（控制方本人操作，不委托子代理）**

起法照波 1 报告第 4–5 行，一个命令都不许另创：

```bash
corepack pnpm build
corepack pnpm mock-provider > scratch/mock-provider-wave15.log 2>&1 &
corepack pnpm --filter @mochen/desktop exec electron . --remote-debugging-port=9225 --user-data-dir=scratch/wave15-profile > scratch/electron-wave15.log 2>&1 &
CDP_PORT=9225 node scratch/cdp.cjs eval 'JSON.stringify({title:document.title,hasBook:!!window.__b})'
```

- 桩：`tools/mock-provider.mjs` 起在 `127.0.0.1:8787`（根 `package.json:14` 的 `mock-provider` 脚本，端口写死在脚本里，`--doc` 默认 `chapters/01-开局.md`，锚点「雾从海面涌上来。」）。
- 实例：**第二个** electron（本波用 9225，避开用户可能还开着的 9223/9224），加载的是 `out/renderer/index.html`（构建产物），不是 vite 热更页；状态用 `scratch/cdp.cjs` 读（`eval` / `eval-file` / `type` / `key` 四种模式都在案）。
- 用书：新建 `scratch/wave15-book`（`book.json` 形状照 `scratch/wave1-book/book.json`：`schemaVersion: 1`、`stages: [{ id: "draft", name: "正文" }]`、`permissionMode: "read-only"`、`chapterOrder` 两条），**并把五类文档都摆齐**：`chapters/01-开局.md`、`chapters/02-中段.md`、`outline/主线.md`、`characters/李深.md`、`plot/三幕.md`、`materials/设定-海怪.md`（`scan.ts:6-11` 认 `chapters/outline/characters/plot` 四个目录，其余归 `material`）。md 一律带 frontmatter `title:` 与至少两段正文（摘要卡要用 `excerpt`）。**绝不拿任何真人书稿当对象。**
- 端点：`baseURL` 填 `http://127.0.0.1:8787/v1`、模型名填桩认得的串、凭据**只在设置对话框里输入桩用的假串**；本波全程不碰真端点、不写 `secrets.enc`。命令行、日志、报告、commit 里不许出现任何凭证串，也不许把那两个字面词（前缀字样 / 鉴权头字样）写成 grep 指令——波 1 报告第 136 行记的就是这个坑。

**A. 附录 §5 的七项验收（逐格展开；「屏幕原文」栏当场粘贴，不许写「符合预期」）**

| # | 格子 | 怎么点 | 期望的可见状态变化（可核对的调用与文案） | 屏幕/磁盘原文 | 证据类型 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 打开书 ⇒ 工作台四卡逐张点 | `CDP_PORT=9225 node scratch/cdp.cjs eval-file scratch/open-book.js`（改 root 指向 `wave15-book`）⇒ 中栏空分支变 `BookWorkbench` | 四张卡是 主笔创作 / 角色塑造 / 世界构建 / 大纲规划（`WORKBENCH_CARD_LABELS`）。逐张点一次：主笔创作 ⇒ 右栏进文稿态、`docTabs` 多一条、中栏线程随 `threadKeyFor` 绑定；其余三张 ⇒ `browse(ref)` 把右栏切浏览并出现只读徽标。**每张都要报出函数名并真的改到屏幕** | | 真机 | |
| 2 | 无书 ⇒ 一张卡都不出 | 起 9226 第三实例（独立 `--user-data-dir=scratch/wave15-nobook`），不 `openBook` | `workbenchVisible(false)===false` ⇒ 屏上只有引导句 + 「打开作品目录」按钮；`grep` 屏上文本无「主笔创作」。同名判定另有 W7 单测在钉 | | 真机 + 单测 | |
| 3 | 右栏「作品资料」五类分组 + 摘要 | 点第三枚页签「作品资料」⇒ 读分组标题与摘要；再点回「文稿」 | 五类都在（章节 / 大纲 / 人物 / 剧情 / 素材，标签读 `BOOK_KIND_LABELS`），每类下有摘要（来自 `DocRef.excerpt`，≤80 码点）；切回文稿后 `draft` 逐字未变、`docTabs` 与 `activeDocTab` 一字不变、`dirty` 不变 | | 真机 | |
| 4 | 两枚 chip 可点且反映真状态 | 点权限档 chip ⇒ 菜单选「可改当前章」；点 `/` chip ⇒ 面板弹出 | 权限档：`book.json` 回读 `permissionMode: "chapter-write"`（`node -e` 读盘）；**关掉实例重开、重选同一本书，档位仍是「可改当前章」**；chip 文案跟着变。`/` chip：面板出现且与**裸 `/` 键**（`utils/hotkeys.ts:98-100`）同一条 `openPalette` | | 真机 + 磁盘 | |
| 5 | md 片段插入 ⇒ 真提案 ⇒ 审批 ⇒ 备份 | 文稿态选中一句话点「加粗」⇒ 输入「用文本块提案」发一轮 ⇒ 聚焦新卡按 `y` | draft 变 `**…**` 且 `dirty=true` ⇒ 提案卡出现 ⇒ 批准后磁盘出现 `.mochen/changes/<时间戳>/chapters/*.md.bak`，正文按锚点改写；`ls scratch/wave15-book/.mochen/changes` 行数比操作前 **+1** | | 真机 + 磁盘 | |
| 6 | 页脚阅读时长 | 点「列表」把选区跨三行 ⇒ 再看页脚 | 页脚同排出现「N 字」与「约 M 分钟阅读」；把正文清空 ⇒「— 分钟」。字数与时长都随 `onEdit` 实时变（不保存也变） | | 真机 | |
| 7 | 新组件无硬编码色值 | `grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(" apps/desktop/src/renderer/src/components/BookWorkbench.vue apps/desktop/src/renderer/src/components/BookDossier.vue apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/styles/interaction.css` | 期望**无输出**（`--focus` 之类 token 不算）。若 `interaction.css` 的既有 `.slash-mask` 命中（`color-mix(... #000 28% ...)`，波 1 留下的遮罩），如实记成「本波未引入的既有命中」并给出行号，不许偷偷改规则 | | 静态 + 肉眼（明暗两套都看一眼 `--focus` 跟着变） | |

> **两处与附录原文的一字之差，报告里必须如实写清**：① 附录 §5 说「五卡」「三 chip」，本波交付的是**四卡 + 两枚 chip**（第五张「灵感激发」按附录 §3 F-A 删待波 2、三枚新 chip 按共头「差异」第 2 条全部归波 2/波 3）；② 附录 §5 的「主题切『墨宸 · 青金』后重启保持」这一格**本波不交付**（F-E 挪波 2，设计决定 7），报告里写「未交付，不留绿痕」，不许拿别的主题截图充数。
> 「既有七项冒烟不回归」这一格另有一句实话：仓里并没有一份恰好七项的表（Plan 2 冒烟报告是 9 条、Plan 3 spec §16 是 9 条）。本波把「七项」钉成下面这张可复跑清单，报告里按七格逐条给原文，并写明这个口径是本波定的：

| # | 回归项（可复跑） | 操作 | 期望 |
| --- | --- | --- | --- |
| R1 | 三栏壳与页脚 | 开书后读 `document.querySelectorAll(".editor-pane,.agent-pane,.left-nav")` | 三栏都在，页脚「N 字 · 约 M 分钟阅读 · 已保存到本机」 |
| R2 | 每章绑线程 | 依次开 `chapters/01`、`chapters/02` | 头部主上下文与中栏内容随章变，不串台 |
| R3 | **Esc 三态**（总 spec §6.2） | ① 说明框有字时 Esc ② 聚焦待审卡时 Esc ③ 无卡且运行中 Esc | ① 字保住、只失焦、不发决策 ② 该卡 `decision:"cancel"` 落盘 ③ `stopTurn` 生效、队列不清；**新增第 ④ 态：设置浮层开着时 Esc 先收浮层（Task 1）** |
| R4 | **`y`/`a`/`p`/`d` 四键** | 造一张真 pending 卡后逐键（`CDP_PORT=9225 node scratch/cdp.cjs key --key=y --code=KeyY`） | `y` ⇒ JSONL 出现 `decision:"accept-once"` 且落盘；`a` ⇒ `decision:"accept-session"`（见留白格 L2）；`p` ⇒ `accept-prefix` 且同类新卡自动 `written`；`d` ⇒ 只把焦点移进说明框、不提交 |
| R5 | 只读档拒绝句 | 切回 `read-only` 后点批准 | 屏上出现 `permission.test.ts:47-48` 钉死的整句中文，卡仍 `pending`，正文 md5 不变 |
| R6 | 批准即落盘 + 备份 | 切 `chapter-write` 后批准 | `.mochen/changes/<时间戳>/` 新增一个目录（`ls` 计数 +1），正文按锚点改写 |
| R7 | `/` 面板四条真通路 | 面板里依次执行 `/model` `/status` `/clear` `/permissions 随意改` | 前两条出浮层/状态行，`/clear` 只清渲染层（盘上 JSONL 行数不变、pending 不删），最后一条回「没有这一档…」 |

**B. 波 1 报告第 132 行的三条界面缺陷复验格**（逐条给怎么点 + 屏幕原文）

| 缺陷 | 谁修的 | 怎么点 | 期望屏幕原文 | 实测（当场粘贴） |
| --- | --- | --- | --- | --- |
| ① 设置浮层开着 + composer 聚焦时 Esc 不收回浮层 | Task 1 | `Ctrl+,` 开浮层 ⇒ 焦点回 composer ⇒ 按一次 Esc | 浮层当场关，`layout.currentView` 回 `"workspace"`；**且这一按不打断进行中的一轮**（`stopTurn` 计数不变）；浮层真身唯一：屏上不再有第二份 `showSettings` 状态 | |
| ② 无书时头部档位标签仍 `disabled=false` 且捏造「只读参考」 | Task 2 | 9226 无书实例里读头部 chip | `{"chipText":"未打开作品目录","chipDisabled":true}`（`NO_BOOK_CHIP_LABEL`），且 `PermissionMenu` 根本不挂；屏上任何位置不出现「只读参考」四个字 | |
| ③ `stale` 不随回放存活 | Task 3 | 造一条 stale（批准一张已被外部改动的旧卡）⇒ 关实例重开、重选同一章 | 重开后那张卡在「已裁决的提案」组里，状态显示「已失效」而**不是**「上次会话未处理」；四键 disabled、不可批准 | |

**C. 波 1「本波不自证通过」的六格留白处置表（每格一个明确处置，不许勾绿不许含糊）**

| 格 | 波 1 原话口径 | 本波处置 | 怎么验 / 欠谁的什么动作 | 判定规则 |
| --- | --- | --- | --- | --- |
| L1 | 排队上限只到直调 store（欠真 Tab 键盘路径 + 计数未拍到） | **本波复验格** | 运行中用 `node scratch/cdp.cjs type --text=排队甲` + `key --key=Tab --code=Tab` 连打五条，第六条再打一次 ⇒ 当场读 **`.status-line`** 的文本（裁定 C：队列计数只在状态行，chip 行那句 `运行中按 Tab 可排队指令` 是静态提示，不带数字）与 `store.notice` | 真 Tab 路径下 notice 逐字 = `排队指令最多 5 条，先等这一轮结束。`（`useAgentStore.ts:37`，`QUEUED_MAX = 5` 见 `:34`）**且**状态行出现「排队 N 条」（`composeStatusLine`，`useAgentStore.ts:144`）在 drain 之前拍到 ⇒ 勾；仍拍不到 ⇒ 继续欠，报告里写「键盘路径已闭合、计数未拍到」 |
| L2 | `a` 键发了但卡已不在待审（无 `accept-session`） | **本波复验格** | 先发一轮拿到**一张真 pending 卡**（不批准），`d` 之外先聚焦该卡，再 `key --key=a --code=KeyA` ⇒ 读主会话 JSONL 最后一行 `decision` | JSONL 出现 `"decision":"accept-session"` ⇒ 勾；若主进程回单句 stale/拒绝 ⇒ 报告贴拒绝原文并写明卡的状态，这一格仍不勾 |
| L3 | 中文输入法候选框回车只到合成级 | **仍欠人肉格** | 只能由控制方本人在真 OS 拼音候选框（未上屏）按一次回车。`cdp.cjs ime-enter` 走的仍是 CDP 派键、`isComposing` 不由它产生 ⇒ 不能当人肉证据 | 本波**不给自己打满**：报告写「欠人肉一次」，格子保持不勾；合成级证据（items 不变 + 文本留在框 + 无新 `user-message`）可复跑一遍并如实标「合成级」 |
| L4 | 无书时头部标签没 disabled 且捏造「只读参考」 | **本波复验格**（= 缺陷②） | 见上表 B 的 ②：9226 无书实例读 `chipText` / `chipDisabled` | 回读到 `未打开作品目录` + `disabled:true` ⇒ 勾；仍是 `只读参考` + `disabled:false` ⇒ 本波未完成，回去修 Task 2 |
| L5 | Step 8 的「§16 逐条」整句 | **字面不可达标格（如实不勾）** | §16 第 1–4 项 + 本波六面逐格有真机原文（本表 A/B 已覆盖）；第 5–9 项（外观三态 / 六档案 / 上下文占用条 / 技能库 / F-4 迁移）归波 2、波 3，本波一次都没跑 | 「§16 **逐条**（全 9 项）」那一格保持不勾，并在旁边一行写归属；不许把整句改读成「§16 相关项」来凑绿 |
| L6 | Step 8 的密钥 grep 字面（两个词作为指令文本会被自己的 grep 命中） | **字面不可达标格（如实不勾）** | 本波换一种**不自我命中**的写法：只扫新增行、按形状不按词面——`git show --format= --unified=0 HEAD | grep "^+" | grep -cE "[A-Za-z]+-[A-Za-z0-9]{16,}"`（期望 `0`）。`--unified=0` 不带上下文行，所以计划原文不会再被带出来 | 形状扫描为 0 ⇒ 报告记「实质达标」；但**波 1 那格的原字面写法（带上下文的 `git log -p -1` + 那两个词的词面）跑起来仍会命中指令自身** ⇒ 该格保持不勾，并保留波 1 报告第 136 行那句原话作为出处 |

- [ ] A/B/C 三张表里，**任何一格填不出屏幕原文就写「未证」**，并写清是「没做」还是「只有单测证据」。mock 桩答句是定值 ⇒ 「续写不重复已流出的句子」这类只有真模型能判的句子，本波照波 1 报告第 60 行的写法明记为未证。
- [ ] 收尾把桩与实例收干净：`taskkill //F //T //IM electron.exe`、桩进程单独收（`node.exe` 里认 8787 那一个），**用户自己的实例与 profile 一律不碰**。

- [ ] **Step 6：报告落盘**

新建 `docs/superpowers/plans/2026-10-03-plan3-wave1-5-report.md`，骨架如下（**冒号处填当场观测到的事实，不许出现「应该没问题」**；格式照波 1 报告）：

```markdown
# Plan 3 波 1.5 门禁与真机冒烟记录（Task 11）

日期：2026-10-0__（UTC 时间戳见日志）
构建：corepack pnpm build 后起第二个 electron 实例（--remote-debugging-port=9225，
--user-data-dir=scratch/wave15-profile，加载 out/renderer/index.html），provider 用仓内
tools/mock-provider.mjs（127.0.0.1:8787）。测试用书 scratch/wave15-book —— 未拿真人书稿当对象。
门禁：两遍 corepack pnpm verify，第二遍不经管道；日志尾部自印 VERIFY_EXIT=0 与 shell 侧退出码都在案。
用例：Test Files __ / Tests __ passed（基线 43 / 476；本波净增下限 +7 文件 / +64 用例 ⇒ 期望 ≥50 / ≥540）。
行号与预算：DocumentPane.vue __ 行（≤220）、CenterColumn.vue __ 行（≤400）、行数预算通过、边界检查通过。

## Step 3：契约变更表对账（六条 node -e 的实测输出逐行抄录）
## Step 4：变异台账 W1–W8（每条：变异 → FAIL 原文 → 改回绿 → git diff --exit-code）
## Step 5-A：附录 §5 七项验收（逐格屏幕/磁盘原文 + 证据类型）
## Step 5-B：三条缺陷复验（①②③ 各自怎么点、屏幕原文）
## Step 5-C：波 1 六格留白的处置（复验 / 仍欠人肉 / 字面不可达标，逐格判定）
## 未证 / 未做 / 留底（如实）
- 只有单测证据、没做真机操作的格子逐条列名。
- F-E（青金 preset）本波未交付 ⇒ 附录 §5 那一格不留绿痕。
- 「墨宸 · 青金」主题、六档案、上下文占用条、技能库、F-4 迁移 ⇒ 波 2 / 波 3。
## 本波改动的行号清单（文件名:行号 + 一句话）
```

- [ ] 报告末尾照波 1 的样子补一节「诚实账」：本波新写的 `.vue` 接线全部**零自动化覆盖**（`vue-shim` + vitest node 环境），凡是「按钮在位但没拍到点击后的可见变化」的格子，一律退回未证。

- [ ] **Step 7：提交与文档回改**

1. 勾选本波计划：`docs/superpowers/plans/2026-10-03-plan3-wave1-5-ui-fusion.md` 里 Task 1–11 的 `- [ ]` → `- [x]`，**只勾真做完并验证过的**；没闭合的留着并在旁边一行说明为什么（L3 / L5 / L6 三格按 Step 5-C 的判定保持不勾）。
2. 落盘报告：`docs/superpowers/plans/2026-10-03-plan3-wave1-5-report.md`（Step 6 的产物）。
3. 回改 `docs/superpowers/plans/README.md` 的本波条目——把「七面」写成本波实际交付的六面，并加一句 F-E 的去向。现原文那句是「落成七面渲染层改造（中栏工作台 / 右栏作品资料 / 左栏三段主操作 / 输入区真开关 chip / 青金主题 preset / md 片段工具栏 / 页脚阅读时长）」，改成：

```markdown
  本波实际交付六面渲染层改造（中栏工作台 / 右栏作品资料 / 左栏三段主操作 /
  输入区两枚真开关 chip / md 片段工具栏 / 页脚阅读时长），并认领波 1 真机撞出的三条界面缺陷与六格留白；
  **F-E「墨宸 · 青金」preset 不在本波**——`themePresets` 至今全仓零消费者，本波加第四条仍是摆设，
  它随波 2 Task 19 的主题三态 + `appearance.json` 一起出生（那时才有真消费者）。
```

```bash
git add docs/superpowers/plans/2026-10-03-plan3-wave1-5-report.md docs/superpowers/plans/2026-10-03-plan3-wave1-5-ui-fusion.md docs/superpowers/plans/README.md
git commit -m "docs(plan3): 波 1.5 全链门禁、变异台账与真机冒烟记录（含波 1 六格留白认领）"
git status --porcelain
```

- [ ] 收尾自检（逐条为真才算本波闭合）：
  - [ ] 两遍 `verify` 的退出码都当场在案（自印 + shell 两侧），用例总数与文件数抄的是**日志原文**。
  - [ ] 契约八行全部对上：IPC 13/13 一字不加、`PROPOSAL_STATUSES` 7、`ThreadView` 10、`schemaVersion` 1、`EscapeAction` 5、`DocRef` 4、`error.proposalId?` 在位。
  - [ ] W1–W8 八条各有红/绿两段证据，`git diff --exit-code` 干净。
  - [ ] 三条缺陷（①②③）与留白六格每格都有处置与判定；**保持不勾的格子旁边都有一行为什么**。
  - [ ] 本波没新增依赖、没新增 IPC 通道、没新增第 6 个工具、没新增写盘通路、没新开样式文件、没改门禁脚本或 ignore 文件；`.mochen/` 与 `scratch/wave15-book` 都没进版本库（`git show --stat HEAD` 里只许出现三个 docs 文件）。
  - [ ] 报告里没有任何看起来像凭据的串，也没有把那两个指令词写成 grep 字面（Step 5-C 的 L6 记录在案）。

---

## 合成自审记录（控制方，提交前当场跑完）

四路草稿（Task 1–3 / 4–6 / 7–9 / 10–11）并进来之后，按 writing-plans 的三项自审逐条查过，查出来的问题**都在正文里改掉了**，不是只在这里记账：

1. **接口总表冲突两条 ⇒ 已裁定**（详见「与附录 / Plan 3 spec 的差异」第 6、7 条）：裁定 A（writeDoc 竞态分支补 publish）、裁定 C（chip 行不做排队徽标）。除这两条之外四路草稿未再报出总表冲突。
2. **类型一致性三处 ⇒ 已回改**：① 文件结构里 `groupDocsForDossier(docs, meta)` 与总表/Task 6 的 `groupDocsForDossier(docs: DocRef[]): DossierGroup[]` 不符 ⇒ 文件结构改成总表口径；② 总表 `ComposerBox.vue props` 缺 chip 行需要的 `hasBook` / `permissionMode` / `permissionSaving` ⇒ 总表补齐，且 `permissionMode` 的联合改为 `PermissionMode | null`（组件里不手抄三档字面量，铁律 6）；③ 总表 `error` 事件那行的「三处 publish」措辞与代码不符 ⇒ 按裁定 A 改写。
3. **零占位符**：11 个任务的全部代码块都是可直接落盘的全文（含注释），命令可直接粘贴（`corepack pnpm …`、门禁后不接管道、切片用 `node -e`），表格都有真实行；唯一留白是 Task 11 台账与真机矩阵里必须**当场粘贴屏幕/日志原文**的那几栏——那是门禁任务的产物，预填就是造假。
4. **用例下限是怎么数出来的**：`grep -c "^### Task"` = 11；下表每一格指回对应任务章节里逐条写出的 `it(`，Task 8 的 4 条是源码契约用例（草稿表原记 0，已按实际值回填），Task 3 因裁定 A 多一条（7 ⇒ 8），Task 9 因裁定 C 仍是 4 条但内容改了。**5+4+8+3+5+5+4+4+4+25 = 67**，期望 `Test Files` 51、`Tests` ≥ 543。基线不是拍的：`2026-10-02-plan3-wave1-report.md:7` 记的日志原文是 `Test Files 43 passed (43)` / `Tests 476 passed (476)`；43 这个数本会话按 `vitest.config.ts:6-8` 的三条 include 当场重算对得上（`packages/*/test/**/*.test.ts` 15 + `apps/desktop/src/**/*.test.ts` 26 + `tools/*.test.mjs` 2 = 43，`git ls-files` 计数）。**执行时若实测低于下限就回任务补，不许改小下限。**
5. **覆盖自查**：附录 F-A（Task 4+7）、F-B（Task 5+6）、F-C（Task 8）、F-D（Task 9，只含已有两枚 chip）、F-F（Task 10）、F-G（Task 10）六面全落；F-E 按设计决定 7 挪波 2；波 1 报告三条真机缺陷（Task 1/2/3）与六格留白（Task 11 复验矩阵 L1–L6）全认领；11 任务 ≤12 ⇒ 仍是 Plan 3 的一波，不开 Plan 4（附录 §7.2 的口径）。
6. **本波随附的文档账（与计划同一提交或紧随其后）**：附录 §3 F-E 与 §4 表格的「波 3 的三态开关」是排期笔误 ⇒ 改「波 2」；`plans/README.md` 波 1.5 条目从「七面」改「六面 + F-E 挪波 2」；波 1 报告保持原样（它记的是当时事实，不改写）。
7. **仍未闭合、不在本波的账**：`/stage` 命令诚实但尚未实现（波 2 档案落地时接）、frontmatter 当正文的 F-F 后续项、思考等级 chip 的厂商出站字段格式（未决 #70）、「替我审批」开关（波 3 #69）、模型枚举通道（波 2 #68）。

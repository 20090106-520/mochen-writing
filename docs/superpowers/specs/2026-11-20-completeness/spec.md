# 2026-11-20 完整性补完（四缺口 + 两小项）

> 背景：2026-11-20 的「全书摘要 / 多模型分工 / search_docs 三源」已落地并全绿。
> 本轮只补**用户能立刻感知、且现在确实缺失**的四处，外加两处低成本顺滑化。
> 总原则：不加新概念、不新开第二套判据；能复用既有通路的一律复用。

## 已确认的真缺口

| # | 现状 | 用户体感 |
| --- | --- | --- |
| 1 | `read_doc` 只取全文前 6000 字，没有偏移参数 | 长章后半段模型永远读不到，改稿只能靠猜 |
| 2 | `book.json` 的 `digest`（全书摘要 + 人物状态）与 `recaps` 在渲染层零入口 | AI 的「记忆」用户看不见、改不了 |
| 3 | 只有「改标题」（只改 frontmatter）；改文件名/挪位置没有通道 | 名字起错了只能去资源管理器改，`chapterOrder`/`recaps` 立刻成孤儿 |
| 4 | 模型只能读设定库，不能写 | 新人物/新地点只能用户手填，AI 不会记账 |
| 小项 A | 提案卡只能逐条点 | 一轮五条提案要点五次 |
| 小项 B | `search_docs` 的 `source`/`kind` 参数描述是机器腔 | 模型和人都不太读得懂 |

---

## 1. read_doc 支持行偏移

### 契约（`packages/agent-runtime/src/tools.ts`）

`read_doc` 增加两个**可选**参数，`doc` 仍必填：

- `from`: number —— 从第几行开始读（1 起，默认 1）。
- `lines`: number —— 最多读多少行（默认读到文末）。

描述改为一句人话，明确「长章被截断时用 from 接着读」。

### 判据（`apps/desktop/src/main/doc-tools-host.ts` 的 `read_doc` 分支）

1. `from`/`lines` 接受 number 或数字字符串；非有限数回默认（`from=1`、`lines=null`）；
   `from` 下限 1，`lines` 下限 1（向下取整）。
2. `total = body.split("\n").length`。
3. `from > total` ⇒ `ok:false`，文案：`第 N 行超出范围：{doc} 共 M 行。`
4. 取 `slice = body.split("\n").slice(from-1, lines ? from-1+lines : undefined)`。
5. **先按行切、再按 `READ_TRUNCATE_AT` 截字**：截断只作用于这一次选中的行段。
   被截断时尾部追加一句：`（这一段在第 K 行被截断；接着读用 from=K）`——
   用 `K` 而不是 `K+1`：截断可能落在行中间，重读这一行只会重复半句，不会丢字。
6. 回执头：当 `from>1`、给了 `lines`、或发生截断时加
   `【{doc} 第 {from}–{endShown} 行（共 {total} 行）】\n`；否则与旧版逐字一致（既有用例钉着）。

### 界面（`apps/desktop/src/renderer/src/utils/tool-args.ts`）

`read_doc` 工具卡：带 `from`/`lines` 时显示 `读《X》第 N 行起。`，否则保持 `读《X》全文。`

### 用例

- `apps/desktop/src/main/doc-tools-host.test.ts`
  - 多行文稿 `{from: 51, lines: 10}`：含第 51 行、不含第 50/61 行，回执头写 `第 51–60 行`。
  - `from` 超界：`ok:false` 且含「超出范围」与总行数。
  - 无参数且 ≤6000 字：回执逐字等于原文（既有用例继续钉）。
  - 长文 + `from`：截断提示里出现 `from=`。

---

## 2. 「AI 记忆」面板

### 位置

设置中心新增页签「AI 记忆」（`SettingsTab` 加 `"memory"`，排在「智能体」之后）。
理由：书级资料、低频修改，放右栏会挤掉正文阅读；放设置中心可搜索、可关。

### 新组件 `apps/desktop/src/renderer/src/components/MemoryPanel.vue`

- 数据源：`useBookStore().meta`；**换书重新灌值**（`watch(() => book.meta?.digest)`）。
- 上半「全书摘要 / 人物状态」两格可编辑：
  - 两个 `textarea`，右下角字数计数，上限取 `BOOK_DIGEST_SUMMARY_MAX_CHARS` /
    `BOOK_DIGEST_CAST_MAX_CHARS`（**不在组件里另写数字**）。
  - 「保存」调用 `book.persistMeta({ digest }, "记忆没有保存")`（全仓唯一 meta 落盘通路）；
    两格都空 ⇒ 传 `digest: undefined`（等于清除这一格）；`metaSaving` 期间按钮禁用。
  - 未改动时按钮禁用；保存成功用 `book.notice` 的既有提示位。
- 下半「各章前情摘要」只读列表：
  - `book.meta?.recaps` 按 `book.docs` 的章节顺序（`sortDocs`）排；
  - 每条显示章节标题（查不到就显示 relPath）+ 摘要正文；
  - 空表时一句：`还没有前情摘要——写完一章后会自动生成。`
  - **不做删除/编辑**：摘要是生成的派生物，手改会与下一轮生成打架。

### 接线

- `stores/layoutStore.ts`：`SettingsTab` 加 `"memory"`。
- `components/SettingsPage.vue`：`SECTIONS` 偏好组加
  `{ id: "memory", label: "AI 记忆", icon: "bot", keywords: "记忆 摘要 前情 人物状态 digest recap 全书" }`，
  内容区加 `<MemoryPanel v-else-if="settingsTab === 'memory'" />`。

### 用例

- 新增 `components/memory-panel-wiring.test.ts`（沿用 `vue-source-reader` 风格）：
  - SettingsPage 真有 `memory` 页签与面板；
  - 组件只经 `book.persistMeta` 落盘，不直接调 `window.mochen.saveMeta`；
  - 上限常量来自 contracts，组件里不出现 `120`/`600` 字面量；
  - `recaps` 只出现在只读区域（组件里没有绑定 recaps 的 `v-model`）。
- 若 `settings-panel-layout.test.ts` 枚举页签，同步补一项。

---

## 3. 章节重命名 / 移动（改文件名）

> 现有的「改标题」只动 frontmatter，文件名与 relPath 不变。本轮补的是**改文件名**：
> 文件真的改名，并同步迁移 `chapterOrder` 与 `recaps` 的键。

### 契约

- `packages/contracts/src/ipc-channels.ts`：新增 `docRename: "doc:rename"`。
- `packages/contracts/src/ipc.ts`：
  ```ts
  export type DocRenameResult =
    | { ok: true; relPath: string; fingerprint: string; doc: DocRef | null; meta: BookMeta }
    | {
        ok: false;
        reason: "no-book" | "invalid-path" | "outside-book" | "exists" | "missing" | "io-error";
        message: string;
      };
  ```
  `RendererApi` 加 `renameDoc(relPath: string, title: string): Promise<DocRenameResult>`。
  ok 侧带 `meta`：`chapterOrder`/`recaps` 的迁移由主进程做一次，渲染层直接换掉整份 meta，
  不在渲染层再抄一遍迁移判据（铁律 6）。

### fs-store：`packages/fs-store/src/read-write.ts`

新增 `renameDocFile(root, fromRel, toRel, fs?)`：

- 两侧都 `assertSafeRelPath`；
- 目标已存在 ⇒ 返回 `{ ok:false, reason:"exists" }`（**不覆盖**）；
- 源不存在 ⇒ `{ ok:false, reason:"missing" }`；
- `rename` 失败 ⇒ `{ ok:false, reason:"io-error", message }`；
- 不做跨目录搬家的特殊判断：目标路径由 `planDocRelPath(kind, title)` 生成，天然同目录。

### 主进程：`apps/desktop/src/main/book-service.ts`

`renameDoc(relPath, title)`：

1. 没开书 ⇒ `no-book`。
2. `assertSafeRelPath` 失败 ⇒ `invalid-path`。
3. 先单问 `windowsReservedNameProblem(title)`（与 `createDoc` 同一句人话）；再
   `sanitizeDocFileName(title)`，为 null ⇒ `invalid-path`。
4. `kind = snapshot.docs 里那一篇的 kind ?? kindOfRelPath(relPath)`；null ⇒ `invalid-path`。
5. `nextRelPath = planDocRelPath(kind, title)`；与 `relPath` 相同 ⇒ 直接 ok（不动盘）。
6. `renameDocFile`；失败按 reason 原样回。
7. `enqueueMetaWrite`：`chapterOrder` 里旧的换成新的；`recaps` 中旧键若存在则搬到新键；
   用 `writeBookMetaFile` 落盘并刷新快照。
8. 重扫一次 `scanBook` 并 `sortChapters`（改名是低频操作，不为它再造增量判据）。
9. 返回 `{ ok:true, relPath: nextRelPath, fingerprint, doc, meta }`。

### 接线

- `apps/desktop/src/main/ipc-guard.ts`：`TRUSTED_RULES` 加 `docRename`。
- `apps/desktop/src/main/index.ts`：注册 `docRename` → `book.renameDoc`。
- `apps/desktop/src/preload/renderer-api.ts`：`renameDoc: (relPath, title) => invoke(...)`。
- 夹具：`agent-store-fixture.ts`、`book-draft-fixture.ts`、`useBookStore*.test.ts`、
  `renderer-api.test.ts` 等所有 `satisfies RendererApi` 的假实现补 `renameDoc`。

### 渲染层

- `stores/useBookStore.ts` 新增：
  ```ts
  async renameDocFile(relPath: string, nextTitle: string): Promise<boolean>
  ```
  成功时：`this.meta = result.meta`；`docs` 换掉旧那一篇（用 `doc-tree.ts` 既有拼接工具，
  拼不进再温和重扫）；打开中的标签、当前文稿、浏览态选中项把旧 relPath 换成新 relPath。
  失败时原因进 `notice`，返回 false。
- `components/LeftSidebar.vue`：行菜单在「改标题」下加一项「改文件名」，
  复用同一个行内输入框，加一个 `renameMode: "title" | "file"` 区分确认时调哪个动作；
  Enter 确认 / Esc 取消 / blur 取消与现有 `onRenameKeydown` 完全一致。

### 用例

- `book-service` 用例：改名后旧文件不在、新文件在；`chapterOrder` 与 `recaps` 跟随；
  目标已存在 ⇒ `exists` 且两边都不动；保留名 ⇒ `invalid-path`。
- `renderer-api.test.ts` 通道清单加 `docRename`。
- `useBookStore.create.test.ts` 增补 `renameDocFile` 成功/失败各一例。
- `left-sidebar-nav.test.ts` 菜单项断言补「改文件名」。

---

## 4. `propose_bible`：模型可以提设定

> 与正文提案同一条纪律：**先提案、用户批准才落盘**；落盘只走 `writeBookData`，
> 不新开写盘通路。设定库条目不是文稿，所以不复用 `EditProposal` 的 docPath 语义，
> 单开一种轻提案。

### 契约

- `packages/contracts/src/bible-proposal.ts`（新）：
  ```ts
  export const BIBLE_PROPOSAL_TYPES = ["character", "location", "timeline"] as const;
  export const bibleProposalSchema = z.object({
    id: z.string().min(1),
    threadKey: z.string().min(1),
    turnId: z.string().min(1),
    type: z.enum(BIBLE_PROPOSAL_TYPES),
    title: z.string().min(1),
    content: z.string(),
    why: z.string().min(1),
    createdAt: z.string().min(1)
  });
  export type BibleProposal = z.infer<typeof bibleProposalSchema>;
  ```
- `packages/contracts/src/tools.ts`：`AGENT_TOOL_NAMES` 末尾加 `"propose_bible"`；
  **不进 `WRITE_TOOLS`**（它不写正文，避免被「写盘前校验」那套判据误伤）。
- `packages/contracts/src/agent-profile.ts`：`WRITE_TOOLS_ALLOWED` 加 `propose_bible`；
  审稿档案 `[...READ_TOOLS, "propose_patch", "propose_bible"]`（只提不落，正好）。
- `packages/contracts/src/agent-event.ts`：
  - `AGENT_EVENT_TYPES` 加 `"bible-proposal"`、`"bible-written"`；
  - `bible-proposal`：`{ ...turn, type, proposal: bibleProposalSchema }`；
  - `bible-written`：`{ ...turn, type, proposalId, entryId, title, entryType }`；
  - `tool-call` 事件加可选 `bibleProposals: bibleProposalSchema.array().optional()`。
- `packages/agent-runtime/src/tools.ts`：`ToolOutcome` 加可选 `bibleProposals: BibleProposal[]`；
  `TOOL_SPECS` 增加 `propose_bible` 的规格（`type`/`title`/`content`/`why` 四参，前三个必填）。

### 主进程

- `doc-tools-host.ts`：
  - `DocToolHostDeps` 加 `onBibleProposal?: (proposal: BibleProposal) => void`；
  - `propose_bible` 分支：`type` 必须是三类之一、`title` 与 `why` 非空、`content` 截到 2000 字；
    组出 `BibleProposal`（`turnId` 留空，由装配层覆写）→ `onBibleProposal?.(item)`；
    回执：`设定提案 {id}（{类型}「{标题}」）已生成，等待用户批准；未批准前设定库没有改动。`
  - 未注入 `onBibleProposal` ⇒ 回「这一轮没接上设定提案通道」。
- `agent-service.ts`：
  - `PendingProposal` 改为判别联合：`{ kind:"doc", proposal: EditProposal, baseline }` /
    `{ kind:"bible", proposal: BibleProposal }`；`pending` 现有读写按 `kind` 分支。
  - 装配 `onBibleProposal`：登记进 `pending`，`turnId` 用本轮真实值覆写，`publish` `bible-proposal` 事件。
  - `applyDecision` 的 bible 分支抽到新模块 `apps/desktop/src/main/bible-approval.ts`
    （`agent-service.ts` 已 792 行，不再往里堆）。
    - 取消/拒绝：删 pending + 发 `decision`。
    - 批准：`workModeOf(meta) === "plan"` ⇒ 拒（与正文同一句话术口径）；
      `permissionMode !== "full-access"` ⇒ 拒，文案：
      `设定库是书级资料，切到「全开」再批准这条设定提案。`
      `readBookData(root, "story-bible")` → `normalizeBibleEntries` 解析（`json:null` 当空库）；
      append `{ id: deps.newId(), type, title, content, createdAt: now, updatedAt: now, tags: [] }`；
      `writeBookData(root, "story-bible", JSON.stringify(list))`；发 `bible-written` + `decision`。
    - `accept-session` / `accept-prefix` 对 bible 按 `accept-once` 处理（不记免审规则）。

### 渲染层

- `components/BibleProposalCard.vue`（新，约 80 行）：标题「设定提案 · 人物/地点/时间线」、
  标题与正文预览、理由、两个按钮「加入设定库 / 忽略」。
  两个按钮都调 `window.mochen.decideProposal({ proposalId, decision, guidance: "" })`，
  与正文提案卡同一条 IPC；成功后本地标记已处理，失败把原因写在卡上。
- `components/AgentTimeline.vue`：工具卡渲染处，若 `event.bibleProposals` 非空，
  在工具回执下方渲染 `<BibleProposalCard v-for="...">`。

### 用例

- `doc-tools-host.test.ts`：`propose_bible` 回执 + `onBibleProposal` 收到一条、`proposals` 为空数组；
  非法 `type` / 空标题 ⇒ 中文拒绝。
- `agent-service` 用例：批准后 `story-bible.json` 多一条；只读档拒绝；`plan` 档拒绝；
  取消不写盘。
- `packages/contracts/test/agent.test.ts`：新事件形状能过 schema。
- `components/agent-timeline-card-chrome.test.ts`（或新增 wiring 测试）：卡片确实渲染并调用 `decideProposal`。

---

## 5. 小项

### 5.1 提案卡「本轮全部接受」

- `components/ProposalCard.vue`：当同一线程还有 ≥2 条待审提案时，卡底多一颗
  「本轮全部接受（N 条）」。
- 行为：按 `useAgentStore` 当前线程的 pending 顺序逐条 `decideProposal(..., "accept-once")`；
  逐条独立成败，最后用 `notice` 汇总一句
  `已接受 X 条，Y 条没写成（原因见对应卡片）。`；不新造批量 IPC。
- 用例：`proposal-card-wiring.test.ts` 增补按钮存在条件与逐条调用。

### 5.2 `search_docs` 参数描述改人话

`packages/agent-runtime/src/tools.ts` 里只改 `description` 字符串，不动判据：

- `source`：`可选：只想看哪一类——正文、设定库、前情摘要，或者全都看（默认）。`
- `kind`：`可选：只在某一类文稿里找（章节、人物卡、地点、世界观、伏笔、大纲……）。`
- `group`：`可选：想先知道「哪几章提到它」就选「按篇」，想逐行看原文就选「逐行」（默认）。`

---

## 验收

1. 相关 vitest 全绿（按上面各节列出的用例）。
2. `pnpm verify` 全绿（含 800 行预算：`agent-service.ts` 不再增长，bible 审批拆到新模块）。
3. `pnpm build` 全绿。
4. 真机自检：
   - 长章中点「读后半段」类请求，模型能拿到后半段；
   - 设置 → AI 记忆：能看见并改摘要，改完重开还在；
   - 左栏改文件名后，目录顺序与章末摘要不丢；
   - 让模型「把这个人记进设定」，卡片出现、批准后设定面板能看到。

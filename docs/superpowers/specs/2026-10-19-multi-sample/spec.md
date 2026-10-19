# 2026-10-19 每轮多稿采样与择优（P0-②）

本 spec 覆盖 P0-②：**每轮显式多稿采样 + 本仓判据择优**。用户两处裁定（原话）：

1. 采样落点 = **每轮显式多稿**：输入区加「多稿择优」开关＋稿数（默认 2、上限 3）；开着一轮里静默跑 N 次生成，用**同一批 AI 味判据**（词命中/千字、句首复读、句长波动、复读句）打分。
2. 落选稿处置 = **N 稿都留着让用户挑**：N 稿一起摆到界面由用户选一稿落盘（**不自动择优落盘**），落选稿需可丢弃。

## 1. 一句话口径

不开开关时**行为一字不变**；开着开关时，一轮里静默跑 N 次生成、各自捕获（**不落盘、不弹提案卡、不自动批准**），收尾时把 N 稿连读数一起摆给用户；用户点「用这一稿」才真落盘（落盘复用现有 `registerProposal` 全链路，不另开写盘通路），点「丢弃」则一个字都不落。

## 2. 契约变更（`packages/contracts`）

### 2.1 新模块 `src/draft-rank.ts`（判据打分的单一真身）

- `DRAFT_SAMPLE_COUNTS = [1, 2, 3] as const`；`type DraftSampleCount`；`DRAFT_SAMPLE_COUNT_REJECT = "多稿档只能是 1（关）、2 或 3（上限 3）"`。
- `draftSampleCountSchema`：只收 1 / 2 / 3，拒绝句走上面的常量（**必填、无默认值**，与 `thinkingLevel` / `webSearchEnabled` 同一条理由：缺字段就是渲染层忘了传，要在边界上炸中文）。
- `interface DraftReading`：`index`、`charCount`、`pass`、`hits`、`perThousand`、`topTerms`、`startRepeat`、`flatRhythm`、`structureOver`、`repeatOverCount`——**全部来自 `aiFlavorGate(text)`**，不新开第二套判据（四条读数就是 gate 的四枚理由字段）。
- `readDraft(index, text): DraftReading`：跑一次 `aiFlavorGate` 装成读数。
- `rankDrafts(texts: readonly string[]): DraftReading[]`：**按推荐度降序**返回，同分保持原序（稳定）。排序键（全确定性）：
  1. `repeatOverCount` 升序
  2. `hits` 升序
  3. `pass === true` 在前
  4. `startRepeat !== null` 在后
  5. `flatRhythm === null` 视为不可比 → 排在同分有值者之后；有值时 `spread` 升序（波动越大越不像机器）
  6. `index` 升序（稳定兜底）

  为什么不用「一个总分」：四条读数是四个**不同**的病（词 / 起手 / 长短 / 原句打转），捏成一个数就得先编权重，那是编出来的数；这里只给一个可靠的**序**，并把「推荐」标在第一位，选哪一稿仍是用户的事。

### 2.2 `src/agent-event.ts`

- `startTurnInputSchema` 增字段 `sampleCount: draftSampleCountSchema`（必填）。
- `AgentOutbound` 增一枚**仅在途**载荷（不落盘、不进模型历史）：
  ```ts
  { type: "candidates"; turnId: string; threadKey: string; draftSetId: string; drafts: DraftCandidate[] }
  ```
  `DraftCandidate = { index: number; text: string; reading: DraftReading }`（`text` 是该稿**新增正文**：该轮 `message` 正文 + 该轮提案的 `replace` 文本，`\n\n` 相接）。
- 新入参契约：
  - `pickDraftInputSchema = { draftSetId: string(min1), index: number(int, min0) }`
  - `discardDraftsInputSchema = { draftSetId: string(min1) }`
  - `type DraftSetResult = { ok: true } | { ok: false; reason: "gone" | "no-book" | "busy"; message: string }`，三种 reason 各配一句中文（单一真身在 contracts，渲染层不抄）。

### 2.3 `src/ipc.ts`

- 通道表增 `agentPickDraft: "agent:pick-draft"`、`agentDiscardDrafts: "agent:discard-drafts"`。
- `RendererApi` 增 `pickDraft(input: PickDraftInput): Promise<DraftSetResult>` 与 `discardDrafts(input: DiscardDraftsInput): Promise<DraftSetResult>`。

## 3. 主进程（`apps/desktop/src/main`）

### 3.1 静默采样（`agent-service.ts` 内，`startTurn` 的 `sampleCount > 1` 分支）

- 一轮里依次跑 N 次 `runTurn`，每次用**独立捕获器**：
  - `emit`：把事件推入该稿自己的数组（**不** `publish`）。
  - `emitDelta`：**一律丢弃**（N 份增量互相覆盖只会把界面搅成雪花；「正在生成」由状态行与思考动画承载）。
  - `onProposal`：`{ proposal, baseline }` 推入该稿自己的数组（**不** `registerProposal`、**不** 弹卡、**不** 自动批准）。
- 每次跑完把该稿的「新增正文」算出来、`readDraft` 出读数。
- 全部跑完后：`rankDrafts` 排序 → 生成 `draftSetId`（`newId`）→ 把**未排序的原始稿**（带 `draftSetId` 与自己的捕获事件）存进 `draftSets: Map<draftSetId, CapturedDraftSet>` → `deps.emit({ type: "candidates", ... })` → 正常走本轮的 `turn-end{status:"done"}` 与 `drain()`。
- `draftSets` 与 `threads`/`pending` 同级，**归 `clearBookScoped()` 管**（换书即作废）。
- 同一轮里 N 次 `runTurn` **串行**（同一条线程本来就只有一轮在跑；并发跑会让 `newId`/`now`/usage 计数互相踩）。

### 3.2 落盘（`pickDraft`）

1. 按 `draftSetId` 取集；取不到 ⇒ `{ ok:false, reason:"gone" }`。
2. 没开书 ⇒ `{ ok:false, reason:"no-book" }`。
3. 这条线程已有一轮在跑（`runningTurns` 命中）⇒ `{ ok:false, reason:"busy" }`。
4. **先删集**（同一 `draftSetId` 只能落一次），再落盘：

   - `emit({ type:"turn-start", turnId: newTurnId, threadKey })` 并占住 `runningTurns[threadKey]`。
   - 依次 `publish`：一条合成 `user-message`（正文 = 该集存的原始 `userText`，`turnId = newTurnId`）、该稿捕获的 `message` 事件（逐条改成 `turnId = newTurnId`、`id`/`ts` 取新值）。
   - 该稿捕获的每条提案：把 `proposal.turnId` 改成 `newTurnId` 后**原样交给 `registerProposal(turnId, threadKey, proposal, baseline)`**——发卡、入 `pending`/`diffs`、自动批准判据全部复用既有那一份，**不新增第二份写盘逻辑**。
   - `emit({ type:"turn-end", status:"done" })`；`drain()`；松开 `runningTurns`。
   - 落盘的事件走既有串行 `persist`（`appendAgentEvent`）与既有的会话（`threads` 里那份；没有就按 `startTurn` 同一套建）。
5. 返回 `{ ok:true }`。

### 3.3 丢弃（`discardDrafts`）

- 取集 → 删集 → 返回 `{ ok:true }`。**不写盘、不发事件、不落任何正文**（用户的书稿一个字没动）。

### 3.4 通道与守卫

- `agent-ipc.ts` 注册两条 invoke：`agent:pick-draft`、`agent:discard-drafts`。
- `ipc-guard.ts`：两条都进 `IPC_ARG_SHAPES`（带一份入参），并在 `IPC_DENY_REPLIES` 配按契约失败档的回会；`ipc-guard.test.ts` 的「形状表 ∪ 没有参数清单 = 全部要收的通道」用例必须自然通过（不许漏登记）。

## 4. 渲染层

- `utils/composer-chips.ts`：`ComposerChipId` 增 `"draft"`，`ComposerChipEvent` 增 `"cycle-draft-sample"`，`CHIP_EMIT` 增键（穷尽性关卡在 `.ts` 里咬得住）。chip 文案 = `多稿 ×2` / `多稿 ×3` / `多稿关`，`title` 必须报出**真发出去的字段名与值**（`sampleCount`）以及「N 倍成本」这件实话。
- `ComposerBox.vue`：新增 prop `sampleCount` 与 emit `cycle-draft-sample`；`composerChips` 入参加 `sampleCount`。
- `CenterColumn.vue`：接线 `:sample-count="agent.sampleCount"` 与 `@cycle-draft-sample="agent.cycleDraftSample()"`；新增候选面板渲染。
- `useAgentStore.ts`：
  - state `sampleCount: DraftSampleCount`（默认 `1`，**不跨重启记忆**——多稿是 N 倍 token 的成本开关，每次启动回到关，与「联网」「深度」那两枚持久偏好刻意不同，理由写进注释）。
  - `cycleDraftSample()`：`1 → 2 → 3 → 1`。
  - `send(...)` 组装的 `StartTurnInput` 增 `sampleCount`。
  - state `draftSets: Record<string, { draftSetId: string; drafts: DraftCandidate[] }>`（按 threadKey）；`apply` 增 `candidates` 分支；`turn-start` 分支清掉该线程的集；`pickDraft(index)` / `discardDrafts()` 两个动作（成功即清集；失败把 `DraftSetResult.message` 写进 `notice`）。
- `utils/agent-thread.ts`：`malformedPush` 增 `case "candidates"`（形状不对回中文原因）。
- 新组件 `components/DraftCandidates.vue`：N 稿并排（正文预览 + 读数行 + 「用这一稿」按钮），底部「丢弃全部」；第一位标「推荐」。文案表 `utils/draft-candidates.ts`（读数行拼句、丢弃成功语、按钮标签——单一真身）。
- `stores`/夹具：`agent-store-fixture.ts`、`book-draft-fixture.ts` 及 7 份测试夹具补两条 RendererApi mock。

## 5. 不变量（要能机器判）

1. **不开开关时行为一字不变**：`sampleCount === 1` 走的是原来那条路，一个字节都不多（用「同一输入、两条路产出的 publish 序列逐条相等」的用例钉住）。
2. 静默采样期间**盘上零写入**：`appendAgentEvent` / `applyPatch` 一次都没被调用（用计数 spy 钉住）。
3. 静默采样期间**零 `publish`、零 `emit`**（除了本轮 `turn-start` / `turn-end`）。
4. 静默采样的提案**不进 `pending`、不被自动批准**（即使用户早先点过 accept-session）。
5. `draftSetId` **只落一次**：连点两次「用这一稿」，第二次回 `gone`，盘上只多一份。
6. 换书 / 关书后旧集**取不到**（`clearBookScoped` 覆盖）。
7. `sampleCount` 缺字段 / 给 0 / 给 4 ⇒ 边界炸中文拒绝句（走 `DRAFT_SAMPLE_COUNT_REJECT` 的同一份常量）。
8. `rankDrafts` 是纯函数且**稳定**：打乱同分输入不改相对序。

## 6. 明确不做（本刀边界）

- 不做自动择优落盘（用户裁定）。
- 不做跨重启的多稿档记忆。
- 不给静默稿做「逐字流式预览」。
- 不为多稿新增任何写盘通路（落盘复用 `registerProposal`）。
- 不改 `aiFlavorGate` 的阈值/判据（那是 P0-① 的事）。

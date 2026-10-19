# 2026-10-19 每轮多稿采样与择优 · 任务清单

口径与不变量见 `spec.md`。**先红后绿**：每步先写会红的用例，再补实现。
每步收口都跑 `corepack pnpm verify`（须 `VERIFY_EXIT=0`），全绿后按小节提交（**不推送**）。

多行 commit message 用 `.git/COMMIT_MSG` + `git commit -F`（PowerShell 不支持 bash heredoc）。

---

## T1 判据打分契约（`packages/contracts/src/draft-rank.ts` + 单测）

- 先写 `draft-rank.test.ts`：
  - `draftSampleCountSchema`：收 1/2/3；`0`/`4`/`"2"`/缺字段 ⇒ 中文拒绝句 = `DRAFT_SAMPLE_COUNT_REJECT`。
  - `readDraft`：读数逐项等于同一份 `aiFlavorGate(text)` 的对应字段（反向钉：改 gate 不改这里就红）。
  - `rankDrafts`：① 复读句多的排后；② 词命中多的排后；③ 同分保持原序（稳定性用例）。
- 再补 `draft-rank.ts` 实现。
- 导出面：从 `packages/contracts/src/index.ts` 转出。

## T2 每轮字段与载荷契约（`agent-event.ts` / `ipc.ts`）

- 先写用例：`startTurnInputSchema` 缺 `sampleCount` ⇒ 炸中文；`pickDraftInputSchema` / `discardDraftsInputSchema` 形状与拒绝句；`DraftSetResult` 三档 reason 各带中文。
- `agent-event.ts`：`startTurnInputSchema` 增 `sampleCount`；`AgentOutbound` 增 `candidates` 变体；增 `DraftCandidate`、两条入参 schema、`DraftSetResult`。
- `ipc.ts`：通道表两条 + `RendererApi` 两个方法。
- 用例名里不许出现「颜色 / 位置」这类样式词。

## T3 主进程静默采样 + 落盘 + 丢弃（`agent-service.ts`）

- 先写 `agent-service.multi-sample.test.ts`（用既有 service 测试的假 deps 搭法）：
  1. `sampleCount: 1` ⇒ publish 序列与 `sampleCount` 缺省那条路逐条相等（不开开关行为不变，spec §5-1）。
  2. `sampleCount: 2` ⇒ `appendAgentEvent` 零调用、`publish` 只有本轮 `turn-start`/`turn-end`；末了恰来一条 `candidates`（2 条稿）。
  3. `sampleCount: 2` + 这本书开着 `accept-session` ⇒ 静默稿的提案不进 `pending`、`applyDecision` 零调用（spec §5-4）。
  4. `pickDraft(集, 1)` ⇒ 盘上多一份、`pending` 有那张卡、`draftSetId` 第二次回 `gone`（spec §5-5）。
  5. 换书后 `pickDraft` 回 `gone`（spec §5-6）。
  6. `discardDrafts` ⇒ 盘上零写入。
- 实现：`buildHost` 的 `onProposal` 改成可注入（默认仍是 `registerProposal`）；新增 `draftSets` 与 `runSilent`、`pickDraft`、`discardDrafts`；`draftSets` 进 `clearBookScoped()`。
- 行数预算：`agent-service.ts` 贴上限，超 800 行就把采样编排整体挪进新模块 `multi-sample.ts`（注入依赖，照 `agent-session-read.ts` 的形）。

## T4 IPC 注册与守卫（`agent-ipc.ts` / `ipc-guard.ts`）

- 先写/补用例：两条通道都进 `IPC_ARG_SHAPES`；`IPC_DENY_REPLIES` 有对应回会；`ipc-guard.test.ts` 的并集用例自然通过。
- `agent-ipc.ts` 注册 `agent:pick-draft` / `agent:discard-drafts`（入参过 zod 后中文拒绝）。

## T5 渲染层

- 先写用例：
  - `composer-chips.test.ts`：`draft` chip 三档文案与 `title` 里出现 `sampleCount` 与真实值；`CHIP_EMIT` 键齐。
  - `useAgentStore` 相关用例：`sampleCount` 默认 1、`cycleDraftSample` 循环 1→2→3→1、`send` 带的 `sampleCount` 正确、`candidates` 入集、`turn-start` 清集、`pickDraft` 成功后清集、失败写 `notice`。
  - `agent-thread.test.ts`：`malformedPush` 对 `candidates` 的形状判定（缺 `drafts` / `drafts` 不是数组 ⇒ 中文原因）。
  - `utils/draft-candidates.ts`：读数拼句（四条读数各出一句 / 算不出那条不硬凑）。
- 实现：`composer-chips.ts`、`ComposerBox.vue`、`CenterColumn.vue`、`useAgentStore.ts`、`utils/agent-thread.ts`、新 `utils/draft-candidates.ts`、新 `components/DraftCandidates.vue`。
- 补 mock：`agent-store-fixture.ts`、`book-draft-fixture.ts` 及 7 份测试夹具。

## T6 门禁与台账

- `corepack pnpm verify` 全绿（prettier → 6 枚 tsc → eslint → 边界 → 行数预算 → vitest）。
- 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 追加 **§一百三十三**：本刀的取舍（为什么打分只给序不给总分、为什么静默稿的提案要复用 `registerProposal`、为什么落盘不自动批准、为什么多稿档不跨重启记忆、为什么丢增量）。
- `commit`（多条 message 走 `-F`）。
- 收口后进 P0-①（阈值真人语料校准，先定数据来源）。

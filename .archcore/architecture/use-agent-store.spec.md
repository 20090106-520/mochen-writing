---
title: "Renderer agent store: turn lifecycle, event reduction and thread views"
status: accepted
tags:
  - "agent"
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「渲染层中栏那份线程态」有规范力：`apps/desktop/src/renderer/src/stores/useAgentStore.ts` 这一份 store，入站推送的归约（`apply`）、事件折叠（`reduceEvent`）、一轮的起 / 排 / 断（`send` / `queueText` / `stop`）、历史水合（`ensureHydrated`）、审批出口（`decide` / `loadDiff`）、`/` 面板派发（`runSlashCommand`）与订阅挂摘全在这里。**纯判定与文案都住 utils**（`agent-thread` / `session-row-action` / `slash-commands` / `composer-context` / `timeline`），本 store 只接线与摆态。

Depended on by: 中栏各组件（消息流、状态行、composer、提案卡、历史面板）、`useBookStore`（`absorbAgentWrite` 吸收智能体写盘）、`useLayoutStore`（`/` 命令落点）、装配处的订阅挂载（`center-column-listening-wiring`）。

Out of scope:

- 判定的真身 —— `ThreadView` / `newThread` / `threadKeyFor` / `malformedPush` / `plainList` / `composeStatusLine` / `composeStatusReport` 住 `utils/agent-thread`；每行判定住 `utils/session-row-action`。
- 跨进程通道的形状与主进程侧的编排 —— 见 `architecture/ipc-channel-contract.spec.md` 与 `architecture/agent-service.spec.md`。
- 书的打开 / 草稿 / 落盘 —— 见 `architecture/use-book-store.spec.md`。

## Surface

- `useAgentStore` — @apps/desktop/src/renderer/src/stores/useAgentStore.ts — 中栏唯一的线程态 store。
- `viewOf(threadKey)` — 同文件 — 线程视图的唯一取处；新建时必须回读 `state` 那一份代理。
- `apply(outbound)` — 同文件 — 唯一入站归约口：畸形闸 → 按载荷 `threadKey` 归位 → turn 守卫 → 分派。
- `reduceEvent(thread, event, options?)` — 同文件 — 事件的唯一折叠处，实时与回放共用；`options` 关实时副作用。
- `send(text)` / `queueText(threadKey, text)` / `stop()` — 同文件 — 一轮的三扇门：起、排、断。
- `ensureHydrated` / `runHydrate` / `applyReplay` — 同文件 — 水合八规则的唯一实现段。
- `decide(proposalId, decision, guidance)` / `loadDiff(proposalId)` — 同文件 — 审批的唯一出口与其差异取数。
- `runSlashCommand(command, argument)` — 同文件 — `/` 面板的唯一派发口。
- `startListening` / `stopListening` — 同文件 — 订阅的唯一挂 / 摘处；`agentEventOff`（state）是那枚句柄。
- `pendingOf` getter — 同文件 — 某线程待审计数的唯一口径（只数 `pending`）。
- `ThreadView` / `newThread` / `threadKeyFor` / `malformedPush` / `composeStatusLine` — @apps/desktop/src/renderer/src/utils/agent-thread.ts — 线程视图形状与纯判定 / 文案，经 store 原样转出。

States: 未订阅 → 订阅（`agentEventOff` 就位）→ 建线（`turn-start` 占 `turnId`）→ 流式（`delta` 累积 / `event` 落 `items`）→ 收束（`turn-end`：`running` 归 false、清流式、落 `endedAs`）→ 水合回放（按 id 去重、派生扫卡）→ 换会话或 `/clear`。

## Normative Behavior

1. WHEN 一条推送进入 `apply`，the store MUST 先经 `malformedPush` 过闸，再按**载荷自带的 `threadKey`** 归位。
2. WHEN 归位，the store MUST NOT 按「激活页」路由事件——否则别的线程的残字与错误会串进当前章视图。
3. WHEN 收到的推送 `turnId` 与当前轮不等，the store MUST 丢弃它，MUST NOT 改动该线程任何字段。
4. WHEN 一条 `turn-start` 到达，the store MUST 用同一个 `newThread` 形状占位（`running=true`、清流式与 `endedAs`）并归零 `seconds`。
5. WHEN 一条 `turn-end` 到达且 `turnId` 过闸，the store MUST 收束该轮（`running=false`、`turnId=null`、清流式、落 `endedAs`），且只在 `failed` 时写 `lastError`。
6. WHEN 一条 `turn-end` 收束，the store MUST 先自动发队首（`queued.shift()`），发了就不再补水合。
7. WHEN `turn-end` 的队列为空，the store MUST 补一次 `ensureHydrated`（`hydrated` 未置位时）。
8. WHEN 一条 `user-message` 事件到达，the store MUST 销掉该线程的还字账——字已在转录里，绝不回填成第二份。
9. WHEN 一轮失败且入口曾乐观清空该格、且该格此刻仍空，the store MUST 把用户原句还回草稿格。
10. WHEN 发一轮，the store MUST 用 `threadKeyFor(activeDocTab)` 作线程键与 `docRelPath`，并原样塞入当下两枚每轮开关。
11. WHEN 递出网，the store MUST 用 `plainList` 把响应式数组摊成普通数组（`skillPaths` / `pinned`）。
12. WHEN 挂载订阅，the store MUST 幂等（`agentEventOff` 非空即 return），并把 preload 交回的那只函数存下。
13. WHEN `stopListening`，the store MUST 走交回的那只函数摘除，MUST NOT 自己去摸 listener 本体，且线程态一字不动。
14. WHEN `viewOf` 新建线程，the store MUST 回读 `this.threads[key]` 而不是手里那份裸对象。
15. WHEN 水合，the store MUST 逐条照八规则：幂等 / `running` 跳过 / 并发合流 / 按事件 id 去重 / `no-session` 才置位 / 派生扫描覆盖卡态 / 只有 `interrupted` 结尾才标 / 坏行如实播报。
16. WHEN 走回放路径，the store MUST 关掉 diff 取数（`fetchDiff:false`）与写盘回吸收 / 实时提示覆盖（`absorbWrites:false`）。
17. WHEN 登记一条 `proposal` 事件，the store MUST 建 `pending` 卡并（非回放路径）取回 diff。
18. WHEN 一条 `error` 事件带 `proposalId` 且那张卡仍是 `pending`，the store MUST 把它收编成 `stale`；其余状态一律不重判。
19. WHEN 切会话（`showSession`），the store MUST 先置 `hydrated=true` 抢在换标签前，再指名读，且覆盖式清掉旧会话的卡。
20. WHEN 派发 `/` 命令，the store MUST 只在 `runSlashCommand` 一处决定落点，MUST NOT 在组件里各写一份 switch。
21. WHEN `/clear`，the store MUST 只清渲染层视图（`hydrated` 置真、清卡），MUST NOT 清 `queued`、MUST NOT 动盘上历史。
22. WHEN 记线程键，the store MUST 只经 `threadKeyFor`（trim；空归 `UNBOUND`），MUST NOT 另立口径。
23. WHEN 面板取数（`refreshSessions` / `refreshSkills`）失败，the store MUST 只写 `notice`，MUST NOT 清空已显示的行 / 表。

## Constraints & Invariants

- Constraint: 本文件正贴 800 行预算顶 —— 纯判定与文案拆到 `utils/agent-thread`（本 store 用 `export *` 原样转出，公开面不变），见 `conventions/source-line-budget.rule.md`。
- Constraint: 每条线程显式挂入的技能 id 住内存态（`skillPathsByThread`），**不跨重启、不落 `book.json`** —— 挂入是每轮临时的事，不该占用户作品的配置位（spec §11）。
- Constraint: 出网前的响应式数组一律经 `plainList` 摊平 —— `contextBridge` 在进 preload 函数体**之前**就序列化实参，`Proxy` 在更外面就被拒（`An object could not be cloned.`）。
- Invariant: `viewOf` 是线程视图的唯一取处 —— 裸对象与 pinia 代理是「同一个 target、两套拦截」，跨 await 握裸引用会让依赖通知一次不发，视图永久停在旧缓存。
- Invariant: `agentEventOff` 是订阅的唯一真身（存句柄不存布尔）——「挂没挂」与「怎么摘」用的是同一份判据。
- Invariant: `malformedPush` 是进 store 的唯一形状闸 —— 因 preload 只做 `payload as AgentOutbound`，畸形形状只能在这一层止步。
- Invariant: 迟到守卫的判据是 `thread.turnId === outbound.turnId`（严格相等）——写成 `turnId !== null && …` 会让「轮次已收束」那一刻整个短路，迟到的字凭空落屏。
- Invariant: `UNBOUND` 与 `threadKeyFor` 取自 contracts / `utils/agent-thread`，本层不另立第二份口径。
- Invariant: 水合的并发合流只经 `hydrateInflight` —— 同一线程同时只有一次在途取数。

## Failure Behavior

1. IF 推送畸形（缺 `threadKey` / `turnId`，或未知 `type` / `deltaKind` / `event` 类型 / `status`），THEN the store MUST 忽略并把中文原因写进 `notice`，MUST NOT 新建或污染任何线程。
2. IF 推送的 `turnId` 与当前轮不等，THEN the store MUST 丢弃它（迟到的 delta / event / turn-end 一律不进）。
3. IF `startTurn` 被边界拒绝（IPC 抛），THEN the store MUST 把单句中文写进 `notice` 与该线程 `lastError`，MUST NOT 留悬空 promise。
4. IF 该轮 `failed` 且该格仍空、且用户未再打新字，THEN the store MUST 把原句还回草稿格；用户已打新字则 MUST NOT 覆盖。
5. IF `decide` 的跨 IPC 调用抛，THEN the store MUST 把中文原因贴回卡片并**保持 `pending`** 可重试。
6. IF `loadDiff` 取回失败，THEN the store MUST 让卡片保持 `pending`、`diff` 置空并写中文原因。
7. IF 水合取数抛（首行坏 / IPC 抛），THEN the store MUST 回滚 `hydrating`、写中文 `notice`、留待用户再按 `/resume`。
8. IF 回放载荷有坏行（`droppedLines > 0`），THEN the store MUST 如实播报行数并只归约可归约的那些，MUST NOT 伪造事件。
9. IF `showSession` 指名读失败，THEN the store MUST 退回 `hydrated` 原值、保留旧视图与旧 `sessionId` 并写中文。
10. IF `refreshContextPreview` 取数失败，THEN the store MUST 静默留住上一次读到的值（占用条是辅助信息）。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 线程 CH 已有一轮在生成中，流式残字已累积
When 一条 turnId 不等（迟到）的 delta 或 turn-end 到达
Then 它被守卫丢弃：streaming 与 items 一字不变、running 不被复活
```

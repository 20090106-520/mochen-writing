---
title: "Agent turn orchestration service"
status: accepted
tags:
  - "agent"
  - "architecture"
  - "main-process"
---

## Purpose & Scope

本规范对「一轮对话从入收到落盘的全部编排」有规范力：`apps/desktop/src/main/agent-service.ts` 这一份文件，`startTurn` / `interrupt` / `decide` / `diffOf` / `loadSession` / `listSessions` / `contextPreview` / `dispose` 的取证都在这一层，跨进程进来的输入校验也在这一层。它是「通道契约」（`architecture/ipc-channel-contract.spec.md`）与「通道运行守卫」（`architecture/ipc-guard.spec.md`）之下真正跑一轮的服务。

Depended on by: `apps/desktop/src/main/agent-ipc.ts`（七条 agent 通道的唯一注册方）、`renderer/src/stores/useAgentStore.ts`（经 preload 消费回执与事件）、`index.ts`（装配依赖并注册）。

Out of scope:

- 通道名与载荷形状 —— 见 `architecture/ipc-channel-contract.spec.md`。
- 通道入口的信任分档与运行时守卫 —— 见 `architecture/ipc-guard.spec.md`。
- 纯函数装配、历史窗口、事件折叠的判据本体 —— 住在 `@mochen/agent-runtime`。
- 只读回放与全书总览 —— 拆到 `agent-session-read.ts`（同 `prompt-assembly.ts` / `approval-read.ts` 一样为行数预算拆出，不共享状态）。

## Surface

- `AgentService` — @apps/desktop/src/main/agent-service.ts — 唯一的对外接口面；七条 agent 通道都打到它的方法上。
- `AgentServiceDeps` — 同文件 — 装配处注入的依赖（book / settings / fetchImpl / emit / promptFor / readSkill / plugins）；不给 `readSkill` 时「挂入技能读不到」必须与「没挂技能」分得出来。
- `startTurn(input)` — 同文件 — 一轮的入口：校验 → 闸门 → 装配 → 先发 turn-start 送 turnId；resolve 在 turn 结束（含落盘与自动批准）之后。
- `runningTurns` — 同文件（闭包内唯一真身）— threadKey → 当前在跑那一轮的 turnId；`hasRunningTurn` 与摘锁共用它。
- `autoSession` / `autoDocTool` — 同文件 — 两张免审表，键只存**并入书根之后**的 `scopedApprovalKey`。
- `PendingProposal` / `diffs` — 同文件 — 待审提案与其差异卡片；换书即清。

States: 未开书 → 开书（threads / pending / diffs / autoSession / autoDocTool 就绪）→ 换书或关书（上述全部清空）→ dispose（abort 全部 controller、reset 作用域）。

## Normative Behavior

1. WHEN 渲染层递来 `StartTurnInput` 或 `DecideInput`，the 服务 MUST 在边界用对应 zod schema 校验。
2. WHEN 边界校验不通过，the 服务 MUST 抛单句中文，MUST NOT 把裸 ZodError 的 issue 数组交回渲染层。
3. WHEN 一条线程已有一轮在跑，the 服务 MUST 在发任何 outbound 之前当场拒掉新的一轮。
4. WHEN 收到一条 startTurn，the 服务 MUST 把 threadKey 归一（trim；空白归一成 `UNBOUND`）后再进 `runningTurns`。
5. WHEN 一轮开始，the 服务 MUST 先占住 `runningTurns`，再发 turn-start。
6. WHEN 一轮收尾（成功 / 失败 / 早退 / 异常），the 服务 MUST 在 `finally` 里摘掉自己那一轮，且只在 `runningTurns.get(threadKey) === turnId` 时摘。
7. WHEN 任一入口读或写按书作用域的状态，the 服务 MUST 先调一次 `bookScope.sync()`。
8. WHEN 书作用域发生变化，the 服务 MUST 清空 threads / pending / diffs / autoSession / autoDocTool。
9. WHEN 记或命中一条免审授权，the 服务 MUST 把书身份并入键（`scopedApprovalKey`）。
10. WHEN `scopedApprovalKey` 拿不到书根（未开书），the 服务 MUST 判为不命中并回落到人工确认。
11. WHEN 登记一条提案，the 服务 MUST 只在 `registerProposal` 一处覆写 turnId 与 threadKey，MUST NOT 改动 `proposal.id`。
12. WHEN 批准一条提案，the 服务 MUST 在批准这一刻才判写入档位（提案生成时不判）。
13. WHEN 一手事件产生，the 服务 MUST 先把事件发去渲染层，再把同一事件串行落进 JSONL。
14. WHEN 写盘，the 服务 MUST 只经 `deps.book.writeDoc`（其下 `writeDocFile` 先备份再按指纹覆写）。
15. WHEN 本轮系统提示词装配完成，the 服务 MUST 把档案写入范围那句（`writeScopeSentence`）一并写进提示词。
16. WHEN 上下文占用条被查询，the 服务 MUST 走与 startTurn 同一条装配路径（`assembleFor`）。
17. WHEN 上下文占用条回复，the 服务 MUST 只回标签与字数，MUST NOT 回正文。
18. WHEN 挂入技能读不到，the 服务 MUST 发一条 error 事件说清跳过几个，MUST NOT 静默放过。
19. WHEN 一条早退（空输入 / 未开书 / 未配模型 / 无密钥），the 服务 MUST 只发渲染层不落盘，并发一条 turn-end failed。

## Constraints & Invariants

- Constraint: 本文件正贴 800 行预算顶 —— 自足且不共享状态的块往外拆（只读回程 `agent-session-read.ts`、提示词装配 `prompt-assembly.ts`、审批读 `approval-read.ts`），见 `conventions/source-line-budget.rule.md`。
- Constraint: apiKey 只进主进程 —— 从 `deps.settings.apiKey()` 取出后只并入出站 provider，绝不递进渲染层。
- Constraint: 全书级批量改写（`book:replace-all` / `import:commit`）只在主进程执行，且仅在「无任何正在运行的轮次」时可调 —— `hasRunningTurn` 是那条 sensitive 档判据的真身（见 `decisions/ipc-channel-trust-tiers.adr.md`）。
- Invariant: 通道名的真身只有一份 `IPC_CHANNELS`；本层不许硬编码通道字符串，注册全在 `agent-ipc.ts`。
- Invariant: `runningTurns` 是「这条线程在跑」的唯一真身 —— 渲染层那个 running 只是某个窗口自己的状态（两个窗口／IPC 重放都能叠两轮进同一 JSONL），所以闸门必须落在本层。
- Invariant: 免审键的拼装只有 `scopedApprovalKey` 一处（真身住 `book-scope.ts`）—— 本地判别式（`threadKey` 或 `${docRelPath}::${tool}`）单独拿去比会跨书撞名。
- Invariant: 判据真身只许一处 —— `workModeOf` / `resolveProfile` / `historyStatFor` / `fitHistoryToWindow` / `UPSTREAM_WINDOW_TOKENS` / `writeScopeSentence` / `foldOrphanUserMessages` 一律只在 `agent-runtime` 或本文件单一处定义，本层不另抄口径（铁律 6）。
- Invariant: 历史只到上一次为止，本轮 user 文本由 `runTurn` 自己追加 —— 重复塞会出现两行一样的 user。
- Invariant: `UNBOUND` 取自 contracts，本层不另立一份。

## Failure Behavior

1. IF 同一线程的下一轮进来，THEN the 服务 MUST 抛单句中文（含「等它答完」或「按 Esc」的出路），且一个 turn-start 都不发。
2. IF 未开书（`snapshot` 取不到当前书），THEN the 服务 MUST 回一句中文而不是一份空数据。
3. IF `readForApproval` 读到 unreadable，THEN the 服务 MUST 停手、保留 pending、让用户重试，MUST NOT 当成「文件确实不存在」用空指纹放行。
4. IF 批准前比对通过、写盘那一刻才发现被改，THEN the 服务 MUST 发一条带 proposalId 的中文错误（这一支不许静默，否则回放会念成 expired）。
5. IF 写盘返回 io / invalid-path / outside-book，THEN the 服务 MUST 保留 pending 并发出写入失败的中文，供用户重试。
6. IF 写盘返回 stale，THEN the 服务 MUST 删掉 pending 并如实说「原稿已被改动，没有覆盖」。
7. IF 档位不允许写入，THEN the 服务 MUST 只挡这一刀且 MUST NOT 删 pending（放开后同一条还能批准）。
8. IF 会话历史落盘失败，THEN the 服务 MUST 发一条 error 事件（只影响回放，不影响已显示内容，但必须说出来）。
9. IF 读一条线程的 JSONL 失败，THEN the 服务 MUST 如实抛中文，MUST NOT 把它当成「没有历史」让模型失忆而用户毫不知情。
10. IF 上下文占用条某一条读盘失败，THEN the 服务 MUST 少装那一条而不抛（辅助信息不该让界面因此报错）。
11. WHEN 未开书查询上下文占用条，the 服务 MUST 回全零结构与 `historyStatFor(null)`，而不是省略字段让面板去猜 `undefined`。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 线程 A 已有一轮在生成中
When 同一线程再递一条 startTurn
Then 当场抛出 THREAD_BUSY_REASON 那句中文，且这条线程一个 outbound 都不发
```

---
title: "IPC channels carry a trust tier"
status: accepted
tags:
  - "ipc"
  - "security"
---

## Context

既有 ipc-guard 只拦来源与形状，拦不住同源页内注入脚本调用任意通道 —— 主进程侧无法区分同源页里的合法脚本与注入脚本，两者的 senderFrame、URL、origin 完全一致。若不加限制，一条被注入的页内脚本可以在无书打开的场景下直接调用整书级批量改写通道。

## Decision

给每条 IPC 通道挂一个信任等级，校验挂在 ipc-guard 的来源闸之后、形状闸之前。等级表与通道清单住在 `apps/desktop/src/main/ipc-guard.ts`（`IPC_TRUST_LEVELS`），判据真身住在 `channel-trust.ts`，依赖查询器用与 `installRendererTrust` 一致的装配点模式注入。

三档：

- `public`（默认）—— 只过来源闸，webdav 五条通道属此档。
- `self` —— 需要「当前书已打开」。
- `sensitive` —— 只在「无任何正在运行的 agent 轮次」时可调，仅含 `book:replace-all`、`import:commit`。

### Rationale

- 判据复用主进程已有的运行时状态查询器（book-service 的 `current()` 与 agent-service 的 `runningTurns`），不新增独立的安全校验逻辑。
- sensitive 档挑的是「轮次中批量改写会触发指纹守卫失败」这一条真实失败模式，而不是泛化地限制所有写通道。

## Alternatives Considered

1. 靠 senderFrame、URL、origin 区分注入脚本 —— 否决，因为同源页内注入脚本与合法脚本在这三项上完全一致，判据天然区分不开。
2. 只做 public 一档 —— 否决，因为无书时仍可调用书级批量改写通道。
3. 把 sensitive 档扩到所有写通道 —— 否决，因为会拦住轮次中合法的写操作。

## Consequences

### Positive

- 无书场景下调 self / sensitive 通道被拦，带 `guard` 类型的拒绝理由。
- 整书级批量改写不会与运行中的 agent 轮次互相打脸。

### Negative

- 有书场景下的同源注入脚本仍拦不住；缓解：依赖 CSP 拦截注入，并由 fs-store 的写盘闸限制后果。
- 装配点必须等依赖查询器就绪，下移到 `registerAgentIpc` 之后 —— 顺序成了一条隐式契约。

### Risks

- 信任等级表与通道清单可能漂移 —— 缓解：`channel-trust.test.ts` 覆盖 fail closed、无书、有书、public 档等边界，两处变异测试验证判据。

## Implementation Notes

- 依赖设为必填，装配完整性由 typecheck 校验。
- 新增通道需同步登记进等级表，未登记的按 public 放行。

---
title: "IPC guard: sender, channel tier, shape, realpath"
status: accepted
tags:
  - "architecture"
  - "ipc"
  - "security"
---

## Purpose & Scope

这一份对「主进程收进来的每一条 IPC 指令」那道入口守卫有规范力：`apps/desktop/src/main/ipc-guard.ts` 加 `channel-trust.ts` 这一个管子，从来源问到档位再到参数形状。

Depended on by: 主进程里每一处 `ipcMain.handle` 注册点（`apps/desktop/src/main/index.ts`、`agent-ipc.ts`、插件与备份那几处），以及窗口侧的 `installWindowGuards`。动这两份文件的任何一刀都按本规范走。

Out of scope:

- 同源页内被注入的脚本 —— 那一帧的 URL 与来源完全合法，本管子认不出来；为什么以及兜底在哪见 `decisions/ipc-channel-trust-tiers.adr.md` 的 Consequences。
- CSP 那一层 —— 见 `renderer-csp.ts`，它才是拦注入的地方。
- fs-store 的写盘闸 —— 第二道防线，不在本管子里。
- 窗口的 `sandbox: false` —— 本轮没动，不在本规范覆盖范围。

## Surface

- `handleTrusted(register, channel, fn, options)` — @apps/desktop/src/main/ipc-guard.ts —— 业务侧唯一注册入口。
- `trustedHandler(channel, fn, options)` — 同文件 —— `index.ts` 那四条通道按字面量注册，`export-dialog-wiring.test.ts` 钉着这个形状。
- `IPC_ARG_SHAPES` — 同文件 —— 参数形状表，按通道名索引。
- `IPC_NO_ARG_CHANNELS` — 同文件 —— 无参通道清单。
- `IPC_DENY_REPLIES` — 同文件 —— 按契约失败回会表。
- `GuardDenyKind` — 同文件 —— 拒绝分四类：`untrusted` / `guard` / `arg` / `check`。
- `senderTrustVerdict(event)` — 同文件 —— 来源裁决点。
- `installRendererTrust(trust)` — 同文件 —— 来源判据的装配点。
- `channelTrustVerdict(channel)` — @apps/desktop/src/main/channel-trust.ts —— 通道档位裁决点。
- `installChannelTrustDeps(deps)` — 同文件 —— 通道档位的装配点，`turnRunning` 是必填字段。
- `IPC_TRUST_LEVELS` — 同文件 —— 三档表（`public` / `self` / `sensitive`）。
- `installWindowGuards(deps, trust)` — @apps/desktop/src/main/ipc-guard.ts —— 窗口闸装配点。

States: 未装配 → 启动装配（`index.ts`）→ 每次请求判一遍。装配未就位时本管子一律 fail closed。

## Normative Behavior

1. WHEN 一条指令到达注册面，the 守卫 MUST 按「来源 → 通道档位 → 参数形状 → 自定义 check」的次序逐道判。
2. WHEN 来源判定为不可信，the 守卫 MUST 就地拒绝。
3. WHEN 来源判定为不可信，the 守卫 MUST 往主进程日志写一行带理由的痕迹。
4. WHEN 来源判据没装上，the 守卫 MUST 按不可信处理。
5. WHEN 一条通道登记为 self 或 sensitive 档而当前没有书，the 通道档位判据 MUST 拒绝该指令。
6. WHEN 一条通道登记为 sensitive 档且有一轮智能体正在跑，the 通道档位判据 MUST 拒绝该指令。
7. WHEN 通道档位判据的装配点没装上，the 通道档位判据 MUST 把 self 与 sensitive 两档按不可信处理。
8. WHEN 一个参数不满足形状表里那条规则，the 守卫 MUST 用该规则给出的理由拒绝。
9. WHEN 自定义 check 给出一个字符串，the 守卫 MUST 拒绝。
10. WHEN `doc:*` 收到的相对路径解出的真实路径落在当前书根之外，the 守卫 MUST 拒绝。
11. WHEN 主窗口被导航走或被 `window.open` 开新窗口，the 窗口闸 MUST 拦下。
12. WHEN 打包版被环境变量牵着去 load 远程 URL，the 窗口闸 MUST 忽略该地址。

## Constraints & Invariants

- Constraint: `IPC_ARG_SHAPES` ∪ `IPC_NO_ARG_CHANNELS` 必须覆盖主进程收的全部通道 —— `ipc-guard.test.ts` 钉着这条并集，漏一处就是一条没人看着的通道。
- Constraint: 新增通道落在带参形状表或无参清单之一，并在 `IPC_DENY_REPLIES` 配一条回会（见 `conventions/ipc-channel-registration.rule.md`）。
- Constraint: `ipc-guard.ts` 正贴 800 行预算顶 —— 新能力往 `channel-trust.ts` 一类新文件拆，不往这里塞（见 `conventions/source-line-budget.rule.md`）。
- Invariant: 判据真身只有一份 —— `isTrustedSender`、`isSameRendererOrigin`、`relPathStaysInsideRoot`、`channelTrustVerdict` 各自只实现一次。
- Invariant: 装配未就位时一律 fail closed，「漏装一次＝那张档位全放行」这个失败模式不允许出现。
- Invariant: 子帧判据走 `WebFrameMain.parent !== null` —— Electron 42 的 invoke 事件没有 `parentFrameId`，按它判会永远判不出子帧。
- Invariant: 全仓唯一一处参数 `as` 在形状闸之后 —— 断言写早了会把「这条通道没走闸」一起吞掉。

## Failure Behavior

1. IF 来源不可信，THEN the 守卫 MUST 回一条 `kind: "untrusted"` 的拒绝。
2. WHEN `senderFrame` 为 null（帧已销毁或已导航），the 来源判定 MUST 判为不可信。
3. IF 参数不是文本、是空串、含 `\0` 或超长，THEN the 形状闸 MUST 拒绝。
4. IF 某个通道在 `IPC_DENY_REPLIES` 没有条目，THEN the 守卫 MUST 抛一条带理由的错误。
5. WHEN 通道档位判据的装配点没装上，the 通道档位判据 MUST 回一句「装配没跑到」的理由。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 来源可信的一条 book:replace-all 指令，当前无书
When 它到达 trustedHandler
Then 通道档位判据以 kind: "guard" 拒掉，且没落到 handler
```

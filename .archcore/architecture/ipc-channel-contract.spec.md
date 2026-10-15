---
title: "IPC channel contract surface"
status: accepted
tags:
  - "architecture"
  - "contracts"
  - "ipc"
---

## Purpose & Scope

本规范对「跨进程通道的契约面」有规范力：`packages/contracts/src/ipc.ts` 这一份文件，通道名、请求载荷、回执形状都只在这里声明一次。它是 `conventions/ipc-channel-registration.rule.md` 与 `decisions/ipc-channel-trust-tiers.adr.md` 落地时所依据的那张表。

Depended on by: `apps/desktop/src/preload/renderer-api.ts`（唯一的实现方）、主进程每一处注册点（`index.ts` / `agent-ipc.ts` / book-service 那几处）、渲染层各 store。

Out of scope:

- 通道入口的运行时守卫与信任分档 —— 见 `architecture/ipc-guard.spec.md`。
- 各领域 zod 形状的本体 —— 住在 `contracts/` 下对应领域模块（`book.ts` / `agent-event.ts` / `webdav.ts` …），本文件只做引用与联合。
- CSP 与窗口闸 —— 见 `apps/desktop/src/main/renderer-csp.ts`。

## Surface

- `IPC_CHANNELS` — @packages/contracts/src/ipc.ts — 唯一的通道名清单；键是进程内名，值是线上字符串。
- `RendererApi` — 同文件 — preload 实现的那份契约；渲染层只拿得到它上面的方法。
- 各通道的回执联合（`DocWriteResult`、`BookReplaceResult`、`DocTrashResult`、`BookBackupCreateResult` …） — 同文件 — 失败是联合的一支，不是抛出的异常。
- `BookReplaceInput` — 同文件 — 全书替换的输入只收字面文本与替换串，不收路径清单。
- `ContextPreview` — 同文件 — 占用条的数据源；只回标签与字数，不回正文。
- `FlushQuitReply` — 同文件 — 退出握手里渲染层唯一的回话形状。

States: 无 —— 这一份是纯声明面，不带运行时状态。

## Normative Behavior

1. WHEN 新增一条跨进程通道，the 契约作者 MUST 把它的名字登记进 `IPC_CHANNELS`。
2. WHEN 定义一条通道的请求载荷或回执形状，the 契约作者 MUST 在承载该领域的模块里用 zod 收口。
3. WHEN 一条通道的回执带失败侧，the 契约作者 MUST 把失败编成可辨识联合的一支。
4. WHEN 一条通道的回执带失败侧，the 契约作者 MUST NOT 用抛错表达失败。
5. WHEN 渲染层要调一条通道，the preload MUST 字面转发实参。
6. WHEN 渲染层要调一条通道，the preload MUST NOT 另加判定或私自夹取范围。
7. WHEN 一条通道会让主进程动盘上路径，the 契约 MUST 只收书内相对路径或清单内的名字。
8. WHEN 渲染层需要向主进程递一个 URL，the 契约 MUST 把这条路限定在 `app:open-web-source` 这一条通道。
9. WHEN 一条通道涉及已存的密钥，the 回执 MUST 只递存在位（`hasPassword`）而不是明文。
10. WHEN 一条通道涉及已存的密钥，the 回执 MUST NOT 把明文带进渲染进程内存。
11. WHEN 一份数据只能由主进程算出（引用、diff、窗口分母），the 契约 MUST 让主进程随回执把它递出来。
12. WHEN 一份数据只能由主进程算出，the 渲染层 MUST NOT 自己抄一份口径。

## Constraints & Invariants

- Constraint: `packages/contracts/src/ipc.ts` 正贴 800 行预算顶 —— 新通道往承载它的领域模块拆，不往这里塞（见 `conventions/source-line-budget.rule.md`）。
- Constraint: 新增通道三处齐备：带参进形状表、无参进无参清单、并在 `IPC_DENY_REPLIES` 配一条按契约的失败回会（见 `conventions/ipc-channel-registration.rule.md`）。
- Invariant: 通道名的真身只有一份 —— `IPC_CHANNELS` 是唯一清单，preload、注册点与用例都从它取（铁律 6）。
- Invariant: 渲染层拿到的表面只有 `RendererApi` 的方法 —— `invoke` / `on` / `ipcRenderer` 不许成为键（`renderer-api.test.ts` 的点名册钉着）。
- Invariant: 契约里每一条要收的通道都在主进程注册过，且不许有人裸写 `handle(IPC_CHANNELS.x)`（`ipc-guard-coverage.test.ts` 钉着）。
- Invariant: 跨进程来的字段渲染层不默认相信 —— `docRefSchema` 验形状，验不过退回整本温和重扫。
- Invariant: 渲染层不 import `agent-runtime` —— 需要它算的东西（提案 diff、历史窗口分母）一律由主进程算好随回执递回。

## Failure Behavior

1. IF 一条通道在带参形状表与无参清单里都没有条目，THEN the 并集用例 MUST 判红。
2. IF 渲染层递出的相对路径解出的真实路径落在书外，THEN the 主进程 MUST 按 `outside-book` 拒掉。
3. WHEN 主进程算不出一篇文稿的引用，the 回执 MUST 如实回 `doc: null`。
4. WHEN 主进程算不出一篇文稿的引用，the 回执 MUST NOT 倒推一根假引用交回去。
5. WHEN 没打开作品目录，the 回执 MUST 用 `no-book` 而不是一份空数据。
6. IF 写盘这一步失败，THEN the 回执 MUST 带原因交回渲染层。
7. WHEN 回执带了失败原因，the 调用方 MUST 把它显示出来。
8. WHEN 更新源没有配置，the 回执 MUST 回 `disabled` 而不是报一条错。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 渲染层调用 writeDoc(relPath, content, expectedFingerprint)
When 盘上这一篇的指纹已被别处改动
Then 回执是 { ok: false, reason: "stale", currentFingerprint }
```

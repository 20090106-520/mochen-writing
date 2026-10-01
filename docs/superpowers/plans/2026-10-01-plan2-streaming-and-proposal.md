# 墨宸 AI · Plan 2（流式对话 + 提案写盘）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让中栏能与 OpenAI 兼容端点做流式对话（思考/计划/正文/工具卡四层渲染 + 会话 JSONL 落盘），并把模型产出的修改提案经人逐条审批后真实写入作品目录——写前备份、指纹不符即拒。

**Architecture:** 新增 `packages/agent-runtime`（纯 node，禁止 import electron）承载 SSE 解析、provider client、双路提案协议、锚点应用与 diff、会话 JSONL、权限判定与工具循环；`apps/desktop/src/main` 用 Plan 1 的 `fs-store`/`book-service` 组装出真实 ToolHost、密钥存储与审批登记，通过 IPC 把 `AgentOutbound` 推给渲染层；渲染层 `useAgentStore` 以事件归约为唯一真相，按章分线程。

**Tech Stack:** Node 24（global fetch / AbortController / TextDecoder）、pnpm 11（corepack）、Electron 42.5.0（safeStorage + ipcMain/webContents）、Vue 3.5.39、TypeScript 6.0.3、Pinia 3.0.4、zod 4.4.3、vitest 4.1.9。**零新增第三方依赖**（SSE 手写解析，见 Global Constraints）。

**Spec:** `docs/superpowers/specs/2026-10-01-mochen-writing-workbench-design.md`
—— 实现 S3（§3 会话布局、§4 中栏分层渲染）与 S4（§6 受控工具与审批、§6.1 双路提案协议、§6.3 打断残留、§8 密钥、§9 错误处理、§10 测试要求）。

**依赖 Plan 1 已交付的：** `@mochen/contracts`（`BookMeta`/`DocRef`/`PermissionMode`/`IPC_CHANNELS`/`RendererApi`）、`@mochen/fs-store`（`scanBook`/`sortChapters`/`readDocFile`/`writeDocFile`/`makeFingerprint`）、主进程 `createBookService()`、preload 白名单、三栏壳与 `useBookStore`。

---

## Global Constraints

每个任务都隐含满足以下约束（值取自 spec 逐字）：

- **模型永不直接写盘**（§6）。唯一落盘通路是「人审批通过 → 主进程写」；写入前必须先把原文件复制到
  `.mochen/changes/<时间戳>/`；指纹不符一律拒绝，绝不覆盖。
- 工具集**只有 5 个**：`read_doc`、`list_docs`、`search_docs`、`propose_patch`、`write_doc`（§6）。
  本计划不得新增第 6 个工具——Task 7 有一条专门断言把这条规则钉死成测试。
- 权限三档 `read-only` / `chapter-write` / `full-access`，默认最保守的 `read-only`（§6）；
  只读档下 `write_doc` 与提案落盘**一律拒绝并把中文原因回喂给模型**，不静默丢弃（§6 末段）。
- 档案的「写入范围」是上限不是授权：本计划所有写入仍走逐条审批（§5.1 约束 3）。
- `packages/contracts`、`packages/fs-store`、`packages/agent-runtime` 内**禁止** `import ... from "electron"`；
  只有 `apps/desktop/src/main|preload` 可以。由 `tools/check-package-boundary.mjs` 强制。
- 单文件（`.ts`/`.vue`）**≤ 800 行**，由 `tools/check-source-line-budget.mjs` 强制；中栏 UI 必须拆组件。
- **不新增 npm 依赖**。SSE 用 `node:util/TextDecoder` + 手写帧解析，HTTP 用 global `fetch`。
  理由：本机外网慢，且 spec §2 未给 provider SDK 预算。（若将来要加，属于新切片，不进本计划。）
- 所有面向用户与回喂模型的文案为简体中文；错误原因直接显示在对话流里，不只进日志（§7 状态行段）。
- 文稿与会话文件一律 UTF-8 + LF；`book.json` 永远不由智能体写（只有本机的 meta 保存通路能写）。
- 断言必须证明能失败：每个任务先写反向用例（红→绿），关键任务额外做**变异实验**
  （抽掉实现行，断言必转红）。只报「全绿」不算验证（§10 + 用户长期要求）。
- 门禁退出码不能被管道吞掉：`cmd | tail` 报的是 `tail` 的码。跑完必须回读日志里的
  `VERIFY_EXIT=0` 与用例总数；`pnpm` 一律 `corepack pnpm`。
- 本机 dev 在跑时全量 vitest 会假红灯（每次红的文件不同）；一律 `--maxWorkers=4`，异常时按文件重跑复核。
- 测试写盘一律用真实临时目录（`mkdtemp`），因为本计划要证明的就是「文件字节有没有变」。
  绝不拿 `C:\Users\17863\Desktop\深渊写作` 之外的真人书稿当测试对象。
- 每个任务结束都要绿：`corepack pnpm verify`（prettier + 5 个 tsc 项目 + eslint + 边界 + 预算 + vitest）。
  **契约与其消费方必须在同一任务落地**（如 `RendererApi` 扩展与 preload 实现同任务），
  否则中间提交会红 typecheck——这是 Plan 1 踩过的坑，本计划已按此排任务顺序。

---

## 设计决定（spec 没写死、本计划拍定的七条）

写在这里是为了让执行者与审查者对着同一套口径，而不是各自猜。

1. **`plan` 事件的来源 = ` ```mochen-plan ` 文本块。** spec §4 要求中栏渲染「计划」这一层，
   但 §6 把工具集钉死为 5 个，Codex 的 `update_plan` 工具在这里不能引进来。
   于是沿用 §6.1「双路协议」的思路：计划走文本块，与 `mochen-patch` 同一套围栏解析器。
2. **审批不阻塞工具循环。** 模型调 `propose_patch`/`write_doc` 时，工具回执立即是
   「提案已生成，等待人工审批；未批准前文件未改动」，循环继续；真正写入发生在人点批准的那一刻。
   理由：让人挂在一个 await 上的生成器会占住整条流，且与 §6.3「已生成未审批的提案保持 pending」矛盾。
3. **审批结果回喂进历史。** `eventsToMessages()` 把 `decision`（带说明的拒绝）与 `written`
   事件转成 `role: "user"` 的中文括注消息注入下一轮（「（审批结果：已写入 …，原稿备份在 …）」）。
   理由：所有 OpenAI 兼容端点都吃 user 消息，而中途插 `system` 或悬空 `tool` 消息在本地小模型上会报错。
4. **`RendererApi` 扩展 + preload 实现同任务（Task 12）**；Task 1 只加通道常量与载荷类型，
   保证每个中间提交都能过 tsc。
5. **自动批准规则的键**：`accept-session` 键在 `threadKey`（= 该章会话线程），`accept-prefix`
   键在 `${docRelPath}::${tool}`。spec §6 说的是「同一智能体档案内自动批准」，但档案是 Plan 3 的
   S6 才有实体；本计划以线程为等价作用域，Plan 3 把键换成 `profileId` 时只改一处（Task 11 有注释锚）。
6. **键位只做 `Enter` 提交 / `Shift+Enter`·`Ctrl+J` 换行，外加 `Esc` 一条**（`Esc` 不做就等于
   没有打断，而 §6.3 的残留规则是 S4 的一部分）；`Esc` 的焦点优先级用 §6.2 的 `resolveEscape`
   纯函数落地（Task 13 判定表 + Task 14 卡内/全局各一处）。
   `y/a/p/d` 审批键、`Ctrl+*`、`/` 面板、标签切换键归 Plan 3（S5）：审批按钮本计划全部可用，
   键位只是同一动作的第二入口。
7. **`stale` 不回 pending，`io-error` 回 pending。** §9 第二行「写盘失败 → 提案回退 pending 可重试」
   适用于占用/权限类失败；指纹不符说明盘上内容已不是提案针对的那一版，自动重试会把人没看过的改动写进去，
   所以卡片标「文件已变动，提案未写入，请让模型重新提案」。这条差异在 Task 11 有专门用例。

另外明确**本计划不做**：上下文包装配（§5 的「本章 + 大纲摘要 + 出场人物 + 前情」，Plan 3/S6）、
六个 `AgentProfile` 档案与切换（§5.1，Plan 3）、除 `Enter`/`Shift+Enter`/`Ctrl+J`/`Esc` 之外的键位层（§7 其余行，Plan 3；
`resolveEscape` 本身已在 Task 13 落为纯函数，Plan 3 只是把它接到更多键上）、
素材/技能浏览不打断的右栏改造（§4 末段，Plan 3）、`/` 斜杠命令与 `/compact`、冲突对话框复用给提案。
Task 11 的 `promptFor()` 是临时最小装配（角色 + 当前档 + 当前章正文 + 5 工具与文本块协议说明），
签名按 Plan 3 可替换的形状预留。

---

## 文件结构（先定边界，再切任务）

```
墨宸 AI/
  packages/contracts/src/
    tools.ts                  新增：AGENT_TOOL_NAMES / WRITE_TOOLS（唯一工具名来源）
    patch.ts                  改写：EditProposal v2（+mode/tool/threadKey/turnId/expectedFingerprint）+ zod schema
    agent-event.ts            新增：10 类持久事件 + SessionMeta + AgentOutbound + StartTurn/Decide 载荷
    provider.ts               新增：ProviderConfig/ProviderDraft/ProviderView + maskApiKey
    ipc.ts                    追加 7 个通道常量（Task 1）；RendererApi 扩展留给 Task 12
    index.ts                  追加 re-export
  packages/agent-runtime/     新建包（纯 node）
    package.json  tsconfig.json
    src/sse.ts                SSE 字节流 → data 帧（多字节安全、[DONE] 终止）
    src/chat-message.ts       ChatMessage 形状与 OpenAI wire 序列化
    src/provider-client.ts    streamChat()：delta/工具调用合并/中文错误/abort
    src/patch-protocol.ts     ```mochen-patch / ```mochen-plan 文本块解析 + prose 剥离
    src/apply-patch.ts        锚点三态（unique/ambiguous/missing）+ doc-overwrite
    src/diff.ts               unified diff（前后缀裁剪 + LCS + hunk）
    src/rollout.ts            会话 JSONL 落盘/读回 + 事件→历史消息
    src/permission.ts         三档权限判定 + 五目录天花板
    src/tools.ts              5 工具 schema + ToolHost 接口 + dispatchToolCall
    src/tool-loop.ts          runTurn()：流式 → 工具 → 提案 → 打断
    src/index.ts              re-export
    test/*.test.ts            与 src 一一对应
  apps/desktop/src/main/
    electron-cipher.ts        新增：safeStorage → Cipher 适配（不 import electron，测试无需 electron）
    credential-store.ts       新增：Cipher 注入的密钥落盘（不可用即拒写）
    provider-settings.ts      新增：baseURL/model + 密钥视图（掩码）
    doc-tools-host.ts         新增：fs 版 ToolHost（read/list/search + 提案生成，永不写盘）
    agent-service.ts          新增：runTurn 组装 + 提案登记 + 审批规则 + 写盘备份 + 事件外发
    agent-ipc.ts              新增：registerAgentIpc / registerProviderIpc（通道注册表，可单测）
    provider-fetch.ts         新增：global fetch → ProviderFetch 适配
    index.ts                  追加装配（secrets/settings/agent IPC）
  apps/desktop/src/preload/
    renderer-api.ts           新增：不 import electron 的 API 工厂（可单测）
    index.ts                  改为 contextBridge.exposeInMainWorld("mochen", createRendererApi(...))
  apps/desktop/src/renderer/src/
    stores/useBookStore.ts    追加 absorbAgentWrite()：智能体写盘后回吸收草稿
    stores/useAgentStore.ts   新增：事件归约 + 线程隔离 + 状态行 + 提案态
    utils/escape-policy.ts    新增：Esc 裁决表（纯函数，可单测）
    utils/timeline.ts         新增：事件流 → 四层时间块（纯函数，可单测）
    components/AgentTimeline.vue   新增：四层流式内容渲染
    components/ProposalCard.vue    新增：diff + 审批按钮 + 说明输入框 + 状态徽章
    components/ComposerBox.vue     新增：输入区（Enter/Shift+Enter + 打断按钮）
    components/ProviderSettings.vue 新增：baseURL/model/密钥对话框
    components/CenterColumn.vue    改为装配上述四者 + 状态行
    styles/agent-pane.css     新增：毛玻璃事件卡/工具卡/审批卡样式
    styles.css                追加 @import
  tools/mock-provider.mjs     新增：本地 OpenAI 兼容 SSE 桩（冒烟与端到端用）
  tools/mock-provider.test.mjs 新增：桩自身的帧拆分/密钥不落日志断言
```

每个 `packages/agent-runtime/src/*` 都保持在 100–250 行；`agent-service.ts` 若逼近 500 行就把
提案登记拆成 `proposal-registry.ts`（预算门禁会告诉我们）。

---

## Task 1：contracts —— Agent 事件、提案 v2、provider 视图

**Files:**
- Create: `packages/contracts/src/tools.ts`、`agent-event.ts`、`provider.ts`
- Modify: `packages/contracts/src/patch.ts`（整体重写）、`packages/contracts/src/ipc.ts`（只加通道常量）、`packages/contracts/src/index.ts`
- Test: `packages/contracts/test/agent.test.ts`

**Interfaces:**
- Consumes: `PERMISSION_MODES`/`PermissionMode`（`permission.ts`）、`BookKind`（`book.ts`）
- Produces:
  - `AGENT_TOOL_NAMES: readonly ["read_doc","list_docs","search_docs","propose_patch","write_doc"]`、`AgentToolName`、`WRITE_TOOLS`
  - `EditProposal` + `editProposalSchema`；`PatchMode`/`PATCH_MODES`、`ProposalStatus`/`PROPOSAL_STATUSES`/`PROPOSAL_STATUS_LABELS`、`ProposalDecision`/`PROPOSAL_DECISIONS`
  - `AgentEvent` + `agentEventSchema`、`SessionMeta` + `sessionMetaSchema`、`AgentOutbound`、`TurnEndStatus`
  - `StartTurnInput`、`DecideInput` + `decideInputSchema`、`DecisionResult`
  - `ProviderConfig`/`providerConfigSchema`、`ProviderDraft`/`providerDraftSchema`、`ProviderView`、`maskApiKey(key: string): string`
  - `IPC_CHANNELS` 追加：`agentStartTurn`/`agentInterrupt`/`agentDecide`/`agentEvent`/`agentDiff`/`providerGet`/`providerSave`

- [x] **Step 1：先写会红的测试**

`packages/contracts/test/agent.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  AGENT_TOOL_NAMES,
  agentEventSchema,
  decideInputSchema,
  editProposalSchema,
  maskApiKey,
  providerDraftSchema,
  sessionMetaSchema
} from "../src/index.js";

const proposal = {
  id: "p1",
  threadKey: "chapters/01-开局.md",
  turnId: "t1",
  docRelPath: "chapters/01-开局.md",
  mode: "anchor-replace",
  anchor: "雾从海面涌上来。",
  replace: "雾从海面涌上来，把闸门的铁锈都舔黑了。",
  why: "补一句环境，承接上一章的闸门意象",
  tool: "propose_patch",
  source: "tool-call",
  expectedFingerprint: "a".repeat(64),
  createdAt: "2026-10-01T08:00:00.000Z"
};

describe("editProposalSchema", () => {
  it("接受带线程/工具/指纹的提案", () => {
    expect(editProposalSchema.parse(proposal)).toEqual(proposal);
  });

  it("缺 expectedFingerprint 时拒绝——没有指纹就没有冲突检测", () => {
    const rest: Record<string, unknown> = { ...proposal };
    delete rest.expectedFingerprint;
    expect(editProposalSchema.safeParse(rest).success).toBe(false);
  });

  it("工具名不在五个之内时拒绝", () => {
    expect(editProposalSchema.safeParse({ ...proposal, tool: "delete_book" }).success).toBe(false);
  });
});

describe("agentEventSchema", () => {
  it("十类事件各自能解析，未知 type 拒绝", () => {
    const base = { id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1" };
    const cases: Record<string, unknown>[] = [
      { ...base, type: "user-message", text: "把这段改紧一点" },
      { ...base, type: "reasoning", text: "先看闸门那段", interrupted: false },
      { ...base, type: "plan", items: [{ text: "读当前章", done: true }] },
      { ...base, type: "message", text: "已生成一条提案", interrupted: false },
      { ...base, type: "tool-call", callId: "c1", tool: "read_doc", args: "{}", ok: true, resultText: "正文…" },
      { ...base, type: "proposal", proposal },
      { ...base, type: "decision", proposalId: "p1", decision: "accept-once", guidance: "", auto: false },
      { ...base, type: "written", proposalId: "p1", docRelPath: proposal.docRelPath, fingerprint: "b".repeat(64), backupRelPath: null },
      { ...base, type: "interrupted", pendingProposals: 2 },
      { ...base, type: "error", message: "无法连接模型服务端" }
    ];
    for (const item of cases) {
      expect(agentEventSchema.safeParse(item).success).toBe(true);
    }
    expect(agentEventSchema.safeParse({ ...base, type: "ghost" }).success).toBe(false);
  });

  it("written 事件必须带 fingerprint（渲染层要据此更新已存指纹）", () => {
    const base = { id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1" };
    expect(
      agentEventSchema.safeParse({ ...base, type: "written", proposalId: "p1", docRelPath: "x" }).success
    ).toBe(false);
  });
});

describe("sessionMetaSchema", () => {
  it("首行元数据带线程绑定的文稿与模型", () => {
    const meta = {
      type: "session-meta",
      sessionId: "s1",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      model: "qwen3:14b",
      startedAt: "2026-10-01T08:00:00.000Z"
    };
    expect(sessionMetaSchema.parse(meta)).toEqual(meta);
  });
});

describe("decideInputSchema", () => {
  it("拒绝并说明时必须给出说明（对应 Codex 的 differently）", () => {
    expect(
      decideInputSchema.safeParse({ proposalId: "p1", decision: "deny-with-guidance", guidance: "  " }).success
    ).toBe(false);
    expect(
      decideInputSchema.safeParse({ proposalId: "p1", decision: "deny-with-guidance", guidance: "别动第一段" }).success
    ).toBe(true);
  });
});

describe("provider 与掩码", () => {
  it("baseURL 必须是 http(s) 绝对地址，密钥不进 URL", () => {
    expect(providerDraftSchema.safeParse({ baseURL: "127.0.0.1:8787/v1", model: "m", apiKey: null }).success).toBe(false);
    expect(
      providerDraftSchema.safeParse({ baseURL: "http://127.0.0.1:8787/v1", model: "m", apiKey: "sk-abcdef" }).success
    ).toBe(true);
  });

  it("掩码只露末 4 位且长度不足时全遮", () => {
    expect(maskApiKey("sk-abcdefg")).toBe("••••defg");
    expect(maskApiKey("ab")).toBe("••••");
  });

  it("五个工具名固定，多一个少一个都算违约", () => {
    expect([...AGENT_TOOL_NAMES].sort()).toEqual(["list_docs", "propose_patch", "read_doc", "search_docs", "write_doc"]);
  });
});
```

- [x] **Step 2：跑到红**

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: FAIL —— `agentEventSchema` 等具名导出不存在（`SyntaxError ... does not provide an export named`）。

- [x] **Step 3：`packages/contracts/src/tools.ts`**

```ts
export const AGENT_TOOL_NAMES = ["read_doc", "list_docs", "search_docs", "propose_patch", "write_doc"] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** 只有这两个工具会产生待写入动作；其余三个是只读参考。 */
export const WRITE_TOOLS = ["propose_patch", "write_doc"] as const;
export type WriteToolName = (typeof WRITE_TOOLS)[number];

export function isWriteTool(name: AgentToolName): name is WriteToolName {
  return (WRITE_TOOLS as readonly AgentToolName[]).includes(name);
}
```

- [x] **Step 4：`patch.ts` 整体改写**

```ts
import { z } from "zod";
import { AGENT_TOOL_NAMES } from "./tools.js";

export const PROPOSAL_DECISIONS = [
  "accept-once",
  "accept-session",
  "accept-prefix",
  "deny-with-guidance",
  "cancel"
] as const;
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];

export const PATCH_MODES = ["anchor-replace", "doc-overwrite"] as const;
export type PatchMode = (typeof PATCH_MODES)[number];

export const PROPOSAL_STATUSES = ["pending", "written", "rejected", "cancelled", "stale", "failed"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** 提案来自哪条路：原生 tool_calls 还是 mochen-patch 文本块（§6.1 双路）。 */
export const PROPOSAL_SOURCES = ["tool-call", "text-block"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

export const editProposalSchema = z.object({
  id: z.string().min(1),
  threadKey: z.string().min(1),
  turnId: z.string().min(1),
  docRelPath: z.string().min(1),
  mode: z.enum(PATCH_MODES),
  anchor: z.string(),
  replace: z.string(),
  why: z.string(),
  tool: z.enum(AGENT_TOOL_NAMES),
  source: z.enum(["tool-call", "text-block"]),
  expectedFingerprint: z.string().min(1),
  createdAt: z.string().min(1)
});
export type EditProposal = z.infer<typeof editProposalSchema>;

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "待审批",
  written: "已写入",
  rejected: "已拒绝",
  cancelled: "已取消",
  stale: "文件已变动",
  failed: "写入失败"
};
```

- [x] **Step 5：`agent-event.ts`**

```ts
import { z } from "zod";
import { editProposalSchema, PROPOSAL_DECISIONS } from "./patch.js";
import { AGENT_TOOL_NAMES } from "./tools.js";

const id = z.string().min(1);
const ts = z.string().min(1);
const turn = { id, ts, turnId: id };

export const AGENT_EVENT_TYPES = [
  "user-message",
  "reasoning",
  "plan",
  "message",
  "tool-call",
  "proposal",
  "decision",
  "written",
  "interrupted",
  "error"
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const sessionMetaSchema = z.object({
  type: z.literal("session-meta"),
  sessionId: id,
  docRelPath: z.string().min(1),
  stageId: z.string().min(1),
  model: z.string().min(1),
  startedAt: ts
});
export type SessionMeta = z.infer<typeof sessionMetaSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...turn, type: z.literal("user-message"), text: z.string() }),
  z.object({ ...turn, type: z.literal("reasoning"), text: z.string(), interrupted: z.boolean() }),
  z.object({
    ...turn,
    type: z.literal("plan"),
    items: z.array(z.object({ text: z.string().min(1), done: z.boolean() })).min(1)
  }),
  z.object({ ...turn, type: z.literal("message"), text: z.string(), interrupted: z.boolean() }),
  z.object({
    ...turn,
    type: z.literal("tool-call"),
    callId: id,
    tool: z.enum(AGENT_TOOL_NAMES),
    args: z.string(),
    ok: z.boolean(),
    resultText: z.string()
  }),
  z.object({ ...turn, type: z.literal("proposal"), proposal: editProposalSchema }),
  z.object({
    ...turn,
    type: z.literal("decision"),
    proposalId: id,
    decision: z.enum(PROPOSAL_DECISIONS),
    guidance: z.string(),
    auto: z.boolean()
  }),
  z.object({
    ...turn,
    type: z.literal("written"),
    proposalId: id,
    docRelPath: z.string().min(1),
    fingerprint: z.string().min(1),
    backupRelPath: z.string().nullable()
  }),
  z.object({ ...turn, type: z.literal("interrupted"), pendingProposals: z.number().int().min(0) }),
  z.object({ ...turn, type: z.literal("error"), message: z.string().min(1) })
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const AGENT_DELTA_KINDS = ["reasoning", "message"] as const;
export type AgentDeltaKind = (typeof AGENT_DELTA_KINDS)[number];
export type TurnEndStatus = "done" | "interrupted" | "failed";

/** 主进程 → 渲染层的唯一外发载荷；delta 不落盘，event 已落盘。 */
export type AgentOutbound =
  | { type: "turn-start"; turnId: string; threadKey: string }
  | { type: "delta"; turnId: string; threadKey: string; deltaKind: AgentDeltaKind; text: string }
  | { type: "event"; turnId: string; threadKey: string; event: AgentEvent }
  | { type: "turn-end"; turnId: string; threadKey: string; status: TurnEndStatus; message: string };

export interface StartTurnInput {
  threadKey: string;
  /** null = 还没打开文稿标签，此时只能问不能改。 */
  docRelPath: string | null;
  stageId: string;
  userText: string;
}

export const decideInputSchema = z
  .object({
    proposalId: id,
    decision: z.enum(PROPOSAL_DECISIONS),
    guidance: z.string()
  })
  .superRefine((value, ctx) => {
    if (value.decision === "deny-with-guidance" && value.guidance.trim() === "")
      ctx.addIssue({ code: "custom", message: "拒绝并说明时必须写清该怎么改", path: ["guidance"] });
  });
export type DecideInput = z.infer<typeof decideInputSchema>;

export type DecisionResult =
  | { ok: true; docRelPath: string; fingerprint: string; backupRelPath: string | null; auto: boolean }
  | {
      ok: false;
      reason: "permission-denied" | "stale" | "not-pending" | "cancelled" | "denied" | "io";
      message: string;
    };
```

- [x] **Step 6：`provider.ts`**

```ts
import { z } from "zod";

const httpUrl = /^https?:\/\//;

export const providerConfigSchema = z.object({
  baseURL: z.string().min(1).regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  model: z.string().min(1)
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** apiKey 为 null 表示「保留现有密钥」；渲染层提交的明文密钥只进主进程，绝不回传。 */
export const providerDraftSchema = z.object({
  baseURL: z.string().min(1).regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  model: z.string().min(1),
  apiKey: z.string().min(1).nullable()
});
export type ProviderDraft = z.infer<typeof providerDraftSchema>;

export interface ProviderView {
  hasKey: boolean;
  baseURL: string;
  model: string;
  keyMask: string;
}

export function maskApiKey(key: string): string {
  return `••••${key.slice(-4)}`.padEnd(8, "•").slice(0, Math.max(8, key.length > 4 ? 8 : 4));
}
```

> `maskApiKey` 的实现要老实写成「短密钥全遮、长密钥只露末 4 位」，上面那行 padEnd 太绕且难读；
> 落地时用这个版本：
>
> ```ts
> export function maskApiKey(key: string): string {
>   const tail = key.length > 4 ? key.slice(-4) : "";
>   return tail === "" ? "••••" : `••••${tail}`;
> }
> ```

- [x] **Step 7：`ipc.ts` 追加通道 + `index.ts` 追加 re-export**

`IPC_CHANNELS` 里加（既有的 5 个键一个不动，只在末尾追加，`as const` 保持）：

```ts
  agentStartTurn: "agent:start-turn",
  agentInterrupt: "agent:interrupt",
  agentDecide: "agent:decide",
  agentEvent: "agent:event",
  agentDiff: "agent:diff",
  providerGet: "provider:get",
  providerSave: "provider:save"
```

> `agentDiff` 是「中栏要展示提案 diff，但渲染层不能直接 import `@mochen/agent-runtime`」的解法：
> 该包只导出 `.` barrel（`main: ./src/index.ts`），barrel 里 `rollout.ts` 依赖 `node:fs`，
> 而 `electron.vite.config.ts` 把 workspace 包一起打进浏览器包——深路径 import 既过不了
> `exports` 映射也会被边界门禁拦。diff 文本由主进程算好（Task 11 的 `diffOf`）经 IPC 取。

`src/index.ts` 追加：

```ts
export * from "./tools.js";
export * from "./agent-event.js";
export * from "./provider.js";
```

- [x] **Step 8：跑到绿并过 prettier/tsc**

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: PASS（11 个用例）。
Run: `corepack pnpm prettier --write packages/contracts && corepack pnpm tsc --noEmit -p packages/contracts/tsconfig.json`
Expected: 无诊断。

- [x] **Step 9：变异实验**

把 `agent-event.ts` 里 `decision` 分支的 `auto: z.boolean()` 删掉再跑测试 ——
必须转红（`proposal`/`decision` 用例之一）。恢复后 `git diff --exit-code packages/contracts/src` 必须空。
理由：`auto` 是「自动批准规则生效」的唯一凭据，丢了它 §6 的 `a`/`p` 两态在审计日志里就与手点无法区分。

- [x] **Step 10：提交**

```bash
git add packages/contracts
git commit -m "feat(contracts): Agent 事件流、提案 v2 与 provider 视图契约"
```

---

## Task 2：新建 `packages/agent-runtime` + SSE 帧解析

**Files:**
- Create: `packages/agent-runtime/package.json`、`tsconfig.json`、`src/index.ts`、`src/sse.ts`、`test/sse.test.ts`
- Modify: 根 `package.json`（`typecheck` 与 `verify` 追加第 5 个 tsc 项目）、
  `apps/desktop/package.json`（依赖 `@mochen/agent-runtime`）、`apps/desktop/electron.vite.config.ts`
  （把新包加入 `externalizeDeps.exclude`）

**Interfaces:**
- Consumes: `@mochen/contracts`（Task 1 的类型）
- Produces: `sseDataFrames(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<string>` —— 产出每个 SSE 消息的
  `data` 文本（多行 data 以 `\n` 拼接），遇 `[DONE]` 终止，注释行与非 `data:` 字段忽略。

- [x] **Step 1：包骨架**

`packages/agent-runtime/package.json`：

```json
{
  "name": "@mochen/agent-runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@mochen/contracts": "workspace:*" },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```

`packages/agent-runtime/tsconfig.json`：

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`src/index.ts`：

```ts
export * from "./sse.js";
```

根 `package.json` 的 `typecheck` 与 `verify` 两条脚本里，在 `packages/fs-store/tsconfig.json` 之后插入
`tsc --noEmit -p packages/agent-runtime/tsconfig.json &&`（保持其余顺序不动）。

同时把新包接进 desktop（否则 Task 9 之后主进程 `import "@mochen/agent-runtime"` 会解析不到，
而 `pnpm build` 又会把 TS 源码当外部依赖留给 Electron 去 require）：

```jsonc
// apps/desktop/package.json 的 dependencies 追加一行
"@mochen/agent-runtime": "workspace:*",
```

```ts
// apps/desktop/electron.vite.config.ts：workspace 包发布的是 TS 源码，必须打进产物
externalizeDeps: { exclude: ["@mochen/contracts", "@mochen/fs-store", "@mochen/agent-runtime"] }
```

主进程那一处 `exclude` 改完即可；`preload` 段不动（preload 只用 contracts）。

- [x] **Step 2：装依赖（离线可达）**

Run: `corepack pnpm install`
Expected: 只有 workspace 链接变更（`@mochen/agent-runtime -> @mochen/contracts`），不下载任何包。
若 pnpm 试图联网抓 registry，说明 catalog 版本没对上——停下来核对 `pnpm-workspace.yaml`，不要硬装。

- [x] **Step 3：写红的测试**

`packages/agent-runtime/test/sse.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { sseDataFrames } from "../src/sse.js";

async function* fromChunks(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

async function collect(bytes: AsyncIterable<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const frame of sseDataFrames(bytes)) out.push(frame);
  return out;
}

const enc = new TextEncoder();

describe("sseDataFrames", () => {
  it("一条消息被切成任意字节片段也要完整拼出", async () => {
    const bytes = fromChunks([enc.encode('data: {"a":'), enc.encode('1}\n\n')]);
    expect(await collect(bytes)).toEqual(['{"a":1}']);
  });

  it("一个 chunk 内含多条消息时按顺序产出", async () => {
    const one = enc.encode('data: {"i":1}\n\ndata: {"i":2}\n\n');
    expect(await collect(fromChunks([one]))).toEqual(['{"i":1}', '{"i":2}']);
  });

  it("CRLF 换行同样识别", async () => {
    expect(await collect(fromChunks([enc.encode('data: x\r\n\r\n')]))).toEqual(["x"]);
  });

  it("中文多字节字符跨 chunk 断开不能出乱码", async () => {
    const whole = enc.encode('data: 雾从海面涌上来\n\n');
    const cut = whole.indexOf(enc.encode("海")) + 1;
    expect(await collect(fromChunks([whole.slice(0, cut), whole.slice(cut)]))).toEqual([
      "雾从海面涌上来"
    ]);
  });

  it("多行 data 以换行拼接", async () => {
    expect(await collect(fromChunks([enc.encode("data: 一\ndata: 二\n\n")]))).toEqual(["一\n二"]);
  });

  it("注释与 event/id 字段被忽略，[DONE] 之后不再产出", async () => {
    const bytes = fromChunks([enc.encode(": ping\nevent: message\ndata: 一\n\ndata: [DONE]\n\ndata: 二\n\n")]);
    expect(await collect(bytes)).toEqual(["一"]);
  });

  it("流结束时未闭合的尾帧仍然产出", async () => {
    expect(await collect(fromChunks([enc.encode("data: 尾")]))).toEqual(["尾"]);
  });
});
```

Run: `corepack pnpm vitest run packages/agent-runtime --maxWorkers=4` → FAIL（`src/sse.ts` 空）。

- [x] **Step 4：`src/sse.ts`**

```ts
const BOUNDARIES = ["\r\n\r\n", "\n\n", "\r\r"] as const;

function findBoundary(buffer: string): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const sep of BOUNDARIES) {
    const at = buffer.indexOf(sep);
    if (at >= 0 && (best === null || at < best.index)) best = { index: at, length: sep.length };
  }
  return best;
}

/** 一个帧内只取 data: 字段；其余（event/id/retry/注释）按 SSE 语义忽略。 */
function frameData(frame: string): string | null {
  const parts: string[] = [];
  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line === "" || line.startsWith(":") || !line.startsWith("data:")) continue;
    parts.push(line.slice("data:".length).replace(/^ /, ""));
  }
  return parts.length === 0 ? null : parts.join("\n");
}

export async function* sseDataFrames(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  for await (const chunk of bytes) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const boundary = findBoundary(buffer);
      if (boundary === null) break;
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const data = frameData(frame);
      if (data === null) continue;
      if (data === "[DONE]") return;
      yield data;
    }
  }
  buffer += decoder.decode();
  const tail = frameData(buffer);
  if (tail !== null && tail !== "[DONE]") yield tail;
}
```

- [x] **Step 5：跑到绿 + 门禁确认新包被自动覆盖**

Run: `corepack pnpm vitest run packages/agent-runtime --maxWorkers=4` → PASS（7 用例）。
Run: `corepack pnpm lint:boundary && echo BOUNDARY_EXIT=0 && corepack pnpm lint:budget && echo BUDGET_EXIT=0`
Expected: 两个 EXIT 都出现（`tools/check-package-boundary.mjs` 遍历 `packages`，新包自动在射程内）。

- [x] **Step 6：变异实验**

把 `frameData` 里 `line.startsWith(":")` 这个条件删掉 → 「注释…被忽略」用例必须转红
（`: ping` 会被当成 data 产出）。恢复后 `git diff --exit-code packages/agent-runtime/src` 必须空。

- [x] **Step 7：提交**

```bash
git add packages/agent-runtime package.json pnpm-lock.yaml apps/desktop/package.json apps/desktop/electron.vite.config.ts
git commit -m "feat(runtime): 新增 agent-runtime 包与 SSE 帧解析"
```

---

## Task 3：provider-client —— 流式增量、工具调用合并与中文错误

**Files:**
- Create: `packages/agent-runtime/src/chat-message.ts`、`src/provider-client.ts`、`test/provider-client.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes: `sseDataFrames`（Task 2）、`AgentToolName`（Task 1）
- Produces:
  - `ChatMessage`、`AssistantToolCall`、`chatMessage(role, content)`、`toWireMessages(messages)`
  - `ProviderFetch`/`ProviderFetchInput`/`ProviderFetchResult`（注入接缝，测试用假的，主进程用真的）
  - `StreamEvent = { kind: "reasoning-delta" | "text-delta"; text } | { kind: "tool-call"; call: AssistantToolCall } | { kind: "finish"; reason }`
  - `streamChat(req: StreamRequest): AsyncGenerator<StreamEvent>`
  - `class ProviderError extends Error`

- [x] **Step 1：`src/chat-message.ts`**

```ts
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface AssistantToolCall {
  id: string;
  name: string;
  args: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** role === "tool" 时是这轮 tool_call 的 id；其余为空串。 */
  toolCallId: string;
  toolCalls: AssistantToolCall[];
}

export function chatMessage(role: ChatRole, content: string): ChatMessage {
  return { role, content, toolCallId: "", toolCalls: [] };
}

export function toolMessage(callId: string, content: string): ChatMessage {
  return { role: "tool", content, toolCallId: callId, toolCalls: [] };
}

export function assistantToolMessage(content: string, toolCalls: AssistantToolCall[]): ChatMessage {
  return { role: "assistant", content, toolCallId: "", toolCalls };
}

/** OpenAI 兼容 wire 形状；无 tool_calls 的 assistant 不带该字段，避免小模型解析失败。 */
export function toWireMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    if (message.role === "assistant" && message.toolCalls.length > 0)
      return {
        role: "assistant",
        content: message.content === "" ? null : message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args }
        }))
      };
    return { role: message.role, content: message.content };
  });
}
```

- [x] **Step 2：写红的测试**

`packages/agent-runtime/test/provider-client.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { streamChat, ProviderError, type ProviderFetchResult, type StreamEvent } from "../src/provider-client.js";
import { chatMessage } from "../src/chat-message.js";

const frames: Record<string, unknown>[] = [];

function sse(...payloads: Record<string, unknown>[]): Uint8Array[] {
  const enc = new TextEncoder();
  return payloads.map((payload) => enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function chunkStream(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

function makeFetch(chunks: Uint8Array[], status = 200, errorText = "") {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  return {
    seen,
    fetchImpl: async (input: { url: string; headers: Record<string, string>; body: string }): Promise<ProviderFetchResult> => {
      seen.push({ url: input.url, headers: input.headers, body: input.body });
      if (status >= 200 && status < 300) return { status, stream: chunkStream(chunks), errorText: "" };
      return { status, stream: null, errorText };
    }
  };
}

async function run(fetchImpl: Parameters<typeof streamChat>[0]["fetchImpl"], signal = new AbortController().signal) {
  const out: StreamEvent[] = [];
  for await (const event of streamChat({
    fetchImpl,
    baseURL: "http://127.0.0.1:8787/v1",
    apiKey: "sk-secret-token",
    model: "test-model",
    messages: [chatMessage("user", "改一下")],
    tools: [{ name: "read_doc", description: "读文稿", parameters: { type: "object", properties: {} } }],
    signal
  }))
    out.push(event);
  return out;
}

describe("streamChat", () => {
  it("思考与正文增量按序产出并带上 finish 原因", async () => {
    const { fetchImpl } = makeFetch(
      sse(
        { choices: [{ delta: { reasoning_content: "先看" } }] },
        { choices: [{ delta: { reasoning_content: "闸门" } }] },
        { choices: [{ delta: { content: "好" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { data: "[DONE]" }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "reasoning-delta", text: "先看" },
      { kind: "reasoning-delta", text: "闸门" },
      { kind: "text-delta", text: "好" },
      { kind: "finish", reason: "stop" }
    ]);
  });

  it("工具调用参数分片要按 index 合并成一次完整调用", async () => {
    const { fetchImpl } = makeFetch(
      sse(
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_doc", arguments: '{"doc"' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ': "chapters/01.md" }' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
      )
    );
    const events = await run(fetchImpl);
    expect(events).toEqual([
      { kind: "tool-call", call: { id: "c1", name: "read_doc", args: '{"doc": "chapters/01.md"}' } },
      { kind: "finish", reason: "tool_calls" }
    ]);
  });

  it("两个并行工具调用按 index 顺序产出，缺 id 时补可复现的 id", async () => {
    const { fetchImpl } = makeFetch(
      sse(
        { choices: [{ delta: { tool_calls: [{ index: 1, function: { name: "search_docs", arguments: "{}" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "list_docs", arguments: "{}" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
      )
    );
    const events = await run(fetchImpl);
    const calls = events.filter((e) => e.kind === "tool-call");
    expect(calls.map((c) => (c.kind === "tool-call" ? c.call.name : ""))).toEqual(["list_docs", "search_docs"]);
    expect(calls.map((c) => (c.kind === "tool-call" ? c.call.id : "").startsWith("call_")).toBe(true);
  });

  it("非 2xx 抛中文 ProviderError 且带状态码与响应片段", async () => {
    const { fetchImpl } = makeFetch([], 500, "upstream model busy");
    await expect(run(fetchImpl)).rejects.toThrow(/500/);
    await expect(run(fetchImpl)).rejects.toBeInstanceOf(ProviderError);
  });

  it("abort 时安静收尾为 aborted，不抛错也不产出半截工具调用", async () => {
    const controller = new AbortController();
    const { fetchImpl } = makeFetch(
      sse({ choices: [{ delta: { content: "半" } }] }, { choices: [{ delta: { content: "句" } }] })
    );
    const events: StreamEvent[] = [];
    for await (const event of streamChat({
      fetchImpl,
      baseURL: "http://127.0.0.1:8787/v1",
      apiKey: "k",
      model: "m",
      messages: [chatMessage("user", "x")],
      tools: [],
      signal: controller.signal
    })) {
      events.push(event);
      if (event.kind === "text-delta") controller.abort();
    }
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "aborted" });
    expect(events.some((e) => e.kind === "tool-call")).toBe(false);
  });

  it("密钥只进 header，绝不进 URL（spec §8）", async () => {
    const { fetchImpl, seen } = makeFetch(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
    await run(fetchImpl);
    expect(seen[0]?.url).toBe("http://127.0.0.1:8787/v1/chat/completions");
    expect(seen[0]?.url).not.toContain("sk-secret-token");
    expect(seen[0]?.headers.Authorization).toBe("Bearer sk-secret-token");
    const body = JSON.parse(seen[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(Object.keys(body)).toEqual(["model", "messages", "tools", "tool_choice", "stream"]);
  });

  it("流里出现非法 JSON 时抛可读错误而不是崩", async () => {
    const enc = new TextEncoder();
    const { fetchImpl } = makeFetch([enc.encode("data: {not json\n\n")]);
    await expect(run(fetchImpl)).rejects.toThrow(/不是合法 JSON/);
  });
});
```

- [x] **Step 3：`src/provider-client.ts`**

```ts
import { sseDataFrames } from "./sse.js";
import { toWireMessages, type AssistantToolCall, type ChatMessage } from "./chat-message.js";

export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderFetchInput {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface ProviderFetchResult {
  status: number;
  stream: AsyncIterable<Uint8Array> | null;
  errorText: string;
}

export type ProviderFetch = (input: ProviderFetchInput) => Promise<ProviderFetchResult>;

export type StreamEvent =
  | { kind: "reasoning-delta"; text: string }
  | { kind: "text-delta"; text: string }
  | { kind: "tool-call"; call: AssistantToolCall }
  | { kind: "finish"; reason: string };

export interface StreamRequest {
  fetchImpl: ProviderFetch;
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolSpec[];
  signal: AbortSignal;
}

export class ProviderError extends Error {}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`;
}

function completionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

function readDelta(raw: unknown): {
  reasoning: string;
  content: string;
  finishReason: string;
  toolCalls: Record<string, unknown>[];
} {
  const root = (raw ?? {}) as Record<string, unknown>;
  const choice = (Array.isArray(root.choices) ? (root.choices[0] as Record<string, unknown>) : undefined) ?? {};
  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  const thinking = [delta.reasoning_content, delta.reasoning].filter((v): v is string => typeof v === "string");
  return {
    reasoning: thinking.join(""),
    content: typeof delta.content === "string" ? delta.content : "",
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
    toolCalls: Array.isArray(delta.tool_calls) ? (delta.tool_calls as Record<string, unknown>[]) : []
  };
}

export async function* streamChat(req: StreamRequest): AsyncGenerator<StreamEvent> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream"
  };
  // 空 apiKey 时连 Authorization 都不发，方便本地 Ollama/LM Studio。
  if (req.apiKey !== "") headers.Authorization = `Bearer ${req.apiKey}`;
  const payload: Record<string, unknown> = { model: req.model, messages: toWireMessages(req.messages) };
  if (req.tools.length > 0) {
    payload.tools = req.tools.map((tool) => ({ type: "function", function: tool }));
    payload.tool_choice = "auto";
  }
  payload.stream = true;

  const result = await req.fetchImpl({
    url: completionsUrl(req.baseURL),
    headers,
    body: JSON.stringify(payload),
    signal: req.signal
  }).catch((error: unknown) => {
    if (req.signal.aborted) return null;
    throw new ProviderError(`无法连接模型服务端：${snippet(error instanceof Error ? error.message : String(error))}`, {
      cause: error
    });
  });
  if (result === null) {
    yield { kind: "finish", reason: "aborted" };
    return;
  }
  if (result.status < 200 || result.status >= 300)
    throw new ProviderError(`模型服务端返回 ${result.status}：${snippet(result.errorText) || "无响应体"}`);
  if (result.stream === null) throw new ProviderError("模型服务端没有返回可读取的流");

  const calls = new Map<number, PendingCall>();
  for await (const frame of sseDataFrames(result.stream)) {
    if (req.signal.aborted) {
      yield { kind: "finish", reason: "aborted" };
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(frame);
    } catch (error) {
      throw new ProviderError("流式响应不是合法 JSON：" + snippet(frame), { cause: error });
    }
    const delta = readDelta(raw);
    if (delta.reasoning !== "") yield { kind: "reasoning-delta", text: delta.reasoning };
    if (delta.content !== "") yield { kind: "text-delta", text: delta.content };
    for (const fragment of delta.toolCalls) {
      const index = typeof fragment.index === "number" ? fragment.index : 0;
      const fn = (fragment.function ?? {}) as Record<string, unknown>;
      const held = calls.get(index) ?? { id: "", name: "", args: "" };
      if (typeof fragment.id === "string" && fragment.id !== "") held.id = fragment.id;
      if (typeof fn.name === "string" && fn.name !== "") held.name = fn.name;
      if (typeof fn.arguments === "string") held.args += fn.arguments;
      calls.set(index, held);
    }
    if (delta.finishReason !== "") {
      for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
        if (call.name === "") continue;
        yield {
          kind: "tool-call",
          call: { id: call.id === "" ? `call_${index}_${calls.size}` : call.id, name: call.name, args: call.args }
        };
      }
      yield { kind: "finish", reason: delta.finishReason };
      return;
    }
  }
  // 端点没给 finish_reason 就断流了：把已收全的工具调用交出去，再标 incomplete。
  for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
    if (call.name === "") continue;
    yield { kind: "tool-call", call: { id: call.id === "" ? `call_${index}_${calls.size}` : call.id, name: call.name, args: call.args } };
  }
  yield { kind: "finish", reason: req.signal.aborted ? "aborted" : "incomplete" };
}
```

- [x] **Step 4：跑到绿**

Run: `corepack pnpm vitest run packages/agent-runtime/test/provider-client.test.ts --maxWorkers=4`
Expected: PASS（7 用例）。若 `Object.keys(body)` 顺序断言红，说明 payload 组装顺序变了——按实现顺序改正断言，
不要放松成 `toContain`（这条就是在钉「不把密钥塞进 body 之外的位置」）。

- [x] **Step 5：变异实验（两处）**

1. 删掉 `if (req.signal.aborted) { yield finish aborted; return; }` 的 abort 分支 → abort 用例必须红。
2. 把 `headers.Authorization = Bearer` 改成把密钥拼进 `completionsUrl` → 「密钥只进 header」用例必须红。
   恢复后 `git diff --exit-code packages/agent-runtime/src` 必须空。

- [x] **Step 6：`src/index.ts` 追加 re-export 并提交**

```ts
export * from "./chat-message.js";
export * from "./provider-client.js";
```

```bash
git add packages/agent-runtime
git commit -m "feat(runtime): OpenAI 兼容流式客户端与增量合并"
```

---

## Task 4：双路提案协议 —— `mochen-patch` / `mochen-plan` 文本块

**Files:**
- Create: `packages/agent-runtime/src/patch-protocol.ts`、`test/patch-protocol.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes: `PatchMode`（Task 1）
- Produces: `parseProtocolBlocks(text: string): ProtocolParseResult`，其中
  `ProtocolParseResult = { patches: RawPatchBlock[]; planItems: string[]; problems: ProtocolProblem[]; prose: string }`；
  `RawPatchBlock = { doc: string; mode: PatchMode; anchor: string; replace: string; why: string }`；
  `ProtocolProblem = { reason: "bad-json" | "missing-field" | "unclosed-fence"; detail: string }`。
  另出 `protocolBlockHint: string`（一段给模型的中文说明，Task 11 的临时提示词直接引用）。

- [x] **Step 1：写红的测试**

`packages/agent-runtime/test/patch-protocol.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseProtocolBlocks } from "../src/patch-protocol.js";

const good = ['```mochen-patch', '{"doc":"chapters/01.md","anchor":"雾","replace":"雾很冷","why":"补温度"}', "```"].join("\n");

describe("parseProtocolBlocks", () => {
  it("正常单块：产出补丁并把围栏从正文里剥掉", () => {
    const out = parseProtocolBlocks(`我给你一条建议：\n\n${good}\n\n要看 diff 吗？`);
    expect(out.patches).toEqual([
      { doc: "chapters/01.md", mode: "anchor-replace", anchor: "雾", replace: "雾很冷", why: "补温度" }
    ]);
    expect(out.problems).toEqual([]);
    expect(out.prose).toBe("我给你一条建议：\n\n要看 diff 吗？");
  });

  it("多块与计划块各自归位", () => {
    const text = [
      good,
      '```mochen-patch\n{"doc":"characters/李深.md","anchor":"他","replace":"李深","why":"指代明确"}\n```',
      '```mochen-plan\n{"items":["读当前章","起两条提案"]}\n```'
    ].join("\n\n");
    const out = parseProtocolBlocks(text);
    expect(out.patches.map((p) => p.doc)).toEqual(["chapters/01.md", "characters/李深.md"]);
    expect(out.planItems).toEqual(["读当前章", "起两条提案"]);
  });

  it("内部更短的围栏算内容，不提前闭合", () => {
    const nested = ['````mochen-patch', '{"doc":"a.md","anchor":"x","replace":"```","why":"代码块里的围栏"}', '```', '{"继续":"忽略"}', "````"].join("\n");
    const out = parseProtocolBlocks(nested);
    expect(out.patches.length).toBe(1);
    expect(out.patches[0]?.replace).toBe("```");
  });

  it("坏 JSON 只记问题，不产出提案", () => {
    const out = parseProtocolBlocks('```mochen-patch\n{"doc": 雾}\n```');
    expect(out.patches).toEqual([]);
    expect(out.problems[0]?.reason).toBe("bad-json");
  });

  it("缺 anchor 记 missing-field 并点名字段", () => {
    const out = parseProtocolBlocks('```mochen-patch\n{"doc":"a.md","replace":"x","why":"y"}\n```');
    expect(out.patches).toEqual([]);
    expect(out.problems).toEqual([{ reason: "missing-field", detail: "anchor" }]);
  });

  it("mode 为 doc-overwrite 时允许无锚点整篇替换", () => {
    const out = parseProtocolBlocks(
      '```mochen-patch\n{"doc":"outline/三幕.md","mode":"doc-overwrite","replace":"新大纲","why":"重建"}\n```'
    );
    expect(out.patches[0]?.mode).toBe("doc-overwrite");
    expect(out.patches[0]?.anchor).toBe("");
  });

  it("未闭合围栏（模型被打断）记 unclosed-fence 且不产出", () => {
    const out = parseProtocolBlocks(`前半句\n\n${good.slice(0, good.length - 4)}`);
    expect(out.patches).toEqual([]);
    expect(out.problems.some((p) => p.reason === "unclosed-fence")).toBe(true);
    expect(out.prose).toContain("前半句");
  });

  it("非协议围栏原样保留在正文里（模型贴的代码示例不能被吞）", () => {
    const out = parseProtocolBlocks('说明：\n```json\n{"keep":true}\n```\n完');
    expect(out.patches).toEqual([]);
    expect(out.prose).toContain("```json");
    expect(out.problems).toEqual([]);
  });

  it("items 不是字符串数组的计划块记问题", () => {
    const out = parseProtocolBlocks('```mochen-plan\n{"items":[{"text":"x"}]}\n```');
    expect(out.planItems).toEqual([]);
    expect(out.problems[0]?.reason).toBe("missing-field");
  });
});
```

Run: `corepack pnpm vitest run packages/agent-runtime/test/patch-protocol.test.ts --maxWorkers=4` → FAIL。

- [x] **Step 2：`src/patch-protocol.ts`**

```ts
import type { PatchMode } from "@mochen/contracts";

export interface RawPatchBlock {
  doc: string;
  mode: PatchMode;
  anchor: string;
  replace: string;
  why: string;
}

export interface ProtocolProblem {
  reason: "bad-json" | "missing-field" | "unclosed-fence";
  detail: string;
}

export interface ProtocolParseResult {
  patches: RawPatchBlock[];
  planItems: string[];
  problems: ProtocolProblem[];
  prose: string;
}

const FENCE = /^ {0,3}(`{3,})\s*([A-Za-z0-9_-]*)\s*$/;
const PATCH_KIND = "mochen-patch";
const PLAN_KIND = "mochen-plan";

export const protocolBlockHint =
  "需要改稿时，输出一个 ```mochen-patch 代码块，内含一个 JSON 对象：" +
  '{"doc":"相对路径","anchor":"被替换的原文片段","replace":"新文本","why":"中文理由"}。' +
  "整篇重写时改用 " +
  '{"doc":"相对路径","mode":"doc-overwrite","replace":"新文本","why":"中文理由"}。' +
  "anchor 必须在文中唯一出现；不确定时先用 read_doc 读全文。" +
  "要列步骤时用 ```mochen-plan 块，内含 " +
  '{"items":["第一步","第二步"]}。';

function required(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function toPatch(raw: unknown): RawPatchBlock | string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "bad-json";
  const object = raw as Record<string, unknown>;
  const mode = object.mode === "doc-overwrite" ? "doc-overwrite" : "anchor-replace";
  for (const key of mode === "doc-overwrite" ? (["doc", "replace", "why"] as const) : (["doc", "anchor", "replace", "why"] as const)) {
    if (required(object, key) === null) return key;
  }
  const anchor = object.anchor;
  return {
    doc: required(object, "doc") ?? "",
    mode,
    anchor: typeof anchor === "string" ? anchor : "",
    replace: required(object, "replace") ?? "",
    why: required(object, "why") ?? ""
  };
}

function toPlanItems(raw: unknown): string[] | string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "bad-json";
  const items = (raw as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0) return "items";
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || item.trim() === "") return "items";
    out.push(item.trim());
  }
  return out;
}

export function parseProtocolBlocks(text: string): ProtocolParseResult {
  const patches: RawPatchBlock[] = [];
  const planItems: string[] = [];
  const problems: ProtocolProblem[] = [];
  const prose: string[] = [];
  const lines = text.split("\n");

  let open: { marker: string; kind: string; body: string[] } | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (open !== null) {
      if (match !== null && match[1]?.length >= open.marker.length && (match[2] ?? "") === "") {
        const kind = open.kind;
        const body = open.body.join("\n");
        open = null;
        if (kind === PATCH_KIND) {
          let payload: unknown;
          try {
            payload = JSON.parse(body);
          } catch {
            problems.push({ reason: "bad-json", detail: body.slice(0, 80) });
            continue;
          }
          const patch = toPatch(payload);
          if (typeof patch === "string") problems.push({ reason: patch === "bad-json" ? "bad-json" : "missing-field", detail: patch });
          else patches.push(patch);
        } else {
          let payload: unknown;
          try {
            payload = JSON.parse(body);
          } catch {
            problems.push({ reason: "bad-json", detail: body.slice(0, 80) });
            continue;
          }
          const items = toPlanItems(payload);
          if (typeof items === "string") problems.push({ reason: "missing-field", detail: items });
          else planItems.push(...items);
        }
        continue;
      }
      open.body.push(line);
      continue;
    }
    if (match !== null && (match[2] === PATCH_KIND || match[2] === PLAN_KIND)) {
      open = { marker: match[1] ?? "```", kind: match[2], body: [] };
      continue;
    }
    prose.push(line);
  }
  if (open !== null) {
    problems.push({ reason: "unclosed-fence", detail: open.kind });
    prose.push(...open.body);
  }
  return { patches, planItems, problems, prose: prose.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
```

- [x] **Step 3：跑到绿**

Run: `corepack pnpm vitest run packages/agent-runtime/test/patch-protocol.test.ts --maxWorkers=4`
Expected: PASS（9 用例）。

- [x] **Step 4：变异实验**

把 `match[1]?.length >= open.marker.length` 改成 `match[1]?.length === open.marker.length` 之外的
「任何围栏都闭合」（即删掉长度比较，只判 `info === ""`）→ 「内部更短的围栏算内容」用例必须红。
恢复后 `git diff --exit-code` 空。

- [x] **Step 5：提交**

```bash
git add packages/agent-runtime
git commit -m "feat(runtime): mochen-patch/mochen-plan 双路文本块协议解析"
```

---

## Task 5：锚点应用与 unified diff

**Files:**
- Create: `packages/agent-runtime/src/apply-patch.ts`、`src/diff.ts`、`test/apply-patch.test.ts`、`test/diff.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes: `PatchMode`
- Produces:
  - `countOccurrences(haystack: string, needle: string): number`
  - `ApplyResult = { status: "unique" | "ambiguous" | "missing"; content: string; hits: number; message: string }`
  - `applyPatch(doc: string, mode: PatchMode, anchor: string, replace: string): ApplyResult`
  - `diffLines(before: string, after: string): DiffOp[]`、`unifiedDiff(before, after, relPath, context?: number): string`

- [x] **Step 1：写红的测试（两个文件）**

`packages/agent-runtime/test/apply-patch.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { applyPatch, countOccurrences } from "../src/apply-patch.js";

describe("countOccurrences", () => {
  it("不重叠计数", () => {
    expect(countOccurrences("aaa", "aa")).toBe(1);
    expect(countOccurrences("雾霜雾", "雾")).toBe(2);
  });
});

describe("applyPatch", () => {
  it("锚点唯一时替换并给出结果全文", () => {
    const out = applyPatch("前\n雾从海面涌上来。\n后", "anchor-replace", "雾从海面涌上来。", "雾从海面涌上来，铁锈味很冲。");
    expect(out.status).toBe("unique");
    expect(out.content).toBe("前\n雾从海面涌上来，铁锈味很冲。\n后");
  });

  it("锚点出现两次判为歧义，不产出新文本（spec §6.1）", () => {
    const out = applyPatch("雾\n雾\n", "anchor-replace", "雾", "海雾");
    expect(out.status).toBe("ambiguous");
    expect(out.hits).toBe(2);
    expect(out.message).toContain("锚点在文中出现 2 次");
    expect(out.content).toBe("");
  });

  it("锚点找不到时判 missing 并提示模型先读全文", () => {
    const out = applyPatch("正文", "anchor-replace", "闸门", "铁闸");
    expect(out.status).toBe("missing");
    expect(out.message).toContain("文中找不到锚点");
  });

  it("空锚点不合法：必须给出被替换的原文", () => {
    const out = applyPatch("正文", "anchor-replace", "", "新增");
    expect(out.status).toBe("missing");
    expect(out.message).toContain("锚点为空");
  });

  it("doc-overwrite 整篇替换且不要求锚点", () => {
    const out = applyPatch("旧大纲", "doc-overwrite", "", "新大纲三幕");
    expect(out.status).toBe("unique");
    expect(out.content).toBe("新大纲三幕");
  });

  it("doc-overwrite 给空内容时拒绝：不允许把文稿清空", () => {
    const out = applyPatch("旧大纲", "doc-overwrite", "", "   ");
    expect(out.status).toBe("missing");
    expect(out.message).toContain("不能把文稿清空");
  });
});
```

`packages/agent-runtime/test/diff.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { diffLines, unifiedDiff } from "../src/diff.js";

const src = ["第一段", "雾从海面涌上来。", "闸门在响。", "第三段", "第四段", "第五段"].join("\n");

describe("diffLines", () => {
  it("按整行比对，中文不拆字", () => {
    expect(diffLines("雾", "霜")).toEqual([
      { kind: "del", lines: ["雾"] },
      { kind: "add", lines: ["霜"] }
    ]);
  });

  it("无变化时只有一串 eq", () => {
    expect(diffLines(src, src).every((op) => op.kind === "eq")).toBe(true);
  });
});

describe("unifiedDiff", () => {
  it("单行改动给一个 hunk，行号与上下文都对", () => {
    const after = src.replace("闸门在响。", "闸门在响，像有人从里面敲。");
    const text = unifiedDiff(src, after, "chapters/01-开局.md");
    expect(text.split("\n")[0]).toBe("--- a/chapters/01-开局.md");
    expect(text.split("\n")[1]).toBe("+++ b/chapters/01-开局.md");
    expect(text).toContain("@@ -2,3 +2,3 @@");
    expect(text).toContain("+闸门在响，像有人从里面敲。");
    expect(text).toContain("-闸门在响。");
    // 上下文：改动行前后各 3 行，这里有第 2 行与第 4、5 行
    expect(text).toContain(" 雾从海面涌上来。");
    expect(text).toContain(" 第三段");
  });

  it("完全没改时返回空串", () => {
    expect(unifiedDiff(src, src, "a.md")).toBe("");
  });

  it("两处远距改动产生两个 hunk", () => {
    const after = src.replace("第一段", "第一段·改").replace("第五段", "第五段·改");
    expect((unifiedDiff(src, after, "a.md").match(/@@/g) ?? []).length).toBe(2);
  });

  it("纯新增在末尾时只有 + 行", () => {
    const text = unifiedDiff("一\n二", "一\n二\n三", "a.md");
    expect(text).toContain("+三");
    expect(text).not.toContain("-");
  });

  it("整篇重写退化为单 hunk 而不是逐字比对", () => {
    const before = Array.from({ length: 500 }, (_, i) => `旧${i}`).join("\n");
    const after = Array.from({ length: 500 }, (_, i) => `新${i}`).join("\n");
    const text = unifiedDiff(before, after, "outline/三幕.md");
    expect((text.match(/@@/g) ?? []).length).toBe(1);
  });
});
```

Run: `corepack pnpm vitest run packages/agent-runtime/test/apply-patch.test.ts packages/agent-runtime/test/diff.test.ts --maxWorkers=4` → FAIL。

- [x] **Step 2：`src/apply-patch.ts`**

```ts
import type { PatchMode } from "@mochen/contracts";

export interface ApplyResult {
  status: "unique" | "ambiguous" | "missing";
  content: string;
  hits: number;
  message: string;
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

export function applyPatch(doc: string, mode: PatchMode, anchor: string, replace: string): ApplyResult {
  if (mode === "doc-overwrite") {
    if (replace.trim() === "")
      return { status: "missing", content: "", hits: 0, message: "不能把文稿清空：新内容为空" };
    return { status: "unique", content: replace, hits: 1, message: "整篇替换" };
  }
  if (anchor === "")
    return {
      status: "missing",
      content: "",
      hits: 0,
      message: "锚点为空：anchor 必须是文中真实存在的原文片段"
    };
  const hits = countOccurrences(doc, anchor);
  if (hits === 0)
    return {
      status: "missing",
      content: "",
      hits: 0,
      message: `文中找不到锚点「${anchor.slice(0, 40)}」。请用 read_doc 读全文后，取一段逐字存在的原文重试。`
    };
  if (hits > 1)
    return {
      status: "ambiguous",
      content: "",
      hits,
      message: `锚点在文中出现 ${hits} 次，无法唯一定位。请带上更多上下文（整句或前后句）重试。`
    };
  return { status: "unique", content: doc.replace(anchor, replace), hits: 1, message: "锚点唯一命中" };
}
```

> `doc.replace(anchor, replace)` 只换第一处，且上面已保证 `hits === 1`；
> 注意 `replace` 里的 `$` 序列会被 `String.prototype.replace` 解释——必须用
> `doc.slice(0, at) + replace + doc.slice(at + anchor.length)` 的形式。落地写法：
>
> ```ts
> const at = doc.indexOf(anchor);
> return { status: "unique", content: `${doc.slice(0, at)}${replace}${doc.slice(at + anchor.length)}`, hits: 1, message: "锚点唯一命中" };
> ```

- [x] **Step 3：`src/diff.ts`**

```ts
export interface DiffOp {
  kind: "eq" | "add" | "del";
  lines: string[];
}

const LCS_CELL_CAP = 1_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  if (a.length * b.length > LCS_CELL_CAP) return [{ kind: "del", lines: a }, { kind: "add", lines: b }];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  const push = (kind: DiffOp["kind"], line: string) => {
    const last = ops[ops.length - 1];
    if (last !== undefined && last.kind === kind) last.lines.push(line);
    else ops.push({ kind, lines: [line] });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("eq", a[i]!);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      push("del", a[i]!);
      i += 1;
    } else {
      push("add", b[j]!);
      j += 1;
    }
  }
  while (i < a.length) {
    push("del", a[i]!);
    i += 1;
  }
  while (j < b.length) {
    push("add", b[j]!);
    j += 1;
  }
  return ops;
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head: DiffOp[] = start > 0 ? [{ kind: "eq", lines: a.slice(0, start) }] : [];
  const tail: DiffOp[] = endA < a.length ? [{ kind: "eq", lines: a.slice(endA) }] : [];
  return [...head, ...lcsOps(a.slice(start, endA), b.slice(start, endB)), ...tail];
}

interface Tagged {
  tag: " " | "+" | "-";
  text: string;
  oldNo: number;
  newNo: number;
}

export function unifiedDiff(before: string, after: string, relPath: string, context = 3): string {
  const ops = diffLines(before, after);
  if (ops.every((op) => op.kind === "eq")) return "";
  let oldNo = 1;
  let newNo = 1;
  const tagged: Tagged[] = [];
  for (const op of ops) {
    for (const line of op.lines) {
      if (op.kind === "eq") tagged.push({ tag: " ", text: line, oldNo: oldNo++, newNo: newNo++ });
      else if (op.kind === "del") tagged.push({ tag: "-", text: line, oldNo: oldNo++, newNo: 0 });
      else tagged.push({ tag: "+", text: line, oldNo: 0, newNo: newNo++ });
    }
  }
  const changed = tagged.map((line) => line.tag !== " ").filter(Boolean);
  const keep = tagged.map(() => false);
  for (let index = 0; index < tagged.length; index += 1) {
    if (!changed[index]) continue;
    for (let offset = -context; offset <= context; offset += 1) {
      const at = (index ?? 0) + offset;
      if (at >= 0 && at < tagged.length) keep[at] = true;
    }
  }
  const hunks: string[] = [];
  let index = 0;
  while (index < tagged.length) {
    if (!keep[index]) {
      index += 1;
      continue;
    }
    let hunkEnd = index;
    while (hunkEnd < tagged.length && keep[hunkEnd]) hunkEnd += 1;
    // 把同一段里被上下文串起来的行合并成一个 hunk
    const body = tagged.slice(index, hunkEnd);
    const oldStart = body.find((line) => line.oldNo > 0)?.oldNo ?? 1;
    const newStart = body.find((line) => line.newNo > 0)?.newNo ?? 1;
    const oldCount = body.filter((line) => line.oldNo > 0).length;
    const newCount = body.filter((line) => line.newNo > 0).length;
    hunks.push(
      [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body.map((line) => `${line.tag}${line.text}`)].join("\n")
    );
    index = hunkEnd;
  }
  return [`--- a/${relPath}`, `+++ b/${relPath}`, ...hunks].join("\n");
}
```

> 上面的 `keep` 掩码 + `hunkEnd` 写法是「连续 true 段」切法，会把相隔 ≤ 2×context 的两处改动
> 合成一个 hunk——正是期望行为；但 `while (hunkEnd < length && keep[hunkEnd])` 在
> 两段改动之间的 `eq` 行若被上下文覆盖仍属同一段，所以「两处远距改动」用例要求间距 > 2×context
> （测试里的第 1 行与第 6 行满足）。若绿不了，先打印 `tagged`/`keep` 再改，不要改断言凑绿。

- [x] **Step 4：跑到绿**

Run: `corepack pnpm vitest run packages/agent-runtime/test/apply-patch.test.ts packages/agent-runtime/test/diff.test.ts --maxWorkers=4`
Expected: PASS（6 + 7 用例）。

- [x] **Step 5：变异实验**

把 `applyPatch` 里 `if (hits > 1)` 分支删掉 → 歧义锚点必须变红（且它正是 §6.1 与风险表第 3 行的命门）。
恢复后 `git diff --exit-code` 空。

- [x] **Step 6：`src/index.ts` 全量导出 + 提交**

每个任务新增模块时都要在同一个任务里给 `src/index.ts` 追加一行——漏导出会让 Task 10/11 的
import 报「没有该导出」。到这里 `src/index.ts` 的完整内容是：

```ts
export * from "./sse.js";
export * from "./chat-message.js";
export * from "./provider-client.js";
export * from "./apply-patch.js";
export * from "./diff.js";
export * from "./patch-protocol.js";
```

```bash
git add packages/agent-runtime
git commit -m "feat(runtime): 锚点三态应用与 unified diff"
```

---

## Task 6：会话 JSONL 落盘与历史重建

**Files:**
- Create: `packages/agent-runtime/src/rollout.ts`、`test/rollout.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes: `AgentEvent`/`SessionMeta`/`agentEventSchema`/`sessionMetaSchema`（Task 1）、`ChatMessage`（Task 3）
- Produces:
  - `SESSIONS_DIR = ".mochen/sessions"`、`sessionRelPath(now: Date, sessionId: string): string`
  - `createSession(root, meta): Promise<string>`（写首行，返回相对路径）
  - `appendAgentEvent(root, relPath, event): Promise<void>`
  - `readSession(root, relPath): Promise<{ meta: SessionMeta; events: AgentEvent[]; droppedLines: number[] }>`
  - `findLatestSession(root, docRelPath): Promise<string | null>`
  - `eventsToMessages(events): ChatMessage[]`

- [x] **Step 1：写红的测试**

`packages/agent-runtime/test/rollout.test.ts`：

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent, SessionMeta } from "@mochen/contracts";
import {
  SESSIONS_DIR,
  appendAgentEvent,
  createSession,
  eventsToMessages,
  findLatestSession,
  readSession,
  sessionRelPath
} from "../src/rollout.js";

let root = "";
const meta: SessionMeta = {
  type: "session-meta",
  sessionId: "s-1",
  docRelPath: "chapters/01-开局.md",
  stageId: "draft",
  model: "test-model",
  startedAt: "2026-10-01T08:00:00.000Z"
};

const turn = { id: "e1", ts: "2026-10-01T08:00:01.000Z", turnId: "t1" };

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-rollout-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("sessionRelPath", () => {
  it("按 Codex rollout 布局分年月日", () => {
    const rel = sessionRelPath(new Date("2026-10-01T08:00:00.000Z"), "s-1");
    expect(rel).toBe(`${SESSIONS_DIR}/2026/10/01/rollout-20261001-080000-s-1.jsonl`);
  });
});

describe("落盘与读回", () => {
  it("首行是 session-meta，其余每行一个事件", async () => {
    const rel = await createSession(root, meta);
    await appendAgentEvent(root, rel, { ...turn, type: "user-message", text: "改紧一点" });
    await appendAgentEvent(root, rel, { ...turn, id: "e2", type: "message", text: "好", interrupted: false });
    const back = await readSession(root, rel);
    expect(back.meta.docRelPath).toBe("chapters/01-开局.md");
    expect(back.events.map((e) => e.type)).toEqual(["user-message", "message"]);
    expect(back.droppedLines).toEqual([]);
    const raw = await readFile(path.join(root, ...rel.split("/")), "utf8");
    expect(raw.split("\n").filter((line) => line !== "").length).toBe(3);
  });

  it("中间坏行跳过并计数，首行坏则报中文错误", async () => {
    const rel = await createSession(root, { ...meta, sessionId: "s-2" });
    const file = path.join(root, ...rel.split("/"));
    const head = await readFile(file, "utf8");
    await writeFile(file, `${head}{"type":"user-message"\n` + '{"nope":1}\n', "utf8");
    const back = await readSession(root, rel);
    expect(back.events).toEqual([]);
    expect(back.droppedLines).toEqual([2, 3]);
    await writeFile(file, "这不是 JSON\n", "utf8");
    await expect(readSession(root, rel)).rejects.toThrow(/会话首行/);
  });

  it("同一章找回自己的线程，另一章另起（目标 6）", async () => {
    await createSession(root, { ...meta, sessionId: "s-3" });
    const other = await createSession(root, {
      ...meta,
      sessionId: "s-4",
      docRelPath: "chapters/02-潮汐.md",
      startedAt: "2026-10-01T09:00:00.000Z"
    });
    expect(await findLatestSession(root, "chapters/02-潮汐.md")).toBe(other);
    expect((await findLatestSession(root, "chapters/01-开局.md")) ?? "").toContain("s-3");
    expect(await findLatestSession(root, "chapters/不存在.md")).toBeNull();
  });
});

describe("eventsToMessages", () => {
  it("提案落盘与拒绝说明都以 user 角色回喂，plan/error/interrupted 不进历史", () => {
    const events: AgentEvent[] = [
      { ...turn, type: "user-message", text: "改一下" },
      { ...turn, id: "e2", type: "plan", items: [{ text: "读章", done: true }] },
      { ...turn, id: "e3", type: "reasoning", text: "先读", interrupted: false },
      { ...turn, id: "e4", type: "message", text: "建议如下", interrupted: false },
      { ...turn, id: "e5", type: "tool-call", callId: "c1", tool: "read_doc", args: "{}", ok: true, resultText: "正文" },
      { ...turn, id: "e6", type: "proposal", proposal: proposalFixture() },
      { ...turn, id: "e7", type: "decision", proposalId: "p1", decision: "deny-with-guidance", guidance: "别动第一段", auto: false },
      { ...turn, id: "e8", type: "decision", proposalId: "p2", decision: "accept-once", guidance: "", auto: false },
      { ...turn, id: "e9", type: "written", proposalId: "p2", docRelPath: "chapters/01-开局.md", fingerprint: "f", backupRelPath: ".mochen/changes/x/1.bak" },
      { ...turn, id: "e10", type: "error", message: "网络断了" },
      { ...turn, id: "e11", type: "interrupted", pendingProposals: 1 }
    ];
    const messages = eventsToMessages(events);
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "tool",
      "user",
      "user"
    ]);
    expect(messages[0]?.content).toBe("改一下");
    expect(messages[1]?.content).toBe("建议如下");
    expect(messages[2]?.toolCalls.map((c) => c.name)).toEqual(["read_doc"]);
    expect(messages[3]?.toolCallId).toBe("c1");
    expect(messages[4]?.content).toContain("别动第一段");
    expect(messages[5]?.content).toContain("原稿备份在");
  });

  it("reasoning 单独存在时作为 assistant 前置内容，不丢", () => {
    const messages = eventsToMessages([
      { ...turn, type: "reasoning", text: "想", interrupted: false },
      { ...turn, id: "e2", type: "message", text: "说", interrupted: false }
    ]);
    expect(messages.map((m) => m.role)).toEqual(["assistant", "assistant"]);
  });
});

function proposalFixture() {
  return {
    id: "p1",
    threadKey: "chapters/01-开局.md",
    turnId: "t1",
    docRelPath: "chapters/01-开局.md",
    mode: "anchor-replace" as const,
    anchor: "雾",
    replace: "海雾",
    why: "更具体",
    tool: "propose_patch" as const,
    source: "tool-call" as const,
    expectedFingerprint: "a",
    createdAt: "2026-10-01T08:00:00.000Z"
  };
}
```

- [x] **Step 2：`src/rollout.ts`**

```ts
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  agentEventSchema,
  sessionMetaSchema,
  type AgentEvent,
  type SessionMeta
} from "@mochen/contracts";
import type { ChatMessage } from "./chat-message.js";
import { assistantToolMessage, chatMessage, toolMessage } from "./chat-message.js";

export const SESSIONS_DIR = ".mochen/sessions";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function sessionRelPath(now: Date, sessionId: string): string {
  const y = String(now.getUTCFullYear());
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hmss = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${SESSIONS_DIR}/${y}/${m}/${d}/rollout-${y}${m}${d}-${hmss}-${sessionId}.jsonl`;
}

function abs(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

export async function createSession(root: string, meta: SessionMeta): Promise<string> {
  const rel = sessionRelPath(new Date(meta.startedAt), meta.sessionId);
  const target = abs(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(meta)}\n`, "utf8");
  return rel;
}

export async function appendAgentEvent(root: string, rel: string, event: AgentEvent): Promise<void> {
  const target = abs(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(event)}\n`, "utf8");
}

export interface ReadSessionResult {
  meta: SessionMeta;
  events: AgentEvent[];
  droppedLines: number[];
}

export async function readSession(root: string, rel: string): Promise<ReadSessionResult> {
  const raw = await readFile(abs(root, rel), "utf8");
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  const first = lines[0] ?? "";
  let meta: SessionMeta;
  try {
    meta = sessionMetaSchema.parse(JSON.parse(first));
  } catch (error) {
    throw new Error(`会话首行不可用（${rel}）：${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
  const events: AgentEvent[] = [];
  const droppedLines: number[] = [];
  for (const [offset, line] of lines.slice(1).entries()) {
    const parsed = agentEventSchema.safeParse(safeJson(line));
    if (parsed.success) events.push(parsed.data);
    else droppedLines.push(offset + 2);
  }
  return { meta, events, droppedLines };
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  if (!(await exists(dir))) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJsonl(full);
    else if (entry.name.endsWith(".jsonl")) yield full;
  }
}

async function exists(dir: string): Promise<boolean> {
  return (await readdir(dir).then(() => true, () => false)) === true;
}

/** 该章最近一条线程；「每章一条线程」的定位就靠这个函数。 */
export async function findLatestSession(root: string, docRelPath: string): Promise<string | null> {
  let best: { rel: string; startedAt: string } | null = null;
  for await (const file of walkJsonl(path.join(root, ...SESSIONS_DIR.split("/")))) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const head = (await readFile(file, "utf8").catch(() => "")).split("\n")[0] ?? "";
    const parsed = sessionMetaSchema.safeParse(safeJson(head));
    if (!parsed.success || parsed.data.docRelPath !== docRelPath) continue;
    if (best === null || parsed.data.startedAt > best.startedAt) best = { rel, startedAt: parsed.data.startedAt };
  }
  return best?.rel ?? null;
}

/**
 * 事件序列 → 下一轮请求的 messages。设计决定 3：审批结果与带说明的拒绝都以 user 角色回喂，
 * plan / error / interrupted 只供 UI，不进模型历史（它们不是对话内容）。
 */
export function eventsToMessages(events: AgentEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const event of events) {
    switch (event.type) {
      case "user-message":
        out.push(chatMessage("user", event.text));
        break;
      case "reasoning":
        if (event.text.trim() !== "") out.push(chatMessage("assistant", `（思考摘要）${event.text}`));
        break;
      case "message":
        if (event.text.trim() !== "") out.push(chatMessage("assistant", event.text));
        break;
      case "tool-call":
        out.push(assistantToolMessage("", [{ id: event.callId, name: event.tool, args: event.args }]));
        out.push(toolMessage(event.callId, event.resultText));
        break;
      case "decision":
        if (event.decision === "deny-with-guidance")
          out.push(chatMessage("user", `（用户对上一条提案的意见：${event.guidance}）`));
        break;
      case "written":
        out.push(
          chatMessage(
            "user",
            `（审批结果：已写入 ${event.docRelPath}，原稿备份在 ${event.backupRelPath ?? "（新文件，无备份）"}。）`
          )
        );
        break;
      default:
        break;
    }
  }
  return out;
}
```

> 注意 `readSession` 用 `agentEventSchema.safeParse(safeJson(line))`：`safeJson` 返回 `null` 时
> `safeParse(null)` 必然失败并计入 `droppedLines`，因此坏行既不会抛也不会静默消失——
> 这正是用例里 `[2, 3]` 的由来。

- [x] **Step 3：跑到绿**

Run: `corepack pnpm vitest run packages/agent-runtime/test/rollout.test.ts --maxWorkers=4`
Expected: PASS（6 用例）。

- [x] **Step 4：变异实验**

把 `findLatestSession` 的 `parsed.data.docRelPath !== docRelPath` 判断删掉 →
「同一章找回自己的线程」必须红（会返回任意最新文件）。恢复后 `git diff --exit-code` 空。

- [x] **Step 5：`src/index.ts` 追加 + 提交**

```ts
export * from "./rollout.js";
```

```bash
git add packages/agent-runtime
git commit -m "feat(runtime): 会话 JSONL 落盘与历史重建"
```

---

## Task 7：权限三档与 5 工具派发

**Files:**
- Create: `packages/agent-runtime/src/permission.ts`、`src/tools.ts`、`test/permission.test.ts`、`test/tools.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes: `PermissionMode`/`PERMISSION_LABELS`、`AGENT_TOOL_NAMES`/`AgentToolName`、`DocRef`
- Produces:
  - `WRITABLE_TOP_DIRS`、`checkWritePermission({ mode, docRelPath, currentChapter }): { allowed: boolean; reason: string }`
  - `TOOL_SPECS: ChatToolSpec[]`
  - `ToolContext = { docRelPath: string | null; permissionMode: PermissionMode }`
  - `ToolOutcome = { ok: boolean; text: string; proposals: EditProposal[] }`
  - `ToolHost = { context(): ToolContext; call(name: AgentToolName, args: Record<string, unknown>): Promise<ToolOutcome> }`
  - `dispatchToolCall(host, call: AssistantToolCall): Promise<ToolOutcome>`
  - `toolNameOf(name: string): AgentToolName | null`

- [x] **Step 1：写红的测试**

`packages/agent-runtime/test/permission.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { WRITABLE_TOP_DIRS, checkWritePermission } from "../src/permission.js";

describe("checkWritePermission", () => {
  it("五目录之外的路径在任何档位都拒绝（book.json 与 .mochen 是天花板）", () => {
    for (const mode of ["read-only", "chapter-write", "full-access"] as const) {
      expect(checkWritePermission({ mode, docRelPath: "book.json", currentChapter: "chapters/01.md" }).allowed).toBe(false);
      expect(checkWritePermission({ mode, docRelPath: ".mochen/sessions/a.jsonl", currentChapter: "chapters/01.md" }).allowed).toBe(false);
      expect(checkWritePermission({ mode, docRelPath: "notes/x.md", currentChapter: "chapters/01.md" }).allowed).toBe(false);
    }
    expect([...WRITABLE_TOP_DIRS]).toEqual(["chapters", "outline", "characters", "plot", "materials"]);
  });

  it("只读参考档一律拒绝，且说明里点名当前档位", () => {
    const out = checkWritePermission({ mode: "read-only", docRelPath: "chapters/01.md", currentChapter: "chapters/01.md" });
    expect(out.allowed).toBe(false);
    expect(out.reason).toContain("只读参考");
  });

  it("可改当前章只放行当前章", () => {
    expect(
      checkWritePermission({ mode: "chapter-write", docRelPath: "chapters/02.md", currentChapter: "chapters/01.md" }).allowed
    ).toBe(false);
    expect(
      checkWritePermission({ mode: "chapter-write", docRelPath: "chapters/01.md", currentChapter: "chapters/01.md" }).allowed
    ).toBe(true);
  });

  it("没选定当前章时 chapter-write 一律拒绝（无锚可写）", () => {
    const out = checkWritePermission({ mode: "chapter-write", docRelPath: "chapters/01.md", currentChapter: null });
    expect(out.allowed).toBe(false);
    expect(out.reason).toContain("尚未选定");
  });

  it("全开放行五个目录内的文稿", () => {
    expect(checkWritePermission({ mode: "full-access", docRelPath: "characters/李深.md", currentChapter: null }).allowed).toBe(true);
  });
});
```

`packages/agent-runtime/test/tools.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, type AgentToolName, type EditProposal } from "@mochen/contracts";
import { TOOL_SPECS, dispatchToolCall, toolNameOf, type ToolHost, type ToolOutcome } from "../src/tools.js";

function fakeHost(log: { name: string; args: Record<string, unknown> }[], outcome: ToolOutcome): ToolHost {
  return {
    context: () => ({ docRelPath: "chapters/01.md", permissionMode: "read-only" }),
    call: async (name, args) => {
      log.push({ name, args });
      return outcome;
    }
  };
}

describe("TOOL_SPECS", () => {
  it("恰好五个工具，与 AGENT_TOOL_NAMES 一一对应（§5.1 约束 2 的机器关卡）", () => {
    expect(TOOL_SPECS.map((spec) => spec.name).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    for (const spec of TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.parameters.type).toBe("object");
    }
  });

  it("未知工具名返回 null，已知返回自身", () => {
    expect(toolNameOf("read_doc")).toBe("read_doc");
    expect(toolNameOf("rm_rf")).toBeNull();
  });
});

describe("dispatchToolCall", () => {
  it("参数是合法 JSON 时把解析结果交给 host", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const outcome = { ok: true, text: "正文", proposals: [] as EditProposal[] };
    const out = await dispatchToolCall(fakeHost(log, outcome), { id: "c1", name: "read_doc", args: '{"doc":"chapters/01.md"}' });
    expect(log).toEqual([{ name: "read_doc", args: { doc: "chapters/01.md" } }]);
    expect(out).toBe(outcome);
  });

  it("参数不是合法 JSON 时把中文回执回喂模型，不抛错（§6 不静默丢弃）", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const out = await dispatchToolCall(fakeHost(log, { ok: true, text: "", proposals: [] }), {
      id: "c1",
      name: "read_doc",
      args: '{"doc": 缺引号}'
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("不是合法 JSON");
    expect(log).toEqual([]);
  });

  it("host 不认识的第六个工具名被拦在派发层", async () => {
    const out = await dispatchToolCall(
      { context: () => ({ docRelPath: null, permissionMode: "read-only" }), call: async () => ({ ok: true, text: "", proposals: [] }) },
      { id: "c1", name: "delete_book", args: "{}" }
    );
    expect(out.ok).toBe(false);
    expect(out.text).toContain("delete_book");
    expect(out.text).toContain("read_doc");
  });
});
```

- [x] **Step 2：`src/permission.ts`**

```ts
import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";

export const WRITABLE_TOP_DIRS = ["chapters", "outline", "characters", "plot", "materials"] as const;

export interface WritePermissionInput {
  mode: PermissionMode;
  docRelPath: string;
  currentChapter: string | null;
}

export interface WritePermissionResult {
  allowed: boolean;
  reason: string;
}

function insideWritableDir(relPath: string): boolean {
  const top = relPath.split("/")[0] ?? "";
  return (WRITABLE_TOP_DIRS as readonly string[]).includes(top);
}

export function checkWritePermission(input: WritePermissionInput): WritePermissionResult {
  if (!insideWritableDir(input.docRelPath))
    return {
      allowed: false,
      reason: `${input.docRelPath} 不在作品文稿目录内。只允许写入 ${WRITABLE_TOP_DIRS.join("/")}，` +
        "book.json 与 .mochen/ 由本机管理，智能体不能碰。"
    };
  if (input.mode === "read-only")
    return {
      allowed: false,
      reason: `当前权限档为「${PERMISSION_LABELS["read-only"]}」，提案不会写入磁盘。` +
        "可以先给出提案与理由，由用户在左栏切换权限档后再批准。"
    };
  if (input.mode === "chapter-write") {
    if (input.currentChapter === null)
      return { allowed: false, reason: `当前权限档为「${PERMISSION_LABELS["chapter-write"]}」，但尚未选定当前章，无处可写。` };
    if (input.docRelPath !== input.currentChapter)
      return {
        allowed: false,
        reason: `当前权限档为「${PERMISSION_LABELS["chapter-write"]}」，只能写入当前章 ${input.currentChapter}。`
      };
  }
  return { allowed: true, reason: `当前权限档「${PERMISSION_LABELS[input.mode]}」允许写入 ${input.docRelPath}。` };
}
```

- [x] **Step 3：`src/tools.ts`**

```ts
import type { AgentToolName, EditProposal, PermissionMode } from "@mochen/contracts";
import { AGENT_TOOL_NAMES } from "@mochen/contracts";
import type { AssistantToolCall, ChatToolSpec } from "./provider-client.js";

export interface ToolContext {
  docRelPath: string | null;
  permissionMode: PermissionMode;
}

export interface ToolOutcome {
  ok: boolean;
  text: string;
  proposals: EditProposal[];
}

export interface ToolHost {
  context(): ToolContext;
  call(name: AgentToolName, args: Record<string, unknown>): Promise<ToolOutcome>;
}

export function toolNameOf(name: string): AgentToolName | null {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name) ? (name as AgentToolName) : null;
}

const object = (properties: Record<string, unknown>, required: string[] = []): ChatToolSpec["parameters"] => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {})
});

export const TOOL_SPECS: ChatToolSpec[] = [
  {
    name: "read_doc",
    description: "读书稿全文（含 frontmatter）。改稿前先用它确认原文逐字。",
    parameters: object({ doc: { type: "string", description: "书内相对路径，如 chapters/03-章名.md" } }, ["doc"])
  },
  {
    name: "list_docs",
    description: "列书名稿清单，可按类型过滤（chapter/outline/character/plot/material）。",
    parameters: object({ kind: { type: "string", description: "可选：文稿类型" } })
  },
  {
    name: "search_docs",
    description: "全书子串检索，返回 路径:行号: 内容 前 20 条。",
    parameters: object({ query: { type: "string", description: "要检索的字面文本" } }, ["query"])
  },
  {
    name: "propose_patch",
    description: "提出一处替换：doc + anchor（文中唯一原文）+ replace + why（中文理由）。不写盘。",
    parameters: object(
      {
        doc: { type: "string" },
        anchor: { type: "string", description: "被替换的原文，必须逐字且唯一" },
        replace: { type: "string" },
        why: { type: "string", description: "中文修改理由，用户在卡片上看这条" }
      },
      ["doc", "anchor", "replace", "why"]
    )
  },
  {
    name: "write_doc",
    description: "整篇写入 doc（新建或重写）。同样需要用户逐条批准，且受权限档约束。",
    parameters: object({ doc: { type: "string" }, content: { type: "string" }, why: { type: "string" } }, ["doc", "content", "why"])
  }
];

export async function dispatchToolCall(host: ToolHost, call: AssistantToolCall): Promise<ToolOutcome> {
  const name = toolNameOf(call.name);
  if (name === null)
    return {
      ok: false,
      text: `没有这个工具：${call.name}。可用工具只有 ${AGENT_TOOL_NAMES.join("、")}。`,
      proposals: []
    };
  let args: unknown;
  try {
    args = JSON.parse(call.args === "" ? "{}" : call.args);
  } catch {
    return { ok: false, text: `工具 ${call.name} 的参数不是合法 JSON，请重新给出：${call.args.slice(0, 120)}`, proposals: [] };
  }
  if (args === null || typeof args !== "object" || Array.isArray(args))
    return { ok: false, text: `工具 ${call.name} 的参数必须是对象。`, proposals: [] };
  return host.call(name, args as Record<string, unknown>);
}
```

- [x] **Step 4：跑到绿 + 门禁**

Run: `corepack pnpm vitest run packages/agent-runtime --maxWorkers=4` → PASS（含前 5 个任务的所有用例）。
Run: `corepack pnpm lint:boundary && echo BOUNDARY_EXIT=0`（`agent-runtime` 全程无 electron import）。

- [x] **Step 5：变异实验**

给 `TOOL_SPECS` 追加一个 `delete_drafts` 工具 → 「恰好五个工具」用例必须红。删掉后恢复绿。
这条断言是 §5.1 约束 2（花名册不加工具）与 §6（工具集 5 个）的永久关卡，留着别删。

- [x] **Step 6：`src/index.ts` 追加 + 提交**

```ts
export * from "./permission.js";
export * from "./tools.js";
```

```bash
git add packages/agent-runtime
git commit -m "feat(runtime): 三档权限判定与五工具派发层"
```

---

## Task 8：工具循环 `runTurn` 与打断残留规则

**Files:**
- Create: `packages/agent-runtime/src/tool-loop.ts`、`test/tool-loop.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes: `streamChat`/`StreamEvent`/`ProviderError`/`ChatMessage`（Task 3）、`dispatchToolCall`/`ToolHost`/`TOOL_SPECS`（Task 7）、`AgentEvent`/`AgentDeltaKind`（Task 1）
- Produces:
  - `TurnInput = { turnId: string; threadKey: string; systemPrompt: string; history: ChatMessage[]; userText: string }`
  - `StreamRequestLike = { baseURL: string; apiKey: string; model: string; messages: ChatMessage[]; tools: ChatToolSpec[]; signal: AbortSignal }`
    （`streamChat` 的 `StreamRequest` 结构上满足它，循环只认这个子集）
  - `TurnDeps = { stream: (req: StreamRequestLike) => AsyncGenerator<StreamEvent>; host: ToolHost;
    emit(event: AgentEvent): void; emitDelta(kind: AgentDeltaKind, text: string): void; newId(): string;
    now(): string; signal: AbortSignal; maxToolRounds: number; provider: { baseURL: string; apiKey: string; model: string } }`
  - `TurnOutcome = { status: "done" | "interrupted" | "failed"; message: string }`
  - `runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutcome>`

- [x] **Step 1：写红的测试**

`packages/agent-runtime/test/tool-loop.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent, EditProposal } from "@mochen/contracts";
import { chatMessage, type ChatMessage, type StreamEvent } from "../src/chat-message.js";
import { ProviderError } from "../src/provider-client.js";
import { runTurn } from "../src/tool-loop.js";
import type { ToolHost, ToolOutcome } from "../src/tools.js";

function proposal(id: string): EditProposal {
  return {
    id,
    threadKey: "chapters/01.md",
    turnId: "t1",
    docRelPath: "chapters/01.md",
    mode: "anchor-replace",
    anchor: "雾",
    replace: "海雾",
    why: "更具体",
    tool: "propose_patch",
    source: "tool-call",
    expectedFingerprint: "fp",
    createdAt: "2026-10-01T08:00:00.000Z"
  };
}

interface Harness {
  events: AgentEvent[];
  deltas: { kind: string; text: string }[];
  hostCalls: { name: string; args: Record<string, unknown> }[];
  sentMessages: ChatMessage[][];
}

function makeDeps(script: StreamEvent[][], hostOutcome: ToolOutcome, abortAfter?: number) {
  const harness: Harness = { events: [], deltas: [], hostCalls: [], sentMessages: [] };
  const controller = new AbortController();
  let round = 0;
  const deps = {
    stream: async function* (req: { messages: ChatMessage[]; signal: AbortSignal }) {
      harness.sentMessages.push(req.messages);
      const events = script[round] ?? [{ kind: "finish", reason: "stop" } as StreamEvent];
      round += 1;
      for (const [index, event] of events.entries()) {
        if (abortAfter !== undefined && index === abortAfter) controller.abort();
        if (controller.signal.aborted && event.kind !== "finish") {
          yield event;
          yield { kind: "finish", reason: "aborted" } as StreamEvent;
          return;
        }
        yield event;
      }
    },
    host: {
      context: () => ({ docRelPath: "chapters/01.md", permissionMode: "read-only" }),
      call: async (name: string, args: Record<string, unknown>) => {
        harness.hostCalls.push({ name, args });
        return hostOutcome;
      }
    } as unknown as ToolHost,
    emit: (event: AgentEvent) => harness.events.push(event),
    emitDelta: (kind: string, text: string) => harness.deltas.push({ kind, text }),
    newId: (() => {
      let n = 0;
      return () => `id${(n += 1)}`;
    })(),
    now: () => "2026-10-01T08:00:00.000Z",
    signal: controller.signal,
    maxToolRounds: 4
  };
  return { deps, harness, controller };
}

const input = {
  turnId: "t1",
  threadKey: "chapters/01.md",
  systemPrompt: "你是墨宸·主笔。",
  history: [chatMessage("user", "上一轮的审批结果：已写入")],
  userText: "把开头改紧"
};

describe("runTurn", () => {
  it("纯文本回答：user-message → reasoning → message，delta 与定稿事件都在", async () => {
    const { deps, harness } = makeDeps([
      [
        { kind: "reasoning-delta", text: "先想" },
        { kind: "text-delta", text: "开头" },
        { kind: "text-delta", text: "收紧了" },
        { kind: "finish", reason: "stop" }
      ]
    ], { ok: true, text: "", proposals: [] });
    const out = await runTurn(deps, input);
    expect(out).toEqual({ status: "done", message: "" });
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "reasoning", "message"]);
    expect(harness.deltas).toEqual([
      { kind: "reasoning", text: "先想" },
      { kind: "message", text: "开头" },
      { kind: "message", text: "收紧了" }
    ]);
    const message = harness.events[2];
    expect(message?.type === "message" && message.text).toBe("开头收紧了");
    // 系统提示在第一行，历史与本轮输入跟在后面
    expect(harness.sentMessages[0]?.map((m) => m.role)).toEqual(["system", "user", "user"]);
  });

  it("工具轮：tool-call 事件后接 proposal 事件，第二轮把 tool 结果带上", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "text-delta", text: "给你一条提案" },
          { kind: "tool-call", call: { id: "c1", name: "propose_patch", args: '{"doc":"chapters/01.md","anchor":"雾","replace":"海雾","why":"更具体"}' } },
          { kind: "finish", reason: "tool_calls" }
        ],
        [{ kind: "text-delta", text: "等你审批" }, { kind: "finish", reason: "stop" }]
      ],
      { ok: true, text: "提案 p1 已生成，等待用户审批", proposals: [proposal("p1")] }
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("done");
    expect(harness.events.map((e) => e.type)).toEqual([
      "user-message",
      "message",
      "tool-call",
      "proposal",
      "message"
    ]);
    expect(harness.hostCalls[0]?.name).toBe("propose_patch");
    const toolCall = harness.events[2];
    expect(toolCall?.type === "tool-call" && toolCall.resultText).toContain("等待用户审批");
    expect(harness.sentMessages[1]?.map((m) => m.role)).toEqual(["system", "user", "user", "assistant", "tool"]);
  });

  it("计划块转成 plan 事件，围栏不进 message 正文", async () => {
    const { deps, harness } = makeDeps([
      [
        { kind: "text-delta", text: '先看计划：\n```mochen-plan\n{"items":["读章","起提案"]}\n```\n' },
        { kind: "finish", reason: "stop" }
      ]
    ], { ok: true, text: "", proposals: [] });
    await runTurn(deps, input);
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "plan", "message"]);
    expect(harness.events[1]?.type === "plan" && harness.events[1].items).toEqual([
      { text: "读章", done: false },
      { text: "起提案", done: false }
    ]);
    const message = harness.events[2];
    expect(message?.type === "message" && message.text).not.toContain("mochen-plan");
  });

  it("打断：已流出文本带 interrupted:true 入库，未收全的工具调用不产出，pending 提案数进 interrupted 事件（§6.3）", async () => {
    const { deps, harness } = makeDeps(
      [[{ kind: "reasoning-delta", text: "想了一半" }, { kind: "text-delta", text: "说了一半" }]],
      { ok: true, text: "", proposals: [] },
      1
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("interrupted");
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "reasoning", "message", "interrupted"]);
    expect(harness.events[1]?.type === "reasoning" && harness.events[1].interrupted).toBe(true);
    expect(harness.events[2]?.type === "message" && harness.events[2].interrupted).toBe(true);
    expect(harness.events[3]?.type === "interrupted" && harness.events[3].pendingProposals).toBe(0);
    expect(harness.hostCalls).toEqual([]);
  });

  it("provider 失败：error 事件 + failed 收尾，原因中文可见（§9）", async () => {
    const harness: Harness = { events: [], deltas: [], hostCalls: [], sentMessages: [] };
    const out = await runTurn(
      {
        stream: async function* () {
          throw new ProviderError("模型服务端返回 429：配额用尽");
          yield { kind: "finish", reason: "stop" } as StreamEvent;
        },
        host: { context: () => ({ docRelPath: null, permissionMode: "read-only" }), call: async () => ({ ok: true, text: "", proposals: [] }) } as unknown as ToolHost,
        emit: (event: AgentEvent) => harness.events.push(event),
        emitDelta: () => {},
        newId: () => "x",
        now: () => "2026-10-01T08:00:00.000Z",
        signal: new AbortController().signal,
        maxToolRounds: 4
      },
      input
    );
    expect(out.status).toBe("failed");
    expect(out.message).toContain("429");
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "error"]);
  });

  it("工具轮超过上限时停下并说明，不死循环", async () => {
    const alwaysTool = [
      [
        { kind: "tool-call", call: { id: "c", name: "list_docs", args: "{}" } },
        { kind: "finish", reason: "tool_calls" }
      ]
    ];
    const { deps, harness } = makeDeps(
      Array.from({ length: 6 }, () => alwaysTool[0]!),
      { ok: true, text: "清单", proposals: [] }
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("failed");
    expect(out.message).toContain("上限");
    expect(harness.hostCalls.length).toBe(4);
  });

  it("host 拒绝（ok:false）时照样回喂，循环不因拒绝而中断", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "tool-call", call: { id: "c1", name: "write_doc", args: '{"doc":"chapters/01.md","content":"x","why":"试"}' } },
          { kind: "finish", reason: "tool_calls" }
        ],
        [{ kind: "text-delta", text: "明白了，我只给提案" }, { kind: "finish", reason: "stop" }]
      ],
      { ok: false, text: "当前权限档为「只读参考」，提案不会写入磁盘。", proposals: [] }
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("done");
    const toolCall = harness.events[2];
    expect(toolCall?.type === "tool-call" && toolCall.ok).toBe(false);
    expect(toolCall?.type === "tool-call" && toolCall.resultText).toContain("只读参考");
  });
});
```

- [x] **Step 2：`src/tool-loop.ts`**

```ts
import type {
  AgentDeltaKind,
  AgentEvent,
  AgentToolName,
  EditProposal,
  ProposalDecision
} from "@mochen/contracts";
import { parseProtocolBlocks } from "./patch-protocol.js";
import { ProviderError } from "./provider-client.js";
import type { ChatToolSpec, StreamEvent } from "./provider-client.js";
import {
  assistantToolMessage,
  chatMessage,
  toolMessage,
  type ChatMessage,
  type AssistantToolCall
} from "./chat-message.js";
import { AGENT_TOOL_NAMES } from "@mochen/contracts";
import { dispatchToolCall, TOOL_SPECS, toolNameOf, type ToolHost } from "./tools.js";

export interface TurnInput {
  turnId: string;
  threadKey: string;
  systemPrompt: string;
  history: ChatMessage[];
  userText: string;
}

export interface StreamRequestLike {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolSpec[];
  signal: AbortSignal;
}

export interface TurnDeps {
  stream: (req: StreamRequestLike) => AsyncGenerator<StreamEvent>;
  host: ToolHost;
  emit(event: AgentEvent): void;
  emitDelta(kind: AgentDeltaKind, text: string): void;
  newId(): string;
  now(): string;
  signal: AbortSignal;
  maxToolRounds: number;
  /** provider 参数由调用方（主进程）填好，循环只负责对话结构。 */
  provider: { baseURL: string; apiKey: string; model: string };
}

export interface TurnOutcome {
  status: "done" | "interrupted" | "failed";
  message: string;
}

interface Collected {
  reasoning: string;
  text: string;
  calls: AssistantToolCall[];
  finishReason: string;
}

type EmitBody =
  | { type: "user-message"; text: string }
  | { type: "reasoning"; text: string; interrupted: boolean }
  | { type: "plan"; items: { text: string; done: boolean }[] }
  | { type: "message"; text: string; interrupted: boolean }
  | { type: "tool-call"; callId: string; tool: AgentToolName; args: string; ok: boolean; resultText: string }
  | { type: "proposal"; proposal: EditProposal }
  | { type: "decision"; proposalId: string; decision: ProposalDecision; guidance: string; auto: boolean }
  | { type: "written"; proposalId: string; docRelPath: string; fingerprint: string; backupRelPath: string | null }
  | { type: "interrupted"; pendingProposals: number }
  | { type: "error"; message: string };

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutcome> {
  const stamp = () => ({ id: deps.newId(), ts: deps.now(), turnId: input.turnId });
  // EmitBody 与 AgentEvent 去掉基字段后一一对应；这里用一次 as 收敛，真正的净网在
  // Task 6 的 readSession：形状不合法的行会被 agentEventSchema 判掉并计入 droppedLines。
  const emitSimple = (body: EmitBody): void => {
    deps.emit({ ...stamp(), ...body } as AgentEvent);
  };
  emitSimple({ type: "user-message", text: input.userText });

  const messages: ChatMessage[] = [chatMessage("system", input.systemPrompt), ...input.history, chatMessage("user", input.userText)];
  let pendingProposals = 0;

  for (let round = 0; round < deps.maxToolRounds; round += 1) {
    const collected: Collected = { reasoning: "", text: "", calls: [], finishReason: "" };
    try {
      for await (const event of deps.stream({
        baseURL: deps.provider.baseURL,
        apiKey: deps.provider.apiKey,
        model: deps.provider.model,
        messages,
        tools: TOOL_SPECS,
        signal: deps.signal
      })) {
        if (event.kind === "reasoning-delta") {
          collected.reasoning += event.text;
          deps.emitDelta("reasoning", event.text);
        } else if (event.kind === "text-delta") {
          collected.text += event.text;
          deps.emitDelta("message", event.text);
        } else if (event.kind === "tool-call") collected.calls.push(event.call);
        else collected.finishReason = event.reason;
      }
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : `本轮执行失败：${String(error)}`;
      emitSimple({ type: "error", message });
      return { status: "failed", message };
    }

    const aborted = deps.signal.aborted || collected.finishReason === "aborted";
    if (collected.reasoning !== "") emitSimple({ type: "reasoning", text: collected.reasoning, interrupted: aborted });
    if (aborted) {
      // §6.3：半截文本入库并标注；未收全的 tool_call 视为不存在；pending 提案保持不动。
      if (collected.text !== "") emitSimple({ type: "message", text: collected.text, interrupted: true });
      emitSimple({ type: "interrupted", pendingProposals });
      return { status: "interrupted", message: "已打断当前轮次，已流出的内容保留。" };
    }

    const parsed = parseProtocolBlocks(collected.text);
    if (parsed.planItems.length > 0)
      emitSimple({ type: "plan", items: parsed.planItems.map((text) => ({ text, done: false })) });
    for (const problem of parsed.problems)
      emitSimple({
        type: "error",
        message: `提案文本块有问题（${problem.reason}：${problem.detail}）；这条建议没有生成。`
      });
    if (collected.text !== "") emitSimple({ type: "message", text: parsed.prose, interrupted: false });

    // 双路汇聚（§6.1）：文本块这条路也走同一个 host 调用、产出同一个 EditProposal schema。
    // 没有走 dispatchToolCall 是因为这条路不是原生 tool_calls，但仍要落一张工具卡，
    // 好让"提案从哪来"在 UI 与审计日志里都看得见。
    for (const block of parsed.patches) {
      const outcome = await deps.host.call("propose_patch", {
        doc: block.doc,
        anchor: block.anchor,
        replace: block.replace,
        why: block.why,
        mode: block.mode,
        source: "text-block"
      });
      emitSimple({
        type: "tool-call",
        callId: `block-${deps.newId()}`,
        tool: "propose_patch",
        args: JSON.stringify(block),
        ok: outcome.ok,
        resultText: outcome.text
      });
      for (const proposal of outcome.proposals) {
        emitSimple({ type: "proposal", proposal });
        pendingProposals += 1;
      }
    }

    if (collected.calls.length === 0) return { status: "done", message: "" };

    messages.push(assistantToolMessage("", collected.calls));
    for (const call of collected.calls) {
      const name = toolNameOf(call.name);
      if (name === null) {
        emitSimple({
          type: "error",
          message: `模型请求了不存在的工具「${call.name}」，这条调用已被忽略。可用工具只有 ${AGENT_TOOL_NAMES.join("、")}。`
        });
        continue;
      }
      const outcome = await dispatchToolCall(deps.host, call);
      emitSimple({
        type: "tool-call",
        callId: call.id,
        tool: name,
        args: call.args,
        ok: outcome.ok,
        resultText: outcome.text
      });
      for (const proposal of outcome.proposals) {
        emitSimple({ type: "proposal", proposal });
        pendingProposals += 1;
      }
      messages.push(toolMessage(call.id, outcome.text));
    }
    if (round === deps.maxToolRounds - 1) {
      const message = `本轮工具调用达到上限（${deps.maxToolRounds} 轮），已停下等你介入。`;
      emitSimple({ type: "error", message });
      return { status: "failed", message };
    }
  }
  return { status: "done", message: "" };
}
```

- [x] **Step 3：跑到绿**

Run: `corepack pnpm vitest run packages/agent-runtime/test/tool-loop.test.ts --maxWorkers=4`
Expected: PASS（7 用例）。两条易踩的点：
1. `harness.sentMessages.push(req.messages)` 存的是引用，第二轮会污染第一轮——写成快照
   `req.messages.map((message) => ({ ...message }))`。
2. `makeDeps` 与失败用例的内联 deps 都要带 `provider: { baseURL: "http://x/v1", apiKey: "k", model: "m" }`，
   否则 `TurnDeps` 少属性直接编译红。

- [x] **Step 4：变异实验（两处，对应 spec §10 点名的两个抽除点）**

1. 删掉 abort 分支里 `emitSimple({ type: "interrupted", pendingProposals })` → 「打断」用例必须红。
2. 把 `if (collected.reasoning !== "") emitSimple({ type: "reasoning", ..., interrupted: aborted })` 的
   `interrupted: aborted` 改成 `interrupted: false` → 「打断」用例的 `interrupted === true` 断言必须红。
   恢复后 `git diff --exit-code packages/agent-runtime/src` 必须空。

- [x] **Step 5：`src/index.ts` 追加 + 全链门禁 + 提交**

```ts
export * from "./tool-loop.js";
```

Run: `corepack pnpm verify` → 回读 `VERIFY_EXIT=0`（此时还没有消费方，runtime 全靠自身测试撑绿）。

```bash
git add packages/agent-runtime
git commit -m "feat(runtime): 工具循环与打断残留规则"
```

---

## Task 9：主进程密钥与模型设置（safeStorage 注入）

**Files:**
- Create: `apps/desktop/src/main/credential-store.ts`、`src/main/provider-settings.ts`、
  `apps/desktop/src/main/credential-store.test.ts`、`apps/desktop/src/main/provider-settings.test.ts`
- Modify: 无（装配留给 Task 11）

**Interfaces:**
- Consumes: `ProviderConfig`/`ProviderDraft`/`ProviderView`/`providerDraftSchema`/`maskApiKey`（Task 1）
- Produces:
  - `Cipher = { available: boolean; encrypt(plain: string): string; decrypt(text: string): string }`
  - `createCredentialStore(dir: string, cipher: Cipher): CredentialStore`，
    `CredentialStore = { read(): Promise<string | null>; save(key: string): Promise<void>; clear(): Promise<void> }`
  - `createProviderSettings(deps: { dir: string; credentials: CredentialStore }): ProviderSettings`，
    `ProviderSettings = { view(): Promise<ProviderView>; config(): Promise<ProviderConfig | null>; apiKey(): Promise<string | null>; save(draft: ProviderDraft): Promise<ProviderView> }`
  - `electronCipher`（Task 11 里在 index.ts 现场包 `safeStorage`，本任务不提供，避免 import electron 进单测）

- [x] **Step 1：写红的测试**

`apps/desktop/src/main/credential-store.test.ts`：

```ts
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCredentialStore, type Cipher } from "./credential-store.js";

let dir = "";

const reversible: Cipher = {
  available: true,
  encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
  decrypt: (text) => {
    if (!text.startsWith("enc:")) throw new Error("不是本存储写出的格式");
    return Buffer.from(text.slice(4), "base64url").toString("utf8");
  }
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-secrets-"));
});
afterEach(async () => {
  for (const entry of await readdir(dir)) await rm(path.join(dir, entry), { recursive: true, force: true });
});

describe("credentialStore", () => {
  it("保存后读回同一串，落盘文件里没有明文", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save("sk-secret-token");
    expect(await store.read()).toBe("sk-secret-token");
    const files = await readdir(dir);
    expect(files).toEqual(["secrets.enc"]);
    const raw = await readFile(path.join(dir, "secrets.enc"), "utf8");
    expect(raw).not.toContain("sk-secret-token");
    expect(raw.startsWith("enc:")).toBe(true);
  });

  it("没有保存过密钥时 read 返回 null", async () => {
    expect(await createCredentialStore(dir, reversible).read()).toBeNull();
  });

  it("系统密钥保管不可用时拒绝落盘，且目录里不留下任何文件（spec §8）", async () => {
    const store = createCredentialStore(dir, { available: false, encrypt: (s) => s, decrypt: (s) => s });
    await expect(store.save("sk-secret-token")).rejects.toThrow(/不可用/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("文件被外部改动导致解密失败时抛中文错误，不返回半串", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save("sk-abcdef");
    await writeFile(path.join(dir, "secrets.enc"), "garbage", "utf8");
    await expect(store.read()).rejects.toThrow(/密钥读取失败/);
  });

  it("clear 后文件消失", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save("sk-abcdef");
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});
```

> 第一个用例的命门是那句 `expect(raw).not.toContain("sk-secret-token")`：
> **磁盘上不许出现明文**。测试里的 `Cipher` 是 base64url 的假加密，只用来验"落盘的不是原串"，
> 真加密由 Task 11 Step 4 的 `electronCipher(safeStorage)` 提供。

`apps/desktop/src/main/provider-settings.test.ts`：

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore, type CredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";

let dir = "";
let credentials: CredentialStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-provider-"));
  credentials = createCredentialStore(dir, {
    available: true,
    encrypt: (plain) => `enc:${plain}`,
    decrypt: (text) => (text.startsWith("enc:") ? text.slice(4) : (() => { throw new Error("坏"); })())
  });
});

describe("providerSettings", () => {
  it("未配置时 view 给出空串与 hasKey=false", async () => {
    const settings = createProviderSettings({ dir, credentials });
    expect(await settings.view()).toEqual({ hasKey: false, baseURL: "", model: "", keyMask: "" });
    expect(await settings.config()).toBeNull();
  });

  it("保存后 baseURL/model 进 config.json，密钥进 secrets.enc，视图只给掩码", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const view = await settings.save({ baseURL: "http://127.0.0.1:8787/v1", model: "test-model", apiKey: "sk-abcdefg" });
    expect(view).toEqual({ hasKey: true, baseURL: "http://127.0.0.1:8787/v1", model: "test-model", keyMask: "••••defg" });
    const config = await settings.config();
    expect(config).toEqual({ baseURL: "http://127.0.0.1:8787/v1", model: "test-model" });
  });

  it("apiKey 为 null 时保留旧密钥", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.save({ baseURL: "http://a/v1", model: "m", apiKey: "sk-old1234" });
    const view = await settings.save({ baseURL: "http://b/v1", model: "m2", apiKey: null });
    expect(view.hasKey).toBe(true);
    expect(await credentials.read()).toBe("sk-old1234");
    expect(view.baseURL).toBe("http://b/v1");
  });

  it("apiKey 只供主进程拼请求头，view 与 config 里都不出现它（spec §8）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.save({ baseURL: "http://a/v1", model: "m", apiKey: "sk-live-9" });
    expect(await settings.apiKey()).toBe("sk-live-9");
    expect(await settings.config()).toEqual({ baseURL: "http://a/v1", model: "m" });
    expect(Object.keys(await settings.view())).toEqual(["hasKey", "baseURL", "model", "keyMask"]);
  });

  it("baseURL 非法时拒绝且不落盘", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await expect(settings.save({ baseURL: "127.0.0.1:8787", model: "m", apiKey: null })).rejects.toThrow(/baseURL/);
    expect(await settings.config()).toBeNull();
  });

  it("config.json 被人写坏时 view 报中文错误而不是静默给空", async () => {
    await writeFile(path.join(dir, "config.json"), "{ oops", "utf8");
    const settings = createProviderSettings({ dir, credentials });
    await expect(settings.view()).rejects.toThrow(/模型配置文件/);
  });
});
```

- [x] **Step 2：`credential-store.ts`**

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Cipher {
  available: boolean;
  encrypt(plain: string): string;
  decrypt(text: string): string;
}

export interface CredentialStore {
  read(): Promise<string | null>;
  save(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** 密钥文件名与 spec §8 一致：目录内 secrets.enc，内容永远是密文。 */
export function createCredentialStore(dir: string, cipher: Cipher): CredentialStore {
  const target = path.join(dir, "secrets.enc");

  return {
    async read() {
      const raw = await readFile(target, "utf8").catch(() => null);
      if (raw === null || raw.trim() === "") return null;
      try {
        return cipher.decrypt(raw);
      } catch (error) {
        throw new Error(
          `密钥读取失败（${error instanceof Error ? error.message : String(error)}）；请在设置里重新填写 API Key。`,
          { cause: error }
        );
      }
    },

    async save(key: string) {
      if (!cipher.available)
        throw new Error("系统密钥保管不可用（safeStorage），密钥不会以明文落盘；请先在系统里启用凭据保护。");
      const text = cipher.encrypt(key);
      if (text.includes(key)) throw new Error("加密结果仍含明文，已拒绝落盘。");
      await mkdir(dir, { recursive: true });
      await writeFile(target, text, "utf8");
    },

    async clear() {
      await rm(target, { force: true });
    }
  };
}
```

- [x] **Step 3：`provider-settings.ts`**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  maskApiKey,
  providerConfigSchema,
  providerDraftSchema,
  type ProviderConfig,
  type ProviderDraft,
  type ProviderView
} from "@mochen/contracts";
import type { CredentialStore } from "./credential-store.js";

export interface ProviderSettings {
  view(): Promise<ProviderView>;
  config(): Promise<ProviderConfig | null>;
  apiKey(): Promise<string | null>;
  save(draft: ProviderDraft): Promise<ProviderView>;
}

export function createProviderSettings(deps: { dir: string; credentials: CredentialStore }): ProviderSettings {
  const configFile = path.join(deps.dir, "config.json");

  async function loadConfig(): Promise<ProviderConfig | null> {
    const raw = await readFile(configFile, "utf8").catch(() => null);
    // 没配置过就是 null：Task 10 取密钥、Task 11 拦「未配置模型」的 turn 都依赖这条不抛错。
    if (raw === null || raw.trim() === "") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`模型配置文件不可读：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const result = providerConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`模型配置文件缺少 baseURL 或 model：${result.error.issues[0]?.message ?? "字段不完整"}`);
    }
    return result.data;
  }

  return {
    async view() {
      const config = await loadConfig();
      const key = await deps.credentials.read();
      return {
        hasKey: key !== null,
        baseURL: config?.baseURL ?? "",
        model: config?.model ?? "",
        keyMask: key === null ? "" : maskApiKey(key)
      };
    },

    config: loadConfig,

    apiKey: () => deps.credentials.read(),

    async save(draft) {
      const value = providerDraftSchema.parse(draft);
      const config = { baseURL: value.baseURL, model: value.model };
      await mkdir(deps.dir, { recursive: true });
      await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      if (value.apiKey !== null) await deps.credentials.save(value.apiKey);
      const key = await deps.credentials.read();
      return {
        hasKey: key !== null,
        baseURL: config.baseURL,
        model: config.model,
        keyMask: key === null ? "" : maskApiKey(key)
      };
    }
  };
}
```

- [x] **Step 4：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/main --maxWorkers=4`
Expected: PASS（含 Plan 1 的 8 个既有用例 + 本任务 10 个）。

- [x] **Step 5：变异实验**

删掉 `save()` 里 `if (!cipher.available) throw` 那两行 → 「不可用时拒绝落盘，且目录里不留下任何文件」必须红
（`readdir` 会多出 `secrets.enc`）。这条断言是「密钥以明文躺在 %APPDATA%」和「不躺」之间唯一的墙，
不许用 try/catch 兜住降级成明文写入。恢复后 `git diff --exit-code apps/desktop/src/main` 空。

- [x] **Step 6：提交**

```bash
git add apps/desktop/src/main
git commit -m "feat(main): safeStorage 密钥存储与模型设置（视图只出掩码）"
```

---

## Task 10：fs 版 ToolHost —— 读、列、检索与提案生成（永不写盘）

**Files:**
- Create: `apps/desktop/src/main/doc-tools-host.ts`、`apps/desktop/src/main/doc-tools-host.test.ts`
- Modify: 无

**Interfaces:**
- Consumes: `ToolHost`/`ToolOutcome`/`ToolContext`（Task 7）、`applyPatch`（Task 5）、`checkWritePermission`（Task 7）、
  `readDocFile`/`makeFingerprint`（fs-store）、`DocRef`/`EditProposal`/`AgentToolName`（contracts）
- Produces:
  - `DocToolHostDeps = { root(): string | null; docs(): DocRef[]; context(): ToolContext; onProposal(proposal: EditProposal, baseline: string): void; newId(): string; now(): string }`
  - `createDocToolHost(deps: DocToolHostDeps): ToolHost`
  - `READ_TRUNCATE_AT = 6000`

- [x] **Step 1：写红的测试**

`apps/desktop/src/main/doc-tools-host.test.ts`：

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scanBook } from "@mochen/fs-store";
import type { DocRef, EditProposal, PermissionMode } from "@mochen/contracts";
import { createDocToolHost } from "./doc-tools-host.js";

let root = "";
let docs: DocRef[] = [];
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n雾又从海面涌上来。\n";
let collected: EditProposal[] = [];
let baselines: string[] = [];
let mode: PermissionMode = "read-only";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-host-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(path.join(root, "characters"), { recursive: true });
  await writeFile(path.join(root, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(path.join(root, "characters", "李深.md"), "身份：守闸人\n", "utf8");
  docs = await scanBook(root);
});
beforeEach(async () => {
  await writeFile(path.join(root, CHAPTER), CHAPTER_TEXT, "utf8");
  collected = [];
  baselines = [];
  mode = "read-only";
});

function host() {
  return createDocToolHost({
    root: () => root,
    docs: () => docs,
    context: () => ({ docRelPath: CHAPTER, permissionMode: mode }),
    onProposal: (proposal, baseline) => {
      collected.push(proposal);
      baselines.push(baseline);
    },
    newId: (() => {
      let n = 0;
      return () => `p${(n += 1)}`;
    })(),
    now: () => "2026-10-01T08:00:00.000Z"
  });
}

describe("read_doc / list_docs / search_docs", () => {
  it("read_doc 返回全文与字数", async () => {
    const out = await host().call("read_doc", { doc: CHAPTER });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("雾从海面涌上来。");
    expect(out.proposals).toEqual([]);
  });

  it("长文按 6000 字截断并说明被截断", async () => {
    await writeFile(path.join(root, CHAPTER), "雾".repeat(9000), "utf8");
    const out = await host().call("read_doc", { doc: CHAPTER });
    expect(out.text).toContain("已截断");
    expect(out.text.length).toBeLessThan(9000);
  });

  it("未知路径给出可读错误并提示可用清单", async () => {
    const out = await host().call("read_doc", { doc: "chapters/不存在.md" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("读不到");
  });

  it("list_docs 按类型过滤", async () => {
    const all = await host().call("list_docs", {});
    const characters = await host().call("list_docs", { kind: "character" });
    expect(all.text).toContain(CHAPTER);
    expect(characters.text).toContain("characters/李深.md");
    expect(characters.text).not.toContain(CHAPTER);
  });

  it("search_docs 给出行号", async () => {
    const out = await host().call("search_docs", { query: "守闸人" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("characters/李深.md:1:");
  });
});

describe("propose_patch", () => {
  it("锚点唯一时产出 pending 提案，文件字节一字不变（全案最硬的断言）", async () => {
    const before = await chapterFile();
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第三段",
      replace: "第三段，铁锈味很冲。",
      why: "补一句可感的细节"
    });
    expect(out.ok).toBe(true);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.mode).toBe("anchor-replace");
    expect(out.proposals[0]?.expectedFingerprint.length).toBe(64);
    expect(out.text).toContain("等待用户审批");
    expect(await chapterFile()).toBe(before);
    expect(collected).toEqual(out.proposals);
    // baseline 是提案生成那一刻读到的正文，Task 11 的 diffOf 用它算 diff
    expect(baselines).toEqual([before]);
  });

  it("锚点出现两次时不产出提案，并把「锚点不唯一」回喂（§6.1 + 风险表第 3 行）", async () => {
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "雾从海面涌上来。",
      replace: "海雾涌上来。",
      why: "收紧"
    });
    expect(out.ok).toBe(false);
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    expect(out.text).toContain("出现 2 次");
  });

  it("source 为 text-block 时提案记下来源", async () => {
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第一段",
      replace: "第一段·改",
      why: "文本块路来的",
      source: "text-block"
    });
    expect(out.proposals[0]?.source).toBe("text-block");
  });

  it("doc 不在五个文稿目录内时直接拒绝，连提案都不给", async () => {
    const out = await host().call("propose_patch", {
      doc: "book.json",
      anchor: "a",
      replace: "b",
      why: "试"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只允许写入");
    expect(collected).toEqual([]);
  });
});

describe("write_doc", () => {
  it("只读档下拒绝，并把中文理由作为工具回执回喂模型", async () => {
    const out = await host().call("write_doc", { doc: CHAPTER, content: "整篇重写", why: "试" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只读参考");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
  });

  it("全开档下也只产出 doc-overwrite 提案，仍然不写盘", async () => {
    mode = "full-access";
    const out = await host().call("write_doc", { doc: CHAPTER, content: "整篇重写", why: "重建" });
    expect(out.ok).toBe(true);
    expect(out.proposals[0]?.mode).toBe("doc-overwrite");
    expect(out.proposals[0]?.tool).toBe("write_doc");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
  });

  it("可改当前章档下，别章的 write_doc 被拒", async () => {
    mode = "chapter-write";
    const out = await host().call("write_doc", { doc: "characters/李深.md", content: "改", why: "试" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只能写入当前章");
  });
});

async function chapterFile(): Promise<string> {
  return readFile(path.join(root, ...CHAPTER.split("/")), "utf8");
}
```

> `chapterFile()` 放在测试末尾（vitest 的函数声明会提升，用例里先用它没问题）。
> 顶部 import 必须含 `readFile`：`import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";`

- [x] **Step 2：`doc-tools-host.ts`**

```ts
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  makeFingerprint,
  readDocFile
} from "@mochen/fs-store";
import type {
  AgentToolName,
  DocRef,
  EditProposal,
  PatchMode,
  ProposalSource
} from "@mochen/contracts";
import { applyPatch } from "@mochen/agent-runtime";
import { checkWritePermission, WRITABLE_TOP_DIRS } from "@mochen/agent-runtime";
import type { ToolContext, ToolHost, ToolOutcome } from "@mochen/agent-runtime";

export const READ_TRUNCATE_AT = 6000;

export interface DocToolHostDeps {
  root(): string | null;
  docs(): DocRef[];
  context(): ToolContext;
  onProposal(proposal: EditProposal, baseline: string): void;
  newId(): string;
  now(): string;
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function inWritableDir(relPath: string): boolean {
  return (WRITABLE_TOP_DIRS as readonly string[]).includes(relPath.split("/")[0] ?? "");
}

export function createDocToolHost(deps: DocToolHostDeps): ToolHost {
  async function text(relPath: string): Promise<string | null> {
    const root = deps.root();
    if (root === null) return null;
    return (await readDocFile(root, relPath).catch(() => null))?.content ?? null;
  }

  function proposal(input: {
    doc: string;
    mode: PatchMode;
    anchor: string;
    replace: string;
    why: string;
    tool: AgentToolName;
    fingerprint: string;
    source: ProposalSource;
  }): EditProposal {
    return {
      id: deps.newId(),
      threadKey: deps.context().docRelPath ?? "unbound",
      turnId: "",
      docRelPath: input.doc,
      mode: input.mode,
      anchor: input.anchor,
      replace: input.replace,
      why: input.why,
      tool: input.tool,
      source: input.source,
      expectedFingerprint: input.fingerprint,
      createdAt: deps.now()
    };
  }

  return {
    context: deps.context,

    async call(name: AgentToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
      const deny = (text: string): ToolOutcome => ({ ok: false, text, proposals: [] });

      if (name === "read_doc") {
        const doc = str(args, "doc");
        const body = await text(doc);
        if (body === null)
          return deny(`读不到 ${doc || "（空路径）"}。书名稿见 list_docs。`);
        const clipped = body.length > READ_TRUNCATE_AT;
        return {
          ok: true,
          text: `${clipped ? `${body.slice(0, READ_TRUNCATE_AT)}\n（已截断，全文 ${body.length} 字）` : body}`,
          proposals: []
        };
      }

      if (name === "list_docs") {
        const kind = str(args, "kind");
        const refs = deps.docs().filter((ref) => kind === "" || ref.kind === kind);
        if (refs.length === 0) return { ok: true, text: "（没有符合条件的文稿）", proposals: [] };
        return {
          ok: true,
          text: refs.map((ref) => `- ${ref.relPath} · ${ref.title}`).join("\n"),
          proposals: []
        };
      }

      if (name === "search_docs") {
        const query = str(args, "query");
        if (query === "") return deny("search_docs 需要非空的 query。");
        const root = deps.root();
        if (root === null) return deny("尚未打开作品目录。");
        const hits: string[] = [];
        let total = 0;
        for (const ref of deps.docs()) {
          const body = await readFile(path.join(root, ...ref.relPath.split("/")), "utf8").catch(() => null);
          if (body === null) continue;
          const lines = body.split("\n");
          for (const [index, line] of lines.entries()) {
            if (!line.includes(query)) continue;
            total += 1;
            if (hits.length < 20) hits.push(`${ref.relPath}:${index + 1}: ${line.trim()}`);
          }
        }
        if (total === 0) return { ok: true, text: `没有命中「${query}」。`, proposals: [] };
        return {
          ok: true,
          text: `命中 ${total} 处${hits.length < total ? `，只列前 ${hits.length} 条` : ""}：\n${hits.join("\n")}`,
          proposals: []
        };
      }

      if (name === "propose_patch" || name === "write_doc") {
        const doc = str(args, "doc");
        const why = str(args, "why");
        if (why === "") return deny("必须给出中文理由 why，用户要在审批卡片上看这条。");
        if (!inWritableDir(doc))
          return deny(`${doc} 不在作品文稿目录内。只允许写入 ${WRITABLE_TOP_DIRS.join("/")} 下的文件。`);

        const permission = checkWritePermission({
          mode: deps.context().permissionMode,
          docRelPath: doc,
          currentChapter: deps.context().docRelPath
        });
        if (!permission.allowed) return deny(permission.reason);

        const body = await text(doc);
        const fingerprint = makeFingerprint(body ?? "");
        const source: ProposalSource = str(args, "source") === "text-block" ? "text-block" : "tool-call";

        if (name === "write_doc") {
          const content = str(args, "content");
          const applied = applyPatch(body ?? "", "doc-overwrite", "", content);
          if (applied.status !== "unique") return deny(applied.message);
          const item = proposal({
            doc,
            mode: "doc-overwrite",
            anchor: "",
            replace: content,
            why,
            tool: "write_doc",
            fingerprint,
            source
          });
          deps.onProposal(item, body ?? "");
          return {
            ok: true,
            text: `提案 ${item.id}（整篇写入 ${doc}）已生成，等待用户逐条审批；未批准前文件未改动。`,
            proposals: [item]
          };
        }

        const mode: PatchMode = str(args, "mode") === "doc-overwrite" ? "doc-overwrite" : "anchor-replace";
        const anchor = str(args, "anchor");
        const replace = str(args, "replace");
        const applied = applyPatch(body ?? "", mode, anchor, replace);
        if (applied.status !== "unique")
          return deny(`${applied.message}（提案没有生成，文件未改动。）`);
        const item = proposal({
          doc,
          mode,
          anchor,
          replace,
          why,
          tool: "propose_patch",
          fingerprint,
          source
        });
        deps.onProposal(item, body ?? "");
        return {
          ok: true,
          text: `提案 ${item.id} 已生成，等待用户审批；未批准前文件未改动。`,
          proposals: [item]
        };
      }

      return deny(`没有这个工具：${name}。`);
    }
  };
}
```

> 两处必须留意的实现细节：
> 1. `proposal()` 里 `turnId: ""` 是占位——Task 11 在登记提案时用真实 turnId 覆写它
>    （`{ ...proposal, turnId }`），因为 host 不知道轮次号。Task 11 的用例会断言
>    `proposal.turnId === 当前轮`，别让空串漏出去。
> 2. `expectedFingerprint` 是**提案生成那一刻**读到的文件指纹；审批时（Task 11）拿它跟盘上
>    当前指纹比，不等就判 stale。这是「模型不能覆盖人刚写过的东西」的唯一凭据。

- [x] **Step 3：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/main/doc-tools-host.test.ts --maxWorkers=4`
Expected: PASS（12 用例）。

- [x] **Step 4：变异实验**

把 `propose_patch` 分支里 `applyPatch(...)` 之后那句 `deps.onProposal(item, body ?? "")` 前面
插入一行 `await writeFile(路径, applied.content)`（也就是"顺手写盘"）→
「文件字节一字不变」用例必须红。然后删掉这行恢复。
这条实验直接验铁律：**唯一能写盘的代码路径不在这个 host 里**。恢复后 `git diff --exit-code` 空。

- [x] **Step 5：提交**

```bash
git add apps/desktop/src/main
git commit -m "feat(main): fs 版工具 host（读/列/检索/提案，永不写盘）"
```

---

## Task 11：`agent-service` —— 审批登记、写盘备份与会话线程

**Files:**
- Create: `apps/desktop/src/main/agent-service.ts`、`src/main/agent-ipc.ts`、`src/main/electron-cipher.ts`、
  `src/main/provider-fetch.ts`，以及三对同名测试 `src/main/agent-service.test.ts`、
  `src/main/agent-ipc.test.ts`、`src/main/provider-fetch.test.ts`（与 Plan 1 一致：主进程测试与源文件同目录）
- Modify: `apps/desktop/src/main/book-service.ts`（加 `current()`，见 Step 2）、`src/main/index.ts`（装配；
  装配本身不做单测，Task 15 冒烟验）

**Interfaces:**
- Consumes: `runTurn`/`streamChat`/`ProviderFetch`/`createDocToolHost`/`createProviderSettings`/
  `createCredentialStore`/`createBookService`/`createSession`/`appendAgentEvent`/`readSession`/
  `findLatestSession`/`eventsToMessages`/`checkWritePermission`/`applyPatch`/`unifiedDiff`/
  `protocolBlockHint`/`decideInputSchema`（前序任务）
- Produces:
  - `AgentService = { startTurn(input: StartTurnInput): Promise<{ turnId: string }>; interrupt(turnId: string): Promise<boolean>; decide(input: DecideInput): Promise<DecisionResult>; diffOf(proposalId: string): string; dispose(): void }`
  - `createAgentService(deps: AgentServiceDeps): AgentService`
  - `AgentServiceDeps = { book: BookService; settings: ProviderSettings; fetchImpl: ProviderFetch; emit(outbound: AgentOutbound): void; newId(): string; isoNow(): string; promptFor(context: PromptContext): string }`
  - `PromptContext = { title: string; stageName: string; chapter: DocRef | null; permissionLabel: string }`
  - `defaultPromptFor(context: PromptContext): string`（临时装配，Plan 3 换 §5 上下文包时替换这一个函数）
  - `registerAgentIpc(handle, service)` 与 `registerProviderIpc(handle, settings)`（`agent-ipc.ts`）
  - `electronCipher(storage: SafeStorageLike): Cipher`、`toProviderFetch(send): ProviderFetch`
  - `BookService` 新增 `current(): BookSnapshot | null`，`BookSnapshot = { root: string; meta: BookMeta; docs: DocRef[] }`

- [x] **Step 1：写红的集成测试（spec §10 的全链断言就在这里）**

`apps/desktop/src/main/agent-service.test.ts`：

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  type AgentEvent,
  type AgentOutbound,
  type BookMeta,
  type DocRef,
  type StartTurnInput
} from "@mochen/contracts";
import {
  findLatestSession,
  readSession,
  type ProviderFetch,
  type ProviderFetchResult
} from "@mochen/agent-runtime";
import { makeFingerprint } from "@mochen/fs-store";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, defaultPromptFor, type AgentService } from "./agent-service.js";

const CHAPTER = "chapters/01-开局.md";
const OTHER = "chapters/02-闸口.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";

let root = "";
const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function turn(docRelPath: string | null, userText: string): StartTurnInput {
  return { threadKey: docRelPath ?? "unbound", docRelPath, stageId: "draft", userText };
}

async function chapterFile(rel = CHAPTER): Promise<string> {
  return readFile(path.join(root, ...rel.split("/")), "utf8");
}

/** 每一轮模型响应是一段独立的 SSE 脚本；轮次用完就重复最后一段。 */
function sseFetch(...rounds: Record<string, unknown>[][]): ProviderFetch {
  const enc = new TextEncoder();
  let call = 0;
  return async () => {
    const chunks = rounds[Math.min(call, rounds.length - 1)] ?? [];
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

function failFetch(status: number, errorText: string): ProviderFetch {
  return async () => ({ status, stream: null, errorText }) satisfies ProviderFetchResult;
}

function toolCallChunks(id: string, doc: string, anchor: string, replace: string, why: string) {
  return [
    { choices: [{ delta: { reasoning_content: "先收紧开头" } }] },
    { choices: [{ delta: { content: "给你一条提案：\n" } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id, function: { name: "propose_patch", arguments: JSON.stringify({ doc, anchor, replace, why }) } }
            ]
          }
        }
      ]
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
  ];
}

const proposeChunks = toolCallChunks("c1", CHAPTER, "雾从海面涌上来。", "海雾涌上来，铁锈味很冲。", "补可感细节");
const proposeAgain = toolCallChunks("c2", CHAPTER, "第三段", "第三段，闸门在响。", "接声音");

type DecisionEvent = Extract<AgentEvent, { type: "decision" }>;
type WrittenEvent = Extract<AgentEvent, { type: "written" }>;
type TurnEnd = Extract<AgentOutbound, { type: "turn-end" }>;

function events(): AgentEvent[] {
  return outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function proposalIds(): string[] {
  return events().flatMap((event) => (event.type === "proposal" ? [event.proposal.id] : []));
}

function decisions(): DecisionEvent[] {
  return events().flatMap((event) => (event.type === "decision" ? [event] : []));
}

function writtenEvents(): WrittenEvent[] {
  return events().flatMap((event) => (event.type === "written" ? [event] : []));
}

function lastTurnEnd(): TurnEnd | undefined {
  return outbound
    .slice()
    .reverse()
    .find((item): item is TurnEnd => item.type === "turn-end");
}

interface Built {
  service: AgentService;
  book: BookService;
}

async function build(fetchImpl: ProviderFetch, meta: Partial<BookMeta> = {}, withProvider = true): Promise<Built> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-agent-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-agent-secret-"));
  tempDirs.push(dir, secrets);
  root = dir;
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await writeFile(path.join(dir, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(path.join(dir, OTHER), "闸门在响。\n", "utf8");
  await writeFile(
    path.join(dir, "book.json"),
    JSON.stringify(
      {
        id: "b1",
        title: "深渊之下",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: []
      },
      null,
      2
    ),
    "utf8"
  );
  const book = createBookService();
  const opened = await book.open(dir);
  // 默认落到「全开」：只读档下 host 连提案都不会生成，验不到审批→写盘这条链
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access", ...meta });
  const credentials = createCredentialStore(secrets, {
    available: true,
    encrypt: (plain) => `enc:${plain}`,
    decrypt: (text) => text.slice(4)
  });
  if (withProvider) {
    await credentials.save("sk-test");
    const settings = createProviderSettings({ dir: secrets, credentials });
    await settings.save({ baseURL: "http://mock/v1", model: "test-model", apiKey: null });
  }
  outbound = [];
  let counter = 0;
  const service = createAgentService({
    book,
    settings: createProviderSettings({ dir: secrets, credentials }),
    fetchImpl,
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, book };
}

describe("agentService 全链", () => {
  it("reasoning→message→tool-call→proposal 顺序落事件，且未批准时文件字节一字不变", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    expect(events().map((event) => event.type)).toEqual([
      "user-message",
      "reasoning",
      "message",
      "tool-call",
      "proposal"
    ]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    expect(service.diffOf(proposalIds()[0] ?? "")).toContain("+海雾涌上来");
    expect(lastTurnEnd()?.status).toBe("done");
    service.dispose();
  });

  it("批准后写盘：原稿进 .mochen/changes 备份，新文本上盘，事件补 decision+written", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const result = await service.decide({
      proposalId: proposalIds()[0] ?? "",
      decision: "accept-once",
      guidance: ""
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("全开档下的合法提案不该失败");
    expect(result.docRelPath).toBe(CHAPTER);
    expect(await chapterFile()).toBe("第一段\n海雾涌上来，铁锈味很冲。\n第三段\n");
    expect(result.fingerprint).toBe(makeFingerprint(await chapterFile()));
    if (result.backupRelPath === null) throw new Error("改旧稿必须先备份");
    expect(await readFile(path.join(root, ...result.backupRelPath.split("/")), "utf8")).toBe(CHAPTER_TEXT);
    expect(events().slice(-2).map((event) => event.type)).toEqual(["decision", "written"]);
    expect(writtenEvents()[0]?.backupRelPath).toMatch(/^\.mochen\/changes\/.+01-开局\.md\.bak$/);
    service.dispose();
  });

  it("批准那一刻权限收紧 → permission-denied，提案留在 pending，档位放开后能重试", async () => {
    const { service, book } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const id = proposalIds()[0] ?? "";
    const before = book.current();
    if (before === null) throw new Error("current() 必须返回已打开的作品");
    await book.saveMeta({ ...before.meta, permissionMode: "read-only" });
    const denied = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("permission-denied");
    expect(
      events().some((event) => event.type === "error" && event.message.includes("只读参考"))
    ).toBe(true);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    const after = book.current();
    if (after === null) throw new Error("current() 必须返回已打开的作品");
    await book.saveMeta({ ...after.meta, permissionMode: "full-access" });
    const retried = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(retried.ok).toBe(true);
    expect(await chapterFile()).toContain("海雾涌上来");
    service.dispose();
  });

  it("提案生成后文件被外部改动 → 批准判 stale，绝不覆盖（反向用例）", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const id = proposalIds()[0] ?? "";
    await writeFile(path.join(root, ...CHAPTER.split("/")), "我自己在编辑器里写的\n", "utf8");
    const result = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
    expect(await chapterFile()).toBe("我自己在编辑器里写的\n");
    const again = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("not-pending");
    service.dispose();
  });

  it("「本会话不再问」之后同线程的新提案自动落盘并标 auto", async () => {
    const { service } = await build(sseFetch(proposeChunks, proposeAgain));
    await service.startTurn(turn(CHAPTER, "第一条"));
    const first = await service.decide({
      proposalId: proposalIds()[0] ?? "",
      decision: "accept-session",
      guidance: ""
    });
    expect(first.ok).toBe(true);
    expect(await chapterFile()).toContain("海雾涌上来");
    await service.startTurn(turn(CHAPTER, "第二条"));
    expect(proposalIds()).toHaveLength(2);
    expect(writtenEvents()).toHaveLength(2);
    expect(decisions()[0]?.auto).toBe(false);
    expect(decisions().at(-1)?.auto).toBe(true);
    expect(await chapterFile()).toContain("第三段，闸门在响。");
    service.dispose();
  });

  it("拒绝并说明：说明进事件、文件不动、这条提案不再可批", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const id = proposalIds()[0] ?? "";
    const result = await service.decide({
      proposalId: id,
      decision: "deny-with-guidance",
      guidance: "别动第二段，改第三段"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("denied");
    expect(decisions()[0]?.guidance).toBe("别动第二段，改第三段");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    const again = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("not-pending");
    service.dispose();
  });

  it("Esc 取消提案：落 decision(cancel)，文件不动，未知 turnId 的打断返回 false", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    const { turnId } = await service.startTurn(turn(CHAPTER, "改紧"));
    expect(await service.interrupt(turnId)).toBe(false);
    expect(await service.interrupt("ghost")).toBe(false);
    const id = proposalIds()[0] ?? "";
    const cancelled = await service.decide({ proposalId: id, decision: "cancel", guidance: "" });
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.reason).toBe("cancelled");
    expect(decisions()[0]?.decision).toBe("cancel");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("provider 失败时中文原因进对话流，turn 落 failed（§9）", async () => {
    const { service } = await build(failFetch(503, "上游配额用尽"));
    await service.startTurn(turn(CHAPTER, "改紧"));
    expect(lastTurnEnd()?.status).toBe("failed");
    expect(
      events().some((event) => event.type === "error" && event.message.includes("503"))
    ).toBe(true);
    service.dispose();
  });

  it("还没配置模型服务时拒绝开轮，原因显示而不是静默", async () => {
    const { service } = await build(sseFetch(proposeChunks), {}, false);
    await service.startTurn(turn(CHAPTER, "改紧"));
    expect(lastTurnEnd()?.status).toBe("failed");
    expect(
      events().some((event) => event.type === "error" && event.message.includes("模型"))
    ).toBe(true);
    expect(outbound.some((item) => item.type === "turn-start")).toBe(true);
    service.dispose();
  });

  it("会话按章分线程落盘，同线程读回上一轮，异章另开一线（目标 6）", async () => {
    const { service } = await build(sseFetch(proposeChunks, proposeAgain));
    await service.startTurn(turn(CHAPTER, "第一次"));
    await service.startTurn(turn(CHAPTER, "第二次"));
    await service.startTurn(turn(OTHER, "换一章"));
    const chapterRel = await findLatestSession(root, CHAPTER);
    const otherRel = await findLatestSession(root, OTHER);
    if (chapterRel === null || otherRel === null) throw new Error("两个线程都要落盘");
    expect(chapterRel).not.toBe(otherRel);
    expect(chapterRel).toMatch(/^\.mochen\/sessions\/2026\/10\/01\/rollout-20261001-080000-id\d+\.jsonl$/);
    const back = await readSession(root, chapterRel);
    expect(back.meta.docRelPath).toBe(CHAPTER);
    // 空 turnId 的提案事件过不了 agentEventSchema，会被计进 droppedLines——这条断言钉住「落盘即可读回」
    expect(back.droppedLines).toEqual([]);
    expect(
      back.events.flatMap((event) => (event.type === "user-message" ? [event.text] : []))
    ).toEqual(["第一次", "第二次"]);
    service.dispose();
  });

  it("defaultPromptFor 把作品名、阶段名、当前文稿与权限档写进系统提示", () => {
    const chapter: DocRef = { relPath: CHAPTER, kind: "chapter", title: "开局" };
    const text = defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter,
      permissionLabel: "全开"
    });
    expect(text).toContain("《深渊之下》");
    expect(text).toContain("正文");
    expect(text).toContain("全开");
    expect(text).toContain("propose_patch");
    expect(text).toContain("```mochen-patch");
    expect(
      defaultPromptFor({ title: "x", stageName: "构思", chapter: null, permissionLabel: "只读参考" })
    ).toContain("还没打开文稿");
  });
});
```

> 事件与提案的 id 由 `newId()` 计数器分配，本文件的断言一律**从事件里取 id**（`proposalIds()`），
> 不写死 `id3`/`id4`——写死会让任何一次实现顺序调整变成假红灯，而事件**顺序**本身是 §10 要的验收，
> 那个才不许改。

- [x] **Step 2：给 `BookService` 加 `current()`（本任务对 Plan 1 代码唯一的改动）**

`agent-service` 与 `doc-tools-host` 都要在运行期现取「当前书目录 + 当前 meta + 当前文稿清单」：
权限档来自 `meta.permissionMode`（用户随时在设置里改），文稿清单来自 `docs`。
把 `apps/desktop/src/main/book-service.ts` 整文件改写为：

```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  parseBookMeta,
  type BookMeta,
  type BookOpenResult,
  type DocContent,
  type DocRef,
  type DocWriteResult
} from "@mochen/contracts";
import { readDocFile, scanBook, sortChapters, writeDocFile } from "@mochen/fs-store";

export interface BookSnapshot {
  root: string;
  meta: BookMeta;
  docs: DocRef[];
}

export interface BookService {
  open(rootPath: string): Promise<BookOpenResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  /** 运行期现取；未打开目录返回 null。permissionMode 会被人随时改，所以每次现取而不是缓存值。 */
  current(): BookSnapshot | null;
  close(): Promise<void>;
}

export function registerBookIpc(
  ipcMain: { handle(channel: string, fn: (...args: unknown[]) => unknown): void },
  service: BookService
): void {
  ipcMain.handle(IPC_CHANNELS.bookOpen, (_event, rootPath) => service.open(rootPath as string));
  ipcMain.handle(IPC_CHANNELS.bookSaveMeta, (_event, meta) => service.saveMeta(meta as BookMeta));
  ipcMain.handle(IPC_CHANNELS.docRead, (_event, relPath) => service.readDoc(relPath as string));
  ipcMain.handle(IPC_CHANNELS.docWrite, (_event, relPath, content, expectedFingerprint) =>
    service.writeDoc(relPath as string, content as string, expectedFingerprint as string)
  );
}

export function createBookService(): BookService {
  let snapshot: BookSnapshot | null = null;

  return {
    async open(rootPath: string) {
      const raw = await readFile(path.join(rootPath, "book.json"), "utf8");
      let meta: BookMeta;
      try {
        meta = parseBookMeta(JSON.parse(raw));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法解析 book.json：${message}`, { cause: error });
      }
      const docs = sortChapters(await scanBook(rootPath), meta.chapterOrder);
      snapshot = { root: rootPath, meta, docs };
      return { rootPath, meta, docs };
    },

    async saveMeta(meta: BookMeta) {
      if (snapshot === null) throw new Error("尚未打开作品目录，无法保存 book.json");
      const parsed = parseBookMeta(meta);
      const body = `${JSON.stringify(parsed, null, 2)}\n`;
      await writeFile(path.join(snapshot.root, "book.json"), body, "utf8");
      // 权限档与阶段就住在 meta 里：不刷新快照，审批时查到的就是旧档位
      snapshot = { ...snapshot, meta: parsed };
    },

    async readDoc(relPath: string) {
      if (snapshot === null) throw new Error("尚未打开作品目录");
      return { relPath, ...(await readDocFile(snapshot.root, relPath)) };
    },

    async writeDoc(relPath, content, expectedFingerprint) {
      if (snapshot === null) return { ok: false, reason: "io-error", message: "尚未打开作品目录" };
      return writeDocFile(snapshot.root, relPath, content, expectedFingerprint);
    },

    current() {
      return snapshot;
    },

    async close() {
      snapshot = null;
    }
  };
}
```

既有 `book-service.test.ts` 不许放松：给它补一条用例（反向）：

```ts
  it("saveMeta 刷新 current().meta，权限档改了审批时立刻查得到", async () => {
    const service = await openedBook();
    const before = service.current();
    if (before === null) throw new Error("打开后必须有快照");
    await service.saveMeta({ ...before.meta, permissionMode: "chapter-write" });
    expect(service.current()?.meta.permissionMode).toBe("chapter-write");
    service.close();
    expect(service.current()).toBeNull();
  });
```

> `openedBook()` 是既有测试文件里已有的建书助手；若那个文件用的是内联临时目录，就把上面这段
> 改成同样的内联写法，**不要**为了两条断言重构整个既有测试文件。

- [x] **Step 3：`agent-service.ts`（完整实现，不留骨架）**

```ts
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  decideInputSchema,
  type AgentEvent,
  type AgentOutbound,
  type DecideInput,
  type DecisionResult,
  type DocRef,
  type EditProposal,
  type ProposalDecision,
  type StartTurnInput
} from "@mochen/contracts";
import {
  appendAgentEvent,
  applyPatch,
  checkWritePermission,
  createSession,
  eventsToMessages,
  findLatestSession,
  protocolBlockHint,
  readSession,
  runTurn,
  streamChat,
  unifiedDiff,
  type ChatMessage,
  type ProviderFetch,
  type ToolHost
} from "@mochen/agent-runtime";
import { makeFingerprint, readDocFile } from "@mochen/fs-store";
import type { BookService } from "./book-service.js";
import type { ProviderSettings } from "./provider-settings.js";
import { createDocToolHost } from "./doc-tools-host.js";

const UNBOUND = "unbound";
const MAX_TOOL_ROUNDS = 4;

export interface PromptContext {
  title: string;
  stageName: string;
  chapter: DocRef | null;
  permissionLabel: string;
}

/**
 * Plan 2 的临时装配：只带作品名、阶段名、当前文稿与权限档。
 * Plan 3 换成 spec §5 的上下文包时只替换这一个函数，service 的其它部分不动。
 */
export function defaultPromptFor(context: PromptContext): string {
  return [
    "你是墨宸 AI 的写作智能体，在用户本地的一本书上工作。",
    `当前作品：《${context.title}》；创作阶段：${context.stageName}；` +
      `当前文稿：${context.chapter?.relPath ?? "（用户还没打开文稿）"}。`,
    `权限档：${context.permissionLabel}。提案只有在用户批准后才写入磁盘。`,
    "改动文稿用 propose_patch（给 doc/anchor/replace/why），整篇重写用 write_doc。",
    "anchor 必须是文中逐字存在且唯一出现的片段；不确定就先 read_doc。",
    "只读档下不要承诺写入。",
    protocolBlockHint
  ].join("\n");
}

export interface AgentServiceDeps {
  book: BookService;
  settings: ProviderSettings;
  fetchImpl: ProviderFetch;
  emit(outbound: AgentOutbound): void;
  newId(): string;
  isoNow(): string;
  promptFor(context: PromptContext): string;
}

export interface AgentService {
  /** 解析时机：turn 结束（含落盘与自动批准）后才 resolve；turnId 通过 turn-start 事件提前送达。 */
  startTurn(input: StartTurnInput): Promise<{ turnId: string }>;
  interrupt(turnId: string): Promise<boolean>;
  decide(input: DecideInput): Promise<DecisionResult>;
  diffOf(proposalId: string): string;
  dispose(): void;
}

interface PendingProposal {
  proposal: EditProposal;
  baseline: string;
}

function ruleKey(proposal: EditProposal): string {
  return `${proposal.docRelPath}::${proposal.tool}`;
}

export function createAgentService(deps: AgentServiceDeps): AgentService {
  const pending = new Map<string, PendingProposal>();
  const diffs = new Map<string, string>();
  const threads = new Map<string, string>();
  const controllers = new Map<string, AbortController>();
  // §6 的 a / p 两态：a 键在会话线程，p 键在「文档::工具」。
  // Plan 3 引入 AgentProfile 后把 autoSession 的键换成 profileId（spec §5.1 约束 1）。
  const autoSession = new Set<string>();
  const autoDocTool = new Set<string>();
  // 同一个 jsonl 上的并发 append 会交错成坏行，所以落盘严格串行。
  let persist: Promise<void> = Promise.resolve();
  // 自动批准发生在 host 的同步回调里，只能排队；轮次 resolve 前必须排空。
  let autos: Promise<unknown> = Promise.resolve();

  function snapshot() {
    const current = deps.book.current();
    if (current === null) throw new Error("尚未打开作品目录，请先在左栏选择一本书。");
    return current;
  }

  async function drain(): Promise<void> {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const queued = persist;
      const auto = autos;
      await queued;
      await auto;
      if (persist === queued && autos === auto) return;
    }
    throw new Error("会话落盘或自动批准队列没有收敛，已停下等你介入。");
  }

  function publish(threadKey: string, event: AgentEvent): void {
    deps.emit({ type: "event", turnId: event.turnId, threadKey, event });
    const rel = threads.get(threadKey);
    const current = deps.book.current();
    if (rel === undefined || current === null) return;
    persist = persist
      .then(() => appendAgentEvent(current.root, rel, event))
      .catch((error: unknown) => {
        // 落盘失败只影响 /resume，不影响已经显示给用户的内容；但必须说出来，不能静默。
        deps.emit({
          type: "event",
          turnId: event.turnId,
          threadKey,
          event: {
            id: deps.newId(),
            ts: deps.isoNow(),
            turnId: event.turnId,
            type: "error",
            message: `会话历史写入失败（${rel}）：${error instanceof Error ? error.message : String(error)}；这一轮可能读不回来。`
          }
        });
      });
  }

  function emitOnly(threadKey: string, turnId: string, message: string): void {
    const event: AgentEvent = { id: deps.newId(), ts: deps.isoNow(), turnId, type: "error", message };
    deps.emit({ type: "event", turnId, threadKey, event });
  }

  async function threadFor(input: StartTurnInput, threadKey: string, model: string): Promise<string> {
    const existing = threads.get(threadKey);
    if (existing !== undefined) return existing;
    const current = snapshot();
    const found = await findLatestSession(current.root, threadKey);
    if (found !== null) {
      threads.set(threadKey, found);
      return found;
    }
    const startedAt = deps.isoNow();
    const rel = await createSession(current.root, {
      type: "session-meta",
      sessionId: deps.newId(),
      docRelPath: threadKey,
      stageId: input.stageId.trim() === "" ? UNBOUND : input.stageId.trim(),
      model,
      startedAt
    });
    threads.set(threadKey, rel);
    return rel;
  }

  function registerProposal(turnId: string, threadKey: string, proposal: EditProposal, baseline: string): void {
    // 必须就地改写：runTurn 紧接着把同一个对象发成 proposal 事件并落盘，
    // 空 turnId 过不了 agentEventSchema，历史会被 readSession 计进 droppedLines。
    proposal.turnId = turnId;
    proposal.threadKey = threadKey;
    pending.set(proposal.id, { proposal, baseline });
    const applied = applyPatch(baseline, proposal.mode, proposal.anchor, proposal.replace);
    diffs.set(
      proposal.id,
      unifiedDiff(baseline, applied.status === "unique" ? applied.content : baseline, proposal.docRelPath)
    );
    const bySession = autoSession.has(threadKey);
    if (!bySession && !autoDocTool.has(ruleKey(proposal))) return;
    const decision: ProposalDecision = bySession ? "accept-session" : "accept-prefix";
    autos = autos.then(() => applyDecision(proposal.id, decision, "", true));
  }

  function buildHost(turnId: string, threadKey: string, docRelPath: string | null): ToolHost {
    return createDocToolHost({
      root: () => deps.book.current()?.root ?? null,
      docs: () => deps.book.current()?.docs ?? [],
      context: () => ({
        docRelPath,
        permissionMode: deps.book.current()?.meta.permissionMode ?? DEFAULT_PERMISSION_MODE
      }),
      onProposal: (proposal, baseline) => registerProposal(turnId, threadKey, proposal, baseline),
      newId: deps.newId,
      now: deps.isoNow
    });
  }

  async function applyDecision(
    proposalId: string,
    decision: ProposalDecision,
    guidance: string,
    auto: boolean
  ): Promise<DecisionResult> {
    const entry = pending.get(proposalId);
    const current = deps.book.current();
    if (entry === undefined || current === null) {
      return { ok: false, reason: "not-pending", message: "这条提案已不在待审列表里（可能已经处理过，或换了作品目录）。" };
    }
    const { proposal } = entry;
    const threadKey = proposal.threadKey;
    const event = (body: Record<string, unknown>): AgentEvent =>
      ({ id: deps.newId(), ts: deps.isoNow(), turnId: proposal.turnId, ...body }) as AgentEvent;
    const decideEvent = () =>
      event({ type: "decision", proposalId, decision, guidance, auto });

    if (decision === "cancel" || decision === "deny-with-guidance") {
      pending.delete(proposalId);
      publish(threadKey, decideEvent());
      return decision === "cancel"
        ? { ok: false, reason: "cancelled", message: "已取消这条提案，文件未改动。" }
        : { ok: false, reason: "denied", message: "已拒绝这条提案，你的说明会在下一轮回喂给模型。" };
    }

    const permission = checkWritePermission({
      mode: current.meta.permissionMode,
      docRelPath: proposal.docRelPath,
      // 审批时的「当前章」取这条提案所绑线程的文稿；Plan 3 换成随右栏活动标签走
      currentChapter: threadKey === UNBOUND ? null : threadKey
    });
    if (!permission.allowed) {
      // 不删 pending：档位收紧只挡这一步，放开后同一条提案还能批准（§5.1 约束 3）
      publish(threadKey, event({ type: "error", message: `这条提案没有写入：${permission.reason}` }));
      return { ok: false, reason: "permission-denied", message: permission.reason };
    }

    const read = await readDocFile(current.root, proposal.docRelPath).catch(() => null);
    const currentFingerprint = read?.fingerprint ?? makeFingerprint("");
    if (currentFingerprint !== proposal.expectedFingerprint) {
      pending.delete(proposalId);
      publish(threadKey, event({
        type: "error",
        message: `提案之后 ${proposal.docRelPath} 又被改动过，这条建议已失效；我没有覆盖你的改动，请让模型基于最新正文重出一条。`
      }));
      return { ok: false, reason: "stale", message: "原稿已被改动，没有覆盖。" };
    }

    const applied = applyPatch(read?.content ?? "", proposal.mode, proposal.anchor, proposal.replace);
    if (applied.status !== "unique") {
      pending.delete(proposalId);
      publish(threadKey, event({ type: "error", message: applied.message }));
      return { ok: false, reason: "stale", message: applied.message };
    }

    const write = await deps.book.writeDoc(proposal.docRelPath, applied.content, currentFingerprint);
    if (!write.ok) {
      if (write.reason === "stale") {
        pending.delete(proposalId);
        return { ok: false, reason: "stale", message: "原稿已被改动，没有覆盖。" };
      }
      // io / invalid-path / outside-book：提案留在 pending，用户可以重试（§9 第 2 行）
      publish(threadKey, event({ type: "error", message: `写入失败：${write.message}` }));
      return { ok: false, reason: "io", message: write.message };
    }

    pending.delete(proposalId);
    if (decision === "accept-session") autoSession.add(threadKey);
    if (decision === "accept-prefix") autoDocTool.add(ruleKey(proposal));
    publish(threadKey, decideEvent());
    publish(threadKey, event({
      type: "written",
      proposalId,
      docRelPath: proposal.docRelPath,
      fingerprint: write.fingerprint,
      backupRelPath: write.backupRelPath
    }));
    return {
      ok: true,
      docRelPath: proposal.docRelPath,
      fingerprint: write.fingerprint,
      backupRelPath: write.backupRelPath,
      auto
    };
  }

  return {
    async startTurn(input: StartTurnInput): Promise<{ turnId: string }> {
      const turnId = deps.newId();
      const threadKey = input.threadKey.trim() === "" ? UNBOUND : input.threadKey.trim();
      const docRelPath = input.docRelPath ?? null;
      deps.emit({ type: "turn-start", turnId, threadKey });
      const controller = new AbortController();
      controllers.set(turnId, controller);
      try {
        if (input.userText.trim() === "") {
          emitOnly(threadKey, turnId, "输入是空的，这一轮没有发给模型。");
          deps.emit({ type: "turn-end", turnId, threadKey, status: "failed", message: "输入为空。" });
          return { turnId };
        }
        const config = await deps.settings.config();
        const apiKey = await deps.settings.apiKey();
        const failure =
          deps.book.current() === null
            ? "尚未打开作品目录，请先在左栏选择一本书。"
            : config === null
              ? "还没有配置模型服务：请在设置里填写 baseURL 与模型名。"
              : apiKey === null
                ? "还没有保存 API Key：密钥只进主进程，请在设置里填写。"
                : null;
        if (failure !== null || config === null || apiKey === null) {
          emitOnly(threadKey, turnId, failure ?? "模型配置读取失败。");
          deps.emit({ type: "turn-end", turnId, threadKey, status: "failed", message: failure ?? "模型配置读取失败。" });
          return { turnId };
        }

        const current = snapshot();
        const rel = await threadFor(input, threadKey, config.model);
        const stored = await readSession(current.root, rel).catch(() => null);
        // 历史只到上一次为止：本轮的 user 文本由 runTurn 自己追加，重复塞会看到两行一样的 user
        const history: ChatMessage[] = stored === null ? [] : eventsToMessages(stored.events);
        const context: PromptContext = {
          title: current.meta.title,
          stageName: current.meta.stages.find((stage) => stage.id === input.stageId)?.name ?? input.stageId,
          chapter: current.docs.find((doc) => doc.relPath === docRelPath) ?? null,
          permissionLabel: PERMISSION_LABELS[current.meta.permissionMode]
        };
        const outcome = await runTurn(
          {
            stream: (req) => streamChat({ ...req, fetchImpl: deps.fetchImpl }),
            host: buildHost(turnId, threadKey, docRelPath),
            emit: (event) => publish(threadKey, event),
            emitDelta: (deltaKind, text) => deps.emit({ type: "delta", turnId, threadKey, deltaKind, text }),
            newId: deps.newId,
            now: deps.isoNow,
            signal: controller.signal,
            maxToolRounds: MAX_TOOL_ROUNDS,
            provider: { baseURL: config.baseURL, apiKey, model: config.model }
          },
          {
            turnId,
            threadKey,
            systemPrompt: deps.promptFor(context),
            history,
            userText: input.userText
          }
        );
        deps.emit({ type: "turn-end", turnId, threadKey, status: outcome.status, message: outcome.message });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.emit({
          type: "event",
          turnId,
          threadKey,
          event: { id: deps.newId(), ts: deps.isoNow(), turnId, type: "error", message }
        });
        deps.emit({ type: "turn-end", turnId, threadKey, status: "failed", message });
      } finally {
        controllers.delete(turnId);
        await drain();
      }
      return { turnId };
    },

    async interrupt(turnId: string): Promise<boolean> {
      const controller = controllers.get(turnId);
      if (controller === undefined) return false;
      controller.abort();
      return true;
    },

    async decide(input: DecideInput): Promise<DecisionResult> {
      const value = decideInputSchema.parse(input);
      const result = await applyDecision(value.proposalId, value.decision, value.guidance, false);
      await drain();
      return result;
    },

    diffOf(proposalId: string): string {
      return diffs.get(proposalId) ?? "";
    },

    dispose(): void {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      pending.clear();
      diffs.clear();
      threads.clear();
      autoSession.clear();
      autoDocTool.clear();
    }
  };
}
```

> `emitOnly` 只用在「没开书 / 没配模型 / 没填密钥 / 输入为空」这四种情况：那时会话文件还不存在，
> 事件只发渲染层、不落盘。

- [x] **Step 4：`registerAgentIpc` 与 `registerProviderIpc`**

```ts
import {
  IPC_CHANNELS,
  type DecideInput,
  type ProviderDraft,
  type StartTurnInput
} from "@mochen/contracts";
import type { ProviderSettings } from "./provider-settings.js";
import type { AgentService } from "./agent-service.js";

type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

export function registerAgentIpc(handle: Handler, service: AgentService): void {
  handle(IPC_CHANNELS.agentStartTurn, (_event, input) => service.startTurn(input as StartTurnInput));
  handle(IPC_CHANNELS.agentInterrupt, (_event, turnId) => service.interrupt(turnId as string));
  handle(IPC_CHANNELS.agentDecide, (_event, input) => service.decide(input as DecideInput));
  handle(IPC_CHANNELS.agentDiff, (_event, proposalId) => service.diffOf(proposalId as string));
}

/** 视图与保存都只回掩码：明文密钥在这条线上是单向的（spec §8）。 */
export function registerProviderIpc(handle: Handler, settings: ProviderSettings): void {
  handle(IPC_CHANNELS.providerGet, () => settings.view());
  handle(IPC_CHANNELS.providerSave, (_event, draft) => settings.save(draft as ProviderDraft));
}
```

这两个函数放 `apps/desktop/src/main/agent-ipc.ts`。装配本身不做单测（Task 15 冒烟验），
但 `registerAgentIpc` 的注册表可以用一个假 `handle` 断言「四条 agent 通道各注册一次」——
`agent-ipc.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "@mochen/contracts";
import { registerAgentIpc } from "./agent-ipc.js";

describe("registerAgentIpc", () => {
  it("注册四条 agent 通道，一条都不漏", async () => {
    const calls: { channel: string; args: unknown[] }[] = [];
    const service = {
      startTurn: async () => ({ turnId: "" }),
      interrupt: async () => false,
      decide: async () => ({ ok: false, reason: "not-pending" as const, message: "" }),
      diffOf: () => "",
      dispose: () => undefined
    };
    registerAgentIpc((channel, fn) => {
      calls.push({ channel, args: [] });
      // 反向用例：每条 handler 都必须真的转给 service，而不是注册了个空函数
      void fn("p1");
    }, service);
    expect(calls.map((call) => call.channel)).toEqual([
      IPC_CHANNELS.agentStartTurn,
      IPC_CHANNELS.agentInterrupt,
      IPC_CHANNELS.agentDecide,
      IPC_CHANNELS.agentDiff
    ]);
  });
});
```

- [x] **Step 5：`electron-cipher.ts` 与 `provider-fetch.ts`（主进程侧两块真实胶水）**

`electron-cipher.ts`（8 行包装，`safeStorage` 由调用方传入，测试不需要 electron）：

```ts
import type { Cipher } from "./credential-store.js";

interface Storage {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(text: Buffer): string;
}

export function electronCipher(storage: Storage): Cipher {
  return {
    available: storage.isEncryptionAvailable(),
    encrypt: (plain) => storage.encryptString(plain).toString("base64"),
    decrypt: (text) => storage.decryptString(Buffer.from(text, "base64"))
  };
}
```

`provider-fetch.ts` 把全局 `fetch` 适配成 `ProviderFetch`，`provider-fetch.test.ts` 覆盖三条：
非 2xx 时把响应体带回给上层拼中文错误、有 body 时逐块吐字节、`body === null` 时返回 `stream: null`。

```ts
import type { ProviderFetch, ProviderFetchInput, ProviderFetchResult } from "@mochen/agent-runtime";

function toAsyncIterable(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      const reader = body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return;
          yield chunk.value;
        }
      } finally {
        reader.releaseLock();
      }
    }
  };
}

/** 网络错误一律原样抛出：streamChat 会按「是否已打断」分别处理（Task 3）。 */
export function toProviderFetch(
  send: (input: ProviderFetchInput) => Promise<Response>
): ProviderFetch {
  return async (input) => {
    const response = await send(input);
    if (!response.ok) {
      return {
        status: response.status,
        stream: null,
        errorText: await response.text().catch(() => "")
      };
    }
    return {
      status: response.status,
      stream: response.body === null ? null : toAsyncIterable(response.body),
      errorText: ""
    };
  };
}
```

`provider-fetch.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ProviderFetchInput } from "@mochen/agent-runtime";
import { toProviderFetch } from "./provider-fetch.js";

const input = { url: "http://x/v1/chat/completions", headers: {}, body: "{}", signal: new AbortController().signal } satisfies ProviderFetchInput;

describe("toProviderFetch", () => {
  it("非 2xx 时把响应体带回去，不抛错（上层负责翻成中文）", async () => {
    const response = new Response("上游配额用尽", { status: 429 });
    const result = await toProviderFetch(async () => response)(input);
    expect(result.status).toBe(429);
    expect(result.stream).toBeNull();
    expect(result.errorText).toContain("配额");
  });

  it("2xx 有流时逐块吐出 SSE 字节", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("data: {}\n\n"));
        controller.close();
      }
    });
    const result = await toProviderFetch(async () => new Response(body, { status: 200 }))(input);
    expect(result.status).toBe(200);
    if (result.stream === null) throw new Error("必须有流");
    const collected: string[] = [];
    const dec = new TextDecoder();
    for await (const chunk of result.stream) collected.push(dec.decode(chunk));
    expect(collected.join("")).toBe("data: {}\n\n");
  });

  it("没有响应体时 stream 为 null", async () => {
    const result = await toProviderFetch(async () => new Response(null, { status: 200 }))(input);
    expect(result.stream).toBeNull();
  });
});
```

- [x] **Step 6：`index.ts` 装配（不进单测，Task 15 冒烟验）**

`apps/desktop/src/main/index.ts` 的 `app.whenReady()` 里，在现有 `registerBookIpc` 之后加：

```ts
  const secretDir = path.join(app.getPath("appData"), "mochen-writing");
  const credentials = createCredentialStore(secretDir, electronCipher(safeStorage));
  const settings = createProviderSettings({ dir: secretDir, credentials });
  const agent = createAgentService({
    book: service,
    settings,
    fetchImpl: toProviderFetch((input) =>
      fetch(input.url, { method: "POST", headers: input.headers, body: input.body, signal: input.signal })
    ),
    emit: (payload) => win.webContents.send(IPC_CHANNELS.agentEvent, payload),
    newId: () => randomUUID(),
    isoNow: () => new Date().toISOString(),
    promptFor: defaultPromptFor
  });
  registerAgentIpc((channel, fn) => ipcMain.handle(channel, fn), agent);
  registerProviderIpc((channel, fn) => ipcMain.handle(channel, fn), settings);
```

`win` 是既有的窗口变量；`randomUUID` 从 `node:crypto` 引；`safeStorage` 从 `electron` 引。
渲染层拿到的 `turn-start` / `delta` / `event` / `turn-end` 都走 `IPC_CHANNELS.agentEvent` 一条通道。

- [x] **Step 7：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/main --maxWorkers=4`
Expected: PASS（Plan 1 既有 8 条 + Task 9 的 11 条 + Task 10 的 12 条 + 本任务 12 条 + ipc/fetch 4 条）。
Run: `corepack pnpm verify` → 回读日志末行 `VERIFY_EXIT=0`（别把管道尾部的 0 当结论）。

- [x] **Step 8：变异实验（本计划最重要的一次）**

按 spec §10 点名的抽除点逐个验，每抽一个跑一次测试并记录**红的用例名**，恢复后再抽下一个：

| 抽掉什么 | 必须转红的用例 |
|---|---|
| `writeDocFile` 里先备份那段（改成直接 `writeFile`） | 「批准后写盘：原稿进 .mochen/changes 备份」 |
| `applyDecision` 里 `if (!permission.allowed)`（改成放行） | 「批准那一刻权限收紧 → permission-denied」 |
| `registerProposal` 里 `pending.set(...)`（改成审批时现造提案） | 「未批准时文件字节一字不变」+「拒绝并说明…文件不动」 |
| `currentFingerprint !== proposal.expectedFingerprint` 比对 | 「外部改动 → 批准判 stale」 |
| `registerProposal` 里 `proposal.turnId = turnId` 覆写 | 「同线程读回上一轮」的 `droppedLines` 断言 |
| `publish` 里 `appendAgentEvent` 那半段（只 emit 不落盘） | 「同线程读回上一轮」（找不到会话） |
| `startTurn` 的 `if (failure !== null ...)` 提前返回 | 「还没配置模型服务时拒绝开轮」 |

全部恢复后 `git diff --exit-code apps/desktop/src packages` 必须空，并把这张表的实际结果写进
提交信息与 Task 16 的台账。

- [x] **Step 9：提交**

```bash
git add apps/desktop packages
git commit -m "feat(main): 智能体服务——审批登记、唯一写盘通路与会话线程"
```

---

## Task 12：preload 白名单扩展（可单测的 API 工厂）

**Files:**
- Create: `apps/desktop/src/preload/renderer-api.ts`、`src/preload/renderer-api.test.ts`
- Modify: `packages/contracts/src/ipc.ts`（`RendererApi` 扩展）、`apps/desktop/src/preload/index.ts`、
  `apps/desktop/src/renderer/src/stores/useBookStore.test.ts`（api 夹具补全缺项，见 Step 5）

**Interfaces:**
- Consumes: `IPC_CHANNELS`、`StartTurnInput`/`DecideInput`/`DecisionResult`/`ProviderDraft`/`ProviderView`/`AgentOutbound`
- Produces: `createRendererApi(invoke: Invoke, on: On): RendererApi`（`Invoke`/`On` 见 Step 4 的实现）；
  `RendererApi` 新增
  `startTurn` / `interruptTurn` / `decideProposal` / `proposalDiff` / `providerView` / `providerSave` / `onAgentEvent`

- [x] **Step 1：先扩 `RendererApi`（与实现同任务，保中间提交绿）**

`packages/contracts/src/ipc.ts` 现在只从 `./book.js` 引类型，先把新载荷引上（同包内用相对 `./x.js`，
NodeNext 不许省扩展名）：

```ts
import type { AgentOutbound, DecideInput, DecisionResult, StartTurnInput } from "./agent-event.js";
import type { ProviderDraft, ProviderView } from "./provider.js";
```

然后把 `RendererApi` 整体换成下面这版（前 5 个方法一字不改，Plan 1 的调用点不受影响）：

```ts
export interface RendererApi {
  pickBookDirectory(): Promise<string | null>;
  openBook(rootPath: string): Promise<BookOpenResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  startTurn(input: StartTurnInput): Promise<{ turnId: string }>;
  interruptTurn(turnId: string): Promise<boolean>;
  decideProposal(input: DecideInput): Promise<DecisionResult>;
  /** 提案的统一 diff 文本；主进程算好，渲染层不 import agent-runtime（见 Task 1 的 agentDiff 说明）。 */
  proposalDiff(proposalId: string): Promise<string>;
  providerView(): Promise<ProviderView>;
  providerSave(draft: ProviderDraft): Promise<ProviderView>;
  /** 返回取消订阅的函数；渲染层拿不到 ipcRenderer。 */
  onAgentEvent(listener: (payload: AgentOutbound) => void): () => void;
}
```

- [x] **Step 2：写红的测试**

`apps/desktop/src/preload/renderer-api.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS, type AgentOutbound, type RendererApi } from "@mochen/contracts";
import { createRendererApi } from "./renderer-api.js";

function harness() {
  const calls: { channel: string; args: unknown[] }[] = [];
  const listeners = new Set<(payload: unknown) => void>();
  const api: RendererApi = createRendererApi(
    async (channel, ...args) => {
      calls.push({ channel, args });
      return { ok: true, turnId: "t1" };
    },
    (channel, listener) => {
      listeners.add(listener);
      calls.push({ channel, args: ["subscribe"] });
      return () => listeners.delete(listener);
    }
  );
  return { api, calls, listeners };
}

describe("createRendererApi", () => {
  it("每个方法只走自己的通道", async () => {
    const { api, calls } = harness();
    await api.startTurn({ threadKey: "a", docRelPath: "a", stageId: "draft", userText: "改" });
    await api.interruptTurn("t1");
    await api.decideProposal({ proposalId: "p1", decision: "cancel", guidance: "" });
    await api.proposalDiff("p1");
    await api.providerView();
    await api.providerSave({ baseURL: "http://a/v1", model: "m", apiKey: null });
    expect(calls.map((call) => call.channel)).toEqual([
      IPC_CHANNELS.agentStartTurn,
      IPC_CHANNELS.agentInterrupt,
      IPC_CHANNELS.agentDecide,
      IPC_CHANNELS.agentDiff,
      IPC_CHANNELS.providerGet,
      IPC_CHANNELS.providerSave
    ]);
    expect(calls[3]?.args).toEqual(["p1"]);
  });

  it("订阅 agentEvent 后能收到推送，取消订阅后不再收到", () => {
    const { api, listeners, calls } = harness();
    const got: AgentOutbound[] = [];
    const off = api.onAgentEvent((payload) => got.push(payload));
    expect(calls.at(-1)?.channel).toBe(IPC_CHANNELS.agentEvent);
    const listener = [...listeners][0];
    listener?.({ type: "turn-end", turnId: "t1", threadKey: "a", status: "done", message: "" });
    expect(got.length).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });

  it("不暴露任何白名单外的通道", async () => {
    const { api, calls } = harness();
    await api.openBook("/book");
    await api.writeDoc("chapters/01.md", "x", "fp");
    const allowed = new Set(Object.values(IPC_CHANNELS));
    expect(calls.every((call) => allowed.has(call.channel))).toBe(true);
  });
});
```

- [x] **Step 3：`renderer-api.ts`**

```ts
import {
  IPC_CHANNELS,
  type AgentOutbound,
  type DecideInput,
  type ProviderDraft,
  type RendererApi,
  type StartTurnInput
} from "@mochen/contracts";

type Invoke = (channel: string, ...args: unknown[]) => Promise<never>;
type On = (channel: string, listener: (payload: unknown) => void) => () => void;

export function createRendererApi(invoke: Invoke, on: On): RendererApi {
  return {
    pickBookDirectory: () => invoke(IPC_CHANNELS.bookPick),
    openBook: (rootPath) => invoke(IPC_CHANNELS.bookOpen, rootPath),
    saveMeta: (meta) => invoke(IPC_CHANNELS.bookSaveMeta, meta),
    readDoc: (relPath) => invoke(IPC_CHANNELS.docRead, relPath),
    writeDoc: (relPath, content, expectedFingerprint) =>
      invoke(IPC_CHANNELS.docWrite, relPath, content, expectedFingerprint),
    startTurn: (input: StartTurnInput) => invoke(IPC_CHANNELS.agentStartTurn, input),
    interruptTurn: (turnId) => invoke(IPC_CHANNELS.agentInterrupt, turnId),
    decideProposal: (input: DecideInput) => invoke(IPC_CHANNELS.agentDecide, input),
    proposalDiff: (proposalId) => invoke(IPC_CHANNELS.agentDiff, proposalId),
    providerView: () => invoke(IPC_CHANNELS.providerGet),
    providerSave: (draft: ProviderDraft) => invoke(IPC_CHANNELS.providerSave, draft),
    onAgentEvent: (listener) => on(IPC_CHANNELS.agentEvent, (payload) => listener(payload as AgentOutbound))
  };
}
```

- [x] **Step 4：`index.ts` 改为薄接线**

```ts
import { contextBridge, ipcRenderer } from "electron";
import { createRendererApi } from "./renderer-api.js";

contextBridge.exposeInMainWorld(
  "mochen",
  createRendererApi(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, listener) => {
      ipcRenderer.on(channel, (_event, payload) => listener(payload));
      return () => ipcRenderer.removeListener(channel, listener);
    }
  )
);
```

> `removeListener` 传的是包装后的箭头，撤不掉——必须撤同一个引用。落地写法：
>
> ```ts
> (channel, listener) => {
>   const wrapped = (_event: unknown, payload: unknown) => listener(payload);
>   ipcRenderer.on(channel, wrapped);
>   return () => ipcRenderer.removeListener(channel, wrapped);
> }
> ```

- [x] **Step 5：跑到绿 + 全量 typecheck**

Run: `corepack pnpm vitest run apps/desktop/src/preload --maxWorkers=4` → PASS（3 用例）。

`RendererApi` 一变长，既有夹具就缺项：`apps/desktop/src/renderer/src/stores/useBookStore.test.ts`
的 `api` 用 `satisfies RendererApi`，少一个键 typecheck 立刻红。把 7 个新方法补进夹具，并且让它们
「被调用即失败」——这同时是一条反向守卫：book 测试若误走 agent 通道必须炸。

```ts
/** book 侧测试绝不触碰的通道：一旦被调用就报出来。 */
function offLimits(name: string) {
  return vi.fn(async () => {
    throw new Error(`useBookStore 不该调用 ${name}`);
  });
}

const api = {
  pickBookDirectory,
  openBook: vi.fn(async () => result),
  saveMeta: vi.fn(async () => {}),
  readDoc,
  writeDoc,
  startTurn: offLimits("startTurn"),
  interruptTurn: offLimits("interruptTurn"),
  decideProposal: offLimits("decideProposal"),
  proposalDiff: offLimits("proposalDiff"),
  providerView: offLimits("providerView"),
  providerSave: offLimits("providerSave"),
  onAgentEvent: offLimits("onAgentEvent")
} satisfies RendererApi;
```

`offLimits("onAgentEvent")` 返回的是 async 函数，作为 `onAgentEvent` 的实现类型不符
（那里要同步返回取消函数）——写成 `vi.fn(() => { throw new Error("useBookStore 不该订阅 agent"); })`。

Run: `corepack pnpm typecheck`（5 个 tsc 项目）→ 无诊断。

- [x] **Step 6：变异实验**

把 `onAgentEvent` 的通道写成 `"agent:events"`（多个 s）→ 订阅用例必须红。恢复。

- [x] **Step 7：提交**

```bash
git add packages/contracts/src/ipc.ts apps/desktop/src/preload
git commit -m "feat(preload): 智能体与模型设置的白名单 API"
```

---
## Task 13：渲染层状态 —— 事件归约、线程隔离、Esc 裁决与写盘回吸收

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/escape-policy.ts`、`utils/escape-policy.test.ts`
- Create: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`、`stores/useAgentStore.test.ts`
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.ts`（新增 `absorbAgentWrite`）、
  `stores/useBookStore.test.ts`（追加 3 个用例）

**Interfaces:**
- Consumes: `AgentOutbound`/`AgentEvent`/`EditProposal`/`ProposalStatus`/
  `ProposalDecision`/`DecideInput`/`DecisionResult`/`StartTurnInput`/`ProviderView`/`BookOpenResult`/
  `DocWriteResult`/`RendererApi`（Task 1、Task 12）、
  `window.mochen.startTurn` / `interruptTurn` / `decideProposal` / `proposalDiff` / `onAgentEvent`（Task 12）
- Produces:
  - `UNBOUND = "unbound"`、`threadKeyFor(activeDocTab: string | null): string`、
    `composeStatusLine(thread: ThreadView | undefined, seconds: number, pending: number): string`
  - `ThreadView = { turnId: string | null; running: boolean; startedAt: number; items: AgentEvent[]; streaming: { reasoning: string; message: string }; lastError: string; endedAs: "" | TurnEndStatus }`
  - `ProposalView = { proposal: EditProposal; status: ProposalStatus; message: string; diff: string }`
  - `useAgentStore`（state：`threads`/`proposals`/`notice`/`seconds`/`listening`；
    getters：`pendingOf(threadKey): number`、`canContinue(threadKey): boolean`；actions：`viewOf`/`startListening`/`apply`/`loadDiff`/
    `decide`/`send`/`continueTurn`/`stop`/`tick`）
  - `EscapeAction = "keep-guidance" | "cancel-proposal" | "interrupt" | "none"`、
    `EscapeFocusState`、`resolveEscape(state: EscapeFocusState): EscapeAction`
  - `useBookStore.absorbAgentWrite(relPath: string, fingerprint: string): Promise<void>`

> `UNBOUND` 与主进程 `agent-service.ts` 里的同名常量必须一致：它是「没开文稿标签时的会话线程键」。
> main 与 renderer 属不同 tsconfig 项目、不能互相 import，所以一致性由 Task 15 的端到端用例兜住
> ——渲染层发出去的 `threadKey` 若与主进程回推的不上号，事件就落进另一条线程，中栏看起来「没反应」。

- [x] **Step 1：写红的 `escape-policy.test.ts`（spec §6.2 的全组合）**

```ts
import { describe, expect, it } from "vitest";
import { resolveEscape, type EscapeFocusState } from "./escape-policy";

function state(overrides: Partial<EscapeFocusState> = {}): EscapeFocusState {
  return {
    hasFocusedProposal: false,
    focusedProposalPending: false,
    guidanceIsDirty: false,
    turnRunning: false,
    ...overrides
  };
}

describe("resolveEscape", () => {
  it("聚焦待审卡且说明非空：只失焦，不清字", () => {
    expect(
      resolveEscape(
        state({ hasFocusedProposal: true, focusedProposalPending: true, guidanceIsDirty: true })
      )
    ).toBe("keep-guidance");
  });

  it("聚焦待审卡且说明为空：取消该条提案", () => {
    expect(resolveEscape(state({ hasFocusedProposal: true, focusedProposalPending: true }))).toBe(
      "cancel-proposal"
    );
  });

  it("审批卡优先于打断：卡待审、turn 也在跑，走卡不走打断", () => {
    expect(
      resolveEscape(
        state({ hasFocusedProposal: true, focusedProposalPending: true, turnRunning: true })
      )
    ).toBe("cancel-proposal");
  });

  it("聚焦的是已裁决卡：跳过它，落回打断", () => {
    expect(
      resolveEscape(
        state({ hasFocusedProposal: true, focusedProposalPending: false, turnRunning: true })
      )
    ).toBe("interrupt");
  });

  it("无卡可管且 turn 在跑：打断", () => {
    expect(resolveEscape(state({ turnRunning: true }))).toBe("interrupt");
  });

  it("什么都没发生：无动作（绝不关工作台、绝不清草稿）", () => {
    expect(resolveEscape(state())).toBe("none");
  });
});
```

- [x] **Step 2：写红的 `useAgentStore.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  AgentEvent,
  AgentOutbound,
  BookOpenResult,
  DecideInput,
  DecisionResult,
  DocWriteResult,
  EditProposal,
  ProviderView,
  RendererApi,
  StartTurnInput
} from "@mochen/contracts";
import { composeStatusLine, threadKeyFor, UNBOUND, useAgentStore } from "./useAgentStore";
import { useBookStore } from "./useBookStore";

const CH = "chapters/01-a.md";
const OTHER = "chapters/02-b.md";

const opened: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "chapter-write",
    chapterOrder: [CH]
  },
  docs: [
    { relPath: CH, kind: "chapter", title: "开局" },
    { relPath: OTHER, kind: "chapter", title: "转折" }
  ]
};

const view: ProviderView = { hasKey: true, baseURL: "http://127.0.0.1:8787/v1", model: "mochen-mock", keyMask: "••••" };

function proposal(id: string, overrides: Partial<EditProposal> = {}): EditProposal {
  return {
    id,
    threadKey: CH,
    turnId: "t1",
    docRelPath: CH,
    mode: "anchor-replace",
    anchor: "夜色沉下去",
    replace: "夜色沉下去，海雾涌上来。",
    why: "补一层听觉与雾气",
    tool: "propose_patch",
    source: "tool-call",
    expectedFingerprint: "fp-a",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides
  };
}

function eventOf(type: AgentEvent["type"], rest: Record<string, unknown> = {}): AgentEvent {
  return { id: `e-${type}`, ts: "2026-10-01T00:00:00.000Z", turnId: "t1", type, ...rest } as AgentEvent;
}

/** 按类型取该线程里的第一条同类事件，省掉测试里满屏的类型收窄。 */
function typed<T extends AgentEvent["type"]>(type: T, threadKey = CH) {
  const items = useAgentStore().threads[threadKey]?.items ?? [];
  return items.find((item) => item.type === type) as Extract<AgentEvent, { type: T }>;
}

const listeners = new Set<(payload: AgentOutbound) => void>();
const started: StartTurnInput[] = [];
const decided: DecideInput[] = [];
let nextDecision: DecisionResult = { ok: true, docRelPath: CH, fingerprint: "fp-b", backupRelPath: null, auto: false };

const startTurn = vi.fn(async (input: StartTurnInput) => {
  started.push(input);
  return { turnId: "t1" };
});
const interruptTurn = vi.fn(async (turnId: string) => turnId.length > 0);
const decideProposal = vi.fn(async (input: DecideInput) => {
  decided.push(input);
  return nextDecision;
});
const proposalDiff = vi.fn(async (id: string) => `diff:${id}`);
const readDoc = vi.fn(async (relPath: string) => ({ relPath, content: "正文\n夜色沉下去\n", fingerprint: "fp-a" }));
const writeDoc = vi.fn(async (): Promise<DocWriteResult> => ({ ok: true, fingerprint: "fp-b", backupRelPath: null }));

const api = {
  pickBookDirectory: vi.fn(async () => CH),
  openBook: vi.fn(async (): Promise<BookOpenResult> => opened),
  saveMeta: vi.fn(async (): Promise<void> => undefined),
  readDoc,
  writeDoc,
  startTurn,
  interruptTurn,
  decideProposal,
  proposalDiff,
  providerView: vi.fn(async (): Promise<ProviderView> => view),
  providerSave: vi.fn(async (): Promise<ProviderView> => view),
  onAgentEvent: vi.fn((listener: (payload: AgentOutbound) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  })
} satisfies RendererApi;

function push(outbound: AgentOutbound): void {
  for (const listener of listeners) listener(outbound);
}

function store() {
  return useAgentStore();
}

async function openChapter(relPath = CH) {
  await useBookStore().openBook("/book");
  await useBookStore().openDocTab(relPath);
}

function itemsOf(threadKey = CH): AgentEvent[] {
  return store().threads[threadKey]?.items ?? [];
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
  listeners.clear();
  started.length = 0;
  decided.length = 0;
  nextDecision = { ok: true, docRelPath: CH, fingerprint: "fp-b", backupRelPath: null, auto: false };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAgentStore", () => {
  it("startListening 幂等：装配重复调用也只订阅一次", async () => {
    await openChapter();
    store().startListening();
    store().startListening();
    expect(api.onAgentEvent).toHaveBeenCalledTimes(1);
  });

  it("流式残字与定稿不重复：delta 累积，message 事件到达后归零并进 items", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "delta", turnId: "t1", threadKey: CH, deltaKind: "reasoning", text: "先读上下文" });
    push({ type: "delta", turnId: "t1", threadKey: CH, deltaKind: "message", text: "海雾" });
    expect(store().viewOf(CH).streaming).toEqual({ reasoning: "先读上下文", message: "海雾" });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("message", { text: "海雾涌上来", interrupted: false })
    });
    expect(store().viewOf(CH).streaming.message).toBe("");
    expect(store().viewOf(CH).streaming.reasoning).toBe("先读上下文");
    expect(typed("message").text).toBe("海雾涌上来");
  });

  it("线程隔离：另一章的事件不进当前章，running 也各算各的", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("user-message", { text: "改这里" }) });
    push({ type: "turn-start", turnId: "t2", threadKey: OTHER });
    expect(itemsOf(CH).length).toBe(1);
    expect(itemsOf(OTHER).length).toBe(0);
    expect(store().viewOf(CH).turnId).toBe("t1");
    expect(store().viewOf(OTHER).turnId).toBe("t2");
    expect(store().viewOf(OTHER).running).toBe(true);
  });

  it("proposal 事件登记成待审卡，diff 从主进程取回", async () => {
    await openChapter();
    store().startListening();
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p1") }) });
    await vi.runAllTimersAsync();
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.diff).toBe("diff:p1");
    expect(store().pendingOf(CH)).toBe(1);
  });

  it("decision：cancel 落已取消，deny-with-guidance 落已拒绝并把说明挂上", async () => {
    await openChapter();
    store().startListening();
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p1") }) });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("decision", { proposalId: "p1", decision: "deny-with-guidance", guidance: "别动比喻", auto: false })
    });
    expect(store().proposals.p1?.status).toBe("rejected");
    expect(store().proposals.p1?.message).toBe("别动比喻");
    expect(store().pendingOf(CH)).toBe(0);
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p2") }) });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("decision", { proposalId: "p2", decision: "cancel", guidance: "", auto: false })
    });
    expect(store().proposals.p2?.status).toBe("cancelled");
  });

  it("written：卡片落已写入，并把新指纹交给 book store 吸收", async () => {
    await openChapter();
    store().startListening();
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p1") }) });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("written", {
        proposalId: "p1",
        docRelPath: CH,
        fingerprint: "fp-b",
        backupRelPath: ".mochen/changes/x/01-a.md.bak"
      })
    });
    await vi.runAllTimersAsync();
    expect(store().proposals.p1?.status).toBe("written");
    expect(store().notice).toContain("已写入");
    expect(store().notice).toContain("原稿已备份");
    expect(useBookStore().draft).toBe("正文\n夜色沉下去\n");
    expect(useBookStore().notice).toContain("草稿已同步");
  });

  it("写盘失败（io）与权限收紧都保持待审并显示原因（spec §9 可重试）", async () => {
    await openChapter();
    store().startListening();
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p1") }) });
    nextDecision = { ok: false, reason: "io", message: "文件被占用，写入失败" };
    await store().decide("p1", "accept-once", "");
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.message).toBe("文件被占用，写入失败");
    nextDecision = { ok: false, reason: "permission-denied", message: "只读参考档下一律拒绝写入" };
    await store().decide("p1", "accept-once", "");
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.message).toContain("只读");
    expect(decided.length).toBe(2);
  });

  it("指纹过期（stale）落「文件已变动」，不再计入待审", async () => {
    await openChapter();
    store().startListening();
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p1") }) });
    nextDecision = { ok: false, reason: "stale", message: "文件在外部被改过，已拒写" };
    await store().decide("p1", "accept-once", "");
    expect(store().proposals.p1?.status).toBe("stale");
    expect(store().pendingOf(CH)).toBe(0);
  });

  it("取消与拒绝即使没有事件回推，也凭 decide 的返回值落态", async () => {
    await openChapter();
    store().startListening();
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p1") }) });
    nextDecision = { ok: false, reason: "cancelled", message: "已取消这条提案" };
    await store().decide("p1", "cancel", "");
    expect(store().proposals.p1?.status).toBe("cancelled");
    nextDecision = { ok: false, reason: "denied", message: "已拒绝" };
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("proposal", { proposal: proposal("p2") }) });
    await store().decide("p2", "deny-with-guidance", "别改节奏");
    expect(store().proposals.p2?.status).toBe("rejected");
    expect(store().proposals.p2?.message).toBe("别改节奏");
  });

  it("send 用当前活动章作线程键，没开标签时退回 unbound", async () => {
    store().send("写点啥");
    expect(started[0]).toEqual({ threadKey: UNBOUND, docRelPath: null, stageId: "draft", userText: "写点啥" });
    await openChapter();
    store().send("改这一章");
    expect(started[1]).toEqual({ threadKey: CH, docRelPath: CH, stageId: "draft", userText: "改这一章" });
    expect(threadKeyFor(null)).toBe(UNBOUND);
    expect(threadKeyFor(CH)).toBe(CH);
  });

  it("stop 打的是 turn-start 推来的那个 turnId；没有活动 turn 就不发", async () => {
    store().startListening();
    expect(await store().stop()).toBe(false);
    expect(interruptTurn).not.toHaveBeenCalled();
    await openChapter();
    push({ type: "turn-start", turnId: "t9", threadKey: CH });
    expect(await store().stop()).toBe(true);
    expect(interruptTurn).toHaveBeenCalledWith("t9");
    push({ type: "turn-end", turnId: "t9", threadKey: CH, status: "interrupted", message: "" });
    expect(await store().stop()).toBe(false);
  });

  it("tick 按最早开跑的线程计时；没有线程在跑就归零", async () => {
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "turn-start", turnId: "t2", threadKey: OTHER });
    vi.setSystemTime(new Date("2026-10-01T00:00:12.000Z"));
    store().tick();
    expect(store().seconds).toBe(12);
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    push({ type: "turn-end", turnId: "t2", threadKey: OTHER, status: "done", message: "" });
    store().tick();
    expect(store().seconds).toBe(0);
  });

  it("状态行四态：工作中 / 断了给原因 / 待审计数 / 就绪", () => {
    const running = { ...store().viewOf("x"), running: true };
    expect(composeStatusLine(running, 42, 0)).toBe("工作中 · 42s · Esc 打断");
    const idle = { ...store().viewOf("y"), running: false };
    expect(composeStatusLine(idle, 0, 3)).toBe("3 条待审");
    expect(composeStatusLine(idle, 0, 0)).toBe("就绪");
    expect(composeStatusLine(undefined, 0, 0)).toBe("就绪");
    // spec §6.3 第 3 条：打断后仍有未审批提案时，状态行必须还是「已打断 · N 条待审」。
    const cut = { ...idle, endedAs: "interrupted" as const };
    expect(composeStatusLine(cut, 0, 2)).toBe("已打断 · 2 条待审");
    expect(composeStatusLine(cut, 0, 0)).toBe("已打断 · 可点「继续」");
    const failed = { ...idle, endedAs: "failed" as const, lastError: "模型服务端返回 503：上游繁忙" };
    expect(composeStatusLine(failed, 0, 0)).toBe("模型服务端返回 503：上游繁忙 · 可点「继续」");
  });

  it("turn-end failed 与 error 事件都只留在出事的线程里", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "event", turnId: "t1", threadKey: CH, event: eventOf("error", { message: "锚点在正文里出现两次" }) });
    expect(store().viewOf(CH).lastError).toBe("锚点在正文里出现两次");
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "failed", message: "模型服务端返回 503：繁忙" });
    expect(store().viewOf(CH).lastError).toContain("503");
    expect(store().viewOf(CH).running).toBe(false);
    expect(store().viewOf(OTHER).lastError).toBe("");
  });

  it("断了才有「继续」：interrupted / failed 给入口，done、运行中与没跑过都不给", async () => {
    await openChapter();
    store().startListening();
    expect(store().canContinue(CH)).toBe(false);
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    expect(store().canContinue(CH)).toBe(false);
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    expect(store().canContinue(CH)).toBe(false);
    push({ type: "turn-start", turnId: "t2", threadKey: CH });
    push({ type: "turn-end", turnId: "t2", threadKey: CH, status: "interrupted", message: "已打断" });
    expect(store().canContinue(CH)).toBe(true);
    push({ type: "turn-start", turnId: "t3", threadKey: CH });
    push({ type: "turn-end", turnId: "t3", threadKey: CH, status: "failed", message: "模型服务端返回 429" });
    expect(store().canContinue(CH)).toBe(true);
    expect(store().canContinue(OTHER)).toBe(false);
  });

  it("「继续」发的是固定指令且断了才发得出去，不是把上一句原样重发", async () => {
    await openChapter();
    store().startListening();
    store().continueTurn();
    expect(started).toEqual([]);
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "interrupted", message: "已打断" });
    store().continueTurn();
    expect(started.at(-1)?.userText).toContain("接着上一轮未写完的地方继续");
    expect(started.at(-1)?.docRelPath).toBe(CH);
  });
});
```

- [x] **Step 3：追加红的 `useBookStore.test.ts` 用例（吸收智能体写盘）**

在既有用例后追加三条（`readDoc` 夹具按 `relPath` 返回内容，已在文件顶部定义）：

```ts
  it("智能体写盘后：干净草稿直接同步盘上内容与新指纹", async () => {
    readDoc.mockResolvedValueOnce({ relPath: "chapters/01-a.md", content: "智能体改过的\n", fingerprint: "fp-b" });
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.absorbAgentWrite("chapters/01-a.md", "fp-b");
    expect(store.draft).toBe("智能体改过的\n");
    expect(store.savedFingerprint).toBe("fp-b");
    expect(store.dirty).toBe(false);
    expect(store.notice).toContain("草稿已同步");
  });

  it("智能体写盘撞上未保存手改：草稿一字不动，标冲突让人决定", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("我还没保存的一段\n");
    await store.absorbAgentWrite("chapters/01-a.md", "fp-z");
    expect(store.draft).toBe("我还没保存的一段\n");
    expect(store.conflict?.currentFingerprint).toBe("fp-z");
    expect(store.notice).toContain("未保存修改没有丢");
  });

  it("写的是非活动标签：不动当前草稿，只作废那一路暂存副本让下次重读", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.openDocTab("chapters/02-b.md");
    readDoc.mockClear();
    await store.absorbAgentWrite("chapters/01-a.md", "fp-c");
    expect(store.draft).toBe("正文\n");
    expect(store.draftsByPath["chapters/01-a.md"]).toBeUndefined();
    expect(readDoc).not.toHaveBeenCalled();
  });
```

- [x] **Step 4：跑一次，确认三处都红**

Run: `corepack pnpm vitest run apps/desktop/src/renderer --maxWorkers=4`
Expected: FAIL —— `resolveEscape`、`useAgentStore`、`absorbAgentWrite` 三者都不存在
（模块解析失败或方法 `is not a function`）。必须先看到红，再进 Step 5。

- [x] **Step 5：`escape-policy.ts`**

```ts
export type EscapeAction = "keep-guidance" | "cancel-proposal" | "interrupt" | "none";

export interface EscapeFocusState {
  hasFocusedProposal: boolean;
  focusedProposalPending: boolean;
  guidanceIsDirty: boolean;
  turnRunning: boolean;
}

/**
 * spec §6.2 的唯一裁决入口：审批卡优先于打断，打断优先于无动作。
 * 说明框已有字时先保住字（只失焦）——绝不吞掉用户输入。
 */
export function resolveEscape(state: EscapeFocusState): EscapeAction {
  if (state.hasFocusedProposal && state.focusedProposalPending)
    return state.guidanceIsDirty ? "keep-guidance" : "cancel-proposal";
  if (state.turnRunning) return "interrupt";
  return "none";
}
```

- [x] **Step 6：`useBookStore.ts` 追加 `absorbAgentWrite`**

放在 `reloadActive` 之后（复用同一份重载语义）：

```ts
    /**
     * 把智能体写入的盘上事实吸收进右栏。
     * 干净草稿：作废暂存副本，活动标签立刻重载。
     * 有未保存手改：绝不覆盖用户草稿，改成报冲突，由人决定重载还是另存。
     */
    async absorbAgentWrite(relPath: string, fingerprint: string): Promise<void> {
      const stashed = this.draftsByPath[relPath];
      if (stashed?.dirty) {
        this.draftsByPath[relPath] = { ...stashed, conflict: { currentFingerprint: fingerprint } };
        if (this.activeDocTab === relPath) this.conflict = { currentFingerprint: fingerprint };
        this.notice = "智能体改写了本章，你的未保存修改没有丢；确认后重载再手工合并";
        return;
      }
      delete this.draftsByPath[relPath];
      if (this.activeDocTab === relPath) {
        await this.reloadActive();
        this.notice = "智能体已写入本章，草稿已同步";
      } else this.notice = "智能体已写入本章";
    },
```

- [x] **Step 7：`useAgentStore.ts`**

```ts
import { defineStore } from "pinia";
import type {
  AgentEvent,
  AgentOutbound,
  DecideInput,
  DecisionResult,
  EditProposal,
  ProposalDecision,
  ProposalStatus,
  StartTurnInput,
  TurnEndStatus
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

/** 与主进程 agent-service.ts 的同名常量必须一致。 */
export const UNBOUND = "unbound";

/** 「继续」按钮发出的固定指令：残字已随 interrupted 事件进历史，模型接着写而不是重来。 */
const CONTINUE_TEXT = "接着上一轮未写完的地方继续，不要重复已经写出的内容。";

export interface ThreadView {
  turnId: string | null;
  running: boolean;
  startedAt: number;
  /** 已落盘的持久事件，按到达顺序渲染。 */
  items: AgentEvent[];
  /** 流式残字：对应事件落库后归零，永不与定稿正文重复显示。 */
  streaming: { reasoning: string; message: string };
  lastError: string;
  /** 上一轮怎么收场的——决定「继续」按钮是否出现（spec §9 第 4 行）。 */
  endedAs: "" | TurnEndStatus;
}

export interface ProposalView {
  proposal: EditProposal;
  status: ProposalStatus;
  message: string;
  diff: string;
}

const EMPTY_STREAM = { reasoning: "", message: "" };

function newThread(): ThreadView {
  return {
    turnId: null,
    running: false,
    startedAt: 0,
    items: [],
    streaming: { ...EMPTY_STREAM },
    lastError: "",
    endedAs: ""
  };
}

export function threadKeyFor(activeDocTab: string | null): string {
  return activeDocTab ?? UNBOUND;
}

/** 状态行文案（spec §7 的运行态、§6.3 的打断残留、§9 第 4 行的中断原因）。 */
export function composeStatusLine(
  thread: ThreadView | undefined,
  seconds: number,
  pending: number
): string {
  if (thread?.running) return `工作中 · ${seconds}s · Esc 打断`;
  if (thread && thread.endedAs !== "" && thread.endedAs !== "done") {
    const head =
      thread.endedAs === "failed" ? (thread.lastError === "" ? "上一轮失败" : thread.lastError) : "已打断";
    return `${head} · ${pending > 0 ? `${pending} 条待审` : "可点「继续」"}`;
  }
  if (pending > 0) return `${pending} 条待审`;
  return "就绪";
}

export const useAgentStore = defineStore("agent", {
  state: () => ({
    threads: {} as Record<string, ThreadView>,
    proposals: {} as Record<string, ProposalView>,
    notice: "",
    seconds: 0,
    listening: false
  }),

  getters: {
    pendingOf: (state) => (threadKey: string): number =>
      Object.values(state.proposals).filter(
        (view) => view.proposal.threadKey === threadKey && view.status === "pending"
      ).length,

    /** 只有「上一轮断了且现在没在跑」才允许继续；正在跑时点继续会并发两轮。 */
    canContinue: (state) => (threadKey: string): boolean => {
      const thread = state.threads[threadKey];
      if (!thread || thread.running) return false;
      return thread.endedAs === "interrupted" || thread.endedAs === "failed";
    }
  },

  actions: {
    viewOf(threadKey: string): ThreadView {
      const existing = this.threads[threadKey];
      if (existing) return existing;
      const created = newThread();
      this.threads[threadKey] = created;
      return created;
    },

    /** 中栏唯一的订阅入口：装配处挂载时调一次，重复调用不叠加监听。 */
    startListening(): void {
      if (this.listening) return;
      this.listening = true;
      window.mochen.onAgentEvent((payload) => {
        this.apply(payload);
      });
    },

    apply(outbound: AgentOutbound): void {
      const thread = this.viewOf(outbound.threadKey);
      if (outbound.type === "turn-start") {
        thread.turnId = outbound.turnId;
        thread.running = true;
        thread.startedAt = Date.now();
        thread.streaming = { ...EMPTY_STREAM };
        thread.lastError = "";
        thread.endedAs = "";
        this.seconds = 0;
        return;
      }
      if (outbound.type === "delta") {
        thread.streaming[outbound.deltaKind] += outbound.text;
        return;
      }
      if (outbound.type === "event") {
        this.reduceEvent(thread, outbound.event);
        return;
      }
      thread.running = false;
      thread.turnId = null;
      thread.streaming = { ...EMPTY_STREAM };
      thread.endedAs = outbound.status;
      if (outbound.status === "failed") thread.lastError = outbound.message;
    },

    reduceEvent(thread: ThreadView, event: AgentEvent): void {
      thread.items.push(event);
      if (event.type === "reasoning") {
        thread.streaming.reasoning = "";
        return;
      }
      if (event.type === "message") {
        thread.streaming.message = "";
        return;
      }
      if (event.type === "proposal") {
        this.proposals[event.proposal.id] = {
          proposal: event.proposal,
          status: "pending",
          message: "",
          diff: ""
        };
        void this.loadDiff(event.proposal.id);
        return;
      }
      if (event.type === "error") {
        thread.lastError = event.message;
        return;
      }
      if (event.type === "written") {
        const written = this.proposals[event.proposalId];
        if (written) {
          written.status = "written";
          written.message = "";
        }
        this.notice = `已写入 ${event.docRelPath}${event.backupRelPath ? "，原稿已备份" : ""}`;
        void useBookStore().absorbAgentWrite(event.docRelPath, event.fingerprint);
        return;
      }
      if (event.type !== "decision") return;
      const view = this.proposals[event.proposalId];
      if (!view) return;
      // 批准类的终态由 written / decide 返回值落，这里只处理两种即时裁决。
      if (event.decision === "cancel") view.status = "cancelled";
      if (event.decision === "deny-with-guidance") {
        view.status = "rejected";
        view.message = event.guidance;
      }
    },

    async loadDiff(proposalId: string): Promise<void> {
      const view = this.proposals[proposalId];
      if (!view) return;
      view.diff = await window.mochen.proposalDiff(proposalId);
    },

    /**
     * 中栏唯一的审批出口：主进程是唯一写盘通路，这里只反映结果。
     * 成功等 written 事件；失败一律保持 pending（spec §9：写盘失败可重试）。
     */
    async decide(proposalId: string, decision: ProposalDecision, guidance: string): Promise<void> {
      const input: DecideInput = { proposalId, decision, guidance };
      const result: DecisionResult = await window.mochen.decideProposal(input);
      const view = this.proposals[proposalId];
      if (result.ok || !view) return;
      if (result.reason === "stale") view.status = "stale";
      if (result.reason === "cancelled") view.status = "cancelled";
      if (result.reason === "denied") {
        view.status = "rejected";
        view.message = guidance;
      }
      if (result.reason === "permission-denied" || result.reason === "io" || result.reason === "not-pending")
        view.message = result.message;
    },

    send(text: string): void {
      const book = useBookStore();
      const input: StartTurnInput = {
        threadKey: threadKeyFor(book.activeDocTab),
        docRelPath: book.activeDocTab,
        stageId: book.meta?.activeStage ?? "draft",
        userText: text
      };
      // startTurn 的 promise 要等整轮跑完才兑现；turnId 走 turn-start 推送，这里不等。
      window.mochen.startTurn(input).catch(() => {
        this.notice = "这一轮没能启动，检查模型设置。";
      });
    },

    /** spec §9 第 4 行「支持继续」：只在断了的那条线程上生效。 */
    continueTurn(): void {
      if (!this.canContinue(threadKeyFor(useBookStore().activeDocTab))) return;
      this.send(CONTINUE_TEXT);
    },

    async stop(): Promise<boolean> {
      const thread = this.threads[threadKeyFor(useBookStore().activeDocTab)];
      const turnId = thread?.turnId;
      if (!turnId) return false;
      return window.mochen.interruptTurn(turnId);
    },

    tick(): void {
      const running = Object.values(this.threads).filter((thread) => thread.running);
      if (running.length === 0) {
        this.seconds = 0;
        return;
      }
      const earliest = Math.min(...running.map((thread) => thread.startedAt));
      this.seconds = Math.max(0, Math.floor((Date.now() - earliest) / 1000));
    }
  }
});
```

- [x] **Step 8：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/renderer --maxWorkers=4`
Expected: PASS —— `escape-policy` 6 用例、`useAgentStore` 16 用例、`useBookStore` 原 11 + 新 3 = 14 用例。
Run: `corepack pnpm typecheck` → 无诊断。

> 若「proposal 事件登记成待审卡」卡在 `await vi.runAllTimersAsync()`，先查 `proposalDiff` 桩是否
> 真的返回 promise；fake timers 下未兑现的微任务要靠 `runAllTimersAsync` 才排空。

- [x] **Step 9：变异实验（逐条做完立刻恢复）**

| 抽掉的实现 | 必须转红的用例 |
|---|---|
| `reduceEvent` 里 `thread.streaming.message = ""` | 「流式残字与定稿不重复」：正文出现两遍 |
| `apply` 的 `turn-end` 分支里 `thread.turnId = null` | 「stop 打的是 turn-start 推来的那个 turnId」：跑完还能再打断 |
| `decide` 里 `result.reason === "stale"` 那行 | 「指纹过期（stale）落『文件已变动』」 |
| `decide` 里 `permission-denied / io` 的 message 赋值 | 「写盘失败（io）与权限收紧都保持待审并显示原因」 |
| `reduceEvent` 里 written 分支的 `absorbAgentWrite` 调用 | 「written：卡片落已写入，并把新指纹交给 book store 吸收」 |
| `absorbAgentWrite` 的 `stashed?.dirty` 分支 | 「智能体写盘撞上未保存手改」：用户草稿被覆盖 |
| `resolveEscape` 的 `guidanceIsDirty` 判定 | 「聚焦待审卡且说明非空：只失焦，不清字」 |
| `startListening` 的 `if (this.listening) return` | 「startListening 幂等」：多订阅导致 items 翻倍 |
| `apply` 的 `turn-end` 分支里 `thread.endedAs = outbound.status` | 「断了才有『继续』」：done 与 interrupted 分不开，按钮常在或永不出 |
| `continueTurn` 的 `canContinue` 前置判断 | 「『继续』发的是固定指令且断了才发得出去」：运行中也能再起一轮 |

Run: `git diff --exit-code apps/desktop/src/renderer` —— 恢复后必须为空。

- [x] **Step 10：提交**

```bash
git add apps/desktop/src/renderer
git commit -m "feat(renderer): 智能体事件归约、线程隔离与写盘回吸收"
```

---
## Task 14：中栏 UI —— 四层流式渲染、提案卡、输入区与模型设置

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/timeline.ts`、`utils/timeline.test.ts`
- Create: `components/AgentTimeline.vue`、`components/ProposalCard.vue`、`components/ComposerBox.vue`、
  `components/ProviderSettings.vue`
- Create: `styles/agent-pane.css`
- Modify: `styles.css`（追加 `@import`）、`components/CenterColumn.vue`（整文件重写）

**Interfaces:**
- Consumes: `AgentEvent`/`ProposalDecision`/`PROPOSAL_STATUS_LABELS`/`ProviderDraft`/`ProviderView`（Task 1）、
  `useAgentStore`/`ThreadView`/`ProposalView`/`composeStatusLine`/`threadKeyFor`/`canContinue`/`continueTurn`/`resolveEscape`（Task 13）、
  `window.mochen.providerView` / `providerSave`（Task 12）、`AppIcon.vue` 与 `IconName`（Plan 1）
- Produces:
  - `TimelineBlock` 判别联合（`user` / `thinking` / `plan` / `message` / `tool` / `error` / `interrupted`）、
    `buildTimeline(items: AgentEvent[], tail: StreamingTail): TimelineBlock[]`、`TOOL_LABELS`
  - 组件（仅供 CenterColumn 装配，无跨任务接口）：`AgentTimeline`、`ProposalCard`、`ComposerBox`、`ProviderSettings`

> `.vue` 文件在本仓库拿不到单测手段：没装 `@vue/test-utils`，也没有 jsdom/happy-dom，
> Plan 2 不允许新增 npm 依赖，而 `vitest.config.ts` 的 `environment` 是 `node`。
> 所以把**唯一需要判断力的部分（事件 → 四层时间线的归约）抽成纯函数 `timeline.ts` 并单测**，
> `.vue` 只做展示与事件转发；`.vue` 的正确性由 `corepack pnpm build`（编译 SFC，模板写错就红）
> 与 Task 15 的真实冒烟兜住。别把逻辑留在 `.vue` 里——那是这条线唯一能失败的地方。

- [x] **Step 1：写红的 `timeline.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import { buildTimeline, TOOL_LABELS } from "./timeline";

function event(type: AgentEvent["type"], rest: Record<string, unknown> = {}): AgentEvent {
  return { id: `e-${type}`, ts: "2026-10-01T00:00:00.000Z", turnId: "t1", type, ...rest } as AgentEvent;
}

const NO_TAIL = { reasoning: "", message: "" };

describe("buildTimeline", () => {
  it("用户消息单独一层，排在最前", () => {
    const blocks = buildTimeline([event("user-message", { text: "把这段改得有雾气" })], NO_TAIL);
    expect(blocks).toEqual([{ kind: "user", id: "e-user-message", text: "把这段改得有雾气" }]);
  });

  it("思考与正文按到达顺序成层，打断标记保留", () => {
    const blocks = buildTimeline(
      [
        event("reasoning", { text: "先读前后文", interrupted: false }),
        event("message", { text: "海雾涌上来。", interrupted: true })
      ],
      NO_TAIL
    );
    expect(blocks.map((block) => block.kind)).toEqual(["thinking", "message"]);
    expect(blocks[1]).toMatchObject({ text: "海雾涌上来。", interrupted: true, streaming: false });
  });

  it("提案/裁决/写入不进时间线——它们只活在提案卡上", () => {
    const blocks = buildTimeline(
      [
        event("proposal", { proposal: {} }),
        event("decision", { proposalId: "p1", decision: "accept-once", guidance: "", auto: false }),
        event("written", { proposalId: "p1", docRelPath: "a.md", fingerprint: "fp", backupRelPath: null })
      ],
      NO_TAIL
    );
    expect(blocks).toEqual([]);
  });

  it("连续 plan 事件合并成一块，以最后一份清单为准", () => {
    const blocks = buildTimeline(
      [
        event("plan", { items: [{ text: "读上下文", done: true }] }),
        event("plan", { items: [{ text: "读上下文", done: true }, { text: "改第三段", done: false }] })
      ],
      NO_TAIL
    );
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatchObject({ kind: "plan", items: [{ text: "读上下文", done: true }, { text: "改第三段", done: false }] });
  });

  it("plan 被正文隔开后不再合并，两份清单各自成块", () => {
    const blocks = buildTimeline(
      [
        event("plan", { items: [{ text: "甲", done: false }] }),
        event("message", { text: "先说一句", interrupted: false }),
        event("plan", { items: [{ text: "乙", done: false }] })
      ],
      NO_TAIL
    );
    expect(blocks.map((block) => block.kind)).toEqual(["plan", "message", "plan"]);
  });

  it("工具调用成卡：中文名、入参、失败也保留结果文本", () => {
    const blocks = buildTimeline(
      [event("tool-call", { callId: "c1", tool: "search_docs", args: '{"query":"雾"}', ok: false, resultText: "锚点不唯一" })],
      NO_TAIL
    );
    expect(blocks[0]).toEqual({
      kind: "tool",
      id: "e-tool-call",
      label: TOOL_LABELS.search_docs,
      args: '{"query":"雾"}',
      ok: false,
      resultText: "锚点不唯一"
    });
    expect(TOOL_LABELS.search_docs).toBe("全书检索");
  });

  it("错误与打断各自成块，打断块带待审计数", () => {
    const blocks = buildTimeline(
      [event("error", { message: "模型服务端返回 503：繁忙" }), event("interrupted", { pendingProposals: 2 })],
      NO_TAIL
    );
    expect(blocks[0]).toEqual({ kind: "error", id: "e-error", text: "模型服务端返回 503：繁忙" });
    expect(blocks[1]).toEqual({ kind: "interrupted", id: "e-interrupted", pending: 2 });
  });

  it("流式残字只在非空时出现，且永远排在末尾", () => {
    const blocks = buildTimeline([event("message", { text: "定稿", interrupted: false })], {
      reasoning: "   ",
      message: "正在写"
    });
    expect(blocks.map((block) => block.kind)).toEqual(["message", "message"]);
    expect(blocks[1]).toMatchObject({ streaming: true, text: "正在写" });
    expect(buildTimeline([], { reasoning: "在想", message: "" })).toEqual([
      { kind: "thinking", id: "tail-thinking", text: "在想", streaming: true, interrupted: false }
    ]);
  });

  it("块 id 不重复：v-for 的 key 撞车就是渲染错位", () => {
    const blocks = buildTimeline(
      [
        event("user-message", { text: "甲" }),
        event("reasoning", { text: "乙", interrupted: false }),
        event("tool-call", { callId: "c1", tool: "read_doc", args: "{}", ok: true, resultText: "" })
      ],
      { reasoning: "丙", message: "丁" }
    );
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  });
});
```

- [x] **Step 2：跑红**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/timeline.test.ts --maxWorkers=4`
Expected: FAIL —— `buildTimeline` 不存在。

- [x] **Step 3：`timeline.ts`**

```ts
import type { AgentEvent } from "@mochen/contracts";

export interface StreamingTail {
  reasoning: string;
  message: string;
}

export interface PlanItemView {
  text: string;
  done: boolean;
}

export type TimelineBlock =
  | { kind: "user"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string; streaming: boolean; interrupted: boolean }
  | { kind: "plan"; id: string; items: PlanItemView[] }
  | { kind: "message"; id: string; text: string; streaming: boolean; interrupted: boolean }
  | { kind: "tool"; id: string; label: string; args: string; ok: boolean; resultText: string }
  | { kind: "error"; id: string; text: string }
  | { kind: "interrupted"; id: string; pending: number };

/** 工具卡的中文标签（中栏给用户看的名字，不是工具 id）。 */
export const TOOL_LABELS: Record<string, string> = {
  read_doc: "读取文档",
  list_docs: "列出文档",
  search_docs: "全书检索",
  propose_patch: "提出改稿提案",
  write_doc: "写入文档"
};

/**
 * 持久事件 → 四层时间线（思考摘要 / 计划 / 正文 / 工具卡）。
 * 提案、裁决、写入三类事件刻意不进时间线：它们只挂在对应的提案卡上，
 * 免得同一件事在中栏出现两遍（spec §4 的中栏分工）。
 */
export function buildTimeline(items: AgentEvent[], tail: StreamingTail): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const event of items) {
    if (event.type === "user-message") {
      blocks.push({ kind: "user", id: event.id, text: event.text });
      continue;
    }
    if (event.type === "reasoning") {
      blocks.push({
        kind: "thinking",
        id: event.id,
        text: event.text,
        streaming: false,
        interrupted: event.interrupted
      });
      continue;
    }
    if (event.type === "plan") {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "plan") {
        last.items = event.items;
        last.id = event.id;
        continue;
      }
      blocks.push({ kind: "plan", id: event.id, items: event.items });
      continue;
    }
    if (event.type === "message") {
      blocks.push({
        kind: "message",
        id: event.id,
        text: event.text,
        streaming: false,
        interrupted: event.interrupted
      });
      continue;
    }
    if (event.type === "tool-call") {
      blocks.push({
        kind: "tool",
        id: event.id,
        label: TOOL_LABELS[event.tool] ?? event.tool,
        args: event.args,
        ok: event.ok,
        resultText: event.resultText
      });
      continue;
    }
    if (event.type === "error") {
      blocks.push({ kind: "error", id: event.id, text: event.message });
      continue;
    }
    if (event.type === "interrupted") {
      blocks.push({ kind: "interrupted", id: event.id, pending: event.pendingProposals });
    }
  }
  if (tail.reasoning.trim() !== "")
    blocks.push({ kind: "thinking", id: "tail-thinking", text: tail.reasoning, streaming: true, interrupted: false });
  if (tail.message.trim() !== "")
    blocks.push({ kind: "message", id: "tail-message", text: tail.message, streaming: true, interrupted: false });
  return blocks;
}
```

> `last.items = event.items` 之后又改 `last.id`：id 变了会让 Vue 重建这块（清单重排一次），
> 这是可接受的——计划本就是一份份覆盖。不要为了保住 id 把两块计划连成无限增长清单。

- [x] **Step 4：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils --maxWorkers=4`
Expected: PASS（9 用例）。

- [x] **Step 5：`AgentTimeline.vue`（纯展示，无逻辑）**

```vue
<!-- 中栏四层流式渲染：类名沿用 deepwrite 的 message/message-body（见 ATTRIBUTION.md），卡片样式自有 -->
<script setup lang="ts">
import { computed } from "vue";
import type { AgentEvent } from "@mochen/contracts";
import { buildTimeline, type StreamingTail, type TimelineBlock } from "../utils/timeline";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ items: AgentEvent[]; tail: StreamingTail }>();
const blocks = computed<TimelineBlock[]>(() => buildTimeline(props.items, props.tail));
</script>

<template>
  <div class="agent-timeline">
    <section v-for="block in blocks" :key="block.id" class="agent-block" :data-kind="block.kind">
      <div v-if="block.kind === 'user'" class="user-line">
        <span class="user-tag">你</span>
        <p class="user-text">{{ block.text }}</p>
      </div>

      <details v-else-if="block.kind === 'thinking'" class="thinking-card" :open="block.streaming">
        <summary>
          <AppIcon name="brain" :size="15" />
          <span>思考摘要</span>
          <em v-if="block.interrupted" class="tail-flag">已打断</em>
          <em v-else-if="block.streaming" class="tail-flag is-live">正在想</em>
        </summary>
        <p class="thinking-text">{{ block.text }}</p>
      </details>

      <div v-else-if="block.kind === 'plan'" class="plan-card">
        <header class="card-head">
          <AppIcon name="list" :size="15" />
          <span>计划</span>
        </header>
        <ul class="plan-list">
          <li v-for="(item, index) in block.items" :key="`${block.id}-${index}`" :class="{ 'is-done': item.done }">
            <AppIcon :name="item.done ? 'check' : 'minus'" :size="13" />
            <span>{{ item.text }}</span>
          </li>
        </ul>
      </div>

      <div v-else-if="block.kind === 'tool'" class="tool-card" :class="{ 'is-failed': !block.ok }">
        <header class="card-head">
          <AppIcon name="terminal" :size="15" />
          <span class="tool-label">{{ block.label }}</span>
          <em>{{ block.ok ? "完成" : "未通过" }}</em>
        </header>
        <p v-if="block.args" class="tool-args">{{ block.args }}</p>
        <pre v-if="block.resultText" class="tool-result">{{ block.resultText }}</pre>
      </div>

      <p v-else-if="block.kind === 'error'" class="error-line">{{ block.text }}</p>

      <p v-else-if="block.kind === 'interrupted'" class="interrupted-line">
        已打断 · {{ block.pending }} 条提案仍在等待审批
      </p>

      <div v-else class="message-line" :class="{ 'is-streaming': block.streaming }">
        <div class="message-body">
          <div class="message-content message-markdown">
            <p class="message-text">{{ block.text }}</p>
            <em v-if="block.interrupted" class="tail-flag">已打断</em>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
```

- [x] **Step 6：`ProposalCard.vue`（含 spec §6.2 的 Esc 第一优先级）**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { PROPOSAL_STATUS_LABELS, type ProposalDecision } from "@mochen/contracts";
import type { ProposalView } from "../stores/useAgentStore";
import { resolveEscape } from "../utils/escape-policy";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ view: ProposalView; running: boolean }>();
const emit = defineEmits<{
  decide: [decision: ProposalDecision, guidance: string];
  interrupt: [];
}>();

const guidance = ref("");
const pending = computed(() => props.view.status === "pending");
const statusLabel = computed(() => PROPOSAL_STATUS_LABELS[props.view.status]);
const modeLabel = computed(() => (props.view.proposal.mode === "doc-overwrite" ? "整篇替换" : "锚点替换"));

function decide(decision: ProposalDecision): void {
  if (decision === "deny-with-guidance" && guidance.value.trim() === "") return;
  emit("decide", decision, guidance.value);
}

/** 卡内 Esc 先按 §6.2 裁决；落不到卡上的动作往上抛，由中栏处理打断。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const action = resolveEscape({
    hasFocusedProposal: true,
    focusedProposalPending: pending.value,
    guidanceIsDirty: guidance.value.trim() !== "",
    turnRunning: props.running
  });
  if (action === "none") return;
  event.preventDefault();
  event.stopPropagation();
  if (action === "keep-guidance") {
    (event.target as HTMLElement | null)?.blur();
    return;
  }
  if (action === "cancel-proposal") decide("cancel");
  if (action === "interrupt") emit("interrupt");
}
</script>

<template>
  <article
    class="proposal-card"
    :class="[`is-${view.status}`, { 'is-focused': pending }]"
    tabindex="0"
    @keydown="onKeydown"
  >
    <header class="card-head">
      <AppIcon name="replace" :size="15" />
      <span class="proposal-title">{{ view.proposal.docRelPath }}</span>
      <span class="proposal-mode">{{ modeLabel }}</span>
      <span class="proposal-status">{{ statusLabel }}</span>
    </header>

    <p class="proposal-why">{{ view.proposal.why }}</p>
    <pre v-if="view.diff" class="proposal-diff">{{ view.diff }}</pre>
    <p v-else class="proposal-diff-empty">diff 尚未取回</p>
    <p v-if="view.proposal.anchor && view.proposal.mode === 'anchor-replace'" class="proposal-anchor">
      锚点：{{ view.proposal.anchor }}
    </p>
    <p v-if="view.message" class="proposal-message">{{ view.message }}</p>

    <footer v-if="pending" class="proposal-actions">
      <textarea
        v-model="guidance"
        class="guidance-box"
        rows="2"
        placeholder="拒绝时写清该怎么改（Shift+Enter 换行，Esc 先保住这段字）"
      />
      <div class="proposal-buttons">
        <button class="is-primary" type="button" @click="decide('accept-once')">仅这一次批准</button>
        <button type="button" @click="decide('accept-session')">本章不再问</button>
        <button type="button" @click="decide('accept-prefix')">同文档同类改动不再问</button>
        <button
          class="is-danger"
          type="button"
          :disabled="guidance.trim() === ''"
          @click="decide('deny-with-guidance')"
        >
          拒绝并说明
        </button>
        <button type="button" @click="decide('cancel')">取消（Esc）</button>
      </div>
    </footer>
  </article>
</template>
```

> `deny-with-guidance` 在两处都设了闸：按钮 `:disabled` 与 `decide()` 的早退。主进程的
> `decideInputSchema` 是第三道（Task 1）。少一道都能被绕过——这是 spec §6 的 `d` 语义。

- [x] **Step 7：`ComposerBox.vue`**

```vue
<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "./AppIcon.vue";

defineProps<{ running: boolean; ready: boolean; canContinue: boolean }>();
const emit = defineEmits<{ send: [text: string]; stop: []; resume: [] }>();

const text = ref("");

function submit(): void {
  const value = text.value.trim();
  if (value === "") return;
  text.value = "";
  emit("send", value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    if (event.shiftKey || event.ctrlKey) {
      event.preventDefault();
      text.value += "\n";
      return;
    }
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <footer class="agent-composer">
    <textarea
      v-model="text"
      class="composer-box"
      rows="3"
      :placeholder="
        ready
          ? '想改哪一段？说给人话，别贴整篇正文——它会自己读文件。'
          : '先在左栏打开作品，或在右上角设置里配好模型。'
      "
      @keydown="onKeydown"
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
        :disabled="running || text.trim() === ''"
        @click="submit()"
      >
        <AppIcon name="arrow-up" :size="15" />
        <span>发送</span>
      </button>
    </div>
  </footer>
</template>
```

> `Shift+Enter` 走的是「在末尾补一个换行」，不是光标处插入——`textarea` 要拿 `selectionStart`
> 才做得到，那是 Plan 3 的键位打磨范围。`Ctrl+J` 在此与 `Shift+Enter` 同义（spec §7）。

- [x] **Step 8：`ProviderSettings.vue`（spec §8 的唯一入口）**

```vue
<!-- 弹窗骨架取自 deepwrite 的 dialog-backdrop / workspace-dialog / dialog-actions -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ProviderDraft, ProviderView } from "@mochen/contracts";

const emit = defineEmits<{ close: [] }>();

const baseURL = ref("");
const model = ref("");
const apiKey = ref("");
const view = ref<ProviderView | null>(null);
const error = ref("");

async function load(): Promise<void> {
  view.value = await window.mochen.providerView();
  baseURL.value = view.value.baseURL;
  model.value = view.value.model;
}

async function save(): Promise<void> {
  error.value = "";
  const draft: ProviderDraft = {
    baseURL: baseURL.value.trim(),
    model: model.value.trim(),
    // 空串 = 保留现有密钥：渲染层永远拿不回已存的明文。
    apiKey: apiKey.value.trim() === "" ? null : apiKey.value.trim()
  };
  try {
    view.value = await window.mochen.providerSave(draft);
    apiKey.value = "";
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section class="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-title">
        <header>
          <div>
            <span class="dialog-eyebrow">只在本机</span>
            <h2 id="provider-title">模型设置</h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭模型设置" @click="emit('close')">
            ×
          </button>
        </header>
        <div class="dialog-content">
          <label class="provider-field">
            <span>baseURL（OpenAI 兼容，含 /v1）</span>
            <input v-model="baseURL" type="text" placeholder="http://127.0.0.1:8787/v1" />
          </label>
          <label class="provider-field">
            <span>模型名</span>
            <input v-model="model" type="text" placeholder="mochen-mock" />
          </label>
          <label class="provider-field">
            <span>密钥（留空则保留已存的那把）</span>
            <input v-model="apiKey" type="password" autocomplete="off" />
          </label>
          <p class="dialog-description">
            当前：{{ view ? `${view.baseURL} · ${view.model}` : "读取中" }}
            {{ view && view.hasKey ? ` · 密钥 ${view.keyMask}` : " · 尚未存密钥" }}
          </p>
          <p v-if="error" class="provider-error">{{ error }}</p>
          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="emit('close')">关闭</button>
            <button class="dialog-primary-button" type="button" @click="save()">保存</button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
```

- [x] **Step 9：`CenterColumn.vue` 整文件重写**

保留 Plan 1 的对外契约（props `leftCollapsed`/`rightCollapsed`，emits `toggleLeft`/`toggleRight`），
`App.vue` 不用改：

```vue
<!-- 中栏骨架（conversation-pane / conversation-header / conversation-scroll-shell / conversation-empty）
     取自 deepwrite（Apache-2.0）；卡片与时间线为自有。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { AgentEvent, ProposalDecision } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import AgentTimeline from "./AgentTimeline.vue";
import ProposalCard from "./ProposalCard.vue";
import ComposerBox from "./ComposerBox.vue";
import ProviderSettings from "./ProviderSettings.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { useBookStore } from "../stores/useBookStore";
import {
  composeStatusLine,
  threadKeyFor,
  useAgentStore,
  type ProposalView,
  type ThreadView
} from "../stores/useAgentStore";

defineProps<{ leftCollapsed: boolean; rightCollapsed: boolean }>();
const emit = defineEmits<{ toggleLeft: []; toggleRight: [] }>();

const book = useBookStore();
const agent = useAgentStore();
const showSettings = ref(false);
const EMPTY_ITEMS: AgentEvent[] = [];
const EMPTY_TAIL = { reasoning: "", message: "" };

const threadKey = computed(() => threadKeyFor(book.activeDocTab));
const thread = computed<ThreadView | undefined>(() => agent.threads[threadKey.value]);
const items = computed(() => thread.value?.items ?? EMPTY_ITEMS);
const tail = computed(() => thread.value?.streaming ?? EMPTY_TAIL);
const running = computed(() => thread.value?.running ?? false);
const pending = computed<ProposalView[]>(() =>
  Object.values(agent.proposals).filter((view) => view.proposal.threadKey === threadKey.value)
);
const statusLine = computed(() =>
  composeStatusLine(thread.value, agent.seconds, agent.pendingOf(threadKey.value))
);
const ready = computed(() => book.meta !== null);

const agentLabel = computed(() => {
  const stage = book.meta?.stages.find((item) => item.id === book.meta?.activeStage);
  return stage ? `${stage.name}智能体` : "未选择作品";
});
const contextTitle = computed(() => {
  if (!book.meta) return "无";
  const chapter = book.docs.find((doc) => doc.relPath === book.activeDocTab);
  return `${book.meta.title} · ${chapter ? chapter.title : "未打开章节"}`;
});
const permissionLabel = computed(() => {
  const mode = book.meta?.permissionMode ?? "read-only";
  return mode === "full-access" ? "全开" : mode === "chapter-write" ? "可改当前章" : "只读参考";
});

function decide(proposalId: string, decision: ProposalDecision, guidance: string): void {
  void agent.decide(proposalId, decision, guidance);
}

function onGlobalEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  // 卡内的 Esc 已在 ProposalCard 里 stopPropagation；走到这里只剩「打断」这一义（spec §6.2）。
  if (running.value) void agent.stop();
}

let timer: number | undefined;
onMounted(() => {
  agent.startListening();
  timer = window.setInterval(() => agent.tick(), 1000);
  document.addEventListener("keydown", onGlobalEscape);
});
onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
  document.removeEventListener("keydown", onGlobalEscape);
});
</script>

<template>
  <main class="conversation-pane" aria-label="智能体对话">
    <header class="conversation-header">
      <div class="conversation-heading-start">
        <button
          v-if="leftCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开左侧栏"
          @click="emit('toggleLeft')"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <div>
          <strong>{{ agentLabel }}</strong>
          <span class="context-caption">主上下文：{{ contextTitle }}</span>
        </div>
      </div>
      <div class="conversation-header-actions">
        <span class="permission-chip">{{ permissionLabel }}</span>
        <button class="header-text-button" type="button" @click="showSettings = true">
          <AppIcon name="settings" :size="15" />
          <span>模型设置</span>
        </button>
        <button
          v-if="rightCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开文本内容栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <div class="conversation-scroll-shell">
      <div class="conversation-scroll transient-scrollbar">
        <div v-if="items.length === 0 && !running && pending.length === 0" class="conversation-empty">
          <span class="empty-agent-mark">
            <img :src="brandMark" alt="" width="52" height="52" />
          </span>
          <h1>{{ agentLabel }}</h1>
          <p>
            说人话就行——它会自己读文档、给出逐条待审的改稿提案；
            你不点批准，它一个字也写不进作品目录。
          </p>
          <p v-if="thread?.lastError" class="error-line">{{ thread.lastError }}</p>
        </div>

        <div v-else class="message-list agent-column">
          <AgentTimeline :items="items" :tail="tail" />

          <div v-if="pending.length" class="proposal-stack">
            <ProposalCard
              v-for="card in pending"
              :key="card.proposal.id"
              :view="card"
              :running="running"
              @decide="(decision: ProposalDecision, guidance: string) => decide(card.proposal.id, decision, guidance)"
              @interrupt="agent.stop()"
            />
          </div>

          <p v-if="thread?.lastError" class="turn-error">{{ thread.lastError }}</p>
        </div>
      </div>
    </div>

    <div class="agent-statusbar">
      <span class="status-line">{{ statusLine }}</span>
      <span v-if="book.notice" class="status-note">{{ book.notice }}</span>
    </div>

    <ComposerBox
      :running="running"
      :ready="ready"
      :can-continue="agent.canContinue(threadKey)"
      @send="agent.send($event)"
      @stop="agent.stop()"
      @resume="agent.continueTurn()"
    />

    <ProviderSettings v-if="showSettings" @close="showSettings = false" />
  </main>
</template>
```

- [x] **Step 10：`styles/agent-pane.css` + `styles.css` 挂载**

新文件首行注明是自有样式（复用 deepwrite 的主题变量，不新造 deepwrite 那批类名），
在 `styles.css` 的 `@import` 序列里、`theme-runtime.css` 之前插一行：

> 只用 `styles.css` 的 `:root` 里已经定义的 token（`--text`/`--text-soft`/`--text-faint`/`--line`/
> `--line-soft`/`--hover`/`--selected`/`--editor`/`--focus`/`--danger*`/`--success*`/`--warning*`/
> `--neutral-solid*`/`--shadow-color`/`--ui-font`/`--code-font`）。deepwrite 原主题里的
> `--accent` / `--accent-soft` / `--accent-text` 本项目**没有定义**，写上去不报错、只会静默变透明——
> 强调色一律走 `--focus`（本仓库就是它映射到 `var(--accent, #5b82b8)`）。

```css
/* 本项目自有样式：中栏智能体卡片、提案卡、输入区与状态行。复用主题变量，未移植 deepwrite 类名。 */
.agent-column {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.agent-block {
  min-width: 0;
}

.user-line {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.user-tag {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--neutral-solid);
  color: var(--neutral-solid-contrast);
  font-size: 12px;
}

.user-text {
  color: var(--text);
  font-weight: 500;
  white-space: pre-wrap;
}

.thinking-card,
.plan-card,
.tool-card,
.proposal-card {
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: color-mix(in srgb, var(--sidebar) 62%, transparent);
  backdrop-filter: blur(10px) saturate(115%);
  box-shadow: 0 10px 26px -18px var(--shadow-color);
}

.thinking-card {
  padding: 0;
}

.thinking-card summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  color: var(--text-soft);
  cursor: pointer;
  font-size: 13px;
  list-style: none;
}

.thinking-card summary::-webkit-details-marker {
  display: none;
}

.thinking-text {
  padding: 0 12px 12px 34px;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
}

.tail-flag {
  margin-left: auto;
  color: var(--warning);
  font-size: 12px;
  font-style: normal;
}

.tail-flag.is-live {
  color: var(--focus);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--text-soft);
  font-size: 13px;
}

.card-head em {
  margin-left: auto;
  font-size: 12px;
  font-style: normal;
}

.plan-list {
  padding: 10px 12px;
}

.plan-list li {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 3px 0;
  color: var(--text-soft);
  font-size: 13px;
}

.plan-list li.is-done {
  color: var(--success);
  text-decoration: line-through;
}

.tool-card.is-failed {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--line-soft));
  background: var(--danger-soft);
}

.tool-label {
  color: var(--text);
  font-weight: 500;
}

.tool-args,
.tool-result {
  margin: 8px 12px;
  color: var(--text-faint);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  white-space: pre-wrap;
  word-break: break-all;
}

.tool-result {
  max-height: 180px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--editor) 80%, transparent);
  color: var(--text-soft);
}

.message-line .message-body {
  padding: 2px 0;
}

.message-text {
  color: var(--text);
  line-height: 1.85;
  white-space: pre-wrap;
}

.message-line.is-streaming .message-text::after {
  content: "▍";
  color: var(--focus);
}

.error-line,
.turn-error,
.interrupted-line {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
}

.error-line,
.turn-error {
  background: var(--danger-soft);
  color: var(--danger-text);
}

.interrupted-line {
  background: var(--warning-soft);
  color: var(--warning);
}

.proposal-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 6px;
}

.proposal-card {
  padding: 0;
}

.proposal-card:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--focus) 55%, transparent);
  outline-offset: 2px;
}

.proposal-title {
  color: var(--text);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
}

.proposal-mode {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--selected);
  color: var(--text-soft);
  font-size: 12px;
}

.proposal-status {
  margin-left: auto;
  color: var(--text-soft);
  font-size: 12px;
}

.proposal-card.is-written .proposal-status {
  color: var(--success);
}

.proposal-card.is-rejected .proposal-status,
.proposal-card.is-cancelled .proposal-status {
  color: var(--text-faint);
}

.proposal-card.is-stale .proposal-status,
.proposal-card.is-failed .proposal-status {
  color: var(--danger);
}

.proposal-why {
  padding: 10px 12px 0;
  color: var(--text);
  font-size: 13px;
}

.proposal-diff {
  max-height: 300px;
  margin: 10px 12px;
  padding: 10px;
  overflow: auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--editor) 82%, transparent);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.7;
  white-space: pre;
}

.proposal-diff-empty {
  padding: 10px 12px;
  color: var(--text-faint);
  font-size: 12px;
}

.proposal-anchor,
.proposal-message {
  padding: 0 12px 10px;
  color: var(--text-faint);
  font-size: 12px;
}

.proposal-message {
  color: var(--danger-text);
}

.proposal-actions {
  padding: 0 12px 12px;
}

.guidance-box {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--editor);
  font-size: 13px;
  resize: vertical;
}

.proposal-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 9px;
}

.proposal-buttons button {
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--editor);
  color: var(--text-soft);
  font-size: 12px;
}

.proposal-buttons button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.proposal-buttons .is-primary {
  border-color: transparent;
  background: var(--neutral-solid);
  color: var(--neutral-solid-contrast);
}

.proposal-buttons .is-danger {
  border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
  color: var(--danger-text);
}

.proposal-buttons button:disabled {
  opacity: 0.5;
}

.agent-statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 24px;
  border-top: 1px solid var(--line-soft);
  background: color-mix(in srgb, var(--sidebar) 70%, transparent);
  backdrop-filter: blur(8px);
  font-size: 12px;
}

.status-line {
  color: var(--text-soft);
}

.status-note {
  color: var(--text-faint);
}

.agent-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 24px 18px;
  border-top: 1px solid var(--line-soft);
}

.composer-box {
  width: 100%;
  min-height: 76px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--editor);
  line-height: 1.7;
  resize: vertical;
}

.composer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.composer-hint {
  margin-right: auto;
  color: var(--text-faint);
  font-size: 12px;
}

.composer-send,
.composer-stop,
.composer-resume {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 13px;
}

.composer-send {
  background: var(--neutral-solid);
  color: var(--neutral-solid-contrast);
}

.composer-send:disabled {
  opacity: 0.45;
}

.composer-stop {
  border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--line));
  background: var(--danger-soft);
  color: var(--danger-text);
}

.composer-resume {
  border: 1px solid color-mix(in srgb, var(--focus) 40%, var(--line));
  background: var(--hover);
  color: var(--text);
}

.permission-chip {
  padding: 2px 9px;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  color: var(--text-soft);
  font-size: 12px;
}

.provider-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
  color: var(--text-soft);
  font-size: 12px;
}

.provider-field input {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--editor);
}

.provider-error {
  margin-bottom: 10px;
  color: var(--danger-text);
  font-size: 12px;
}
```

- [x] **Step 11：编译与门禁**

Run: `corepack pnpm prettier --write apps/desktop/src/renderer`（`.vue` 的属性换行由它定，别硬猜格式）
Run: `corepack pnpm build`
Expected: 主进程 / preload / 渲染层三段都出包。`.vue` 的模板错误、图标名拼错、`defineProps`
类型不符只有这一步会报——`pnpm typecheck` 看不见 `.vue` 里的模板。
Run: `corepack pnpm verify` → 末行回读 `VERIFY_EXIT=0` 与用例总数（管道会吞掉门禁退出码，
`| tail` 报的是 `tail` 的码）。

- [x] **Step 12：变异实验（`timeline.ts` 是唯一可编程判定的地方）**

| 抽掉的实现 | 必须转红的用例 |
|---|---|
| plan 合并分支（`last.kind === "plan"`） | 「连续 plan 事件合并成一块」 |
| `proposal`/`decision`/`written` 不进时间线（改成 push 一个块） | 「提案/裁决/写入不进时间线」 |
| `tail.reasoning.trim() !== ""` 的空串判定 | 「流式残字只在非空时出现」 |
| `TOOL_LABELS[event.tool] ?? event.tool` 的兜底 | 工具卡用例（未知工具名直接 `undefined`） |
| 残字块 push 在循环之前 | 「永远排在末尾」+ id 唯一用例 |

Run: `git diff --exit-code apps/desktop/src/renderer` 恢复后必须为空。

- [x] **Step 13：提交**

```bash
git add apps/desktop/src/renderer
git commit -m "feat(renderer): 中栏四层流式渲染、逐条提案卡与模型设置入口"
```

---
## Task 15：端到端 —— 本地 SSE 桩服务 + 全链真写盘 + 真机三栏冒烟

**Files:**
- Create: `tools/mock-provider.mjs`、`tools/mock-provider.test.mjs`
- Create: `apps/desktop/src/main/turn-e2e.test.ts`
- Modify: 根 `package.json`（`mock-provider` / `smoke` 两条脚本，外加 `devDependencies` 里的
  `@mochen/agent-runtime` = `workspace:*`，理由见 Step 2）

**Interfaces:**
- Consumes: `streamChat`/`ProviderFetch`/`ProviderFetchInput`/`ProviderFetchResult`/`findLatestSession`/
  `readSession`（Task 2/3/6）、`createBookService`/`createCredentialStore`/`createProviderSettings`/
  `createAgentService`/`defaultPromptFor`（Task 9/10/11）、`toProviderFetch`（Task 11）
- Produces:
  - `tools/mock-provider.mjs`：`node tools/mock-provider.mjs --port <p> [--doc <relPath>]`，
    监听 `127.0.0.1:<p>`，提供 `POST /v1/chat/completions`（SSE）、`GET /__health`、`GET /__requests`
  - 根脚本：`corepack pnpm mock-provider`、`corepack pnpm smoke`

> 只有一个 SSE 服务端实现：桩本身是 `tools/mock-provider.mjs`，`tools/mock-provider.test.mjs`
> 与 `turn-e2e.test.ts` 都**以子进程 spawn 它**，走真实 socket。不要为了测试再写第二个假服务器——
> 两份假服务器会各自漂移，最后谁也没验过真的那条路。

- [x] **Step 1：`tools/mock-provider.mjs`**

关键字驱动，无状态：按最后一条 user 文本决定这一轮演什么，按 `messages` 里有没有 `role:"tool"`
决定是第一轮还是收尾轮。SSE 帧**故意从中间切成两次 `res.write`**——那才是真实端点会干的事
（`sse.ts` 的缓冲只有在这种输入下才算被验过）。

```js
#!/usr/bin/env node
import { createServer } from "node:http";
import process from "node:process";

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
}

const port = Number(flag("port", "8787"));
const doc = process.env.MOCHEN_MOCK_DOC ?? flag("doc", "chapters/01-开局.md");
const requests = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lastUserText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (item && item.role === "user") return String(item.content ?? "");
  }
  return "";
}

function isFollowUp(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.some((item) => item && item.role === "tool");
}

function patchBlock() {
  const payload = JSON.stringify({
    doc,
    anchor: "雾从海面涌上来。",
    replace: "海雾涌上来，铁锈味很冲。",
    why: "补一层可感的细节"
  });
  // 文本块协议（spec §6.1 的第二条路）：分三段吐，围栏与 JSON 都不在一次写出
  return [
    { choices: [{ delta: { content: "给你一条提案：\n```mochen-patch\n" } }] },
    { choices: [{ delta: { content: payload.slice(0, 24) } }] },
    { choices: [{ delta: { content: payload.slice(24) + "\n```\n" } }] }
  ];
}

function planBlock() {
  return [
    { choices: [{ delta: { content: "```mochen-plan\n- [x] 读开头三段\n" } }] },
    { choices: [{ delta: { content: "- [ ] 收紧比喻\n```\n" } }] }
  ];
}

function toolCallFrame() {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              function: {
                name: "propose_patch",
                arguments: JSON.stringify({
                  doc,
                  anchor: "雾从海面涌上来。",
                  replace: "海雾涌上来，铁锈味很冲。",
                  why: "补一层可感的细节"
                })
              }
            }
          ]
        }
      }
    ]
  };
}

function framesFor(body, text) {
  if (isFollowUp(body)) {
    const closing = "提案已经挂在下面，等你点批准才落盘。";
    const step = text.includes("慢") ? 2 : 8;
    const out = [];
    for (let i = 0; i < closing.length; i += step) {
      out.push({ choices: [{ delta: { content: closing.slice(i, i + step) } }] });
    }
    out.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
    return out;
  }
  const out = [{ choices: [{ delta: { reasoning_content: "先读一遍上下文，再决定动哪一段。" } }] }];
  if (text.includes("计划")) out.push(...planBlock());
  if (text.includes("文本块")) {
    out.push(...patchBlock());
    out.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    return out;
  }
  out.push(toolCallFrame());
  out.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", (chunk) => parts.push(chunk));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

/** 把一帧 SSE 从**字节中间**劈开两次写出，逼真地考验客户端缓冲与流式解码。 */
async function writeSplit(res, text, gapMs) {
  const buf = Buffer.from(text, "utf8");
  let half = Math.ceil(buf.length / 2);
  // 刻意落在 UTF-8 续字节（0b10xxxxxx）上：这样前一片以半个汉字结尾，
  // 客户端的 TextDecoder({stream:true}) 只有真缓冲才拼得回来。
  for (let i = half; i < buf.length; i += 1) {
    if ((buf[i] & 0xc0) === 0x80) {
      half = i;
      break;
    }
  }
  res.write(buf.subarray(0, half));
  await sleep(gapMs);
  res.write(buf.subarray(half));
  await sleep(gapMs);
}

const server = createServer((req, res) => {
  void handle(req, res);
});

async function handle(req, res) {
  const url = req.url ?? "";
  if (url === "/__health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (url === "/__requests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(requests));
    return;
  }
  const raw = await readBody(req);
  let parsed = {};
  try {
    parsed = raw === "" ? {} : JSON.parse(raw);
  } catch {
    parsed = {};
  }
  // 密钥只记「有没有带」，绝不落进日志：spec §8 的单向性在这里也要成立
  requests.push({
    url,
    method: req.method,
    hasAuth: Boolean(req.headers.authorization),
    model: parsed.model,
    messages: Array.isArray(parsed.messages) ? parsed.messages.length : 0
  });
  if (!url.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "未知路径" } }));
    return;
  }
  const text = lastUserText(parsed);
  if (text.includes("503")) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "上游繁忙，请稍后再试" } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  const gap = text.includes("慢") ? 60 : 3;
  for (const frame of framesFor(parsed, text)) {
    await writeSplit(res, `data: ${JSON.stringify(frame)}\n\n`, gap);
  }
  await writeSplit(res, "data: [DONE]\n\n", gap);
  res.end();
}

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[mochen-mock] http://127.0.0.1:${port}/v1 doc=${doc}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
```

- [x] **Step 2：`tools/mock-provider.test.mjs`（桩自身 + runtime 真 socket）**

先解决一件事：根 `node_modules` 里现在**没有** `@mochen/*` 的链接（pnpm 只把依赖链进
「声明它的那个包」的 `node_modules`），所以 `tools/*.test.mjs` 直接 `import "@mochen/agent-runtime"`
会 `ERR_MODULE_NOT_FOUND`。在根 `package.json` 的 `devDependencies` 追加一行，让根也声明它：

```json
"@mochen/agent-runtime": "workspace:*"
```

Run: `corepack pnpm install`
Expected: 只多出 `node_modules/@mochen/agent-runtime` 一个链接，不下载任何包（`workspace:*` 是本地链接）。
若 pnpm 试图联网，说明协议写错了（写成 `*` 或 `latest` 都会去 registry 找），改回 `workspace:*`。
验证：`ls node_modules/@mochen` 必须列出 `agent-runtime`。

```js
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatMessage, ProviderError, streamChat } from "@mochen/agent-runtime";

// 与桩同目录，用 URL 相对定位：不依赖 vitest 的工作目录。
const script = fileURLToPath(new URL("./mock-provider.mjs", import.meta.url));
let child = null;
let port = 0;
const KEY = "sk-mock-secret";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const value = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(value));
    });
  });
}

async function waitReady(p) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${p}/__health`);
      if (response.ok) return;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`mock provider 没能在端口 ${p} 起来`);
}

const fetchImpl = async (input) => {
  const response = await fetch(input.url, {
    method: "POST",
    headers: input.headers,
    body: input.body,
    signal: input.signal
  });
  const text = response.ok ? "" : await response.text();
  return { status: response.status, stream: response.ok ? response.body : null, errorText: text };
};

async function collect(request) {
  const out = [];
  for await (const event of streamChat(request)) out.push(event);
  return out;
}

function baseRequest(overrides = {}) {
  return {
    fetchImpl,
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: KEY,
    model: "mochen-mock",
    messages: [chatMessage("user", "改紧一点")],
    tools: [],
    signal: new AbortController().signal,
    ...overrides
  };
}

beforeAll(async () => {
  port = await freePort();
  child = spawn(process.execPath, [script, "--port", String(port)], { stdio: "ignore" });
  await waitReady(port);
});

afterAll(() => {
  child?.kill();
});

describe("mock provider 与 streamChat 的真实 socket", () => {
  it("跨字节切分的 SSE 仍能拼出完整中文，且密钥只进 header", async () => {
    const events = await collect(baseRequest());
    const text = events
      .filter((event) => event.kind === "text-delta" || event.kind === "reasoning-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("先读一遍上下文");
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "tool_calls" });
    const log = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    const post = log.find((item) => item.url.endsWith("/chat/completions"));
    expect(post.hasAuth).toBe(true);
    expect(post.url).not.toContain(KEY);
  });

  it("propose_patch 的工具调用增量被合并成一次完整调用", async () => {
    const events = await collect(baseRequest());
    const call = events.find((event) => event.kind === "tool-call")?.call;
    expect(call?.id).toBe("call-1");
    expect(call?.name).toBe("propose_patch");
    expect(JSON.parse(call?.args ?? "{}").doc).toBeTruthy();
  });

  it("文本块轮次：```mochen-patch 分三段吐出，仍能解析出提案 JSON", async () => {
    const events = await collect(baseRequest({ messages: [chatMessage("user", "用文本块提案")] }));
    const text = events
      .filter((event) => event.kind === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("```mochen-patch");
    expect(text).toContain("海雾涌上来，铁锈味很冲。");
  });

  it("503 翻成中文 ProviderError，且不留下未处理的 rejection", async () => {
    await expect(collect(baseRequest({ messages: [chatMessage("user", "给我 503")] }))).rejects.toThrow(
      ProviderError
    );
    let message = "";
    try {
      await collect(baseRequest({ messages: [chatMessage("user", "给我 503")] }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("模型服务端返回 503");
  });

  it("abort 之后立刻收束：不再产出新 delta", async () => {
    const controller = new AbortController();
    const seen = [];
    for await (const event of streamChat(
      baseRequest({
        messages: [chatMessage("user", "慢一点，我要打断")],
        signal: controller.signal
      })
    )) {
      seen.push(event);
      if (seen.length === 2) controller.abort();
    }
    expect(seen.length).toBeLessThan(10);
    expect(seen.at(-1).kind).toBe("finish");
  });
});
```

Run: `corepack pnpm vitest run tools/mock-provider.test.mjs --maxWorkers=4` → PASS（5 用例）。

- [x] **Step 3：写红的 `turn-e2e.test.ts`（全链，真 HTTP）**

`apps/desktop/src/main/turn-e2e.test.ts` 复用 Task 11 那套装配，但 `fetchImpl` 走
`toProviderFetch(全局 fetch)`，provider 是 spawn 出来的 `tools/mock-provider.mjs`：

```ts
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PERMISSION_MODE, type AgentEvent, type AgentOutbound, type StartTurnInput } from "@mochen/contracts";
import { findLatestSession, readSession, type ProviderFetch } from "@mochen/agent-runtime";
import { createBookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, defaultPromptFor } from "./agent-service.js";
import { toProviderFetch } from "./provider-fetch.js";

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";

let port = 0;
let child: ReturnType<typeof spawn> | null = null;
const tempDirs: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const value = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(value));
    });
  });
}

beforeAll(async () => {
  port = await freePort();
  child = spawn(process.execPath, [path.join(ROOT, "tools", "mock-provider.mjs"), "--port", String(port), "--doc", CHAPTER], {
    stdio: "ignore"
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__health`);
      if (response.ok) return;
    } catch {
      // 还没起来
    }
    await sleep(50);
  }
  throw new Error(`mock provider 没能在端口 ${port} 起来`);
});

afterAll(async () => {
  child?.kill();
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function build() {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-e2e-"));
  const secretDir = await mkdtemp(path.join(tmpdir(), "mochen-e2e-secret-"));
  tempDirs.push(dir, secretDir);
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await writeFile(path.join(dir, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(
    path.join(dir, "book.json"),
    JSON.stringify(
      {
        id: "b1",
        title: "深渊之下",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: []
      },
      null,
      2
    ),
    "utf8"
  );
  const book = createBookService();
  const opened = await book.open(dir);
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access" });
  const credentials = createCredentialStore(secretDir, {
    available: true,
    encrypt: (plain) => `enc:${plain}`,
    decrypt: (text) => text.slice(4)
  });
  await credentials.save("sk-e2e");
  const settings = createProviderSettings({ dir: secretDir, credentials });
  await settings.save({ baseURL: `http://127.0.0.1:${port}/v1`, model: "mochen-mock", apiKey: null });
  const outbound: AgentOutbound[] = [];
  let counter = 0;
  const fetchImpl: ProviderFetch = toProviderFetch((input) =>
    fetch(input.url, { method: "POST", headers: input.headers, body: input.body, signal: input.signal })
  );
  const service = createAgentService({
    book,
    settings,
    fetchImpl,
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { dir, service, book, outbound };
}

function turn(docRelPath: string | null, userText: string): StartTurnInput {
  return { threadKey: docRelPath ?? "unbound", docRelPath, stageId: "draft", userText };
}

function eventsOf(list: AgentOutbound[]): AgentEvent[] {
  return list.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function proposalIds(list: AgentOutbound[]): string[] {
  return eventsOf(list).flatMap((event) => (event.type === "proposal" ? [event.proposal.id] : []));
}

describe("端到端：模型 → 提案 → 审批 → 写盘", () => {
  it("文本块协议产出的提案，批准后真的写进文件并留下原稿备份", async () => {
    const { dir, service, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "用文本块提案"));
    const ids = proposalIds(outbound);
    expect(ids.length).toBe(1);
    const before = await readFile(path.join(dir, ...CHAPTER.split("/")), "utf8");
    expect(before).toBe(CHAPTER_TEXT);
    const result = await service.decide({ proposalId: ids[0] ?? "", decision: "accept-once", guidance: "" });
    if (!result.ok) throw new Error(`批准失败：${result.message}`);
    const after = await readFile(path.join(dir, ...CHAPTER.split("/")), "utf8");
    expect(after).toContain("海雾涌上来，铁锈味很冲。");
    if (result.backupRelPath === null) throw new Error("写入前必须有备份");
    const backup = await readFile(path.join(dir, ...result.backupRelPath.split("/")), "utf8");
    expect(backup).toBe(CHAPTER_TEXT);
    const rel = await findLatestSession(dir, CHAPTER);
    if (rel === null) throw new Error("会话文件没落盘");
    const session = await readSession(dir, rel);
    expect(session.droppedLines).toEqual([]);
    expect(session.events.some((event) => event.type === "decision")).toBe(true);
    service.dispose();
  });

  it("原生 tool_calls 那一路同样只需一次批准", async () => {
    const { dir, service, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    const ids = proposalIds(outbound);
    expect(ids.length).toBe(1);
    const result = await service.decide({ proposalId: ids[0] ?? "", decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(true);
    const after = await readFile(path.join(dir, ...CHAPTER.split("/")), "utf8");
    expect(after).toContain("铁锈味");
    service.dispose();
  });

  it("503 走真实 HTTP：轮次落 failed，中文原因进对话流，文件一字不动", async () => {
    const { dir, service, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "给我 503"));
    const last = outbound
      .slice()
      .reverse()
      .find((item) => item.type === "turn-end");
    expect(last?.type === "turn-end" && last.status).toBe("failed");
    expect(JSON.stringify(outbound)).toContain("模型服务端返回 503");
    expect(await readFile(path.join(dir, ...CHAPTER.split("/")), "utf8")).toBe(CHAPTER_TEXT);
    expect(proposalIds(outbound)).toEqual([]);
    service.dispose();
  });

  it("慢流中途 Esc：已流出的思考入库标注 interrupted，半截正文绝不写盘", async () => {
    const { dir, service, outbound } = await build();
    const running = service.startTurn(turn(CHAPTER, "慢一点，我要打断"));
    let turnId = "";
    while (turnId === "") {
      await sleep(10);
      const found = outbound.find((item) => item.type === "turn-start");
      if (found && found.type === "turn-start") turnId = found.turnId;
    }
    expect(await service.interrupt(turnId)).toBe(true);
    await running;
    const list = eventsOf(outbound);
    expect(list.some((event) => event.type === "reasoning" && event.interrupted)).toBe(true);
    expect(proposalIds(outbound)).toEqual([]);
    expect(await readFile(path.join(dir, ...CHAPTER.split("/")), "utf8")).toBe(CHAPTER_TEXT);
    service.dispose();
  });
});
```

> 第四条若红在「reasoning 的 `interrupted` 标记」，那是 Task 7 的打断残留没做全（spec §6.3 第一条）——
> 回 `tool-loop.ts` 补，**不许放宽断言**。同理第三条红在错误文案，就回去补 Task 3 的中文包装。

Run: `corepack pnpm vitest run apps/desktop/src/main --maxWorkers=4`
Expected: PASS —— 目录里是「Plan 1 既有 8 + Task 9 的 11 + Task 10 的 12 + Task 11 的 12 + ipc/fetch 4」
再加本文件 4 条；把总数记进 Task 16 的台账，别只写「都绿了」。

- [x] **Step 4：根脚本**

`package.json` 的 `scripts` 追加两行（放在 `build` 之后）：

```json
"mock-provider": "node tools/mock-provider.mjs --port 8787",
"smoke": "corepack pnpm build && corepack pnpm --filter @mochen/desktop exec electron .",
```

Run: `corepack pnpm prettier --write tools package.json apps/desktop/src/main` → 无变更后再
Run: `corepack pnpm verify` → 回读末行 `VERIFY_EXIT=0` 与用例总数（`| tail` 会把门禁退出码吞掉）。

- [x] **Step 5：变异实验**

| 抽掉的实现 | 必须转红的用例 |
|---|---|
| 桩里 `writeSplit` 退回一次性 `res.write(整帧)`，或删掉「找续字节」那段循环 | 「跨字节切分的 SSE 仍能拼出完整中文」失去意义；随后把 `sse.ts` 里复用的 `TextDecoder(..., { stream: true })` 换成每个 chunk 新建一个 decoder，该用例**必须红**——红不了说明这条断言是空的 |
| `agent-service` 里写盘前的备份步骤 | e2e 第一条（备份必须等于原稿） |
| `agent-service` 里 `interrupted` 的 reasoning 落库 | e2e 第四条 |
| 桩的 503 分支 | e2e 第三条 + runtime 的 ProviderError 用例 |

Run: `git diff --exit-code apps/desktop/src packages tools` 恢复后必须为空。

- [x] **Step 6：真机三栏冒烟（spec §10 的 UI 验收）**

前置：另开一个终端 `corepack pnpm mock-provider`（端口 8787）。

1. Run: `corepack pnpm smoke`（先 build 再启真窗口）。
2. 左栏点「打开作品目录」，选一个含 `chapters/01-开局.md` 的真实目录；确认左栏出章节树、
   右栏可点开正文。
3. 中栏右上「模型设置」：baseURL 填 `http://127.0.0.1:8787/v1`、模型名随意、密钥填 `sk-e2e`，保存；
   重开弹窗应显示掩码 `••••`+ 后四位，且明文密钥不在任何输入框里回显。
4. 输入「改紧一点」并回车：思考摘要展开、正文流式、出现「提出改稿提案」工具卡与一张待审卡；
   状态行 `工作中 · Ns · Esc 打断` 在跳秒。
5. 卡上点「仅这一次批准」：右栏正文出现「海雾涌上来，铁锈味很冲。」，卡片落「已写入」；
   到文件管理器确认 `.mochen/changes/<时间戳>/01-开局.md.bak` 存在。
6. 再发「用文本块提案」：不点批准，直接 Esc——已流出内容仍在，卡保持待审，状态行变
   `已打断 · N 条待审`。此时输入区应出现「继续」按钮；点它，确认新起一轮、对话里还看得到
   上一轮的残字（spec §9 第 4 行）。
7. 输入「给我 503」：对话流出现中文错误，文稿一字不变；状态行变成该中文原因（不再是「就绪」），
   「继续」按钮仍然出现。
8. 在左栏点一篇素材「浏览」：右栏切到浏览页，中栏会话与当前章草稿都不受影响（Plan 1 的
   浏览不打断仍然成立）。
9. 收尾：停 dev/smoke 进程后再 `taskkill //IM electron.exe //F`（computer-use 的 UIA Invoke
   不会触发 Vue 的 `@click`，点按钮要用坐标点击）。

冒烟任一步不符，就在本任务内修到底再进 Task 16；`docs/superpowers/plans/README.md` 的完成状态里
记一句「冒烟实测：通过 / 待办」。

- [x] **Step 7：提交**

```bash
git add tools apps/desktop/src/main package.json docs/superpowers/plans/README.md
git commit -m "test(e2e): 本地 SSE 桩打通模型到写盘全链，补真机三栏冒烟"
```

---

## Task 16：全量门禁、变异台账与文档收尾

**Files:**
- Modify: `docs/superpowers/plans/README.md`（Plan 2 状态）、`docs/ATTRIBUTION.md`（本次复用清单）、
  本计划文件（勾选已完成复选框）

**Interfaces:**
- Consumes: 前 15 个任务的全部产出
- Produces: 一条可交付的 S3+S4 切片（墨宸 AI 能对话、能出提案、能逐条审批落盘）

- [ ] **Step 1：全量门禁**

Run: `corepack pnpm verify`
Expected: 末行 `VERIFY_EXIT=0`，且 vitest 汇总的用例总数 ≥ Plan 1 收尾时的基线。
Windows 提醒：本机 dev 在跑时全量 vitest 会假红且每次红的文件不同；先 `taskkill //IM electron.exe //F`
或用 `--maxWorkers=4` 复核，别把并发争用当真红灯。

- [ ] **Step 2：边界与预算复述**

Run: `corepack pnpm lint:boundary && corepack pnpm lint:budget`
Expected: 两条都 0 退出。`packages/agent-runtime` 里若出现 `import "electron"` 会被边界拦下；
`agent-service.ts` 逼近 800 行预算时，按本计划的约定把提案登记拆成 `proposal-registry.ts`，
不要靠压缩注释或换行蒙过门禁。

> **收尾实测与决定（2026-10-02，Task 16 波 B）**：`wc -l apps/desktop/src/main/agent-service.ts` = **513 行**，
> 未逼近 800 行预算 ⇒ **决定：本计划不拆 `proposal-registry.ts`**，`applyDecision` 留在原文件。
> 理由写死在此处，别让下一个任务把「不拆」当成遗漏：拆分的前提是逼近边界，而它没到。
> 同批核对：`useAgentStore.test.ts` 737 行（预算 800，同样不拆；再加用例前要先想好拆分）。

- [ ] **Step 3：变异台账（把每任务实测结果写回本文件）**

| 任务 | 抽掉了什么 | 是否转红 | 备注（含证据日志名） |
| --- | --- | --- | --- |
| 1 | `decision.auto` 字段 | 红 1 条（`packages/contracts/test/agent.test.ts`）——**无归档日志，仅实现者报告逐字转述** | 契约。落点 `packages/contracts/src/agent-event.ts:58`（`auto: z.boolean()`）。`task-1-report.md` §3.1 原文：简报逐字给的 10 个用例下**变异存活、`Tests 10 passed (10)` 全绿**（zod 的 object 静默剥掉未声明键，那 10 条只断言 `safeParse().success`）；补守护用例「decision 事件必须留住 auto 字段」（现 `agent.test.ts:99`）后同一变异转红，逐字 `AssertionError: expected undefined to be true`、`Tests 1 failed \| 10 passed (11)`，恢复后 `Tests 11 passed (11)`。同报告 §3.2 另记一条（删 `packages/contracts/src/patch.ts` 的 `expectedFingerprint: z.string().min(1)`）红 2 条 `Tests 2 failed \| 9 passed (11)`，同样无日志。报告「遗留」自陈：本套件对「schema 删字段」这类变异整体偏弱。 |
| 2 | SSE 单行单 chunk 假定 | 红 1 条（`packages/agent-runtime/test/sse.test.ts`）——**无归档日志，仅实现者报告逐字转述** | 中文跨字节。落点 `packages/agent-runtime/src/sse.ts:26`（`decoder.decode(chunk, { stream: true })` 去掉 `{ stream: true }`）。`task-2-report.md`「变异实验」原文：`AssertionError: expected [ '雾从\ufffd\ufffd\ufffd面涌上来' ] to deeply equal [ '雾从海面涌上来' ]`、`Tests 1 failed \| 6 passed (7)`。必须一并记两点：① 简报自己指定的变异（删 `sse.ts:16` 的 `line.startsWith(":")` 注释守卫）实测 `Tests 7 passed (7)` 全绿＝**等价变异**（该守卫位于 `!startsWith("data:")` 白名单之后，恒为死代码），属计划缺陷，`progress.md` Task 2 段有裁定；② 变异 B 首跑也曾全绿，根因是简报用例用 `Uint8Array.indexOf(Uint8Array)` 算断点得 `-1`、切成「空块＋整段」，任何实现下恒绿，修断点计算后才转红。 |
| 3 | abort 分支 | 红（**有日志**）：主证据红 1 条（`provider-client.test.ts`）＋同性质各红 1 条（`tool-loop.test.ts`）＋补装置后三层各红 1 条 | 打断语义。① `provider-client.ts:179-181` 帧循环顶部 abort 守卫整块删除 → 红 1 条（`mutB1-red.log`：`Tests 1 failed \| 11 passed (12)`，用例「abort 后停止消费后续帧：只产出已流出文本，第二帧 delta 绝不出现」）；② `tool-loop.ts:140-146` 的 interrupted 发射：删 `emitSimple({ type: "interrupted", pendingProposals })` → 红 1（`mutM1.log`，`1 failed \| 7 passed (8)`）、`interrupted: aborted` 写死 `false` → 红 1（`mutM2.log`，同数）、`pendingProposals` 传 `void 0` → 红 1（`mutM5.log`，`1 failed \| 8 passed (9)`），三条都在 `tool-loop.test.ts` 的「打断…」用例；③ Task 15 补上真 socket 装置后，控制方与评审者在三层各自跑红：`t15r-mut-guard-unit.log` 红 1（`1 failed \| 15 passed (16)`「读流期打断…」）、`t15r-mut-guard-stub.log` 红 1（`1 failed \| 6 passed (7)`「abort 之后立刻收束」）、`t15r-mut-guard-e2e.log` 红 1（`1 failed \| 4 passed (5)`「慢流中途 Esc…」），恢复后 `t15r-guard-restored.log` = `Tests 28 passed (28)`；控制方侧 `t15c-mut-noguard-unit.log`、`t15c-mut-noguard-e2e.log` 各红 1 条。教训见 `EXECUTION-NOTES.md` §6「三条已定案口径」第 1、3 条：「打断」类语义必须有一条走真 socket 的用例。 |
| 4 | 锚点多处命中判歧义 | 红 1 条（`packages/agent-runtime/test/apply-patch.test.ts`）——**无归档日志，仅实现者报告逐字转述** | 双路提案。落点 `packages/agent-runtime/src/apply-patch.ts:58`（`if (hits > 1)` 歧义分支）。`task-5-report.md` §6 M1：只有「锚点出现两次判为歧义」红，其余 20 条仍绿；删掉后歧义锚点走唯一分支、`status` 变 `unique` 并产出被猜位置的 `content`；恢复证明是 md5 逐字节比对（当时四个文件未入库，`git diff` 看不到）。**行号与任务号的漂移**：本行挂在「任务 4」名下，抽除点实在 Task 5 的 `apply-patch.ts`；Task 4 自己的五条变异（`task-4-report.md` §5 A–E，`patch-protocol.ts` 围栏闭合等）同样**只有报告、无归档日志**，其中简报指定的 A 为等价变异体（9 个原文用例全绿），补一条 `expect(out.prose).toBe("")` 才变成可杀。 |
| 5 | diff 前后缀裁剪 | 红 1 条（`packages/agent-runtime/test/diff.test.ts`）——**无归档日志，仅实现者报告逐字转述** | 卡片可读性。落点 `packages/agent-runtime/src/diff.ts:68` 的 `diffLines`（整体换成不裁剪的 `lcsOps(...)`）。`task-5-report.md` §6 M3：只有「长文稿只改一句时首尾修剪生效」红，逐字 `expected … to contain '@@ -998,7 +998,7 @@'`，其余 11 条全绿。**如实记**：简报原有 7 条用例对该变异是**等价变异体**（小样本不触 `diff.ts:11` 的 `LCS_CELL_CAP`，裁剪与否输出相同），按 EXECUTION-NOTES §2.2 补用例后才可杀。同任务 M9（删 `countOccurrences` 的 `needle === ""` 早退）不是断言红而是**挂死**：报告记 `EXIT=124`＋`Worker exited unexpectedly`；Task 10 的 MU-9 复现同一形状，`task10-mut-9.log` 回读为 `Errors 1 error`、`Tests (10)` 未收口、`Error: Worker exited unexpectedly`（该报告写 `Tests (9)`，日志实为 `(10)`）。 |
| 6 | 坏行计入 droppedLines | 红（**无归档日志，仅实现者报告逐字转述，且报告只标 `RED`、未给条数**） | 会话可读回。落点 `packages/agent-runtime/src/rollout.ts:87`（`else droppedLines.push(offset + 2)` 不 push，报告 M3）与 `:89`（`return { meta, events, droppedLines }` 换成 `droppedLines: []`，报告 M15），两条都落在用例「中间坏行跳过并计数，首行坏则报中文错误」。（草稿给的 `:83`/`:87` 分别是数组声明行与 push 行，本行按当前 HEAD 更正为 `:87`/`:89`。）`task-6-report.md` §3 的 16 条变异（M1–M16）全部只写 RED、无条数，脚本与输出留在 `/tmp/mut-t6.mjs`、`/tmp/mut-t6b.mjs`（脚本自带还原但没落盘），**日志未进本过程目录**。简报指定的 M1（删 `docRelPath` 过滤）不是等价体、照跑即红。 |
| 7 | 工具轮次上限 | 红 1 条（`packages/agent-runtime/test/tool-loop.test.ts`，**有日志**） | 死循环。落点 `packages/agent-runtime/src/tool-loop.ts:216`（`if (round === deps.maxToolRounds - 1)` → `if (false)`）。日志 `mutM3.log`：`Tests 1 failed \| 7 passed (8)`，用例「工具轮超过上限时停下并说明，不死循环」，逐字 `AssertionError: expected 'done' to be 'failed'`；同代另有 `toolloop-red.log` / `toolloop-green.log` 两份，但它们是 **TDD 的红绿基线、不是变异红**：前者回读为收集期失败（`Error: Cannot find module '../src/tool-loop.js'`、`Test Files 1 failed (1)`、`Tests no tests`），后者 `Tests 9 passed (9)`（9 条；本行变异日志所在的套件是 8 条，属不同代，别混着数）。**行号与任务号的漂移**：本行挂在「任务 7」名下，抽除点是 Task 8 的 `runTurn`。 |
| 8 | 权限天花板五目录 | **本体无日志**（仅 `task-7-report.md` §4 逐字转述）；**下游有日志**，各红 1–7 条（`doc-tools-host.test.ts` / `permission.test.ts`） | 铁律。本体落点 `packages/agent-runtime/src/permission.ts:4-10`（`WRITABLE_TOP_DIRS` 清单本身）、`:23-26`（`insideWritableDir`）、`:33`（天花板文案）：Task 7 报告 §4 记 M6（删 `insideWritableDir` 判定，逐字 `AssertionError: expected true to be false`）、M7（删 `read-only` 默认档拦截）、M8（删 `docRelPath !== currentChapter`）、M9（删 `currentChapter === null` 分支，红在文案 `to contain '尚未选定'`）、M10（五目录前两项重排）全部转红、各钉一条用例，但**只有报告、无归档日志**。有日志的是**下游各层对同一道天花板的抽除**，不许冒充本体证据：`task10-mut-2.log` 红 2 条（`2 failed \| 20 passed (22)`，删 write_doc 档位门 → 「只读档下拒绝，并把中文理由作为工具回执回喂模型」＋「可改当前章档下，别章的 write_doc 被拒」）、`t10fix-mut-e.log` 红 5 条（host 的 `inWritableDir` 恒 `return true`）、`t10fix-mut-f.log` 红 7 条（归一＋天花板＋档位三道门全拆；同批 `t10fix-mut-d.log` 红 4、`t10fix-mut-f-scratch.log` 是一次性探针 1 passed）、`t11-mut-m11.log` 红 5 条（`5 failed \| 43 passed (48)`，含「doc 不在五个文稿目录内时直接拒绝」「反斜杠越界路径仍然 fail-closed」）、`t16ac-mut-f2-wording.log` 红 1 条（`1 failed \| 4 passed (5)`，只读档文案塞回「左栏」二字 → `permission.test.ts`「只读参考档一律拒绝，且说明里点名当前档位」）。 |
| 9 | 明文密钥落盘 | **本体无日志**（仅 `task-9-report.md` §4 逐字转述）；后端与端到端**有日志**，各红 1 条 | spec §8。本体落点 `apps/desktop/src/main/credential-store.ts:63`（`if (text.includes(key)) throw new Error("加密结果仍含明文，已拒绝落盘。")`）：报告 §4 变异 2 记 RED，逐字 `AssertionError: promise resolved "undefined" instead of rejecting`，**无归档日志**（当时的恢复证明是「全量回绿＋grep 源码 0 命中」，报告 §4 自陈四个源文件尚未入库）。有日志的是另外两道：`t15-mut-m5.log` 红 4 条（`Tests 4 failed (4)`，`turn-e2e.test.ts` 四条一起红，首条是「文本块协议产出的提案…」而非密钥用例 ⇒ 精确归因靠下一条）、`t15-mut-m5b.log` 红 1 条（`1 failed \| 3 passed (4)`，只留「密钥只进 header：书目录、密钥目录与会话 JSONL 都不含明文」，逐字 `expected '{\n "baseURL": …' not to contain 'sk-e2e-canary-4f9d1c'`）、评审者复跑 `t15r-mut-keyleak.log` 红 1 条（同一用例）。 |
| 10 | 提案 baseline 传盘上文 | 红 1 条（`apps/desktop/src/main/doc-tools-host.test.ts`，**有日志**） | diff 真实性。落点 `apps/desktop/src/main/doc-tools-host.ts:195` 与 `:223`（`deps.onProposal(item, body ?? "")` → `(item, applied.content)`）。日志 `task10-mut-8.log`：`Tests 1 failed \| 21 passed (22)`，用例「锚点唯一时产出 pending 提案，文件字节一字不变（全案最硬的断言）」的 baselines 断言，逐字 `AssertionError: expected [ Array(1) ] to deeply equal [ '第一段\n雾从海面涌上来。…' ]`。同批 `task10-mut-1..7.log` 回读为红 6/2/2/1/2/4/1 条（`Tests` 行依次为 `6 failed \| 16`、`2 failed \| 20`、`2 failed \| 20`、`1 failed \| 21`、`2 failed \| 20`、`4 failed \| 18`、`1 failed \| 21`，每组 22 条），MU-9 为挂死（见第 5 行）。 |
| 11 | 备份 / 权限判定 / pending 保留 / 指纹比对 | 红（**有日志，14 个抽除点全部实测**，逐点见备注） | 全案最硬。逐点条数（日志 `t11-mut-mN.log`，用例名逐字见 `t11-mut-summary.txt`）：m1 删先备份段 → 红 2（`2 failed \| 25 passed (27)`，`fs-store/test/read-write.test.ts` 单元层同红）；m2 删 `if (!permission.allowed)` → 红 2（`agent-service.test.ts`）；m3 删 `pending.set(...)` → 红 9（`9 failed \| 12 passed (21)`）；m4 删指纹比对 → 红 1；m5 删 `proposal.turnId = turnId` → 红 2；m6 删 `appendAgentEvent` → 红 3；m7 删 `startTurn` 失败早退 → 红 1；m8 密钥只进 header → 红 2；m9 fs-store 读失败分类 → 红 1；m10 审批读失败处理 → 红 1；m11 路径门 → 红 5（`5 failed \| 43 passed (48)`）；m11b 抽 host 整段守卫 → 红 1（`t11-mut-m11b-E4.log` 逐字复现原日志；**只抽前两道门的 `t11-mut-m11b-remeasure.log` 为 `Tests 21 passed (21)` 全绿**，故台账把「抽除什么」更正为整段三道门）；m12 `sessionId` 退回 `newId()` → 红 1。m3 的**如实记录**：简报预言的两半里「未批准时文件字节一字不变」在该抽除下为**绿**（日志里是 `✓`，该用例不调 `decide()`，无可达路径）。**审批时刻权限闸的覆盖面另见 `EXECUTION-NOTES.md` §6 口径第 2 条**：`agent-service.ts:293` 的 `if (!permission.allowed)` 改成恒假时 e2e 五条全绿，只有单元测试红 2 条（`t15r-mut-permgate.log`：`2 failed \| 107 passed (109)`）。 |
| 12 | `onAgentEvent` 通道拼错 | 红 1 条（`apps/desktop/src/preload/renderer-api.test.ts`，**有日志**） | 白名单。落点 `apps/desktop/src/preload/renderer-api.ts:47` 的 `on(IPC_CHANNELS.agentEvent, ...)`（通道常量唯一来源 `packages/contracts/src/ipc.ts:14`）；`t12-mutation1.log`：`Tests 1 failed \| 3 passed (4)`，用例「订阅 agentEvent 后能收到推送，取消订阅后不再收到」，逐字 `AssertionError: expected 'agent:events' to be 'agent:event'`（栈顶 `renderer-api.test.ts:48`）。**这是 EXECUTION-NOTES §4「Task 12 更正」的位置**：拼错通道名**确实能红**，控制方早期「拼错不红＝等价变异」的说法作废（该说法只适用于「撤订阅传原始 listener」那条，要靠同引用断言才红得住，`t12-mutation2.log` 红 1）。同批 `t12-mutation3.log` 红 2 条；修复波 `t12fix-mut1..4.log` 红 3/2/1/1；评审者二波 `t12r2-mut-channel.log` 红 1 条（用例「12 个方法各调一次：通道与参数逐条钉死（期望值全是字面量，不从 `IPC_CHANNELS` 派生）」），`-args`/`-draft`/`-superrefine`/`-n-decide` 各红 1，`-n-provider` 红 2，`-n-startturn` 红 3。 |
| 13 | 残字归零 / stale 落态 / 未保存手改保护 / 断了才给「继续」 | 红（**四性质全部有日志**，各红 1–2 条） | 中栏一致性。落点 `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（脚本 `t13b-mutations.sh`，逐行 `hits=1`＋`changed=mutated` 证明确实改到）：残字归零 `:223-224` → 红 2 条（`t13b-mutation-1-streaming-reset.log`，`2 failed \| 22 passed (24)`，主用例＋m2 白名单用例）；stale 落态 `:295` → 红 1（`t13b-mutation-3-stale.log`，`1 failed \| 23 passed (24)`）；`endedAs` `:213` → 红 2（`-7-endedas`）；`turnId=null`、io 文案、`absorbAgentWrite` 调用（`:249`）、`listening` 闸门（`:171`）、`canContinue` 闸门各红 1（`-2/-4/-5/-6/-8`，均 `1 failed \| 23 passed (24)`）。**未保存手改保护**在 Wave A：`t13a-mutation-absorb.log` 红 1（`1 failed \| 13 passed (14)`，「智能体写盘撞上未保存手改：草稿一字不动，标冲突让人决定」）、`t13a-mutation-escape.log` 红 1（`1 failed \| 5 passed (6)`，「聚焦待审卡且说明非空：只失焦，不清字」）。修复波：`t13fix-mut-{delta-route,event-route,turnid,trim}.log` 各红 1（均 `1 failed \| 59 passed (60)`）；`t13fix-mut-status-union.log` 是**同文件两阶段**（PHASE A 派生白名单 `Tests 70 passed (70)` 全绿＝无漂移，正是修复目标；PHASE B 退回硬编码 `1 failed \| 59 passed (60)`），**不是**「等价变异之说」。评审者三波 `t13r3-mut-{delta-route,event-route,turnid,drift}.log` 各红 1（基线 `t13r3-baseline.log` = `Tests 60 passed (60)`）。 |
| 14 | plan 合并 / 残字置末 / 工具名兜底 | 红（**有日志**，各红 1 条；另有 1 个曾全绿的无牙齿点） | 四层渲染。落点 `apps/desktop/src/renderer/src/utils/timeline.ts`（脚本 `t14a-mutations.sh`）：plan 合并 → 红 1（`t14a-mut-1-plan-merge.log`，`1 failed \| 9 passed (10)`，「连续 plan 事件合并成一块，以最后一份清单为准」）；提案事件不入正文 → 红 1（`-2-proposal-events`）；残字置末/尾部修剪 → 红 1（`-3-tail-reasoning-trim`）；**工具名兜底 `:27`/`:84`：简报原用例下 `t14a-mut-4-before-hardening.log` 回读为 `Tests 10 passed (10)` 全绿（无牙齿）**，补断言后 `t14a-mut-4-after-hardening.log` 红 1；尾部插入位置在循环前 → 红 1（`-6-tail-before-loop`）；尾部 id 撞车 → 红 1（`-7-tail-id-collision`）；恢复后 `t14a-mut-restored-green.log` = `Tests 10 passed (10)`。（同目录另有上一代命名 `-3-tail-trim`、`-4-tool-label-fallback`、`-5-tool-label-fallback`、`-5-tail-before-loop`，回读各红 1，内容与最后一代重叠，台账按最后一代引用。）裁定 r（类型关卡可失败性）：`t14b-r-mutation-toolrename.log` 回读 `TSC_EXIT=2`＋`timeline.ts(30,3): error TS2561`，对照弱断言的 `t14b-r-control-weak-type-silent.log` `TSC_EXIT=0`；评审者复跑 `t14r-r-mutation.log`/`t14r-r-control-weak.log` 同形；另 `t14r-mutA-tail-streaming-false.log`、`t14r-mutB-drop-interrupted.log` 各红 1（`1 failed \| 9 passed (10)`）。 |
| 15 | 备份步骤 / interrupted 标注 | 红（**有日志**；端到端一层最硬） | 端到端。备份步骤：`packages/fs-store/src/read-write.ts:56-63`（`:62` 的 `await writeFile(backupTarget, current, "utf8")` 整段抽掉）→ `t15-mut-m2.log` 红 1、`t15-mut-m2b.log` 红 1（均 `1 failed \| 3 passed (4)`，用例「文本块协议产出的提案，批准后真的写进文件并留下原稿备份」）；评审者复跑 `t15r-mut-nobak.log` 红 1（同用例），会话侧 `t15r-mut-nojsonl.log` 红 1（同一 e2e 用例里的 JSONL 断言）。interrupted 标注：`tool-loop.ts:140-146` → `t15-mut-m3.log` 红 1（`1 failed \| 196 passed (197)`，当时只有单元层能跑，e2e 尚未接上），修复后 `t15fix-mut-m3.log` 是同文件两阶段（单元层红 1 `1 failed \| 9 passed (10)`、e2e 层红 1 `1 failed \| 4 passed (5)`）；控制方 `t15c-mut-m3.log` 红 2（`2 failed \| 13 passed (15)`，`tool-loop.test.ts`＋`turn-e2e.test.ts`「慢流中途 Esc…」两层同红）。桩侧 `t15-mut-m1b.log` 红 2、`t15-mut-m4.log` 红 2、`t15-mut-m6.log` 红 3。**必须如实记**：`t15-mut-m1a-alone.log`、`t15-mut-m1a-plus-m1b.log`、`t15-mut-m1c-alone.log`、`t15-mut-m1c-plus-m1b.log` 四条对照日志回读都是 `Tests 6 passed (6)` **全绿**（报告自己标注为绿，不是造假）；`t15fix2-red-provider.log` 名叫 red 实为 `Tests 16 passed (16)` **全绿**，真正的红证据在同代另一份 `t15fix-red-provider.log`（`Tests 1 failed \| 89 passed (90)`）⇒ 这是**文件名与内容不符＋台账没引用**，不是「某步没红」。 |
| 波 A（Task 16 自身的修复 `85fd394`） | open 判据恒真 / `turnAnchors` 返回 `{}` / `errorHint` 回原响应体 / `isFollowUp` 恢复旧判据 / 只读档文案塞回「左栏」 | 红（**控制方亲跑五条，全部有日志**）：各红 3、2、3、1、1 条 | 台账落表波自己的修复面。基线 `t16ac-controller-baseline.log` = `Tests 348 passed (348)`、`VERIFY_EXIT=0`。逐条：open 判据恒真 → 红 3（`t16ac-mut-f1a-predicate.log`，`3 failed \| 18 passed (21)`，`timeline.test.ts`）；`turnAnchors` → `{}` → 红 2（`t16ac-mut-f1b-anchors.log`，`2 failed \| 19 passed (21)`，含 `expected '本轮' to be '第 1 轮 · 收紧比喻'`）；`errorHint` 直接回原响应体 → 红 3（`t16ac-mut-f5-hint.log`，`3 failed \| 20 passed (23)`，`provider-client.test.ts`）；`isFollowUp` 恢复「历史里有 tool」旧判据 → 红 1（`t16ac-mut-f3-followup.log`，`1 failed \| 7 passed (8)`，`tools/mock-provider.test.mjs`）；只读档文案塞回「左栏」→ 红 1（`t16ac-mut-f2-wording.log`）。**教训一**：简报原列的 `turnAnchors` → `return {}` 变异**不可能**让 `cardTurnLabel` 的单元用例转红（anchors 是入参，单元用例自造锚点绕开实现），是实现者补了一条集成用例才钉住 ⇒ 变异要问「改动能不能被这条用例看见」，不只要问「有没有对应用例」。**教训二**：`85fd394` 提交信息写「347 passed（基线 329 + 新增 18）」，落盘后的最终日志 `t16a-verify-final.log` 回读是 **348**（＋19），347 是补集成用例**之前**的 `t16a-verify.log` ⇒ 不改历史，只记账务。**教训三**：波 A 初稿曾记「六条变异」，其中「`{open:cards, settled:[]}` 红 2」一条**没有控制方日志**（目录只有 5 个 `t16ac-mut-*.log`），是把实现者的 `t16a-mut-f1a-split.log`（回读红 3）混记 ⇒ 台账每行必须当场写日志名，隔轮补会造出不存在的实验；该行按现状不能定案，本表不列。 |
| 波 A2（评审后补保护 `03185a4`） | 码点截断 / 原型键 / 比较器并列返回值 / 第二句指引 / `candidate.trim()` / createdAt 次级键 / `status` 类型收窄 | 红（**控制方亲跑，全部有日志**）：M1 红 1、M2 红 2、M3a **全绿**、M3b 红 1、M6 红 2、M4 红 1、M5 红 1；P3-8 是类型关卡不是用例 | 本波基线（`Tests 353 passed (353)`，见 `t16a2c-controller-verify.log`）。基线 `t16a2c-baseline.log` = 三个被改文件 `Tests 54 passed (54)`。M1 码点截断退回 UTF-16 `slice` → 红 1（`t16a2c-m1-codepoint-revert.log`，`1 failed \| 24 passed (25)`）；M2 `Object.create(null)` 换回 `{}` → 红 2（`t16a2c-m2-proto-revert.log`，两次 `TypeError: Cannot read properties of undefined (reading 'replace')`）；M3a **简报逐字指定的** `return 0` → `return 1` → **全绿 `Tests 25 passed (25)`**（`t16a2c-m3a-tie-return1.log`，V8 TimSort 对并列组不可观测 ⇒ 等价变异，控制方另用 `node -e` 对 n=3..64 探针独立证实）；M3b 同位 `return 0` → `return -1` → 红 1（`t16a2c-m3b-tie-return-1.log`，`expected [ 'pZ', 'pY', 'pX' ] to deeply equal [ 'pX', 'pY', 'pZ' ]`）；M6 比较器丢 createdAt 次级键 → 红 2（`t16a2c-m6-drop-createdat.log`，证明 P3-3 的加固把第二条用例变成牙齿）；M4 只删只读档第二句指引 → 红 1（`t16a2c-m4-drop-guidance.log`，`1 failed \| 4 passed (5)`，`permission.test.ts`）；M5 去掉 `provider-client.ts:58` 的 `candidate.trim()` → 红 1（`t16a2c-m5-drop-trim.log`，落到「无响应体」可区分）。P3-8：`status` 收窄成 `ProposalStatus` 后 vitest 测不出来，控制方用临时 `cardOf(..., "bogus")` + `tsc -p apps/desktop/tsconfig.web.json` 证到 `timeline.test.ts(364,74): error TS2345`（`t16a2c-p38-typeprobe.log`；**该日志只存了 tsc 的输出行，`TSC_EXIT=2` 这个数字在归档里回读不到**，按「有 TS2345 报错、退出码未落盘」记）。**本波唯一一条「抽了但不红」是 M3a**，写成教训：排序类变异要先问返回值方向在 V8 里可不可观测，不可观测就换向、别放弃。 |

「待填」必须换成实测结论。没跑过的变异实验不算做过——只报「全绿」不算验证。

> **台账落表口径（2026-10-02，Task 16 波 B）**：上表 17 行（原 15 行 + 波 A + 波 A2）全部换成实测或
> 照实标注「无归档日志」。取证目录 `.superpowers/sdd/2026-10-01-plan2-streaming-and-proposal/`（git-ignore），
> 每一格引用的日志名都经波 B 实现者 `grep` 回读 `Tests …` 汇总行核对。
> **五行只有实现者报告的逐字转述、没有归档日志**：行 1、2、4、5、6（变异当时跑在 `/tmp`，当场未落盘）；
> 另有两处「本体无日志 / 下游有日志」分开写在行 8、行 9。
> 三条已定案口径（真 socket 打断教训、审批时权限闸只有单元守卫、§9.4 之辨定案为实现者装置问题）
> 与 C 组四项裁定写在 `EXECUTION-NOTES.md` §6，不在此重复。
> 波 A 之前 `progress.md` 说「Task 1/2 等早期任务的日志在本目录」**不成立**，已就地更正；
> 教训入表：**变异实验必须当场把日志写进过程目录**，否则下一轮无法自证。

- [ ] **Step 4：文档收尾**

- `docs/superpowers/plans/README.md`：Plan 2 行改成「已完成（S3 流式对话 + S4 提案写盘与审批，
  16 任务；冒烟实测：……）」，并把 Plan 3 的依赖句改成「依赖 Plan 2 的 `useAgentStore` 与
  `agent-service`」。
- `docs/ATTRIBUTION.md`：补两条——中栏骨架与弹窗沿用 deepwrite 的
  `conversation-pane` / `dialog.css` 类名（`CenterColumn.vue`、`ProviderSettings.vue`）；
  `agent-pane.css` 是自有样式，只复用主题变量。
- 本计划文件：把已完成任务的复选框勾上。

- [ ] **Step 5：提交**

```bash
git add docs
git commit -m "docs(plan2): 收尾台账与来源清单"
```

---

## 交付核对表（spec §10 对着勾）

| spec 要求 | 落在哪个任务 |
|---|---|
| 模型永不直接写盘；唯一写盘通路是「审批 → `book.writeDoc`」 | Task 11（`applyDecision` 是唯一调用 `writeDoc` 的地方）+ Task 8（host 只产提案） |
| 写入前把原文件复制进 `.mochen/changes/<时间戳>/` | Plan 1 Task 5（`writeDocFile` 已实现）+ Task 11（写前取 baseline）+ Task 15 e2e 第一条实测备份字节 |
| 指纹不符即拒（外部改动） | Plan 1 Task 5（`stale` 分支）+ Task 11（`stale` 删 pending）+ Task 13（渲染层落「文件已变动」） |
| 双路提案协议（`tool_calls` 与 ```mochen-patch 文本块） | Task 4（解析）+ Task 7（汇聚）+ Task 15（两条路都真跑过） |
| 歧义锚点不产提案，回喂「锚点不唯一」 | Task 4 + Task 7 |
| 三档权限（只读参考 / 可改当前章 / 全开），只读档一律拒绝并回喂 | Task 8 + Task 11（`permission-denied` 保持 pending） |
| 审批五态 y/a/p/d/Esc | Task 11（五种 decision 的后端语义）+ Task 14（五个按钮 + 说明框）；键位在 Plan 3 |
| `resolveEscape` 覆盖 §6.2 每种焦点组合 | Task 13（纯函数 6 用例）+ Task 14（卡内与全局各用一次） |
| 打断残留：已流出文本入库标注 `interrupted`、未完成 tool_call 视为不存在、提案保持 pending、状态行「已打断 · N 条待审」 | Task 3/7 + Task 13（状态行）+ Task 15 e2e 第四条 |
| 流中途断 / 非 2xx：已流出内容保留 + 状态行显示中断原因 + 支持「继续」 | Task 7（残字入库）+ Task 13（`endedAs`/`canContinue`/`continueTurn` 与状态行）+ Task 14（「继续」按钮，发固定指令而非重发上句） |
| 会话 JSONL 每章线程一份，首行 SessionMeta，坏行计入 droppedLines | Task 6 + Task 11 + Task 15 e2e 第一条 |
| 四层流式渲染（思考摘要 / 计划 / 正文 / 工具卡）+ 提案卡在下 | Task 14（`timeline.ts` 是唯一判定层，`.vue` 只展示） |
| 密钥只进主进程、只进 header、明文不落盘、渲染层只见掩码 | Task 9 + Task 3（wire）+ Task 12（单向 API）+ Task 15（桩只记 hasAuth） |
| provider 非 2xx / 网络失败 → 中文原因进对话流、轮次落 failed | Task 3 + Task 11 + Task 13 + Task 15 第三条 |
| 状态行 `工作中 · Ns · Esc 打断` | Task 13（`composeStatusLine`）+ Task 14（1s 心跳） |
| `pnpm smoke` 真窗口 + computer-use 三栏核对 | Task 15 Step 6 |
| 每片一次变异实验 | 每任务倒数第二步 + Task 16 的台账 |

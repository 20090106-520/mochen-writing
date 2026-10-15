# Token 用量统计（2026-10-15）

## 目标

给智能体每一轮对话加一条**如实**的 token 用量播报：上游报了就算、没报就明说没报，绝不用估算冒充实测。

## 侦察结论（已核实，不再重新论证）

- 全仓 API `usage` / `prompt_tokens` 零命中（仅模板使用次数 `usageCount` 不相关）。
- 流解析唯一入口 [provider-client.ts](file:///c:/Users/17863/Desktop/深渊写作/packages/agent-runtime/src/provider-client.ts#L383-L399) 目前只读 `choices[0].delta`，`usage` 字段从未被看过。
- [AgentTimeline.vue](file:///c:/Users/17863/Desktop/深渊写作/apps/desktop/src/renderer/src/components/AgentTimeline.vue#L177-L196) 模板以末尾 `v-else` 兜底渲染 message —— 不加新分支，usage 块会掉进 message 分支。
- 行数预算 `LIMIT=800` 覆盖 `packages` / `apps/desktop/src` / `tools` / `apps/desktop/scripts`（含测试文件）。

## 关键取舍（必须原样写进台账）

| 决策 | 内容 | 理由 |
| --- | --- | --- |
| **不改出站请求体** | 刻意**不加** `stream_options:{include_usage:true}` | 严格端点会整批 400（历史先例 2026-10-08 真机 400/422 `tools[9].function`）；这条改动本机无法验证。改成「上游报了就统计，没报就如实说没报」。台账须写明被放弃的覆盖率：OpenAI 官方端点默认不带 usage |
| **绝不估算** | 三枚数缺一即视为「没报」 | 宁可不报也不拿两个数凑第三个 |
| **后到覆盖先到** | 同一请求内 usage 是累计值 | 绝不逐帧相加 |
| **只在 reported>0 发事件** | reported===0 时一个字都不上屏 | 避免打断/失败轮的噪音 |
| **唯一收口** | runTurn 内 `finish()` 包裹全部 return | 6 个 return 点（行 200/252/262/324/407/410）+ finishInterrupted 全走同一处 |
| **丢弃逐轮发** | 只在轮末发一枚 | 逐轮发会把时间线刷成 N 行 |
| **不挂到 error/message** | usage 单独事件类型 | 语义不同，且需 requests/reported 两个计数 |
| **不复用 formatApproxTokens** | 用 `toLocaleString("zh-CN")` | 那是估算专用近似写法，拿它显示实报值等于把真数改写成约数 |

## 改动清单（精确到文件/函数）

### 1) 契约层

- **新建** `packages/contracts/src/token-usage.ts`（仿 `text-replace.ts` 先例）：
  - `export interface TokenUsage { promptTokens: number; completionTokens: number; totalTokens: number }`
- `packages/contracts/src/index.ts`：加一行 `export * from "./token-usage.js";`
- `packages/contracts/src/agent-event.ts`：
  - `AGENT_EVENT_TYPES` 追加 `"usage"`
  - discriminatedUnion 追加：
    `{ ...turn, type: z.literal("usage"), requests: int().min(0), reported: int().min(0), promptTokens: int().min(0), completionTokens: int().min(0), totalTokens: int().min(0) }`
    （requests=这一轮发了几次请求；reported=其中几次有回报；三枚数=已回报部分之和）

### 2) agent-runtime

- `packages/agent-runtime/src/provider-client.ts`：
  - `StreamEvent` 追加 `| { kind: "usage"; usage: TokenUsage }`
  - 新增 `readUsage(raw)`（紧挨 `readDelta`，同源守 wire 字段名处）：读 root `usage` 对象，`prompt_tokens`/`completion_tokens`/`total_tokens` **三枚都是有限非负整数**才算「报了用量」，缺一即 `null`
  - `streamChat`：在 `const delta = readDelta(raw)` **之后**、`if (delta.finishReason !== "")` **之前**，`const usage = readUsage(raw); if (usage !== null) yield { kind: "usage", usage };`
- `packages/agent-runtime/src/tool-loop.ts`：
  - 每轮在 `try { for await (const event of deps.stream(...))` **之前** `requests += 1`
  - 轮内 `roundUsage = event.usage`（覆盖）；流循环结束后 `if (roundUsage !== null) { reported += 1; 三枚数分别累加 }`
  - `const finish = (outcome: TurnOutcome): TurnOutcome => { emitUsage(); return outcome; }`，把 6 个 return 点与 `finishInterrupted` 的 return 全改成 `return finish(...)`

### 3) 渲染层

- **新建** `apps/desktop/src/renderer/src/utils/token-usage.ts`：
  - `turnUsageText(u)`：全报 → `本轮用量：输入 12,345 · 输出 678 · 合计 13,023 Token`；部分（reported<requests）追加 `（这轮共 N 次请求，其中 M 次上游没回报用量）`
  - `sessionUsageText(items)`：既无 user-message 也无 usage 事件 → 空串；否则 `用量：N 轮里 M 轮有上游回报，输入 … · 输出 … · 合计 … Token`；M===0 → `用量：还没有上游回报过（本会话 N 轮都没报）。`（N=user-message 事件数，M=usage 事件数）
  - 数字一律 `toLocaleString("zh-CN")`
- `apps/desktop/src/renderer/src/utils/timeline.ts`：新增 block `{ kind: "usage"; id: string; text: string }`；`buildTimeline` 里 `event.type === "usage"` 时用 `turnUsageText` 组好文案（模板只渲染 text）
- `apps/desktop/src/renderer/src/components/AgentTimeline.vue`：在 `block.kind === 'error'` 旁加 `v-else-if="block.kind === 'usage'"` 的 `<p class="usage-line">{{ block.text }}</p>`
- `apps/desktop/src/renderer/src/styles/agent-pane.css`：加 `.usage-line` 样式（照 `.error-line`/`.interrupted-line` 那一档）
- `apps/desktop/src/renderer/src/utils/agent-thread.ts` 的 `composeStatusReport`：parts 里插一行 `sessionUsageText(thread.items)`，空串就跳过

### 4) 自动生效、无需改（须在台账写明）

- 持久化走 `agent-service.ts` 的 `publish→appendAgentEvent`
- `rollout.ts` 的 `eventsToMessages` default 分支天然忽略 usage（不进模型历史）
- `agent-thread.ts` 的 `malformedPush` 读 `AGENT_EVENT_TYPES` 自动放行

## 验证

- 用例：provider-client（usage 块解析 / 三枚齐全才算 / 缺一算没报 / usage 与 finish_reason 同块也吐）；tool-loop（多轮相加、后到覆盖、一轮没报另一轮报了 → reported<requests、reported===0 不发事件、requests 计数）；timeline（usage 事件 → usage block）；token-usage（两档文案 + 空档 + 数字格式）；agent-thread（/status 含用量行）
- 变异实测（至少两处，红后原样回退）：「逐帧相加」→ 红；「reported===0 也发」→ 红
- 六段门禁：prettier `--check .` / 6 个 tsconfig 的 `tsc --noEmit` / eslint `--max-warnings=0` / check-package-boundary.mjs / check-source-line-budget.mjs / vitest run --maxWorkers=4
- 台账追加第六十七节到 `docs/superpowers/plans/2026-10-09-full-scan-report.md`

## 仓规

- 每刀六段门禁；不新增 npm 依赖；不引入组件库；铁律 6（同一判据只许一处真身）；诚实优先。
- **不碰**并行会话脏文件：`workbench-cta-emphasis.test.ts`、`conversation-pane.css`；提交只 `git add <明确文件名>`。
- PowerShell 环境：`pnpm` 不在 PATH（用 `node node_modules/...`），不支持 `&&`（用 `;`），不支持 heredoc（用 `$msg = @'...'@` 再 `git commit -m $msg`）。

## 剩余（仍等同用户一句话，不在本刀内）

通道级授权、LICENSE 字段、WebDAV/整书备份。

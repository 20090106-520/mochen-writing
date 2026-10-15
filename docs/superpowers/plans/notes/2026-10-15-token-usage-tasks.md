# tasks — Token 用量统计（2026-10-15）

对应 spec：`docs/superpowers/specs/2026-10-15-token-usage-spec.md`

## T1 契约层

- [x] 新建 `packages/contracts/src/token-usage.ts`：`TokenUsage` 接口
- [x] `packages/contracts/src/index.ts` 追加 `export * from "./token-usage.js";`
- [x] `packages/contracts/src/agent-event.ts`：`AGENT_EVENT_TYPES` 加 `"usage"`；discriminatedUnion 加 usage 事件（requests/reported/promptTokens/completionTokens/totalTokens 五枚 int().min(0)）

## T2 provider-client

- [x] `StreamEvent` 加 `{ kind: "usage"; usage: TokenUsage }`
- [x] 新增 `readUsage(raw)`：root `usage` 三枚有限非负整数齐才算报，缺一即 null
- [x] `streamChat` 在 `readDelta` 之后、`finishReason` 判断之前 yield usage

## T3 tool-loop

- [x] 每轮请求前 `requests += 1`
- [x] 轮内 `roundUsage` 覆盖；流循环后 `reported += 1` 且三枚累加
- [x] `finish()` 收口，包住全部 6 个 return 点 + finishInterrupted 的 return
- [x] 只在 `reported > 0` 发 usage 事件

## T4 渲染层

- [x] 新建 `apps/desktop/src/renderer/src/utils/token-usage.ts`（turnUsageText / sessionUsageText）
- [x] `utils/timeline.ts` 加 usage block + buildTimeline 分支
- [x] `components/AgentTimeline.vue` 加 usage 渲染分支
- [x] `styles/agent-pane.css` 加 `.usage-line`
- [x] `utils/agent-thread.ts` composeStatusReport 插入用量行

## T5 用例

- [x] provider-client 测试（单开 `provider-client-usage.test.ts`：行数预算所迫）
- [x] tool-loop 测试（单开 `tool-loop-usage.test.ts`：行数预算所迫）
- [x] timeline 测试
- [x] token-usage 测试（新建 `utils/token-usage.test.ts`）
- [x] agent-thread 测试（+ 同步更新既有 `useAgentStore.slash.test.ts` 的 /status 期望串）

## T6 变异实测

- [x] 「逐帧相加」变异 → 红（1 失败）→ 已原样回退
- [x] 「reported===0 也发」变异 → 红（14 失败）→ 已原样回退

## T7 六段门禁

- [x] prettier `--check .`
- [x] tsc --noEmit × 6 项目
- [x] eslint --max-warnings=0
- [x] check-package-boundary.mjs
- [x] check-source-line-budget.mjs（691 份）
- [x] vitest run --maxWorkers=4（353 文件 / 4567 通过 / 2 skipped）

## T8 台账与提交

- [x] `docs/superpowers/plans/2026-10-09-full-scan-report.md` 追加第六十七节（取舍、变异数、测试数变动、剩余三项）
- [x] `git add <明确文件名>` 提交（不 add 脏文件）—— commit `345e54a`

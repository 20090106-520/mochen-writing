/**
 * token 用量的中文文案层（2026-10-15）。
 *
 * 与 timeline.ts 同性质：这里全是「给一组事实、回一句中文」的纯函数，零 store 依赖，
 * 所以能直接被 node 单测覆盖。判据（谁算报、谁算没报）不在这一层——
 * 上游解析在 `provider-client.readUsage`，累计在 `tool-loop.runTurn`；
 * 这里只负责把**已经算好的数**说成人话。
 *
 * 【数字一律精确、绝不写「约」】用 `toLocaleString("zh-CN")` 出千分位。
 * **不复用** `context-meter.ts` 的 `formatApproxTokens`：那是「估算上下文占用」专用的
 * 近似写法（会输出「约 1.2 万」这种），拿它显示上游**实报**的值，等于把真数改写成约数
 * ——本条功能的正题就是「如实」，用近似格式自相矛盾。
 */
import type { AgentEvent } from "@mochen/contracts";

/** 一轮的用量事实（与 `usage` 事件去掉基字段后的形状一致）。 */
export interface TurnUsage {
  requests: number;
  reported: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 精确千分位（zh-CN）。只吃整数，上游已保证是非负有限整数。 */
function count(value: number): string {
  return value.toLocaleString("zh-CN");
}

/**
 * 一轮用量的那一行。
 *
 * 全报（reported === requests）：`本轮用量：输入 12,345 · 输出 678 · 合计 13,023 Token`。
 * 部分报（reported < requests）：追加一句「这轮共 N 次请求，其中 M 次上游没回报用量」
 * ——M = requests - reported，是**事实**不是估算：那几次是真的没给数，如实说出来。
 */
export function turnUsageText(usage: TurnUsage): string {
  const head = `本轮用量：输入 ${count(usage.promptTokens)} · 输出 ${count(usage.completionTokens)} · 合计 ${count(usage.totalTokens)} Token`;
  if (usage.reported < usage.requests) {
    const miss = usage.requests - usage.reported;
    return `${head}（这轮共 ${usage.requests} 次请求，其中 ${miss} 次上游没回报用量）`;
  }
  return head;
}

/**
 * 整条会话的用量汇总（`/status` 报告用）。
 *
 * N = 本会话的轮数（user-message 事件数），M = 有上游回报的轮数（usage 事件数）。
 * 两件事都没有（既没提问也没回报）→ 回空串，调用方跳过这一行，不硬凑一句。
 * 有提问但一次都没报过 → `用量：还没有上游回报过（本会话 N 轮都没报）。`
 * ——绝不拿「0 Token」冒充，那是把「没数」说成「用了零」。
 */
export function sessionUsageText(items: AgentEvent[]): string {
  let turns = 0;
  let reported = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const event of items) {
    if (event.type === "user-message") turns += 1;
    else if (event.type === "usage") {
      reported += 1;
      promptTokens += event.promptTokens;
      completionTokens += event.completionTokens;
      totalTokens += event.totalTokens;
    }
  }
  if (turns === 0 && reported === 0) return "";
  if (reported === 0) return `用量：还没有上游回报过（本会话 ${turns} 轮都没报）。`;
  return `用量：${turns} 轮里 ${reported} 轮有上游回报，输入 ${count(promptTokens)} · 输出 ${count(completionTokens)} · 合计 ${count(totalTokens)} Token`;
}

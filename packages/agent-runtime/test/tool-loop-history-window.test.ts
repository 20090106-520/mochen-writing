import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { agentEventSchema, type AgentEvent } from "@mochen/contracts";
import {
  assistantToolMessage,
  chatMessage,
  toolMessage,
  type ChatMessage
} from "../src/chat-message.js";
import { eventsToMessages } from "../src/rollout.js";
import { estimateTokens } from "../src/context.js";
import { fitHistoryToWindow, HISTORY_TOKEN_BUDGET, historyNotice } from "../src/history-window.js";
import type { StreamEvent } from "../src/provider-client.js";
import { runTurn, type TurnInput } from "../src/tool-loop.js";
import type { ToolHost, ToolOutcome } from "../src/tools.js";

/**
 * 扫描总单 P1-3 的**接线**那一半。
 *
 * `history-window.ts` 那 16 条用例证明的是纯函数切得对；这一份证明的是**这一轮真发出去的那笔请求**
 * 用的就是切过的那一段，并且「更早的 N 条没发给模型」这件事在事件流里留下了痕迹。
 * 只有前者没有后者，就是界面上多一块面板、线上照旧把整段历史端出去——上游报 context_length_exceeded
 * 时用户仍然只看得到「请求失败」，这条 P1 等于没修。
 */

interface Harness {
  events: AgentEvent[];
  sentMessages: ChatMessage[][];
}

function makeDeps(): { deps: Parameters<typeof runTurn>[0]; harness: Harness } {
  const harness: Harness = { events: [], sentMessages: [] };
  const controller = new AbortController();
  const hostOutcome: ToolOutcome = { ok: true, text: "", proposals: [] };
  const deps = {
    stream: async function* (req: { messages: ChatMessage[] }): AsyncGenerator<StreamEvent> {
      harness.sentMessages.push(req.messages.map((message) => ({ ...message })));
      yield { kind: "finish", reason: "stop" } as StreamEvent;
    },
    host: {
      context: () => ({ docRelPath: "chapters/01.md", permissionMode: "read-only" }),
      call: async () => hostOutcome
    } as unknown as ToolHost,
    emit: (event: AgentEvent) => harness.events.push(event),
    emitDelta: () => {},
    newId: () => "id1",
    now: () => "2026-10-10T08:00:00.000Z",
    signal: controller.signal,
    maxToolRounds: 2,
    provider: { baseURL: "http://x/v1", apiKey: "k", model: "m" }
  };
  return { deps, harness };
}

/** 一段约 `tokens` 的历史正文：CJK 一字约一枚 token， marker 用来认出这是第几轮。 */
function para(marker: string, tokens: number): string {
  return marker + "雾".repeat(tokens);
}

function turnOf(marker: string, tokens: number): ChatMessage[] {
  return [chatMessage("user", para(marker, tokens)), chatMessage("assistant", "收到。")];
}

function baseInput(history: ChatMessage[]): TurnInput {
  return {
    turnId: "t1",
    threadKey: "chapters/01.md",
    systemPrompt: "你是墨宸·主笔。",
    history,
    userText: "把开头改紧",
    thinkingLevel: "off",
    webSearchEnabled: false
  };
}

/** 明显超预算的长会话：每轮约 1000 tokens，10 轮 ≈ 10000，而 HISTORY_TOKEN_BUDGET 是 6000。 */
function longHistory(): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (let i = 1; i <= 10; i += 1) history.push(...turnOf(`T${i}`, 1000));
  return history;
}

/**
 * 那句切窗提示的**期望值**：用同一个纯函数（`historyNotice` ∘ `fitHistoryToWindow`）对着同一份入参
 * 再算一遍。不在用例里抄句子——抄了就只证明「用例没写错」，证明不了 runtime 与主进程说的是同一句。
 */
function expectedNotice(input: TurnInput): string {
  return historyNotice(
    fitHistoryToWindow({
      history: input.history,
      systemTokens: estimateTokens(input.systemPrompt),
      userTokens: estimateTokens(input.userText)
    })
  );
}

describe("runTurn 把历史切窗后再发出去（P1-3 接线）", () => {
  it("超过预算的长会话：发出去的那笔请求只带切过的尾巴，不再把整段历史端出去", async () => {
    const history = longHistory();
    expect(estimateTokens(history.map((m) => m.content).join(""))).toBeGreaterThan(
      HISTORY_TOKEN_BUDGET
    );

    const { deps, harness } = makeDeps();
    await runTurn(deps, baseInput(history));

    const sent = harness.sentMessages[0];
    expect(sent, "本轮至少要发过一次请求").toBeDefined();
    expect(sent![0]!.role).toBe("system");
    expect(sent![sent!.length - 1]!.content).toBe("把开头改紧");
    // 最早那几轮必须被切掉，最晚那一轮必须留着——两头都钉住才叫「从后往前留」。
    const bodies = sent!.map((m) => m.content).join("");
    expect(bodies.includes("T1雾"), "T1 已被裁掉").toBe(false);
    expect(bodies.includes("T10雾"), "最近的轮次不许裁").toBe(true);
    expect(sent!.length).toBeLessThan(history.length + 2);
  });

  it("切窗这件事在事件流里留痕：user-message 之后紧跟一条 error 事件，句子与主进程同源", async () => {
    const history = longHistory();
    const input = baseInput(history);
    const { deps, harness } = makeDeps();
    await runTurn(deps, input);

    // 走既有的 error 通路，不新造事件类型（2026-10-12 收口）：渲染层与回放认得 error，
    // 而原先那枚 history-truncated 在 apps/desktop/src 里消费方是零——盘上有事件、界面上什么都没有。
    const types = harness.events.map((event) => event.type);
    expect(types).toEqual(["user-message", "error"]);
    const event = harness.events[1];
    if (event?.type !== "error") throw new Error("没有发出切窗提示");
    expect(event.message).toBe(expectedNotice(input));
    // 数字仍然只有 fitHistoryToWindow 那一份：句里的条数 = 20 条历史里没进 kept 的那些。
    const dropped = Number(event.message.match(/更早的 (\d+) 条/)?.[1] ?? -1);
    expect(dropped).toBeGreaterThan(0);
    expect(dropped + (harness.sentMessages[0]!.length - 2)).toBe(history.length);
    // 字数同样读得懂：钉的是**字符**而不是 token（token 是本机估算，用户读不懂）。
    const chars = Number(event.message.match(/约 (\d+) 字/)?.[1] ?? -1);
    expect(chars).toBeGreaterThan(0);
  });

  it("短会话一个字都不裁，也不发切窗事件（不许为不存在的截断向用户道歉）", async () => {
    const history = [chatMessage("user", "上一章的结尾"), chatMessage("assistant", "雾散了。")];
    const { deps, harness } = makeDeps();
    await runTurn(deps, baseInput(history));

    const sent = harness.sentMessages[0]!;
    expect(sent.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(sent[1]!.content).toBe("上一章的结尾");
    expect(harness.events.map((event) => event.type)).toEqual(["user-message"]);
  });

  it("切点落在工具轮中间时整块同进同出：kept 里不许出现没有父 assistant 的孤儿 tool 回执", async () => {
    // 每轮 = user + assistant(带两笔调用) + 两条回执，单轮就超预算的一半 ⇒ 切点必然落在块边界上。
    const history: ChatMessage[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const tag = `K${i}`;
      history.push(
        chatMessage("user", para(tag, 1200)),
        assistantToolMessage("", [
          { id: `${tag}a`, name: "read_doc", args: para("args", 60) },
          { id: `${tag}b`, name: "read_doc", args: para("args", 60) }
        ]),
        toolMessage(`${tag}a`, para("回执甲", 400)),
        toolMessage(`${tag}b`, para("回执乙", 400))
      );
    }
    const { deps, harness } = makeDeps();
    await runTurn(deps, baseInput(history));

    const sent = harness.sentMessages[0]!;
    // 这份夹具必须**真的**发生截断，否则本用例是空跑（ vacuous 守卫是这类配对断言最常骗人的地方）。
    const notice = harness.events.find(
      (event) => event.type === "error" && /更早的 \d+ 条没有发给模型/.test(event.message)
    );
    expect(notice, "夹具没触发截断：这份用例什么都没证明").toBeDefined();
    const bodies = sent.map((m) => m.content).join("");
    expect(bodies.includes("K1雾"), "K1 应已被裁").toBe(false);
    expect(bodies.includes("K6雾"), "最近一轮必须留着").toBe(true);
    // 系统提示之后第一条不是 tool：孤儿回执发出去上游直接 400。
    expect(sent[1]!.role).not.toBe("tool");
    for (const [index, message] of sent.entries()) {
      if (message.role !== "tool") continue;
      const callId = message.toolCallId;
      const parent = sent.slice(0, index).find((m) => m.toolCalls.some((c) => c.id === callId));
      expect(parent, `第 ${index} 条 tool 回执（${callId}）没有同批的父 assistant`).toBeDefined();
    }
  });

  it("切窗那句能被 contracts 的 agentEventSchema 收下（回放读盘要过这道闸，过不去就是静默丢行）", async () => {
    const { deps, harness } = makeDeps();
    await runTurn(deps, baseInput(longHistory()));
    const event = harness.events[1]!;
    const parsed = agentEventSchema.safeParse(event);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("切窗那句不进对话正文：eventsToMessages 把 error 当元数据跳过，不冒充谁说了一句", () => {
    const notice = agentEventSchema.parse({
      id: "id1",
      ts: "2026-10-10T08:00:00.000Z",
      turnId: "t1",
      type: "error",
      message: "更早的 7 条没有发给模型（约 3512 字）。"
    });
    expect(eventsToMessages([notice])).toEqual([]);
  });

  it("退役的那枚事件类型不再被契约承认（这条红=有人把它加回来了，而渲染层仍然不吃它）", () => {
    const parsed = agentEventSchema.safeParse({
      id: "id1",
      ts: "2026-10-10T08:00:00.000Z",
      turnId: "t1",
      type: "history-truncated",
      droppedCount: 7,
      droppedChars: 3512
    });
    expect(
      parsed.success,
      "契约里又承认 history-truncated 了：截断那句的唯一通路是 error 事件"
    ).toBe(false);
  });

  it("runtime 源码里不残留第二种截断说法（普查到文本，注释里讲历史的那句不算）", () => {
    const src = readFileSync(new URL("../src/tool-loop.ts", import.meta.url), "utf8");
    expect(/type:\s*"history-truncated"/.test(src), "tool-loop 里又在发 history-truncated").toBe(
      false
    );
    // 反向对照：兜底那句确实是从 historyNotice 来的，不是在这儿现编的句子。
    expect(src, "tool-loop 不再经过 historyNotice，两处说法要分家了").toContain(
      "historyNotice(fit)"
    );
  });
});

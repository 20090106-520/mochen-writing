import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import { chatMessage, type ChatMessage } from "../src/chat-message.js";
import { ProviderError, type StreamEvent } from "../src/provider-client.js";
import { runTurn, type TurnInput } from "../src/tool-loop.js";
import type { ToolHost, ToolOutcome } from "../src/tools.js";

/**
 * token 用量累计（2026-10-15）——单开一文件是因为 `tool-loop.test.ts` 已顶到 800 行上限
 * （仓规 check-source-line-budget.mjs 对测试文件同样生效）。
 *
 * 钉三件事：① 一轮里上游报的数原样累加进整轮总计；② 同一请求内多帧 usage **后到覆盖先到**
 * （绝不逐帧相加）；③ `reported === 0` 时**一个字都不发**（失败轮/打断轮不刷噪音）。
 * requests 计的是「这一轮发了几次请求」，所以多轮时它 > 1。
 * 夹具是精简版：只保留用量用例真正用得到的 emit / stream / host 三件事。
 */
function makeDeps(script: StreamEvent[][], hostOutcome: ToolOutcome) {
  const events: AgentEvent[] = [];
  const sentMessages: ChatMessage[][] = [];
  let round = 0;
  const deps = {
    stream: async function* (req: { messages: ChatMessage[] }): AsyncGenerator<StreamEvent> {
      sentMessages.push(req.messages.map((message) => ({ ...message })));
      const eventsOfRound = script[round] ?? [{ kind: "finish", reason: "stop" } as StreamEvent];
      round += 1;
      for (const event of eventsOfRound) yield event;
    },
    host: {
      context: () => ({ docRelPath: "chapters/01.md", permissionMode: "read-only" }),
      call: async () => hostOutcome
    } as unknown as ToolHost,
    emit: (event: AgentEvent) => events.push(event),
    emitDelta: () => undefined,
    newId: (() => {
      let n = 0;
      return () => `id${(n += 1)}`;
    })(),
    now: () => "2026-10-01T08:00:00.000Z",
    signal: new AbortController().signal,
    maxToolRounds: 4,
    provider: { baseURL: "http://x/v1", apiKey: "k", model: "m" }
  };
  return { deps, events };
}

const input: TurnInput = {
  turnId: "t1",
  threadKey: "chapters/01.md",
  systemPrompt: "你是墨宸·主笔。",
  history: [chatMessage("user", "上一轮的审批结果：已写入")],
  userText: "把开头改紧",
  thinkingLevel: "off",
  webSearchEnabled: false
};

const OK: ToolOutcome = { ok: true, text: "读到内容", proposals: [] };

describe("runTurn · token 用量累计（2026-10-15）", () => {
  it("单轮全报 ⇒ 发一枚 usage：requests=1、reported=1、三枚数原样", async () => {
    const { deps, events } = makeDeps(
      [
        [
          { kind: "usage", usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 } },
          { kind: "finish", reason: "stop" }
        ]
      ],
      OK
    );
    await runTurn(deps, input);
    expect(events.at(-1)).toMatchObject({
      type: "usage",
      requests: 1,
      reported: 1,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150
    });
  });

  it("reported===0（上游一次都没报）⇒ 不发 usage 事件", async () => {
    const { deps, events } = makeDeps(
      [
        [
          { kind: "text-delta", text: "照常说" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      OK
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("done");
    expect(events.some((event) => event.type === "usage")).toBe(false);
  });

  it("同一请求内多帧 usage 后到覆盖先到：总计只取最后一帧，绝不逐帧相加", async () => {
    const { deps, events } = makeDeps(
      [
        [
          { kind: "usage", usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 } },
          { kind: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
          { kind: "finish", reason: "stop" }
        ]
      ],
      OK
    );
    await runTurn(deps, input);
    const usage = events.find((event) => event.type === "usage");
    expect(usage).toMatchObject({
      requests: 1,
      reported: 1,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
  });

  it("两轮都报 ⇒ 三枚数相加、requests=2、reported=2", async () => {
    const { deps, events } = makeDeps(
      [
        [
          { kind: "usage", usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } },
          { kind: "tool-call", call: { id: "c1", name: "read_doc", args: "{}" } },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "usage", usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 } },
          { kind: "finish", reason: "stop" }
        ]
      ],
      OK
    );
    await runTurn(deps, input);
    expect(events.at(-1)).toMatchObject({
      type: "usage",
      requests: 2,
      reported: 2,
      promptTokens: 300,
      completionTokens: 60,
      totalTokens: 360
    });
  });

  it("一轮没报、另一轮报了 ⇒ reported<requests，总计只含报了的那一轮", async () => {
    const { deps, events } = makeDeps(
      [
        [
          { kind: "tool-call", call: { id: "c1", name: "read_doc", args: "{}" } },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "usage", usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 } },
          { kind: "finish", reason: "stop" }
        ]
      ],
      OK
    );
    await runTurn(deps, input);
    expect(events.at(-1)).toMatchObject({
      type: "usage",
      requests: 2,
      reported: 1,
      promptTokens: 200,
      completionTokens: 40,
      totalTokens: 240
    });
  });

  it("失败轮：一发请求也没回报 ⇒ 不发 usage（requests 记账，但 reported 为 0）", async () => {
    const { deps, events } = makeDeps([[{ kind: "finish", reason: "stop" }]], OK);
    // 让这一发连接期就抛：requests 会 +1，但没有可信的数，于是不通报。
    const failing = {
      ...deps,
      stream: (): AsyncGenerator<StreamEvent> => {
        throw new ProviderError("无法连接模型服务端：fetch failed");
      }
    };
    const out = await runTurn(failing, input);
    expect(out.status).toBe("failed");
    expect(events.some((event) => event.type === "usage")).toBe(false);
  });
});

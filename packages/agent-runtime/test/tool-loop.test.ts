import { describe, expect, it } from "vitest";
import type { AgentEvent, EditProposal } from "@mochen/contracts";
import { chatMessage, type ChatMessage } from "../src/chat-message.js";
import { ProviderError, type StreamEvent } from "../src/provider-client.js";
import { runTurn, type TurnInput } from "../src/tool-loop.js";
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
    stream: async function* (req: {
      messages: ChatMessage[];
      signal: AbortSignal;
    }): AsyncGenerator<StreamEvent> {
      // 存快照而非引用：runTurn 会往同一个 messages 数组 push，第二轮会污染第一轮的记录。
      harness.sentMessages.push(req.messages.map((message) => ({ ...message })));
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
    maxToolRounds: 4,
    provider: { baseURL: "http://x/v1", apiKey: "k", model: "m" }
  };
  return { deps, harness, controller };
}

const input: TurnInput = {
  turnId: "t1",
  threadKey: "chapters/01.md",
  systemPrompt: "你是墨宸·主笔。",
  history: [chatMessage("user", "上一轮的审批结果：已写入")],
  userText: "把开头改紧",
  // 每轮两枚在这里只是夹具的默认态（关 + 不联网）。字段是必填的，缺了会炸在类型层，
  // 于是「循环把档位弄丢」只可能表现为断言红，不可能表现为悄悄不发。
  thinkingLevel: "off",
  webSearchEnabled: false
};

describe("runTurn", () => {
  it("纯文本回答：user-message → reasoning → message，delta 与定稿事件都在", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "reasoning-delta", text: "先想" },
          { kind: "text-delta", text: "开头" },
          { kind: "text-delta", text: "收紧了" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
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
          {
            kind: "tool-call",
            call: {
              id: "c1",
              name: "propose_patch",
              args: '{"doc":"chapters/01.md","anchor":"雾","replace":"海雾","why":"更具体"}'
            }
          },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "text-delta", text: "等你审批" },
          { kind: "finish", reason: "stop" }
        ]
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
    expect(harness.sentMessages[1]?.map((m) => m.role)).toEqual([
      "system",
      "user",
      "user",
      "assistant",
      "tool"
    ]);
  });

  it("计划块转成 plan 事件，围栏不进 message 正文", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          {
            kind: "text-delta",
            text: '先看计划：\n```mochen-plan\n{"items":["读章","起提案"]}\n```\n'
          },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
    await runTurn(deps, input);
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "plan", "message"]);
    expect(harness.events[1]?.type === "plan" && harness.events[1].items).toEqual([
      { text: "读章", done: false },
      { text: "起提案", done: false }
    ]);
    const message = harness.events[2];
    expect(message?.type === "message" && message.text).not.toContain("mochen-plan");
  });

  it("mochen-patch 文本块走双路 host.call：落工具卡与 proposal 事件，围栏不进正文（§6.1）", async () => {
    // 简报 7 用例只覆盖 mochen-plan，双路（§6.1）的 patch 文本块 → host.call 这条路没有任何用例；
    // 本条钉住：文本块也走同一个 host、落一张 tool-call 卡与一条 proposal 事件，pending 计数随之上升。
    const patchBlock =
      '给你：\n```mochen-patch\n{"doc":"chapters/01.md","anchor":"雾","replace":"海雾","why":"更具体"}\n```\n';
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "text-delta", text: patchBlock },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "提案 p1 已生成，等待用户审批", proposals: [proposal("p1")] }
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("done");
    expect(harness.events.map((e) => e.type)).toEqual([
      "user-message",
      "message",
      "tool-call",
      "proposal"
    ]);
    expect(harness.hostCalls[0]?.name).toBe("propose_patch");
    expect(harness.hostCalls[0]?.args).toMatchObject({ source: "text-block", anchor: "雾" });
    const message = harness.events[1];
    expect(message?.type === "message" && message.text).not.toContain("mochen-patch");
  });

  it("打断：已流出文本带 interrupted:true 入库，未收全的工具调用不产出，pending 提案数进 interrupted 事件（§6.3）", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "reasoning-delta", text: "想了一半" },
          { kind: "text-delta", text: "说了一半" }
        ]
      ],
      { ok: true, text: "", proposals: [] },
      1
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("interrupted");
    expect(harness.events.map((e) => e.type)).toEqual([
      "user-message",
      "reasoning",
      "message",
      "interrupted"
    ]);
    expect(harness.events[1]?.type === "reasoning" && harness.events[1].interrupted).toBe(true);
    expect(harness.events[2]?.type === "message" && harness.events[2].interrupted).toBe(true);
    expect(harness.events[3]?.type === "interrupted" && harness.events[3].pendingProposals).toBe(0);
    expect(harness.hostCalls).toEqual([]);
  });

  it("打断前已产出的提案数计入 interrupted 事件（§6.3 pendingProposals 传播）", async () => {
    // 上一轮的 0 只钉住「没有提案」，钉不了计数本身。这里让第一轮产出 1 条提案（走 tool-call 派发），
    // 循环继续到第二轮；第二轮在第 3 帧（index 2）才 abort，pendingProposals 必须带着 1 进 interrupted 事件。
    const { deps, harness } = makeDeps(
      [
        [
          {
            kind: "tool-call",
            call: {
              id: "c1",
              name: "propose_patch",
              args: '{"doc":"chapters/01.md","anchor":"雾","replace":"海雾","why":"更具体"}'
            }
          },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "reasoning-delta", text: "接着想" },
          { kind: "text-delta", text: "再说半句" },
          { kind: "text-delta", text: "被打断" }
        ]
      ],
      { ok: true, text: "提案 p1 已生成，等待用户审批", proposals: [proposal("p1")] },
      2
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("interrupted");
    const interrupted = harness.events.find((e) => e.type === "interrupted");
    expect(interrupted?.type === "interrupted" && interrupted.pendingProposals).toBe(1);
  });

  it("provider 失败：error 事件 + failed 收尾，原因中文可见（§9）", async () => {
    const harness: Harness = { events: [], deltas: [], hostCalls: [], sentMessages: [] };
    const out = await runTurn(
      {
        stream: async function* (): AsyncGenerator<StreamEvent> {
          throw new ProviderError("模型服务端返回 429：配额用尽");
          // 这条 yield 只为满足 eslint 的 require-yield：生成器首帧即抛错，runTurn 进 catch。
          yield { kind: "finish", reason: "stop" } as StreamEvent;
        },
        host: {
          context: () => ({ docRelPath: null, permissionMode: "read-only" }),
          call: async () => ({ ok: true, text: "", proposals: [] })
        } as unknown as ToolHost,
        emit: (event: AgentEvent) => harness.events.push(event),
        emitDelta: () => {},
        newId: () => "x",
        now: () => "2026-10-01T08:00:00.000Z",
        signal: new AbortController().signal,
        maxToolRounds: 4,
        provider: { baseURL: "http://x/v1", apiKey: "k", model: "m" }
      },
      input
    );
    expect(out.status).toBe("failed");
    expect(out.message).toContain("429");
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "error"]);
  });

  it("工具轮超过上限时停下并说明，不死循环", async () => {
    const alwaysTool: StreamEvent[][] = [
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
    // 上限计数的是「轮」而不是「次」：一轮可以派发好几个调用，单位写成「次」会误导用户。
    expect(out.message).toContain(`达到上限（${deps.maxToolRounds} 轮）`);
    expect(out.message).not.toMatch(/\d+\s*次/);
    expect(harness.hostCalls.length).toBe(4);
  });

  it("host 拒绝（ok:false）时照样回喂，循环不因拒绝而中断", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          {
            kind: "tool-call",
            call: {
              id: "c1",
              name: "write_doc",
              args: '{"doc":"chapters/01.md","content":"x","why":"试"}'
            }
          },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "text-delta", text: "明白了，我只给提案" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: false, text: "当前权限档为「只读参考」，提案不会写入磁盘。", proposals: [] }
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("done");
    // 第一轮没有 text-delta，故 tool-call 落在 index 1（index 2 是第二轮的收尾 message）。
    // 简报原写 events[2] 是与「工具轮」用例（第一轮有正文）混淆的下标笔误，此处按实际事件序校正，断言本身不变。
    const toolCall = harness.events[1];
    expect(toolCall?.type === "tool-call" && toolCall.ok).toBe(false);
    expect(toolCall?.type === "tool-call" && toolCall.resultText).toContain("只读参考");
  });

  it("未知名工具调用：error 事件与中文 tool 回执成对，第二轮绝不留悬空 tool_call", async () => {
    // §4 裁定：对模型请求的拒绝必须用中文回喂、绝不静默丢弃。
    // messages 里那条 assistant 消息带着**全部** calls，于是每条 call 都必须有自己的 tool 回执——
    // 缺回执时 toWireMessages 会发出无配对的 tool_calls，OpenAI 兼容端点直接 400，整轮被判 failed。
    // 混一条已知调用（c2）是为了证明「配对」是逐条的，不是「有一条回执就算过」。
    const unknownName = "delete_file";
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "tool-call", call: { id: "c1", name: unknownName, args: "{}" } },
          { kind: "tool-call", call: { id: "c2", name: "list_docs", args: "{}" } },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "text-delta", text: "好的，我改用列目录" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "清单", proposals: [] }
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("done");
    // 未知名的那条不派发 host，但必须在事件流里可见（UI 与审计日志靠这条 error）。
    expect(harness.hostCalls.map((c) => c.name)).toEqual(["list_docs"]);
    const errors = harness.events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    const reason = errors[0]?.type === "error" ? errors[0].message : "";
    expect(reason).toContain("不存在的工具");
    expect(reason).toContain(unknownName);
    // 第二轮发出去的消息：assistant 的每条 tool_call 都有配对的 tool 回执。
    const second = harness.sentMessages[1] ?? [];
    expect(second.map((m) => m.role)).toEqual([
      "system",
      "user",
      "user",
      "assistant",
      "tool",
      "tool"
    ]);
    const calls = second.find((m) => m.role === "assistant")?.toolCalls ?? [];
    const receipts = second.filter((m) => m.role === "tool");
    expect(calls.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(receipts.length).toBe(calls.length);
    expect(receipts.map((m) => m.toolCallId)).toEqual(["c1", "c2"]);
    // 回执正文就是那句中文，且与 error 事件同一句。
    expect(receipts[0]?.content).toContain("不存在的工具");
    expect(receipts[0]?.content).toBe(reason);
    expect(receipts[1]?.content).toBe("清单");
  });
});

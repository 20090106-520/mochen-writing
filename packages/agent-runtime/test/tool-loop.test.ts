import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, type AgentEvent, type EditProposal } from "@mochen/contracts";
import { wireToolsFor } from "../src/per-run-fields.js";
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
  /** 每次请求带出去的 tools 名字（出站那一跳的输入；provider-client 的 wireToolsFor 就作用在它上面）。 */
  sentTools: string[][];
}

function makeDeps(
  script: StreamEvent[][],
  hostOutcome: ToolOutcome,
  abortAfter?: number,
  /**
   * 第 N 次（1 起）host.call 执行**期间**按下打断键：真机情形就是「用户在搜索跑着的时候按了 Esc」。
   * P1-1 的③要的就是这一格——派发循环里那次 abort 检查只能在这种时序下才量得到。
   */
  abortOnHostCall?: number
) {
  const harness: Harness = {
    events: [],
    deltas: [],
    hostCalls: [],
    sentMessages: [],
    sentTools: []
  };
  const controller = new AbortController();
  let round = 0;
  const deps = {
    stream: async function* (req: {
      messages: ChatMessage[];
      tools: { name: string }[];
      signal: AbortSignal;
    }): AsyncGenerator<StreamEvent> {
      // 存快照而非引用：runTurn 会往同一个 messages 数组 push，第二轮会污染第一轮的记录。
      harness.sentMessages.push(req.messages.map((message) => ({ ...message })));
      harness.sentTools.push(req.tools.map((tool) => tool.name));
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
        if (abortOnHostCall === harness.hostCalls.length) controller.abort();
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
    const harness: Harness = {
      events: [],
      deltas: [],
      hostCalls: [],
      sentMessages: [],
      sentTools: []
    };
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

/**
 * P1-2：联网开关只门控出站清单、不门控执行。
 *
 * 关掉联网后 `wireToolsFor` 把 web_search 从发给模型的清单里摘掉了，可派发那一层原先
 * 静态放行花名册全部工具——模型只要**仿历史里那条 web_search** 调一次，照样真出网。
 * 所以这三条验的是「清单与执行同一份判据」，而不只是 body 里少一个名字。
 */
describe("runTurn · 联网关闭那一轮的执行闸（P1-2）", () => {
  const webSearchTurn: StreamEvent[][] = [
    [
      { kind: "tool-call", call: { id: "c1", name: "web_search", args: '{"query":"雾 写法"}' } },
      { kind: "finish", reason: "tool_calls" }
    ],
    [
      { kind: "text-delta", text: "那我基于已有文稿写" },
      { kind: "finish", reason: "stop" }
    ]
  ];

  it("关掉联网：模型仿历史调 web_search，派发层拒它、host 一次都没被叫，回执是一句能看懂的中文", async () => {
    const { deps, harness } = makeDeps(webSearchTurn, {
      ok: true,
      text: "来源：360 搜索\n[a] 某页",
      proposals: []
    });
    const out = await runTurn(deps, { ...input, webSearchEnabled: false });
    expect(out.status).toBe("done");
    // 真身没被叫到 = 一个字都没出网。这条断言才是 P1-2 的正身：清单过滤拦不住执行。
    expect(harness.hostCalls).toEqual([]);
    const card = harness.events.find((event) => event.type === "tool-call");
    expect(card?.type === "tool-call" && card.ok).toBe(false);
    const text = card?.type === "tool-call" ? card.resultText : "";
    expect(text).toContain("联网");
    expect(text).toContain("web_search");
    // 关掉的那一轮也不许给模型留悬空 tool_call：这条调用有配对回执，下一轮才发得出去。
    const second = harness.sentMessages[1] ?? [];
    expect(second.map((one) => one.role)).toEqual(["system", "user", "user", "assistant", "tool"]);
    expect(second[4]?.content).toContain("联网");
  });

  it("开着联网：同一份脚本照常派发到 host（闸只关该关的，不是把工具从花名册摘掉）", async () => {
    const { deps, harness } = makeDeps(webSearchTurn, {
      ok: true,
      text: "来源：360 搜索",
      proposals: []
    });
    const out = await runTurn(deps, { ...input, webSearchEnabled: true });
    expect(out.status).toBe("done");
    expect(harness.hostCalls.map((one) => one.name)).toEqual(["web_search"]);
    const card = harness.events.find((event) => event.type === "tool-call");
    expect(card?.type === "tool-call" && card.ok).toBe(true);
  });

  it("清单与执行是同一份判据：模型这一轮看得见哪几枚，就只叫得动哪几枚（逐枚对照开关两态）", async () => {
    for (const enabled of [true, false]) {
      for (const name of [...AGENT_TOOL_NAMES]) {
        const { deps, harness } = makeDeps(
          [
            [
              { kind: "tool-call", call: { id: "c1", name, args: "{}" } },
              { kind: "finish", reason: "tool_calls" }
            ],
            [{ kind: "finish", reason: "stop" }]
          ],
          { ok: true, text: "跑了", proposals: [] }
        );
        await runTurn(deps, { ...input, webSearchEnabled: enabled });
        // provider-client 拼 body 时对 req.tools 做的正是这一次映射，所以这里量的是真出站清单。
        const visible = wireToolsFor(
          (harness.sentTools[0] ?? []).map((tool) => ({ name: tool })),
          enabled
        ).map((tool) => tool.name);
        expect(harness.hostCalls.length === 1).toBe(visible.includes(name));
      }
    }
  });
});

/**
 * P1-1 的③：工具执行不受打断约束。
 *
 * 台账 README:6399 那条「联网开着挂 200 秒零响应零报错」的另一半原因就在这里：
 * 用户按了 Esc，而派发循环从头到尾没查过 signal，于是这一轮的工具照样一个个跑完。
 */
describe("runTurn · 工具派发要受打断约束（P1-1 的③）", () => {
  const twoCalls: StreamEvent[][] = [
    [
      { kind: "tool-call", call: { id: "c1", name: "list_docs", args: "{}" } },
      { kind: "tool-call", call: { id: "c2", name: "search_docs", args: '{"query":"雾"}' } },
      { kind: "finish", reason: "tool_calls" }
    ],
    [{ kind: "finish", reason: "stop" }]
  ];

  it("第一条工具跑到一半按下打断：第二条不再执行，逐条留下回执并按 interrupted 干净收尾", async () => {
    const { deps, harness } = makeDeps(
      twoCalls,
      { ok: true, text: "跑了", proposals: [] },
      undefined,
      1
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("interrupted");
    expect(harness.hostCalls.map((one) => one.name)).toEqual(["list_docs"]);
    const cards = harness.events.filter((event) => event.type === "tool-call");
    expect(cards.length).toBe(2);
    expect(cards[0]?.type === "tool-call" && cards[0].ok).toBe(true);
    const skipped = cards[1];
    expect(skipped?.type === "tool-call" && skipped.ok).toBe(false);
    expect(skipped?.type === "tool-call" ? skipped.resultText : "").toContain("打断");
    expect(harness.events.at(-1)?.type).toBe("interrupted");
  });

  it("工具执行期间才按下的打断，不许再往上游发下一笔请求（每轮开头也查 signal）", async () => {
    const { deps, harness } = makeDeps(
      [[{ kind: "tool-call", call: { id: "c1", name: "list_docs", args: "{}" } }], []],
      { ok: true, text: "跑了", proposals: [] },
      undefined,
      1
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("interrupted");
    expect(harness.sentMessages.length).toBe(1);
    expect(harness.events.at(-1)?.type).toBe("interrupted");
  });
});

/**
 * P2-5（2026-10-10 扫描总单）：被截断的一轮必须是一个**上屏的事实**。
 *
 * 上游回 `finish_reason:"length"`（撞到输出上限）或流断成 `"incomplete"` 时，原先与正常 `stop`
 * 走的是同一条路：循环只看 `collected.calls.length === 0` 就 `done` 收尾，界面上写「完成」。
 * 用户读到半截回答、还以为模型答完了；那一轮里没传完的 tool_call 更是连一张卡都没留下。
 *
 * 修法用既有通路，不新造事件类型：
 *   - 轮级事实 → 既有的 `error` 事件（进时间线、写 lastError；历史切窗那句走的是同一条先例）；
 *   - 半截调用 → 既有的 `tool-call` 事件配一句 `ok:false` 回执，与 SKIPPED_BY_INTERRUPT 同款口径。
 */
describe("runTurn · 被截断的一轮要上屏（P2-5）", () => {
  it("finish_reason:length：回答之外多发一条 error，说清这段不是完整回答", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "text-delta", text: "开头改紧了" },
          { kind: "finish", reason: "length" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
    const out = await runTurn(deps, input);
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "message", "error"]);
    const error = harness.events[2];
    const message = error?.type === "error" ? error.message : "";
    expect(message).toContain("截断");
    // 内容已经流出去、也落了盘，这一轮不该被改判成失败；「没答完」由那条 error 说。
    expect(out.status).toBe("done");
  });

  it("断流收尾 incomplete：同样上屏，句子说的是「流断了」而不是「长度上限」", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "text-delta", text: "说到一半" },
          { kind: "finish", reason: "incomplete" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
    const out = await runTurn(deps, input);
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "message", "error"]);
    const message = harness.events[2]?.type === "error" ? harness.events[2].message : "";
    expect(message).toContain("流");
    expect(message).not.toContain("长度上限");
    expect(out.status).toBe("done");
  });

  it("正常 stop 收尾不许冒出截断那句话（不许对答完的人道歉）", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "text-delta", text: "写完了" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
    await runTurn(deps, input);
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "message"]);
  });

  it("参数没收全的 tool_call 回一条 ok:false 的配对回执：同一 callId、host 一次都没被叫", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          {
            kind: "tool-call-truncated",
            call: { id: "c1", name: "read_doc", args: '{"doc": "c' }
          },
          { kind: "finish", reason: "tool_calls" }
        ]
      ],
      { ok: true, text: "这条绝不该被执行", proposals: [] }
    );
    const out = await runTurn(deps, input);
    const card = harness.events[1];
    if (card?.type !== "tool-call") throw new Error("半截调用没有落成回执卡");
    expect(card.callId).toBe("c1");
    expect(card.tool).toBe("read_doc");
    expect(card.args).toBe('{"doc": "c');
    expect(card.ok).toBe(false);
    expect(card.resultText).toContain("没有被执行");
    // 派发没发生 = 一半都没跑；用户看得见这张卡，而不是以为模型答完了。
    expect(harness.hostCalls).toEqual([]);
    expect(out.status).toBe("done");
  });

  it("半截参数绝不回喂上游：那张卡只上屏，不进 messages（回喂就是 400）", async () => {
    // 上一轮的 assistant 消息只带**收全的**那些调用；本轮的 messages 里既没有半截 tool_call，
    // 也没有为它配的 tool 回执——因为半截 JSON 一旦出站，严格端点整批拒收。
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "tool-call", call: { id: "c1", name: "list_docs", args: "{}" } },
          {
            kind: "tool-call-truncated",
            call: { id: "c2", name: "read_doc", args: '{"doc": "chap' }
          },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "text-delta", text: "那我看清单来写" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "跑了", proposals: [] }
    );
    await runTurn(deps, input);
    const second = harness.sentMessages[1] ?? [];
    const calls = second.find((m) => m.role === "assistant")?.toolCalls ?? [];
    expect(calls.map((c) => c.id)).toEqual(["c1"]);
    expect(second.filter((m) => m.role === "tool").map((m) => m.toolCallId)).toEqual(["c1"]);
    expect(JSON.stringify(second)).not.toContain('{"doc": "chap');
    // 两条都要在事件流里看得见：收全的那条 ok:true，半截的那条 ok:false（卡片顺序不作数）。
    const executed = harness.events.find((e) => e.type === "tool-call" && e.callId === "c1");
    const droppedCard = harness.events.find((e) => e.type === "tool-call" && e.callId === "c2");
    expect(executed?.type === "tool-call" && executed.ok).toBe(true);
    expect(droppedCard?.type === "tool-call" && droppedCard.ok).toBe(false);
    expect(droppedCard?.type === "tool-call" ? droppedCard.resultText : "").toContain("没有被执行");
  });

  it("打断的那一路不冒截断句：半截参数本来就是这次 Esc 的产物", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "text-delta", text: "说了一半" },
          {
            kind: "tool-call-truncated",
            call: { id: "c1", name: "read_doc", args: '{"doc"' }
          },
          { kind: "finish", reason: "aborted" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
    const out = await runTurn(deps, input);
    expect(out.status).toBe("interrupted");
    expect(harness.events.map((e) => e.type)).toEqual(["user-message", "message", "interrupted"]);
  });
});

describe("runTurn · 工具与打断的鲁棒性（2026-10-14 审计项 1/2）", () => {
  it("工具炸了不掀桌：host.call 抛异常折成 ok:false 回执，回合照常收尾", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          {
            kind: "tool-call",
            call: { id: "c1", name: "read_doc", args: '{"path":"chapters/01.md"}' }
          },
          { kind: "finish", reason: "tool_calls" }
        ],
        [
          { kind: "text-delta", text: "重来" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
    deps.host.call = async () => {
      throw new Error("盘没挂上");
    };
    const out = await runTurn(deps, input);
    // 异常没有掀翻整轮：第二轮照常发出，回合 done。
    expect(harness.sentMessages.length).toBe(2);
    expect(out.status).toBe("done");
    // 模型拿到的是一张说得清原因的失败回执，而不是整轮崩掉。
    const receipt = harness.events.find((e) => e.type === "tool-call");
    expect(receipt?.type === "tool-call" && receipt.ok).toBe(false);
    expect(receipt?.type === "tool-call" && receipt.resultText).toContain("执行异常");
    expect(receipt?.type === "tool-call" && receipt.resultText).toContain("盘没挂上");
  });

  it("打断与异常竞态：人已叫停时逃出的异常只算余波，回合折成 interrupted 而不是 failed", async () => {
    const { deps, harness, controller } = makeDeps([[{ kind: "text-delta", text: "说一半" }]], {
      ok: true,
      text: "",
      proposals: []
    });
    const inner = deps.stream;
    // 原流收完之后先 abort 再抛：真机情形就是「取消与错误帧/坏帧撞在同一拍」。
    deps.stream = async function* (req) {
      yield* inner(req);
      controller.abort();
      throw new Error("竞态里逃出的坏帧");
    };
    const out = await runTurn(deps, input);
    expect(out.status).toBe("interrupted");
    // 界面该说「已打断」：error 事件不许出现，failed 那条路一步都没走。
    expect(harness.events.some((e) => e.type === "error")).toBe(false);
    expect(harness.events.some((e) => e.type === "interrupted")).toBe(true);
  });
});

describe("runTurn · maxToolRounds 的守卫（2026-10-14 审计项 7）", () => {
  it("传 0 不再静默返回空结果：至少跑一轮，模型照常说话", async () => {
    const { deps, harness } = makeDeps(
      [
        [
          { kind: "text-delta", text: "说" },
          { kind: "finish", reason: "stop" }
        ]
      ],
      { ok: true, text: "", proposals: [] }
    );
    const out = await runTurn({ ...deps, maxToolRounds: 0 }, input);
    expect(out.status).toBe("done");
    expect(harness.sentMessages.length).toBe(1);
  });
});

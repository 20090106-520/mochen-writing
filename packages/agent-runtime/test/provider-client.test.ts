import { describe, expect, it } from "vitest";
import {
  streamChat,
  ProviderError,
  type ProviderFetchResult,
  type StreamEvent
} from "../src/provider-client.js";
import { chatMessage } from "../src/chat-message.js";

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
    fetchImpl: async (input: {
      url: string;
      headers: Record<string, string>;
      body: string;
    }): Promise<ProviderFetchResult> => {
      seen.push({ url: input.url, headers: input.headers, body: input.body });
      if (status >= 200 && status < 300)
        return { status, stream: chunkStream(chunks), errorText: "" };
      return { status, stream: null, errorText };
    }
  };
}

async function run(
  fetchImpl: Parameters<typeof streamChat>[0]["fetchImpl"],
  signal = new AbortController().signal
) {
  const out: StreamEvent[] = [];
  for await (const event of streamChat({
    fetchImpl,
    baseURL: "http://127.0.0.1:8787/v1",
    apiKey: "sk-secret-token",
    model: "test-model",
    messages: [chatMessage("user", "改一下")],
    tools: [
      { name: "read_doc", description: "读文稿", parameters: { type: "object", properties: {} } }
    ],
    signal
  }))
    out.push(event);
  return out;
}

// Task 15 §7 的最小复现夹具：真实 socket 被打断时，未收完的 reader.read() 是直接 reject
// AbortError（DOMException: "This operation was aborted"），不是返回 {done:true}，也不是
// 「消费者主动停止」。上面三条 abort 用例的假处所正在于此——它们永远收不到这条 reject，
// 所以 provider-client.ts 帧循环缺守卫的洞藏了 12 个任务。
function abortRejectingStream(
  chunks: Uint8Array[],
  signal: AbortSignal
): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
      // 流尚未收完：等到 abort 为止，然后让「下一次 read」reject——与真 fetch 的时序一致。
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    }
  };
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
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "read_doc", arguments: '{"doc"' } }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: ': "chapters/01.md"}' } }]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
      )
    );
    const events = await run(fetchImpl);
    expect(events).toEqual([
      {
        kind: "tool-call",
        call: { id: "c1", name: "read_doc", args: '{"doc": "chapters/01.md"}' }
      },
      { kind: "finish", reason: "tool_calls" }
    ]);
  });

  it("两个并行工具调用按 index 顺序产出，缺 id 时补可复现的 id", async () => {
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 1, function: { name: "search_docs", arguments: "{}" } }]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { name: "list_docs", arguments: "{}" } }]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
      )
    );
    const events = await run(fetchImpl);
    const calls = events.filter((e) => e.kind === "tool-call");
    expect(calls.map((c) => (c.kind === "tool-call" ? c.call.name : ""))).toEqual([
      "list_docs",
      "search_docs"
    ]);
    expect(calls.every((c) => (c.kind === "tool-call" ? c.call.id : "").startsWith("call_"))).toBe(
      true
    );
  });

  it("非 2xx 抛中文 ProviderError 且带状态码与响应片段", async () => {
    const { fetchImpl } = makeFetch([], 500, "upstream model busy");
    await expect(run(fetchImpl)).rejects.toThrow(/500/);
    await expect(run(fetchImpl)).rejects.toBeInstanceOf(ProviderError);
  });

  // ===== F-5：非 2xx 的用户可见句子不许是裸 JSON =====
  // 钉整句用 toBe 而不是 toContain：toContain 守不住「不带花括号」这件事。
  async function failMessage(
    fetchImpl: Parameters<typeof streamChat>[0]["fetchImpl"]
  ): Promise<string> {
    let message = "";
    try {
      await run(fetchImpl);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    return message;
  }

  it("错误体是嵌套 error.message 的 JSON 时只取那句中文，整句不带花括号", async () => {
    const { fetchImpl } = makeFetch([], 503, '{"error":{"message":"上游繁忙，请稍后再试"}}');
    expect(await failMessage(fetchImpl)).toBe("模型服务端返回 503：上游繁忙，请稍后再试");
  });

  it("顶层 message 也算：取它而不是原样 JSON", async () => {
    const { fetchImpl } = makeFetch([], 429, '{"message":"额度不足"}');
    expect(await failMessage(fetchImpl)).toBe("模型服务端返回 429：额度不足");
  });

  it("非 JSON 的 HTML 错误体：压平后原样带上，不抛异常也不被当 JSON", async () => {
    const { fetchImpl } = makeFetch([], 502, "<html>502 Bad Gateway</html>");
    const message = await failMessage(fetchImpl);
    expect(message).toBe("模型服务端返回 502：<html>502 Bad Gateway</html>");
    expect(message).not.toContain('{"error"');
  });

  it("畸形 JSON（截断的错误体）不许把轮次搞崩，退回压平截断", async () => {
    const { fetchImpl } = makeFetch([], 503, '{"error":{"message":"x"');
    expect(await failMessage(fetchImpl)).toBe('模型服务端返回 503：{"error":{"message":"x"');
  });

  it("error.message 为空串时不取空串，退回原样片段", async () => {
    const { fetchImpl } = makeFetch([], 503, '{"error":{"message":""}}');
    expect(await failMessage(fetchImpl)).toBe('模型服务端返回 503：{"error":{"message":""}}');
  });

  it("取出来的 message 同样受 200 字截断", async () => {
    const { fetchImpl } = makeFetch(
      [],
      503,
      JSON.stringify({ error: { message: "忙".repeat(250) } })
    );
    expect(await failMessage(fetchImpl)).toBe(`模型服务端返回 503：${"忙".repeat(200)}…`);
  });

  it("空响应体仍说「无响应体」，不因为新增的解析分支变成裸空串", async () => {
    const { fetchImpl } = makeFetch([], 500, "");
    expect(await failMessage(fetchImpl)).toBe("模型服务端返回 500：无响应体");
  });

  it("abort 时安静收尾为 aborted，不抛错也不产出半截工具调用", async () => {
    const controller = new AbortController();
    // 桩流带一个真实的半截 tool_calls 分片（id + name + 截断的 arguments），随后 abort。
    // 这条就是在钉 spec §6.3 规则 2：参数未收全的 tool_call 绝不交给下游。
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "read_doc", arguments: '{"doc"' } }
                ]
              }
            }
          ]
        },
        { choices: [{ delta: { content: "半" } }] }
      )
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

  it("流提前断开且工具参数未收全时，丢弃半截调用并收尾为 incomplete", async () => {
    // 无 finish_reason、也无 abort：走非 abort 的 incomplete 收尾分支（F2 修复点）。
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "read_doc", arguments: '{"doc"' } }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: ': "c' } }] }
            }
          ]
        }
      )
    );
    const events = await run(fetchImpl);
    expect(events).toEqual([{ kind: "finish", reason: "incomplete" }]);
  });

  it("流提前断开但工具参数已收全时，incomplete 收尾仍交出完整调用", async () => {
    // 反向钉桩：门禁只丢半截，不丢收全的（防止退化成「incomplete 一律丢弃」）。
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "read_doc", arguments: '{"doc"' } }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: ': "chapters/01.md"}' } }] }
            }
          ]
        }
      )
    );
    const events = await run(fetchImpl);
    expect(events).toEqual([
      {
        kind: "tool-call",
        call: { id: "c1", name: "read_doc", args: '{"doc": "chapters/01.md"}' }
      },
      { kind: "finish", reason: "incomplete" }
    ]);
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

  it("空 data 帧跳过：裸 data: 与只有空白的 data: 都不许打断整条流", async () => {
    const enc = new TextEncoder();
    const { fetchImpl } = makeFetch([
      enc.encode("data:\n\n"),
      enc.encode("data:  \n\n"),
      ...sse({ choices: [{ delta: { content: "继续" } }] }),
      ...sse({ choices: [{ delta: {}, finish_reason: "stop" }] })
    ]);
    expect(await run(fetchImpl)).toEqual([
      { kind: "text-delta", text: "继续" },
      { kind: "finish", reason: "stop" }
    ]);
  });

  it("正常收尾（finish_reason）也必须丢弃参数未收全的工具调用（§6.3）", async () => {
    // 钉 parked 项 (a)：finish_reason 分支此前只按 name==="" 过滤，不看 arguments 是否收全，
    // 于是截断的工具参数会在「端点正常收尾」这条路上被原样交给下游（Task 8 会直接 JSON.parse 炸）。
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "read_doc", arguments: '{"doc": "c' } }
                ]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
      )
    );
    // 断言完整事件序列：半截调用被丢弃，只剩收尾的 finish；等价于「不产出 tool-call」。
    expect(await run(fetchImpl)).toEqual([{ kind: "finish", reason: "tool_calls" }]);
  });

  it("abort 后停止消费后续帧：只产出已流出文本，第二帧 delta 绝不出现", async () => {
    // 钉 parked 项 (b)：断流守卫的独特性质是「abort 后不再消费后续帧」，
    // 此前没有任何用例专门触达循环内守卫（Task 3 fix-round 把 abort 落在最后一帧后失Cover）。
    // 用完整序列断言（非 containment）：frames [半, 句]，abort 落在两帧之间 ⇒ 句 不得产出。
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
    expect(events).toEqual([
      { kind: "text-delta", text: "半" },
      { kind: "finish", reason: "aborted" }
    ]);
  });

  it("只有工具名、端点根本不发 arguments 字段的调用是合法调用，正常收尾必须产出", async () => {
    // 反向钉 parked (a) 的门禁：list_docs 这类无参工具的 arguments 字段常常整个不缺省，
    // readDelta 于是把 held.args 留在空串。而 tools.ts 的 dispatchToolCall 明写
    // `call.args === "" ? "{}" : call.args`——空串按「无参」处理，是收全的合法调用。
    // 若 argumentsComplete("") 判 false，模型这条调用就会在这里被静默丢弃。
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "list_docs" } }] } }
          ]
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "tool-call", call: { id: "c1", name: "list_docs", args: "" } },
      { kind: "finish", reason: "tool_calls" }
    ]);
  });

  it("arguments 为空串的 name-only 调用在断流收尾（无 finish_reason）时同样不得丢弃", async () => {
    // 同一条性质的另一条路径：两个收尾分支共用 argumentsComplete，判定必须一致。
    const { fetchImpl } = makeFetch(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "c1", function: { name: "list_docs", arguments: "" } }]
            }
          }
        ]
      })
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "tool-call", call: { id: "c1", name: "list_docs", args: "" } },
      { kind: "finish", reason: "incomplete" }
    ]);
  });

  it("连接阶段就已打断：fetch 直接 reject 也安静收为 aborted，绝不抛错", async () => {
    // 这条钉 fetch 的 .catch 里的连接期守卫：abort 落在 fetch 之前/期间时，端点的 reject
    // 是 AbortError，不是「连不上」。下一轮 fetch 的拒绝只有靠它才变成 finish:aborted（→ interrupted），
    // 抽掉它整轮会被 runTurn 判成 failed。
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = async (): Promise<ProviderFetchResult> => {
      throw new TypeError("This operation was aborted");
    };
    expect(await run(fetchImpl, controller.signal)).toEqual([
      { kind: "finish", reason: "aborted" }
    ]);
  });

  it("读流期打断：read() 在 abort 后 reject AbortError 也折成 finish:aborted，绝不外抛", async () => {
    // 钉 §7 的上游缺口：真 fetch 被打断后是 read 直接 reject，**收不到下一帧**，
    // 所以循环内 aborted 检查（:147）与连接期守卫（:119-138）都救不了它。
    // 与连接期守卫同性质：aborted 时按现有语义收成 finish:aborted；未打断则原样抛。
    const controller = new AbortController();
    const chunks = sse({ choices: [{ delta: { reasoning_content: "想了一半" } }] });
    const fetchImpl = async (): Promise<ProviderFetchResult> => ({
      status: 200,
      stream: abortRejectingStream(chunks, controller.signal),
      errorText: ""
    });
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
      if (event.kind === "reasoning-delta") controller.abort();
    }
    expect(events).toEqual([
      { kind: "reasoning-delta", text: "想了一半" },
      { kind: "finish", reason: "aborted" }
    ]);
  });
});

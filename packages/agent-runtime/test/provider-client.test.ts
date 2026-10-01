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
});

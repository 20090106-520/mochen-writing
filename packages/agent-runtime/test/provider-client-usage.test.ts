import { describe, expect, it } from "vitest";
import { streamChat, type ProviderFetchResult, type StreamEvent } from "../src/provider-client.js";
import { chatMessage } from "../src/chat-message.js";

/**
 * token 用量（2026-10-15）——单开一文件是因为 `provider-client.test.ts` 已顶到 800 行上限
 * （仓规 check-source-line-budget.mjs 对测试文件同样生效）。
 *
 * `usage` 是**上游报的事实**，不是估算：三枚数齐才算报，缺一枚就当它没报（回 null，一个字都不冒）。
 * 这里钉三件：
 *   1. 三枚齐全 ⇒ 原样吐一枚 `usage` 事件；
 *   2. 缺一枚 / 非有限非负整数 ⇒ **不吐**（宁可不报，也不拿两个数凑第三个）；
 *   3. usage 与 finish_reason 同帧（DeepSeek 类）时，usage 必须先于 finish 到达。
 * 注意时序：`streamChat` 一读到 finish_reason 就 return，所以 usage 帧必须先于 finish 帧到达
 * （真实端点里 usage 要么与 finish 同帧，要么紧挨在它前面）。
 */
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

function makeFetch(chunks: Uint8Array[]) {
  return async (): Promise<ProviderFetchResult> => ({
    status: 200,
    stream: chunkStream(chunks),
    errorText: ""
  });
}

function requestOf(
  fetchImpl: Parameters<typeof streamChat>[0]["fetchImpl"],
  signal: AbortSignal
): Parameters<typeof streamChat>[0] {
  return {
    fetchImpl,
    baseURL: "http://127.0.0.1:8787/v1",
    apiKey: "sk-secret-token",
    model: "test-model",
    messages: [chatMessage("user", "改一下")],
    tools: [
      { name: "read_doc", description: "读文稿", parameters: { type: "object", properties: {} } }
    ],
    signal,
    thinkingLevel: "off",
    webSearchEnabled: false,
    retryDelayMs: 1
  };
}

async function run(fetchImpl: Parameters<typeof streamChat>[0]["fetchImpl"]) {
  const out: StreamEvent[] = [];
  const signal = new AbortController().signal;
  for await (const event of streamChat(requestOf(fetchImpl, signal))) out.push(event);
  return out;
}

describe("streamChat · token 用量（2026-10-15）", () => {
  it("三枚数齐全 ⇒ 吐一枚 usage，驼峰命名、数值原样", async () => {
    const fetchImpl = makeFetch(
      sse(
        { choices: [{ delta: { content: "写完了" } }] },
        {
          usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
          choices: [{ delta: {}, finish_reason: "stop" }]
        }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "text-delta", text: "写完了" },
      { kind: "usage", usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 } },
      { kind: "finish", reason: "stop" }
    ]);
  });

  it("usage 单独一帧（choices 为空数组，OpenAI 类）也能读到", async () => {
    const fetchImpl = makeFetch(
      sse(
        { usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 }, choices: [] },
        { choices: [{ delta: {}, finish_reason: "stop" }] }
      )
    );
    const events = await run(fetchImpl);
    expect(events).toContainEqual({
      kind: "usage",
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 }
    });
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "stop" });
  });

  it("缺 total_tokens ⇒ 视为没报，不吐 usage（也不拿两数凑第三个）", async () => {
    const fetchImpl = makeFetch(
      sse({
        usage: { prompt_tokens: 120, completion_tokens: 30 },
        choices: [{ delta: {}, finish_reason: "stop" }]
      })
    );
    expect(await run(fetchImpl)).toEqual([{ kind: "finish", reason: "stop" }]);
  });

  it("缺 prompt_tokens ⇒ 视为没报，不吐 usage", async () => {
    const fetchImpl = makeFetch(
      sse({
        usage: { completion_tokens: 30, total_tokens: 150 },
        choices: [{ delta: {}, finish_reason: "stop" }]
      })
    );
    expect(await run(fetchImpl)).toEqual([{ kind: "finish", reason: "stop" }]);
  });

  it("数值是小数 / 负数 / 字符串 / 缺失 ⇒ 一律视为没报", async () => {
    const bad = [
      { prompt_tokens: 1.5, completion_tokens: 30, total_tokens: 150 },
      { prompt_tokens: -1, completion_tokens: 30, total_tokens: 150 },
      { prompt_tokens: "120", completion_tokens: 30, total_tokens: 150 },
      { prompt_tokens: 120, completion_tokens: 30, total_tokens: null }
    ];
    for (const usage of bad) {
      const fetchImpl = makeFetch(sse({ usage, choices: [{ delta: {}, finish_reason: "stop" }] }));
      expect(await run(fetchImpl)).toEqual([{ kind: "finish", reason: "stop" }]);
    }
  });

  it("没有 usage 字段的普通帧 ⇒ 不吐 usage（反向守卫：不许误伤正常流）", async () => {
    const fetchImpl = makeFetch(
      sse(
        { choices: [{ delta: { content: "照常说" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "text-delta", text: "照常说" },
      { kind: "finish", reason: "stop" }
    ]);
  });

  it("同一发请求里多帧 usage（累计值）⇒ 逐帧原样吐，覆盖的活留给循环层", async () => {
    // provider-client 只负责**报事实**：收到几帧就吐几帧，它绝不自己相加。
    // 「后到覆盖先到」是 tool-loop 的职责（那是累计层）。
    const fetchImpl = makeFetch(
      sse(
        { usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, choices: [] },
        { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, choices: [] },
        { choices: [{ delta: {}, finish_reason: "stop" }] }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "usage", usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 } },
      { kind: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { kind: "finish", reason: "stop" }
    ]);
  });
});

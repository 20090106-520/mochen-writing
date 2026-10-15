import { describe, expect, it } from "vitest";
import {
  retryWaitMsOf,
  streamChat,
  type ProviderFetchResult,
  type StreamEvent
} from "../src/provider-client.js";
import { chatMessage } from "../src/chat-message.js";

// 与 provider-client.test.ts 的同名夹具同口径（重试间隔钉在 1ms）。
// 为什么单独成文：行数预算（单文件 800 行）装不下两块完整的行为面——
// 连接期重试这一族整体搬到这里，主文件留给流式解析与带内错误帧。
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
    tools: [],
    signal,
    thinkingLevel: "off",
    webSearchEnabled: false,
    // 连接期重试的间隔压到 1ms：错误类用例（429/5xx）会走一次重试，不注入就是 1.5 秒 ×N 条。
    retryDelayMs: 1
  };
}

async function run(
  fetchImpl: Parameters<typeof streamChat>[0]["fetchImpl"],
  signal = new AbortController().signal
) {
  const out: StreamEvent[] = [];
  for await (const event of streamChat(requestOf(fetchImpl, signal))) out.push(event);
  return out;
}

describe("streamChat · 连接期一次性自动重试（2026-10-11）", () => {
  /** 状态序列桩：第 i 次调用回 statuses[i]，用尽后一直回最后一个。 */
  function sequentialFetch(statuses: number[], errorText = "") {
    let calls = 0;
    const fetchImpl = async (): Promise<ProviderFetchResult> => {
      const status = statuses[Math.min(calls, statuses.length - 1)]!;
      calls += 1;
      if (status >= 200 && status < 300)
        return {
          status,
          stream: chunkStream(
            sse(
              { choices: [{ delta: { content: "好" } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] }
            )
          ),
          errorText: ""
        };
      return { status, stream: null, errorText };
    };
    return { fetchImpl, calls: () => calls };
  }

  it("429 闪断 → 默哀后重试一次，第二次 200 正常出流", async () => {
    const { fetchImpl, calls } = sequentialFetch([429, 200]);
    const events = await run(fetchImpl);
    expect(calls()).toBe(2);
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "stop" });
  });

  it("500 后仍 500 → 照旧抛 ProviderError，不无限重试", async () => {
    const { fetchImpl, calls } = sequentialFetch([500, 500], "busy");
    await expect(run(fetchImpl)).rejects.toThrow(/500/);
    expect(calls()).toBe(2);
  });

  it("401 不重试：请求本身不对，再试只是原样再错一次", async () => {
    const { fetchImpl, calls } = sequentialFetch([401, 200]);
    await expect(run(fetchImpl)).rejects.toThrow(/401/);
    expect(calls()).toBe(1);
  });

  it("已经吐出字节的轮绝不重放：流中途坏了只报错，fetch 只发一次", async () => {
    // 反向守卫（2026-10-15，预登记方案的最后一道闸）：重试只许发生在「连接期」——
    // 也就是一个字节都还没吐给用户的时候。一旦流开始吐字节（这里先吐一个 text-delta
    // 再断线），后面无论出什么错都**不许**重新发一次请求：重放会把用户已经看见的半截
    // 回答再吐一遍（正文凭空重复），比「报错」坏得多。这条性质目前由代码结构保证
    // （重试循环在读流之前，见 provider-client.ts:288-336），本用例把结构钉成事实——
    // 将来若有人顺手把「失败就重试」包到整段请求上，这里当场红。
    let calls = 0;
    const out: StreamEvent[] = [];
    const fetchImpl = async (): Promise<ProviderFetchResult> => {
      calls += 1;
      return {
        status: 200,
        stream: {
          async *[Symbol.asyncIterator]() {
            yield sse({ choices: [{ delta: { content: "半截" } }] })[0]!;
            throw new Error("模拟读流中途连接断了");
          }
        },
        errorText: ""
      };
    };
    await expect(
      (async () => {
        for await (const event of streamChat(requestOf(fetchImpl, new AbortController().signal)))
          out.push(event);
      })()
    ).rejects.toThrow(/连接断/);
    expect(calls).toBe(1); // 重放的话会变 2 —— 用户就会把「半截」看两遍
    expect(out).toEqual([{ kind: "text-delta", text: "半截" }]);
  });

  it("重试等待期间被打断 → 安静收尾 aborted，不再发第二次", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = async (): Promise<ProviderFetchResult> => {
      calls += 1;
      return { status: 429, stream: null, errorText: "rate limited" };
    };
    // 这里不能走 run()（它把重试间隔钉在 1ms，会抢在 20ms 的打断前发完第二发）：
    // 间隔 200ms、打断 20ms——打断必然落在默哀期内。
    const pending = (async () => {
      const out: StreamEvent[] = [];
      for await (const event of streamChat({
        ...requestOf(fetchImpl, controller.signal),
        retryDelayMs: 200
      }))
        out.push(event);
      return out;
    })();
    setTimeout(() => controller.abort(), 20);
    const events = await pending;
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "aborted" });
    expect(calls).toBe(1);
  });
});

describe("retryWaitMsOf · 等多久的判定真身（2026-10-14 审计项 7）", () => {
  it("测试钉死的 retryDelayMs 最优先", () => {
    expect(
      retryWaitMsOf(
        { retryDelayMs: 1 },
        { status: 429, stream: null, errorText: "", retryAfterMs: 9_000 }
      )
    ).toBe(1);
  });

  it("其次听上游的 Retry-After，封顶 60 秒", () => {
    expect(
      retryWaitMsOf({}, { status: 429, stream: null, errorText: "", retryAfterMs: 4_000 })
    ).toBe(4_000);
    expect(
      retryWaitMsOf({}, { status: 503, stream: null, errorText: "", retryAfterMs: 600_000 })
    ).toBe(60_000);
    expect(retryWaitMsOf({}, { status: 503, stream: null, errorText: "", retryAfterMs: 0 })).toBe(
      1_500
    );
  });

  it("都没有才落到默认默哀", () => {
    expect(retryWaitMsOf({}, undefined)).toBe(1_500);
    expect(retryWaitMsOf({}, { status: 500, stream: null, errorText: "busy" })).toBe(1_500);
  });
});

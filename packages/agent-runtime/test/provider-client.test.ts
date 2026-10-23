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
    // 本文件管的是流式解析与打断，每轮两枚恒为默认态；它们到字节的那一段住在 per-run-fields.test.ts。
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

/** 与 run 同一份请求，但把「抛」也读回来：带内错误那几条既要验抛出的句子，也要验抛之前已经产出的增量。 */
async function runSettled(
  fetchImpl: Parameters<typeof streamChat>[0]["fetchImpl"],
  signal = new AbortController().signal
) {
  const events: StreamEvent[] = [];
  let error: unknown = null;
  try {
    for await (const event of streamChat(requestOf(fetchImpl, signal))) events.push(event);
  } catch (caught) {
    error = caught;
  }
  return { events, error };
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

  // ===== 2026-10-23 真机走查：网关退回工具清单时不许直出内部异常 =====
  it("工具清单被网关退回（serde 反序列化报错）→ 翻成人话并指出下一步", async () => {
    const raw =
      "***.BadRequestError: OpenAIException - Failed to deserialize the JSON body into the target type: " +
      "tools[9].function: missing field `parameters` at line 1 column 8706";
    const { fetchImpl } = makeFetch([], 422, JSON.stringify({ error: { message: raw } }));
    const message = await failMessage(fetchImpl);
    expect(message).toContain("模型服务端返回 422：");
    // 说清是「第几个工具 + 缺什么」并指向插件那一栏——原文给的这三样，用户能真去查。
    expect(message).toContain("第 10 个工具");
    expect(message).toContain("parameters");
    expect(message).toContain("插件");
    // 反向：内部异常的特征串一个都不许留。
    expect(message).not.toContain("Failed to deserialize");
    expect(message).not.toContain("tools[9]");
    expect(message).not.toContain("column 8706");
    expect(message).not.toContain("BadRequestError");
  });

  it("翻译只认那一种形状：不带 tools[N] 的英文错误体仍旧原样透传", async () => {
    const { fetchImpl } = makeFetch([], 500, "Failed to deserialize something else entirely");
    expect(await failMessage(fetchImpl)).toBe(
      "模型服务端返回 500：Failed to deserialize something else entirely"
    );
  });

  /* 2026-10-22：选错模态时上游回的是英文（「Model X is an image model. Use /v1/images/generations」）。
     这句话用户读不懂，也看不出下一步该干什么——翻成人话，并点明去哪儿换模型。 */
  it("选到图像模型：翻译成一句能照着做的话，并带上模型名", async () => {
    const { fetchImpl } = makeFetch(
      [],
      400,
      JSON.stringify({
        error: {
          message:
            "Model agnes-image-2.1-flash is an image model. Use /v1/images/generations instead."
        }
      })
    );
    expect(await failMessage(fetchImpl)).toBe(
      "模型服务端返回 400：「agnes-image-2.1-flash」是图像生成模型，不能用来对话；请在左下角齿轮（设置）里换一个对话模型。"
    );
  });

  it("选到视频模型：同一套说法，不把视频说成图像", async () => {
    const { fetchImpl } = makeFetch(
      [],
      400,
      JSON.stringify({ message: "Model agnes-video-2.5 is a video model." })
    );
    const message = await failMessage(fetchImpl);
    expect(message).toContain("视频生成模型");
    expect(message).not.toContain("图像生成模型");
  });

  it("上游原文没有对应的下一步时不擅自改写：不知道的就原样留着", async () => {
    const { fetchImpl } = makeFetch([], 400, '{"error":{"message":"Bad request: unknown field"}}');
    expect(await failMessage(fetchImpl)).toBe("模型服务端返回 400：Bad request: unknown field");
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

  it("error.message 为全空白：按空处理退回压平后的原样片段，而不是走「无响应体」", async () => {
    // provider-client.ts:58 的 candidate.trim() 把纯空白 message 归零 ⇒ upstreamMessage 返回 "" ⇒
    // errorHint 退回 flat（原样片段）。删掉 trim 后 candidate 保持 "   "（非空），
    // errorHint 走 snippet("   ")="" ⇒ 调用处 || "无响应体" ⇒ 结果变成「无响应体」。
    // 这条正是能区分 trim 有/无的断言（评审 M14：当前无断言能区分）。
    const { fetchImpl } = makeFetch([], 503, '{"error":{"message":"   "}}');
    expect(await failMessage(fetchImpl)).toBe('模型服务端返回 503：{"error":{"message":" "}}');
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
      signal: controller.signal,
      thinkingLevel: "off",
      webSearchEnabled: false
    })) {
      events.push(event);
      if (event.kind === "text-delta") controller.abort();
    }
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "aborted" });
    expect(events.some((e) => e.kind === "tool-call")).toBe(false);
    // P2-5 的反向半边：用户自己按下的打断不是「模型被截断」，不该冒出截断回执去道歉。
    expect(events.some((e) => e.kind === "tool-call-truncated")).toBe(false);
  });

  it("流提前断开且工具参数未收全时，收尾标 incomplete 并把半截调用如实递出去", async () => {
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
    // P2-5 改的就是「丢弃」这个动作本身：半截调用不再静默消失，而是以
    // tool-call-truncated 递出去，由 runTurn 落成一张 ok:false 的回执卡。
    // 「不许伪装成可执行调用」这半边一个字没松（下面紧邻的 length 用例同钉这一点）。
    expect(events).toEqual([
      { kind: "tool-call-truncated", call: { id: "c1", name: "read_doc", args: '{"doc": "c' } },
      { kind: "finish", reason: "incomplete" }
    ]);
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

  it("正常收尾（finish_reason）也不许把参数未收全的调用伪装成可执行调用（§6.3 + P2-5）", async () => {
    // 钉 parked 项 (a)：端点正常收尾时，参数未收全的 tool_call 仍然**不能**当可执行调用交出去——
    // Task 8 会把这些 arguments 原样 JSON.parse，半截串就炸。
    // P2-5 补上另一半：它不再是「静默丢弃」，而是一条 tool-call-truncated，界面上要看得见。
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
    // 断言完整事件序列：可执行的那条没有产出，取而代之的是截断标记 + 收尾原因。
    expect(await run(fetchImpl)).toEqual([
      { kind: "tool-call-truncated", call: { id: "c1", name: "read_doc", args: '{"doc": "c' } },
      { kind: "finish", reason: "tool_calls" }
    ]);
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
      signal: controller.signal,
      thinkingLevel: "off",
      webSearchEnabled: false
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
      signal: controller.signal,
      thinkingLevel: "off",
      webSearchEnabled: false
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

/**
 * P1-1 的①：上游空闲看门狗抛的那句话必须**原样**到用户眼前。
 *
 * 中文句子始终住在抛它的那一行（本仓既有约定），而 provider-client 对连接期的任何异常都套一层
 * `无法连接模型服务端：`。套在裸 `fetch failed` 上是对的（那句英文用户读不懂），
 * 套在**已经是人话**的看门狗句子上就变成两句话叠在一起、还谎称「连不上」——
 * 真机情形是「连上了，是它不回话」。所以这里按 ProviderError 分流：已经成人话的不再套。
 */
describe("streamChat · 看门狗句子不许二次包装（P1-1 的①）", () => {
  const hangMessage = "模型服务端 30 秒没有给出任何响应，已停止等待。";

  it("fetchImpl 抛的是 ProviderError（看门狗那句）：整句原样上抛，不再加前缀", async () => {
    const fetchImpl = async (): Promise<ProviderFetchResult> => {
      throw new ProviderError(hangMessage);
    };
    const caught = await run(fetchImpl).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(caught).toBe(hangMessage);
    expect(caught).not.toContain("无法连接模型服务端");
  });

  it("裸网络错误仍然套上「无法连接模型服务端」：它自己不是人话", async () => {
    const fetchImpl = async (): Promise<ProviderFetchResult> => {
      throw new Error("fetch failed");
    };
    const caught = await run(fetchImpl).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    );
    expect(caught).toContain("无法连接模型服务端");
    expect(caught).toContain("fetch failed");
  });
});

/**
 * P2-5（2026-10-10 扫描总单）：`finish_reason:"length"` 与断流 `"incomplete"` 都不是「答完了」。
 *
 * 改之前这两种收尾与正常 `stop` 走的是同一条路——收尾原因虽然原样递下去了，但攒到一半、
 * JSON 解析不了的 tool_call 在两个收尾分支里都是 `continue` 直接消失，界面上什么痕迹都没有。
 * 这一层要钉住的有两件：
 *   1. 收尾原因照原样递（`length` / `incomplete` 不许被折成 `stop`，那句人话由 runTurn 组）；
 *   2. 半截调用改成一条独立的 `tool-call-truncated`，**不再静默**，但它也绝不冒充可执行调用。
 */
describe("streamChat · 被截断的收尾不再等于答完（P2-5）", () => {
  it("finish_reason:length 且参数没收全 ⇒ 截断标记与 length 原因两条都递出去", async () => {
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
        { choices: [{ delta: {}, finish_reason: "length" }] }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "tool-call-truncated", call: { id: "c1", name: "read_doc", args: '{"doc": "c' } },
      { kind: "finish", reason: "length" }
    ]);
  });

  it("finish_reason:length 但参数已经收全 ⇒ 那条调用照常可执行（截断不等于一律作废）", async () => {
    // 反向钉桩：新事件类型只收「解析不了」的那些。把门禁扩成「length 一律丢弃」会让
    // 模型这一轮真的能做的调用凭空消失——那是同一个洞的另一面。
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "list_docs", arguments: "{}" } }
                ]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: "length" }] }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "tool-call", call: { id: "c1", name: "list_docs", args: "{}" } },
      { kind: "finish", reason: "length" }
    ]);
  });

  it("两条调用一条收全一条半截 ⇒ 收全的照常执行、半截的单独标记，顺序仍按 index", async () => {
    // 逐条判定，不是「这一轮有半截就整批作废」，也不是「有一条能跑就把半截的那条藏起来」。
    const { fetchImpl } = makeFetch(
      sse(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "list_docs", arguments: "{}" } },
                  {
                    index: 1,
                    id: "c2",
                    function: { name: "read_doc", arguments: '{"doc": "chap' }
                  }
                ]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: "length" }] }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "tool-call", call: { id: "c1", name: "list_docs", args: "{}" } },
      { kind: "tool-call-truncated", call: { id: "c2", name: "read_doc", args: '{"doc": "chap' } },
      { kind: "finish", reason: "length" }
    ]);
  });
});

/**
 * 带内错误帧（2026-10-14 第三方审计核对出的真缺口）。
 *
 * 上游可以在 **HTTP 200** 的流里夹一条 `{"error":…}`——Azure 与各家 OpenAI 兼容网关的常见形态，
 * 限流、超长、内容审核都走这一条。改之前它一路被吞：`sse.ts` 一个帧内只取 `data:` 字段，
 * `readDelta` 对这条帧读出全空（没有 choices），于是界面最后只剩 `truncationNotice("incomplete")`
 * 那句「响应流在中途断了」，而上游给的真实原因一个字都没到过人眼前。
 */
describe("streamChat · 带内错误帧不再静默吞", () => {
  it("error 帧带 message ⇒ 抛 ProviderError 且原话上屏，抛出前的增量照常产出", async () => {
    const { fetchImpl } = makeFetch(
      sse(
        { choices: [{ delta: { content: "前半段" } }] },
        { error: { message: "This key is rate limited" } }
      )
    );
    const { events, error } = await runSettled(fetchImpl);
    expect(events).toEqual([{ kind: "text-delta", text: "前半段" }]);
    expect(error).toBeInstanceOf(ProviderError);
    // 整句钉住：这句是给用户看的，前缀改了界面就换了一个说法而没人会发现。
    expect((error as Error).message).toBe("模型服务端在流里回了错误：This key is rate limited");
  });

  it("error 是字符串 ⇒ 那句话原样带上，不折成「无响应体」", async () => {
    const { fetchImpl } = makeFetch(sse({ error: "内容审核未通过" }));
    const { error } = await runSettled(fetchImpl);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toContain("内容审核未通过");
  });

  it("error 只有 type 没有 message ⇒ 仍然抛，并把 type 说出口", async () => {
    // 这一条钉的是「取不到 message 就不当错误」这个坏死法：overloaded_error 那种帧
    // 一句 message 都没有，若按 message 判空就会照旧静默。
    const { fetchImpl } = makeFetch(sse({ error: { type: "overloaded_error" } }));
    const { error } = await runSettled(fetchImpl);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toContain("overloaded_error");
  });

  it("error 为 null 或压根没有 error 键 ⇒ 正常流完（反向守卫：这臂不许误伤正常帧）", async () => {
    const { fetchImpl } = makeFetch(
      sse(
        { error: null, choices: [{ delta: { content: "照常说" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] }
      )
    );
    expect(await run(fetchImpl)).toEqual([
      { kind: "text-delta", text: "照常说" },
      { kind: "finish", reason: "stop" }
    ]);
  });

  it("已经打断 ⇒ 带内错误帧不越过打断，仍折成 finish:aborted", async () => {
    // 打断优先是既有语义（帧循环开头那道守卫），这条钉的是新判定**不许**插到它前面：
    // 用户按了 Esc 之后界面该说「已打断」，不该说「模型服务端回了错误」。
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = makeFetch(sse({ error: { message: "本该看不见的一条" } }));
    const { events, error } = await runSettled(fetchImpl, controller.signal);
    expect(error).toBeNull();
    expect(events).toEqual([{ kind: "finish", reason: "aborted" }]);
  });
});

import { describe, expect, it } from "vitest";
import { thinkingBodyField, webSearchToolEntry } from "../src/per-run-fields.js";
import { streamChat, type ProviderFetchResult } from "../src/provider-client.js";
import { chatMessage } from "../src/chat-message.js";

/**
 * 每轮开关到出站字节的唯一映射（task #101，裁定 W1）。
 *
 * 字段名的盘上依据来自参考仓 deepwrite 的 pi-runtime-adapter（只读勘探，抄的是它已经跑通的形状）：
 * - `reasoning_effort`：OpenAI 兼容 /chat/completions 的公开参数，且它的测试明确断言
 *   「关掉思考时 payload 里不许有这个键」（`not.toHaveProperty("reasoning_effort")`）——
 *   本仓同样用反向用例钉住，因为「发 reasoning_effort: "off"」在不少端点上会被 400。
 * - 联网：deepwrite 对 OpenAI 兼容出口是把 `{ type: "web_search" }` 追加进 tools 数组
 *   （`appendDeepSeekWebSearchTool`），不是往 body 顶层塞自造字段。本仓照这个形状走。
 */
function sseStop(): Uint8Array[] {
  const enc = new TextEncoder();
  return [
    enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`)
  ];
}

async function sendOnce(req: {
  thinkingLevel: "off" | "low" | "medium" | "high";
  webSearchEnabled: boolean;
}): Promise<Record<string, unknown>> {
  const seen: string[] = [];
  const fetchImpl = async (input: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<ProviderFetchResult> => {
    seen.push(input.body);
    return {
      status: 200,
      stream: (async function* () {
        for (const chunk of sseStop()) yield chunk;
      })(),
      errorText: ""
    };
  };
  // 这里要的只是「生成器走到发请求那一步」：取一帧就 return() 收流，不装作在读正文。
  const iterator = streamChat({
    fetchImpl,
    baseURL: "http://127.0.0.1:8787/v1",
    apiKey: "sk-test",
    model: "mochen-mock",
    messages: [chatMessage("user", "改一下")],
    tools: [
      { name: "read_doc", description: "读文稿", parameters: { type: "object", properties: {} } }
    ],
    signal: new AbortController().signal,
    thinkingLevel: req.thinkingLevel,
    webSearchEnabled: req.webSearchEnabled
  })[Symbol.asyncIterator]();
  await iterator.next();
  // return 的形参类型是 TReturn（这里是 void），裸调 return() 过不了 tsc，所以显式给 undefined。
  await iterator.return?.(undefined);
  const bodyText = seen.length === 1 ? seen[0] : undefined;
  if (bodyText === undefined)
    throw new Error(`一次 streamChat 必须恰好发出一笔请求，实际 ${seen.length} 笔`);
  return JSON.parse(bodyText) as Record<string, unknown>;
}

describe("thinkingBodyField", () => {
  it("off 一个字段都不发；其余三档发 reasoning_effort 且值就是档位", () => {
    expect(thinkingBodyField("off")).toEqual({});
    expect(thinkingBodyField("low")).toEqual({ reasoning_effort: "low" });
    expect(thinkingBodyField("medium")).toEqual({ reasoning_effort: "medium" });
    expect(thinkingBodyField("high")).toEqual({ reasoning_effort: "high" });
  });

  // 反向保护：不许出现 reasoning_effort: "off" 这种写法——关思考靠「不发字段」，不靠发一个 off 值。
  it("任何一档的输出里都不含字符串 off", () => {
    for (const level of ["off", "low", "medium", "high"] as const)
      expect(JSON.stringify(thinkingBodyField(level))).not.toContain("off");
  });
});

describe("webSearchToolEntry", () => {
  it("关 ⇒ 空数组；开 ⇒ 一枚 type=web_search 的工具条目，不带 function 壳", () => {
    expect(webSearchToolEntry(false)).toEqual([]);
    expect(webSearchToolEntry(true)).toEqual([{ type: "web_search" }]);
  });
});

describe("streamChat 把两枚开关写进出站 body", () => {
  it("默认（off + 不联网）的 body 既没有 reasoning_effort 也没有 web_search 条目", async () => {
    const body = await sendOnce({ thinkingLevel: "off", webSearchEnabled: false });
    expect(body).not.toHaveProperty("reasoning_effort");
    const tools = body.tools as Record<string, unknown>[];
    expect(tools.some((t) => t.type === "web_search")).toBe(false);
  });

  it("思考开到 high 时 body 带 reasoning_effort=high，其余字段不受影响", async () => {
    const body = await sendOnce({ thinkingLevel: "high", webSearchEnabled: false });
    expect(body.reasoning_effort).toBe("high");
    expect(body.model).toBe("mochen-mock");
    expect(body.stream).toBe(true);
  });

  it("联网打开时 tools 追加 web_search，原有那枚 function 工具一个字都不少", async () => {
    const body = await sendOnce({ thinkingLevel: "off", webSearchEnabled: true });
    const tools = body.tools as Record<string, unknown>[];
    expect(tools.length).toBe(2);
    expect(tools[0]).toEqual({
      type: "function",
      function: {
        name: "read_doc",
        description: "读文稿",
        parameters: { type: "object", properties: {} }
      }
    });
    expect(tools[1]).toEqual({ type: "web_search" });
  });

  it("两枚一起开时两个形状同时成立（不许互相覆盖）", async () => {
    const body = await sendOnce({ thinkingLevel: "medium", webSearchEnabled: true });
    expect(body.reasoning_effort).toBe("medium");
    expect((body.tools as Record<string, unknown>[])[1]).toEqual({ type: "web_search" });
  });
});

import { describe, expect, it } from "vitest";
import { THINKING_WIRE_FIELD } from "@mochen/contracts";
import { thinkingBodyField, wireToolsFor } from "../src/per-run-fields.js";
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
 *   （`appendDeepSeekWebSearchTool`）。本仓照抄过一次，2026-10-08 被真机打掉——
 *   严格端点要求 tools 里每一条都带完整 `function.parameters`，裸条目会让整笔请求 400/422。
 *   现在的形状：联网开关只决定 `web_search` 这枚 function 工具有没有出站，见下面那条反向钉。
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
    // 两枚工具：一枚书稿工具 + 一枚 web_search。联网开关要 gate 的就是后者，
    // 只喂一枚的话「关掉少一条」这条断言根本没有鉴别力（少的那条是谁都看不出来）。
    tools: [
      { name: "read_doc", description: "读文稿", parameters: { type: "object", properties: {} } },
      {
        name: "web_search",
        description: "联网搜索",
        parameters: { type: "object", properties: {} }
      }
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

/**
 * 思考档的**线格式映射**（2026-10-09 批次 5-㊻）。
 *
 * 真机回执（Agnes AI Hub）：`Unexpected reasoning effort high. Supported types are
 * xhigh (default), medium, and low.` —— 它照收 low/medium，唯独最高那一档叫 xhigh。
 * 我们发 `high` 上去**整笔请求 400**，症状是「地址与密钥全对，但一个字都发不出去」，
 * 与当初 MiMo 只认 `api-key` 头是同一族死法。
 */
describe("thinkingBodyField · 连接级线格式（批次 5-㊻）", () => {
  it("standard：原样发 high（OpenAI 兼容的通用值）", () => {
    expect(thinkingBodyField("high", "standard")).toEqual({ reasoning_effort: "high" });
  });

  it("xhigh：最高那一档换成 xhigh", () => {
    expect(thinkingBodyField("high", "xhigh")).toEqual({ reasoning_effort: "xhigh" });
  });

  it("**只有最高档变**：low / medium 两档两家一致，一律原样", () => {
    for (const level of ["low", "medium"] as const) {
      expect(thinkingBodyField(level, "standard")).toEqual({ [THINKING_WIRE_FIELD]: level });
      expect(thinkingBodyField(level, "xhigh")).toEqual({ [THINKING_WIRE_FIELD]: level });
    }
  });

  it("关档在两种线格式下都不发字段（映射不许把 off 变成 xhigh 或别的什么）", () => {
    expect(thinkingBodyField("off", "standard")).toEqual({});
    expect(thinkingBodyField("off", "xhigh")).toEqual({});
  });

  it("反向后发的那枚字：xhigh 端点上最高档发出去的**值**不是 high", () => {
    // 注意这里钉的是**值**，不是子串：「xhigh」这个串本身含「high」，
    // 用 toContain 反钉会自己误伤自己（第一版就是这么写的，当场红）。
    const body = thinkingBodyField("high", "xhigh");
    expect(body[THINKING_WIRE_FIELD]).toBe("xhigh");
    expect(body[THINKING_WIRE_FIELD] === "high").toBe(false);
  });

  it("省略第二参 = standard（旧调用方不改行为，也与旧配置一致）", () => {
    expect(thinkingBodyField("high")).toEqual(thinkingBodyField("high", "standard"));
  });

  it("两档映射互不串：standard 的输出里不许出现 xhigh，反之亦然", () => {
    expect(JSON.stringify(thinkingBodyField("high", "standard"))).not.toContain("xhigh");
    expect(JSON.stringify(thinkingBodyField("high", "xhigh"))).not.toContain('"high"');
  });
});

describe("wireToolsFor", () => {
  const tools = [
    { name: "read_doc", description: "读文稿", parameters: {} },
    { name: "web_search", description: "联网搜索", parameters: {} }
  ];

  it("开 ⇒ 原样交出这一轮的工具；关 ⇒ 只摘掉 web_search，其余一枚不动", () => {
    expect(wireToolsFor(tools, true)).toEqual(tools);
    expect(wireToolsFor(tools, false).map((tool) => tool.name)).toEqual(["read_doc"]);
  });
});

describe("streamChat 把两枚开关写进出站 body", () => {
  it("默认（off + 不联网）的 body 既没有 reasoning_effort，也没有 web_search 这一枚", async () => {
    const body = await sendOnce({ thinkingLevel: "off", webSearchEnabled: false });
    expect(body).not.toHaveProperty("reasoning_effort");
    const tools = body.tools as { function?: { name?: string } }[];
    expect(tools.map((tool) => tool.function?.name)).toEqual(["read_doc"]);
  });

  it("思考开到 high 时 body 带 reasoning_effort=high，其余字段不受影响", async () => {
    const body = await sendOnce({ thinkingLevel: "high", webSearchEnabled: false });
    expect(body.reasoning_effort).toBe("high");
    expect(body.model).toBe("mochen-mock");
    expect(body.stream).toBe(true);
  });

  it("联网打开时 web_search 以 function 形态在名单里，书稿那枚一个字都不少", async () => {
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
    expect(tools[1]).toEqual({
      type: "function",
      function: {
        name: "web_search",
        description: "联网搜索",
        parameters: { type: "object", properties: {} }
      }
    });
  });

  /**
   * 2026-10-08 真机红的那一条，反向钉。
   *
   * 这里曾经往数组尾上追加一枚裸的 `{ type: "web_search" }`（hosted tool 形状，抄自 deepwrite
   * 对 OpenAI 出口的做法）。Agnes AI Hub 这类严格 OpenAI 兼容端点把它当 function 条目反序列化，
   * 发现缺 `parameters` 就整笔拒收：`400/422 tools[9].function: missing field 'parameters'`——
   * 联网一开，用户一个字都发不出去，而地址与密钥全是对的。
   * 把本用例的 `webSearchEnabled` 改回 true 之前那段旧拼装、或给 fixture 塞一枚缺 parameters 的
   * 工具，这条当场红。
   */
  it("任何一轮出站 tools 里每一条都带完整 function（type/name/parameters），不许有裸条目", async () => {
    for (const enabled of [false, true]) {
      const body = await sendOnce({ thinkingLevel: "off", webSearchEnabled: enabled });
      const tools = body.tools as Record<string, unknown>[];
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.type).toBe("function");
        const fn = tool.function as Record<string, unknown>;
        expect(typeof fn).toBe("object");
        expect(typeof fn.name).toBe("string");
        expect(fn).toHaveProperty("parameters");
      }
    }
  });

  it("两枚一起开时两个形状同时成立（不许互相覆盖）", async () => {
    const body = await sendOnce({ thinkingLevel: "medium", webSearchEnabled: true });
    expect(body.reasoning_effort).toBe("medium");
    expect((body.tools as Record<string, unknown>[])[1]).toEqual({
      type: "function",
      function: {
        name: "web_search",
        description: "联网搜索",
        parameters: { type: "object", properties: {} }
      }
    });
  });
});

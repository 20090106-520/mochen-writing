// 追加到 tool-loop.test.ts 的一段：连接级字段必须真的到达出站请求。
// 为什么单独立一段（2026-10-09 批次 5-㊻）：
//   `authHeader` 曾经是**死字段**——TurnDeps.provider 上声明了、StreamRequestLike 上也声明了，
//   唯独构造请求时是逐字段点名、没把它递下去。后果与当初一模一样：
//   小米 MiMo 那条连接永远发 Authorization: Bearer 而不是 api-key，
//   界面全对、请求永远 401，而代码上完全看不出原因。
//   `thinkingWire` 差点成为第二个。这条用例就是钉住「整个 provider 到达出站」。
import { describe, expect, it } from "vitest";
import { chatMessage } from "../src/chat-message.js";
import type { StreamEvent } from "../src/provider-client.js";
import { runTurn, type StreamRequestLike, type TurnInput } from "../src/tool-loop.js";
import type { ToolHost } from "../src/tools.js";

const HOST = {
  context: () => ({ docRelPath: "chapters/01.md", permissionMode: "read-only" }),
  call: async () => ({ ok: true, text: "", proposals: [] })
} as unknown as ToolHost;

const INPUT: TurnInput = {
  turnId: "t1",
  threadKey: "chapters/01.md",
  systemPrompt: "s",
  history: [chatMessage("user", "上一句")],
  userText: "这一句",
  thinkingLevel: "high",
  webSearchEnabled: true
};

/** 跑一轮，把出站请求原样录下来。 */
async function captureRequest(provider: Record<string, unknown>) {
  const seen: StreamRequestLike[] = [];
  const controller = new AbortController();
  let n = 0;
  await runTurn(
    {
      stream: async function* (req: StreamRequestLike): AsyncGenerator<StreamEvent> {
        seen.push({ ...req });
        yield { kind: "text-delta", text: "好" } as StreamEvent;
        yield { kind: "finish", reason: "stop" } as StreamEvent;
      },
      host: HOST,
      emit: () => {},
      emitDelta: () => {},
      newId: () => `id${(n += 1)}`,
      now: () => "2026-10-09T00:00:00.000Z",
      signal: controller.signal,
      maxToolRounds: 1,
      provider: provider as never
    },
    INPUT
  );
  const req = seen[0];
  if (req === undefined) throw new Error("一次 runTurn 必须恰好发一笔请求");
  return req;
}

describe("tool-loop · 连接级字段要真的到达出站请求（批次 5-㊻）", () => {
  it("authHeader 到达请求：api-key 那条连接不能被悄悄换成 Bearer", async () => {
    const req = await captureRequest({
      baseURL: "http://x/v1",
      apiKey: "k",
      model: "m",
      authHeader: "api-key"
    });
    expect(req.authHeader).toBe("api-key");
  });

  it("thinkingWire 到达请求：xhigh 那条连接的最高档要真的发 xhigh", async () => {
    const req = await captureRequest({
      baseURL: "http://x/v1",
      apiKey: "k",
      model: "m",
      thinkingWire: "xhigh"
    });
    expect(req.thinkingWire).toBe("xhigh");
  });

  it("两档线格式**同时**到达（它们是同一个连接上的两份独立设置）", async () => {
    const req = await captureRequest({
      baseURL: "http://x/v1",
      apiKey: "k",
      model: "m",
      authHeader: "api-key",
      thinkingWire: "xhigh"
    });
    expect(req.authHeader).toBe("api-key");
    expect(req.thinkingWire).toBe("xhigh");
  });

  it("反钉：逐字段点名的那份写法**不许回来**（逐字段点名 = 每加一个连接级字段就再犯一次）", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/tool-loop.ts", import.meta.url), "utf8");
    // 请求构造那一段必须是 `...deps.provider`，而不是一个一个字段名。
    expect(src).toContain("...deps.provider");
    // 这两行是当年那条死字段的现场：它们一旦回来，守卫就只剩钉着一个没人用的声明。
    expect(src).not.toContain("baseURL: deps.provider.baseURL");
    expect(src).not.toContain("apiKey: deps.provider.apiKey");
  });

  it("每轮开关仍归这一轮管，不被 provider 覆盖（它们不在 provider 上）", async () => {
    const req = await captureRequest({
      baseURL: "http://x/v1",
      apiKey: "k",
      model: "m",
      authHeader: "api-key",
      thinkingWire: "xhigh",
      // 伪造一个 provider 上不该有的每轮开关：它不许盖掉这一轮的值。
      thinkingLevel: "off",
      webSearchEnabled: false
    });
    expect(req.thinkingLevel).toBe("high");
    expect(req.webSearchEnabled).toBe(true);
  });
});

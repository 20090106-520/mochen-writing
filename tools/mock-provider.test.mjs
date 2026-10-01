// Task 15 Step 2：桩自身 + @mochen/agent-runtime 的 streamChat 走**真实 socket**。
// 这里刻意不再写第二个假服务器：sse.ts 的跨 chunk 缓冲、provider-client 的增量合并，
// 只有在「对端真的把一帧从字节中间劈开」时才算被验过。
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatMessage, ProviderError, streamChat } from "@mochen/agent-runtime";

// 与桩同目录，用 URL 相对定位：不依赖 vitest 的工作目录。
const script = fileURLToPath(new URL("./mock-provider.mjs", import.meta.url));
let child = null;
let port = 0;
const KEY = "sk-mock-secret";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const value = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(value));
    });
  });
}

async function waitReady(p) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${p}/__health`);
      if (response.ok) return;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`mock provider 没能在端口 ${p} 起来`);
}

const fetchImpl = async (input) => {
  const response = await fetch(input.url, {
    method: "POST",
    headers: input.headers,
    body: input.body,
    signal: input.signal
  });
  const text = response.ok ? "" : await response.text();
  return { status: response.status, stream: response.ok ? response.body : null, errorText: text };
};

async function collect(request) {
  const out = [];
  for await (const event of streamChat(request)) out.push(event);
  return out;
}

function baseRequest(overrides = {}) {
  return {
    fetchImpl,
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: KEY,
    model: "mochen-mock",
    messages: [chatMessage("user", "改紧一点")],
    tools: [],
    signal: new AbortController().signal,
    ...overrides
  };
}

beforeAll(async () => {
  port = await freePort();
  child = spawn(process.execPath, [script, "--port", String(port)], { stdio: "ignore" });
  await waitReady(port);
});

afterAll(() => {
  child?.kill();
});

describe("mock provider 与 streamChat 的真实 socket", () => {
  it("跨字节切分的 SSE 仍能拼出完整中文，且密钥只进 header", async () => {
    const events = await collect(baseRequest());
    const text = events
      .filter((event) => event.kind === "text-delta" || event.kind === "reasoning-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("先读一遍上下文");
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "tool_calls" });
    const log = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    const post = log.find((item) => item.url.endsWith("/chat/completions"));
    expect(post.hasAuth).toBe(true);
    expect(post.url).not.toContain(KEY);
    // 桩的日志面也只记「有没有带」，绝不把密钥原样吐回来
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("propose_patch 的工具调用增量被合并成一次完整调用", async () => {
    const events = await collect(baseRequest());
    const call = events.find((event) => event.kind === "tool-call")?.call;
    expect(call?.id).toBe("call-1");
    expect(call?.name).toBe("propose_patch");
    expect(JSON.parse(call?.args ?? "{}").doc).toBeTruthy();
  });

  it("文本块轮次：mochen-patch 分三段吐出，仍能解析出提案 JSON", async () => {
    const events = await collect(baseRequest({ messages: [chatMessage("user", "用文本块提案")] }));
    const text = events
      .filter((event) => event.kind === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("```mochen-patch");
    expect(text).toContain("海雾涌上来，铁锈味很冲。");
  });

  it("503 翻成中文 ProviderError，且不留下未处理的 rejection", async () => {
    await expect(
      collect(baseRequest({ messages: [chatMessage("user", "给我 503")] }))
    ).rejects.toThrow(ProviderError);
    let message = "";
    try {
      await collect(baseRequest({ messages: [chatMessage("user", "给我 503")] }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("模型服务端返回 503");
  });

  // 简报在这里还写了第五条「abort 之后立刻收束：不再产出新 delta」，走的是
  // `for await (const event of streamChat(...))` + 流中途 controller.abort()。
  // 它在真实 socket 上**必红**：客户端打断后未收完的 read() 抛 AbortError，
  // provider-client.ts:146 的帧循环没有守卫（只有 :126-134 的连接期守卫），异常穿过
  // sse.ts / provider-fetch.ts 的 toAsyncIterable，被 tool-loop.ts:131 的 catch 接住后
  // 整轮判成 failed ——「已流出的思考标 interrupted」这条性质因此在全链上拿不到。
  // 最小复现见 task-15-report.md「BLOCKED：真 socket 打断链」；该用例与 turn-e2e.test.ts
  // 的第四条一起留给上游修复后的接续波，此处不降级、不 skip、也不改成断言现状。
  it("客户端中途拔线：桩进程不崩，后续用例仍能用同一个子进程", async () => {
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "mochen-mock",
        messages: [{ role: "user", content: "慢一点，我要打断" }],
        stream: true
      }),
      signal: controller.signal
    });
    const reader = response.body.getReader();
    const chunks = [];
    let thrown = null;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value.length);
        if (chunks.length === 2) controller.abort();
      }
    } catch (error) {
      thrown = error instanceof Error ? error.name : "unknown";
    }
    // 拔线时确实只拿到很少几片，且之后没有新片
    expect(chunks.length).toBeLessThan(8);
    expect(thrown).toBe("AbortError");
    // 桩还活着：e2e 的四个用例共用一个子进程，一次打断不能把它带走
    const health = await fetch(`http://127.0.0.1:${port}/__health`);
    expect(health.ok).toBe(true);
    expect(
      (await (await fetch(`http://127.0.0.1:${port}/__requests`)).json()).length
    ).toBeGreaterThan(0);
  });

  it("未知路径回 404 中文，健康检查与请求日志只字不提密钥", async () => {
    const unknown = await fetch(`http://127.0.0.1:${port}/v1/nope`, { method: "POST", body: "{}" });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.message).toBe("未知路径");
    const log = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    expect(JSON.stringify(log)).not.toContain(KEY);
  });
});

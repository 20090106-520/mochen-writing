import { describe, expect, it } from "vitest";
import type { ProviderFetchInput } from "@mochen/agent-runtime";
import { toProviderFetch } from "./provider-fetch.js";

const enc = new TextEncoder();

const input = {
  url: "http://x/v1/chat/completions",
  headers: {},
  body: "{}",
  signal: new AbortController().signal
} satisfies ProviderFetchInput;

describe("toProviderFetch", () => {
  it("非 2xx 时把响应体带回去，不抛错（上层负责翻成中文）", async () => {
    const response = new Response("上游配额用尽", { status: 429 });
    const result = await toProviderFetch(async () => response)(input);
    expect(result.status).toBe(429);
    expect(result.stream).toBeNull();
    expect(result.errorText).toContain("配额");
  });

  it("2xx 有流时逐块吐出 SSE 字节", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("data: {}\n\n"));
        controller.close();
      }
    });
    const result = await toProviderFetch(async () => new Response(body, { status: 200 }))(input);
    expect(result.status).toBe(200);
    if (result.stream === null) throw new Error("必须有流");
    const collected: string[] = [];
    const dec = new TextDecoder();
    for await (const chunk of result.stream) collected.push(dec.decode(chunk));
    expect(collected.join("")).toBe("data: {}\n\n");
  });

  it("没有响应体时 stream 为 null", async () => {
    const result = await toProviderFetch(async () => new Response(null, { status: 200 }))(input);
    expect(result.stream).toBeNull();
  });

  it("请求对象原样交给 send：url 与 headers 都不被改写，密钥只留在头里", async () => {
    const seen: ProviderFetchInput[] = [];
    const request: ProviderFetchInput = {
      url: "https://provider.example/v1/chat/completions",
      headers: { Authorization: "Bearer sk-canary-6a1b2c" },
      body: '{"stream":true}',
      signal: new AbortController().signal
    };
    const fetchImpl = toProviderFetch(async (item) => {
      seen.push(item);
      return new Response(null, { status: 200 });
    });
    await fetchImpl(request);
    expect(seen).toEqual([request]);
    expect(seen[0]?.url).not.toContain("sk-canary-6a1b2c");
    expect(seen[0]?.headers.Authorization).toBe("Bearer sk-canary-6a1b2c");
  });

  it("网络错误原样抛出，不吞成「没有流」", async () => {
    const fetchImpl = toProviderFetch(async () => {
      throw new Error("socket hang up");
    });
    await expect(fetchImpl(input)).rejects.toThrow("socket hang up");
  });
});

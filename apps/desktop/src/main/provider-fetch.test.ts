import { describe, expect, it } from "vitest";
import type { ProviderFetchInput } from "@mochen/agent-runtime";
import { ProviderError } from "@mochen/agent-runtime";
import { assertUpstreamUrlAllowed, retryAfterMsOf, toProviderFetch } from "./provider-fetch.js";

const enc = new TextEncoder();

const input = {
  url: "https://x/v1/chat/completions",
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
    const sent = seen[0];
    if (sent === undefined) throw new Error("send 必须被调用一次");
    // 「原样」管的是出站内容这三样：本改动一个字都不该碰它们（密钥只在头里是 5-㊻ 的老闸）。
    expect({ url: sent.url, headers: sent.headers, body: sent.body }).toEqual({
      url: request.url,
      headers: request.headers,
      body: request.body
    });
    // signal 是唯一的例外，而且是**必须**的例外：递给 send 的是「用户的打断 ∪ 看门狗」合并那只，
    // 不再是传进来的原对象。哪天有人图省事把 input.signal 直接透传，看门狗就永远 abort 不掉连接，
    // 这一条会立刻红；打断怎么传下去由下面那条回归闸单独钉。
    expect(sent.signal).not.toBe(request.signal);
    expect(sent.url).not.toContain("sk-canary-6a1b2c");
    expect(sent.headers.Authorization).toBe("Bearer sk-canary-6a1b2c");
  });

  it("网络错误原样抛出，不吞成「没有流」", async () => {
    const fetchImpl = toProviderFetch(async () => {
      throw new Error("socket hang up");
    });
    await expect(fetchImpl(input)).rejects.toThrow("socket hang up");
  });
});

/**
 * P1-1 的①：上游请求没有连接/空闲超时。
 *
 * 台账 README:6399 量到的「联网开着挂 200 秒零响应零报错」就是这么来的：上游不回响应头，
 * 而这里一个时限都没设，于是这一轮永远显示进行中。
 *
 * **不用假计时器**：阈值由参数注入成几十毫秒，真等、真超时——被验的是
 * 「race + abort」这条真链路，假计时器只会替我把 setTimeout 读一遍。
 * 生产阈值取默认值（那两个常量的取值理由写在 provider-fetch.ts）。
 */
describe("toProviderFetch · 上游空闲看门狗（P1-1 的①）", () => {
  /** 一条永远不 settle 的 send：模拟连上了但上游一个字都不回。 */
  const neverSettles = () => async (): Promise<Response> => await new Promise<Response>(() => {});

  /** 把「要么拿到结论、要么承认没超时」压成一次可断言的取值（绝不让用例挂到 vitest 默认超时）。 */
  async function settleFast<T>(work: Promise<T>, fallback: string): Promise<T | string> {
    return await Promise.race([
      work,
      new Promise<string>((resolve) => setTimeout(() => resolve(fallback), 800))
    ]);
  }

  it("响应头一直不来：到点抛一句说清等了多久的中文，而不是让这一轮永远转圈", async () => {
    const fetchImpl = toProviderFetch(neverSettles(), { firstByteTimeoutMs: 30 });
    const outcome = await settleFast(
      fetchImpl(input).then(
        () => "没有超时：请求一直没结束",
        (error: unknown) => (error instanceof Error ? error.message : String(error))
      ),
      "没有超时：请求一直没结束"
    );
    expect(outcome).toContain("30 毫秒没有给出任何响应");
  });

  it("超时那一刻把这一次请求的 signal 也 abort 掉：连接要放掉，不许留一只挂着的 socket", async () => {
    const seen: AbortSignal[] = [];
    const fetchImpl = toProviderFetch(
      async (item) => {
        seen.push(item.signal);
        return await new Promise<Response>(() => {});
      },
      { firstByteTimeoutMs: 30 }
    );
    await settleFast(
      fetchImpl(input).catch(() => "已超时"),
      "没有超时：请求一直没结束"
    );
    expect(seen.length).toBe(1);
    expect(seen[0]?.aborted).toBe(true);
  });

  it("用户的打断仍然一路传到 send：合并 signal 不许把外部 abort 弄丢（回归闸）", async () => {
    const seen: AbortSignal[] = [];
    const controller = new AbortController();
    // 真 fetch 被打断后这只 promise 会 reject AbortError；假 send 必须照同一个时序来，
    // 否则「signal 传到了」和「请求真的停下了」两件事就只验到前一件。
    const fetchImpl = toProviderFetch(
      async (item) => {
        seen.push(item.signal);
        return await new Promise<Response>((resolve, reject) => {
          item.signal.addEventListener(
            "abort",
            () => reject(new DOMException("This operation was aborted", "AbortError")),
            { once: true }
          );
        });
      },
      { firstByteTimeoutMs: 30_000 }
    );
    const pending = fetchImpl({ ...input, signal: controller.signal }).catch(() => "已中止");
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(seen[0]?.aborted).toBe(true);
    expect(await pending).toBe("已中止");
  });

  it("响应头回来了、流却一直不出字节：迭代到点抛「多久没新内容」", async () => {
    const fetchImpl = toProviderFetch(
      async () =>
        new Response(new ReadableStream<Uint8Array>({ start: () => {} }), { status: 200 }),
      { firstByteTimeoutMs: 30_000, idleTimeoutMs: 30 }
    );
    const result = await fetchImpl(input);
    if (result.stream === null) throw new Error("必须有流");
    const iterate = async (): Promise<string> => {
      for await (const chunk of result.stream ?? []) void chunk;
      return "流自己走完了，没超时";
    };
    const outcome = await settleFast(
      iterate().catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
      "没有超时：流一直没动"
    );
    expect(outcome).toContain("30 毫秒没有新内容");
  });

  it("慢而活着的流不许被误杀：每 10ms 来一块、空闲阈值 60ms，整条流一块不少", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
          setTimeout(() => controller.enqueue(enc.encode(`data: ${index}\n\n`)), index * 10);
        }
        setTimeout(() => controller.close(), 90);
      }
    });
    const fetchImpl = toProviderFetch(async () => new Response(body, { status: 200 }), {
      firstByteTimeoutMs: 30_000,
      idleTimeoutMs: 60
    });
    const result = await fetchImpl(input);
    if (result.stream === null) throw new Error("必须有流");
    const collected: string[] = [];
    for await (const chunk of result.stream) collected.push(new TextDecoder().decode(chunk));
    // 总时长 ~90ms 已经越过「首字节 30s + 空闲 60ms」那种硬总时长的量级：
    // 这里刻意不设整轮总时限，长回答会被误杀，所以只掐「没有任何新字节」。
    expect(collected.join("")).toBe(
      "data: 0\n\ndata: 1\n\ndata: 2\n\ndata: 3\n\ndata: 4\n\ndata: 5\n\ndata: 6\n\ndata: 7\n\n"
    );
  });

  it("错误体那条路也要有看门狗：状态码回来了却读不到体，同样不能无限等", async () => {
    const hangingTextBody = {
      status: 503,
      ok: false,
      text: () => new Promise<string>(() => {})
    } as unknown as Response;
    const fetchImpl = toProviderFetch(async () => hangingTextBody, {
      firstByteTimeoutMs: 30_000,
      idleTimeoutMs: 30
    });
    const outcome = await settleFast(
      fetchImpl(input).then(
        () => "没有超时：错误体一直没读完",
        (error: unknown) => (error instanceof Error ? error.message : String(error))
      ),
      "没有超时：错误体一直没读完"
    );
    expect(outcome).toContain("30 毫秒没有新内容");
  });

  it("默认阈值说的是人话：界面上是「30 秒 / 60 秒」，不是毫秒数也不是 undefined", async () => {
    const mod = await import("./provider-fetch.js");
    expect(mod.UPSTREAM_FIRST_BYTE_TIMEOUT_MS).toBe(30_000);
    expect(mod.UPSTREAM_IDLE_TIMEOUT_MS).toBe(60_000);
    expect(mod.upstreamHangMessage(mod.UPSTREAM_FIRST_BYTE_TIMEOUT_MS, "first-byte")).toContain(
      "30 秒没有给出任何响应"
    );
    expect(mod.upstreamHangMessage(mod.UPSTREAM_IDLE_TIMEOUT_MS, "idle")).toContain(
      "60 秒没有新内容"
    );
  });

  it("看门狗抛的是 ProviderError：到了界面上就是这一句，不再被套一层「无法连接模型服务端」", async () => {
    const mod = await import("./provider-fetch.js");
    const error = new mod.UpstreamHangError("模型服务端 30 秒没给出任何响应。");
    const { ProviderError } = await import("@mochen/agent-runtime");
    expect(error).toBeInstanceOf(ProviderError);
  });
});

/**
 * P1-1 的②：webSearch 没接 signal——用户按了打断，联网搜索照样把三个源串着跑完。
 * 这一组验的是 `abortableFetch` 把「这一轮的 abort」并进真正出网那次 fetch 的 signal。
 */
describe("abortableFetch（联网搜索接上这一轮的打断）", () => {
  it("外部 signal 一 abort，出网那只 signal 立刻 aborted（搜索当场停下）", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    const { abortableFetch } = await import("./provider-fetch.js");
    const send = abortableFetch(async (_url, init) => {
      seen.push(init?.signal);
      // 与真 fetch 一致：只有 signal 被 abort，这只挂住的请求才会 reject（搜索这才停得下来）。
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined) reject(new Error("出网那一步没有 signal"));
        else
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("This operation was aborted", "AbortError")),
            { once: true }
          );
      });
    }, controller.signal);
    const pending = send("https://example.com", {
      method: "GET",
      signal: AbortSignal.timeout(30_000)
    }).catch(() => "已中止");
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(seen[0]?.aborted).toBe(true);
    expect(await pending).toBe("已中止");
  });

  it("搜索自己的单源 6s 超时不许被接 signal 弄丢：合并的是两只，不是拿一只换另一只", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    const { abortableFetch } = await import("./provider-fetch.js");
    const send = abortableFetch(async (_url, init) => {
      seen.push(init?.signal);
      return new Response("", { status: 200 });
    }, controller.signal);
    await send("https://example.com", { signal: AbortSignal.timeout(20) });
    const merged = seen[0];
    if (merged === undefined) throw new Error("必须把 signal 递到出网那一步");
    // 单源超时自己到点：合并后的 signal 也必须跟着 abort，否则 6s 有界那条闸门形同被摘掉。
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(merged.aborted).toBe(true);
  });
});

describe("出网地址闸（2026-10-14 审计项 4）", () => {
  it.each([
    "https://api.deepseek.com/v1",
    "http://127.0.0.1:11434/v1",
    "http://localhost:1234/v1",
    "http://[::1]:8080/v1"
  ])("放行 %s", (url) => {
    expect(() => assertUpstreamUrlAllowed(url)).not.toThrow();
  });

  it.each([
    "http://api.example.com/v1",
    "http://192.168.1.5:1234/v1",
    "http://mock/v1",
    "不是地址"
  ])("拒绝 %s（明文 http 会把密钥和全文裸送出去）", (url) => {
    expect(() => assertUpstreamUrlAllowed(url)).toThrow(ProviderError);
  });

  it("toProviderFetch 在 send 之前就拦下明文地址：请求根本不出手", async () => {
    let called = false;
    const guarded = toProviderFetch(async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    await expect(guarded({ ...input, url: "http://x/v1/chat/completions" })).rejects.toThrow(
      /https/
    );
    expect(called).toBe(false);
  });
});

describe("Retry-After 折算（2026-10-14 审计项 7）", () => {
  it("秒数形状：Retry-After: 2 ⇒ 2000ms", () => {
    const headers = new Headers({ "retry-after": "2" });
    expect(retryAfterMsOf(headers)).toBe(2000);
  });

  it("HTTP-date 形状：按现在到那一刻的差算（HTTP-date 秒级截断，只断言区间），过去那刻收 0", () => {
    // **「现在」要由本用例自己递进去**（`retryAfterMsOf(headers, now)` 的第二个参数就是为此留的）。
    // 不递的话，函数内部自己读一次墙钟，而用例前面也读了一次——两次读之间只要跨过整秒，
    // 算出来的差就少一截（HTTP-date 本身还被 `toUTCString()` 截到整秒）。
    // 那道缝有多宽：设第一次读到的毫秒余数为 m、两次读之间隔了 delta 毫秒，
    // 差值就是 `5000 - m - delta`；m + delta ≥ 1000 时差值 ≤ 4000，断言当场红。
    // 空载时两次读只隔零点几毫秒（几乎撞不上），一跑满仓（4 个 worker 抢 CPU）delta 会涨到几十毫秒，
    // 撞上的窗口就有百分之几——**一条按机器负载随机红的闸，比没有闸更坏**（它训练人忽略红灯）。
    // 实测：2026-10-24 跑全仓门禁时它红了两次、单独跑 12 次全绿（单独跑时 delta 太小，撞不上）。
    const now = Date.now();
    const at = now + 5_000;
    const wait = retryAfterMsOf(new Headers({ "retry-after": new Date(at).toUTCString() }), now);
    // now 固定 ⇒ 差值恒为 `5000 - (now % 1000)`，落在 (4000, 5000] 这一段里（端点都取得到）。
    expect(wait).toBeGreaterThan(4_000);
    expect(wait).toBeLessThanOrEqual(5_000);
    expect(retryAfterMsOf(new Headers({ "retry-after": "Wed, 21 Oct 2015 07:28:00 GMT" }))).toBe(0);
  });

  it("解不出就不缺省这颗字段：等多久由 provider-client 的判定说了算，这里不发明数字", () => {
    expect(retryAfterMsOf(new Headers())).toBeUndefined();
    expect(retryAfterMsOf(new Headers({ "retry-after": " soon " }))).toBeUndefined();
  });

  it("上游要等太久也不许全听：封顶 60 秒", () => {
    expect(retryAfterMsOf(new Headers({ "retry-after": "86400" }))).toBe(60_000);
  });
});

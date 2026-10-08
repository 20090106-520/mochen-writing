// Task 15 Step 2：桩自身 + @mochen/agent-runtime 的 streamChat 走**真实 socket**。
// 这里刻意不再写第二个假服务器：sse.ts 的跨 chunk 缓冲、provider-client 的增量合并，
// 只有在「对端真的把一帧从字节中间劈开」时才算被验过。
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chatMessage,
  ProviderError,
  streamChat,
  TOOL_SPECS,
  toolMessage,
  assistantToolMessage
} from "@mochen/agent-runtime";

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
    // 2026-10-08：夹具交的是**完整名单**（含 web_search 那枚 function 工具），跟 agent-service 一样。
    // 「开关关着 ⇒ web_search 不出站」由 provider-client 的 wireToolsFor 做——
    // 夹具不替它过滤，否则这条链上最重要的一段就没被验过。
    tools: TOOL_SPECS,
    // StreamRequest 的每轮字段是必填的：夹具也按真实形状给，别让「漏传」在桩这一侧看起来正常。
    thinkingLevel: "off",
    webSearchEnabled: false,
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

  // F-3：桩的 isFollowUp 判据以前是「历史任何位置存在 role:"tool"」⇒ 同一线程的第二轮
  // （历史里必然带着上一轮的回投）永远被误判成收尾轮，「文本块」/「计划」分支不可达。
  // 冒烟实测踩过：第一次发「用文本块提案」只拿到回投文案、零提案。
  it("同线程第二轮（历史里有 tool 回投、最后一条是 user）仍走关键字分支", async () => {
    const events = await collect(
      baseRequest({
        messages: [
          chatMessage("user", "用文本块提案"),
          chatMessage("assistant", "给你一条提案。"),
          toolMessage("call-1", "提案已生成，等待人工审批；未批准前文件未改动"),
          chatMessage("user", "再用文本块提案一次")
        ]
      })
    );
    const text = events
      .filter((event) => event.kind === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("```mochen-patch");
    // 收尾轮的那句回投文案一个字都不许出现：出现即说明这一轮又被判成 followUp。
    expect(text).not.toContain("提案已经挂在下面");
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "tool_calls" });
  });

  // 收尾分支的正向覆盖。此前本文件里 isFollowUp 只被**反向**验过（第 122 条：末条是 user ⇒ 不许走收尾），
  // 「末条真是 tool ⇒ 该走收尾」这一半只有 turn-e2e 在主进程全链上看着。留下的缝是：
  // 若 isFollowUp 被改成恒 false（或恒 true），上面那条照样绿，收尾分支变成不可达的死代码也没人喊。
  it("工具回投轮（末条是 tool）走收尾分支：吐回投文案、且不再派工具调用", async () => {
    const events = await collect(
      baseRequest({
        messages: [
          chatMessage("user", "用文本块提案"),
          toolMessage("call-1", "提案已生成，等待人工审批；未批准前文件未改动")
        ]
      })
    );
    const deltas = events.filter((event) => event.kind === "text-delta");
    expect(deltas.map((event) => event.text).join("")).toBe("提案已经挂在下面，等你点批准才落盘。");
    // 收尾轮绝不能再派工具调用：否则会凭空造出第二条提案，模型自己把自己绕进去了
    expect(events.some((event) => event.kind === "tool-call")).toBe(false);
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "stop" });
  });

  it("收尾轮的切帧步长跟着「慢」走：普通 8 字一帧、带「慢」2 字一帧", async () => {
    const closing = "提案已经挂在下面，等你点批准才落盘。";
    const frames = async (text) => {
      const events = await collect(
        baseRequest({
          messages: [chatMessage("user", text), toolMessage("call-1", "已回投")]
        })
      );
      return events.filter((event) => event.kind === "text-delta");
    };
    // 18 字：8 字一帧 ⇒ 3 帧；2 字一帧 ⇒ 9 帧。帧数是桩「怎么切」的唯一可观测面。
    expect((await frames("用文本块提案")).length).toBe(Math.ceil([...closing].length / 8));
    expect((await frames("慢一点，我要打断")).length).toBe(Math.ceil([...closing].length / 2));
  });

  it("打断轮只吐思考与正文、半截不变提案：Esc 之后绝不写盘靠的就是这一条", async () => {
    const events = await collect(
      baseRequest({ messages: [chatMessage("user", "慢一点，我要打断")] })
    );
    const reasoning = events
      .filter((event) => event.kind === "reasoning-delta")
      .map((event) => event.text)
      .join("");
    expect(reasoning).toContain("先读一遍上下文");
    // 关键：不派工具调用 ⇒ 打断在半截时，磁盘上不可能有改动
    expect(events.some((event) => event.kind === "tool-call")).toBe(false);
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "stop" });
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

  // 简报第 5 用例（Task 15 报告 §7 曾被判 BLOCKED）：真 socket 流中途 abort 后，
  // 未收完的 read() 抛 AbortError——provider-client.ts 的读流期守卫把它折成
  // finish:aborted 之后，这条才在真实链路上成立。它与下面的「客户端中途拔线」并存：
  // 那条验桩活着，这条验 streamChat 的收束语义（不再产出新 delta）。
  it("abort 之后立刻收束：不再产出新 delta", async () => {
    const controller = new AbortController();
    const seen = [];
    for await (const event of streamChat(
      baseRequest({
        messages: [chatMessage("user", "慢一点，我要打断")],
        signal: controller.signal
      })
    )) {
      seen.push(event);
      if (seen.length === 2) controller.abort();
    }
    expect(seen.length).toBeLessThan(10);
    expect(seen.at(-1).kind).toBe("finish");
  });

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
    // 桩还活着：e2e 的五个用例共用一个子进程，一次打断不能把它带走
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

  // #101：桩是这条链的终点，也是**唯一能在真机上看见出站形状**的地方——两个开关必须在桩这一侧留下痕迹，
  // 否则「chip 点了有用」在实机上是一句无法证伪的话。
  it("思考档与联网开关真的抵达 body：桩把两者回显进思考与请求日志", async () => {
    const events = await collect(baseRequest({ thinkingLevel: "high", webSearchEnabled: true }));
    const reasoning = events
      .filter((event) => event.kind === "reasoning-delta")
      .map((event) => event.text)
      .join("");
    expect(reasoning).toContain("思考档 high");
    expect(reasoning).toContain("已联网");

    const log = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    const post = log.filter((item) => item.url.endsWith("/chat/completions")).at(-1);
    expect(post.reasoningEffort).toBe("high");
    expect(post.webSearch).toBe(true);
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("两枚开关都关着时：body 里没有 reasoning_effort、tools 里没有 web_search，思考里也没有标记", async () => {
    const events = await collect(baseRequest({ thinkingLevel: "off", webSearchEnabled: false }));
    const reasoning = events
      .filter((event) => event.kind === "reasoning-delta")
      .map((event) => event.text)
      .join("");
    expect(reasoning).not.toContain("思考档");
    expect(reasoning).not.toContain("已联网");

    const log = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    const post = log.filter((item) => item.url.endsWith("/chat/completions")).at(-1);
    expect(post.reasoningEffort).toBe(null);
    expect(post.webSearch).toBe(false);
  });

  // 2026-10-06 批次 5-⑨：web_search 是唯一一条**回执带结构化来源**的工具，
  // 来源那条链跨六层（contracts → ToolOutcome → tool-loop 事件 → preload → timeline → 工具卡），
  // 没有真模型可验时桩就是唯一的驱动源。这三条把它钉住。
  it("带联网开关且用户要查：派 web_search 调用，搜索词取自用户那句话", async () => {
    const events = await collect(
      baseRequest({
        messages: [chatMessage("user", "帮我查一下黑暗森林法则是什么。")],
        webSearchEnabled: true
      })
    );
    const call = events.find((event) => event.kind === "tool-call")?.call;
    expect(call?.name).toBe("web_search");
    // 搜索词要是用户**原样**要查的东西：真机截图里回执的 query 与输入一致，
    // 串了词一眼能看出来，桩去猜同义词就把这条证据弄虚了。
    //
    // 批次 5-⑬ 改了「原样」的**含义**：提示词要求模型发关键词，而必应源只认开头词，
    // 整句会被拆成词义查询。所以现在去掉的是**问句尾巴**（「是什么」问号那些），
    // 词本身还是用户那句话里的那几个字——不是桩另挑的。
    expect(JSON.parse(call?.args ?? "{}").query).toBe("黑暗森林法则");
  });

  it("开关关着时不派 web_search：模型不能凭空调用自己手上没有的工具", async () => {
    const events = await collect(
      baseRequest({
        messages: [chatMessage("user", "帮我查一下黑暗森林法则。")],
        webSearchEnabled: false
      })
    );
    expect(events.find((event) => event.kind === "tool-call")).toBeUndefined();
    const text = events
      .filter((event) => event.kind === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("这一轮没带联网工具");
  });

  // 批次 5-⑩：模型第一轮搜不准就换词重搜，是**常态**而不是异常。
  // 这一格以前写的是「工具回投轮不该又去搜一遍」——那条守卫描述的是一个只会搜一次的替身，
  // 而真实模型就在这一格再搜一次。现改成钉住重搜本身：两次调用必须**换词**、
  // **换 id**（id 相同会让两轮回执串对），且第二次搜完就收尾、照回执里的键引用。
  const searchedTurn = (receipt) => [
    chatMessage("user", "帮我查一下黑暗森林法则。"),
    assistantToolMessage("", [
      { id: "call-net-1", name: "web_search", args: JSON.stringify({ query: "黑暗森林法则" }) }
    ]),
    toolMessage("call-net-1", receipt)
  ];

  /** 已经搜过两次的线程：桩到这里才该收尾。少放一次它就会再派一次搜索。 */
  const searchedTwice = (receipt) => [
    ...searchedTurn(receipt),
    assistantToolMessage("", [
      {
        id: "call-net-2",
        name: "web_search",
        args: JSON.stringify({ query: "黑暗森林法则 详细解释" })
      }
    ]),
    toolMessage("call-net-2", receipt)
  ];

  it("第一轮回投之后换个词再搜一次：两次调用的查询词不同、调用 id 不同", async () => {
    const events = await collect(
      baseRequest({
        messages: searchedTurn("来源：360 搜索"),
        webSearchEnabled: true
      })
    );
    const call = events.find((event) => event.kind === "tool-call")?.call;
    expect(call?.name).toBe("web_search");
    // 换了说法才递得出重叠的结果，而「重叠的结果怎么处理」正是要验的东西。
    expect(JSON.parse(call?.args ?? "{}").query).toBe("黑暗森林法则 详细解释");
    expect(call?.id).toBe("call-net-2");
  });

  it("第二次搜完就收尾，且收尾时引用的是回执里给的来源键（不是桩自己编的）", async () => {
    const receipt =
      "来源：360 搜索\n[zhihu.com/111-357f] 甲\n     https://a/1\n[baike.baidu.com/darkforest-adb2] 乙\n     https://b/2";
    const events = await collect(
      baseRequest({
        messages: searchedTwice(receipt),
        webSearchEnabled: true
      })
    );
    expect(events.find((event) => event.kind === "tool-call")).toBeUndefined();
    const text = events
      .filter((event) => event.kind === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("[zhihu.com/111-357f]");
    expect(text).toContain("[baike.baidu.com/darkforest-adb2]");
    expect(events.at(-1)).toEqual({ kind: "finish", reason: "stop" });
  });

  it("历史里已经带着上一轮那两次搜索时，本轮第一次请求仍然派第一次搜索", async () => {
    // 真机连着跑两轮时撞出来的：数全量的话，桩会把上一轮的搜索算成本轮的，
    // 于是用户第二句一开口模型就直接收尾——一张工具卡都没有。
    const history = [...searchedTwice("来源：360 搜索\n[a.test/1-1111] 甲")];
    history.push(chatMessage("assistant", "按 [a.test/1-1111] 核对过。"));
    history.push(chatMessage("user", "那再查一下三体的宇宙社会学。"));
    const events = await collect(baseRequest({ messages: history, webSearchEnabled: true }));
    const call = events.find((event) => event.kind === "tool-call")?.call;
    expect(call?.id).toBe("call-net-1");
    expect(JSON.parse(call?.args ?? "{}").query).toBe("三体的宇宙社会学");
  });

  it("第二次搜索的回投里没有键时（一条都没搜着），收尾不编键", async () => {
    const events = await collect(
      baseRequest({
        messages: searchedTwice("搜索源都能用，但没搜到相关结果——换几个关键词再搜一次。"),
        webSearchEnabled: true
      })
    );
    const text = events
      .filter((event) => event.kind === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("没搜到可用的来源");
    expect(text).not.toMatch(/\[[a-z0-9.-]+-[0-9a-f]{4}\]/);
  });

  // 2026-10-06 真机撞出来的：上面那条夹具**两次回执都一样**，所以「第一次成功、第二次失败」
  // 这条真实路径一直没被覆盖。真机上就是这么翻车的——桩只从**最后一条**回执里摘键，
  // 第二次搜索失败，于是它把第一次已经拿到手的 10 条来源整个忘了，
  // 收尾写「这一轮没搜到可用的来源」。真实模型看得见这一轮的每一条工具回执。
  it("第一次搜到、第二次失败：收尾仍然引用第一次回执里的键", async () => {
    const events = await collect(
      baseRequest({
        messages: [
          chatMessage("user", "帮我查一下黑暗森林法则是怎么来的。"),
          assistantToolMessage("", [
            {
              id: "call-net-1",
              name: "web_search",
              args: JSON.stringify({ query: "黑暗森林法则是怎么来的" })
            }
          ]),
          toolMessage(
            "call-net-1",
            "来源：必应\n[baike.baidu.com/828514-72e2] 黑暗森林法则_百度百科\n     https://a/1"
          ),
          assistantToolMessage("", [
            {
              id: "call-net-2",
              name: "web_search",
              args: JSON.stringify({ query: "黑暗森林法则是怎么来的 详细解释" })
            }
          ]),
          toolMessage(
            "call-net-2",
            "搜到的 10 条几乎都不含你搜的词——换个说法：压成 2–4 个关键词再搜一次。"
          )
        ],
        webSearchEnabled: true
      })
    );
    const text = events
      .filter((event) => event.kind === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("[baike.baidu.com/828514-72e2]");
    expect(text).not.toContain("没搜到可用的来源");
  });

  // #104：桩是 `{baseURL}/models` 这一侧的真对手。名单**故意**乱序且带重复——
  // 去重与排序是主进程 provider-models.ts 的活，桩替它做齐就等于把那条链测虚了。
  it("GET /v1/models 返回乱序含重复的名单，且这次 GET 也进日志（密钥只在 header）", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      method: "GET",
      headers: { authorization: `Bearer ${KEY}` }
    });
    expect(response.status).toBe(200);
    const ids = (await response.json()).data.map((item) => item.id);
    expect(ids).toContain("mochen-mock");
    expect(new Set(ids).size).toBeLessThan(ids.length);
    expect(ids).not.toEqual([...ids].sort());

    const log = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    const got = log.find((item) => item.url.endsWith("/models"));
    expect(got.method).toBe("GET");
    expect(got.hasAuth).toBe(true);
    expect(got.url).not.toContain(KEY);
    expect(JSON.stringify(log)).not.toContain(KEY);
  });
});

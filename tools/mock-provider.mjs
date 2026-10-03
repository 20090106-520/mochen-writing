#!/usr/bin/env node
// 本地 SSE 桩：关键字驱动、无状态，只演「这一轮该说什么」，不演任何业务规则。
// 它是本仓库唯一的 SSE 服务端实现：tools/mock-provider.test.mjs 与
// apps/desktop/src/main/turn-e2e.test.ts 都以子进程 spawn 本文件、走真实 socket。
import { createServer } from "node:http";
import process from "node:process";

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  return value === undefined ? fallback : value;
}

const port = Number(flag("port", "8787"));
const doc = process.env.MOCHEN_MOCK_DOC ?? flag("doc", "chapters/01-开局.md");
const requests = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lastUserText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (item && item.role === "user") return String(item.content ?? "");
  }
  return "";
}

// F-3：判据是「最后一条消息是不是 tool 回投」，不是「历史里有没有 tool」。
// 上一版用 some(...)，于是同一线程的第二轮（历史里必然带着上一轮的回投）永远被误判成
// 收尾轮，「文本块」/「计划」关键字分支不可达——冒烟实测第一次发「用文本块提案」只拿到回投文案。
function isFollowUp(messages) {
  const last = messages.at(-1);
  return Boolean(last) && last.role === "tool";
}

function patchBlock() {
  const payload = JSON.stringify({
    doc,
    anchor: "雾从海面涌上来。",
    replace: "海雾涌上来，铁锈味很冲。",
    why: "补一层可感的细节"
  });
  // 文本块协议（spec §6.1 的第二条路）：分三段吐，围栏与 JSON 都不在一次写出
  return [
    { choices: [{ delta: { content: "给你一条提案：\n```mochen-patch\n" } }] },
    { choices: [{ delta: { content: payload.slice(0, 24) } }] },
    { choices: [{ delta: { content: payload.slice(24) + "\n```\n" } }] }
  ];
}

// 计划块走的是 parseProtocolBlocks 的 mochen-plan 分支：正文必须是 {"items":[...]}，
// 围栏里写 Markdown 列表会被判成 bad-json（见报告「改了简报的哪一行」）。
function planBlock() {
  const payload = JSON.stringify({ items: ["读开头三段", "收紧比喻"] });
  return [
    { choices: [{ delta: { content: "```mochen-plan\n" } }] },
    { choices: [{ delta: { content: payload } }] },
    { choices: [{ delta: { content: "\n```\n" } }] }
  ];
}

function toolCallFrame() {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              function: {
                name: "propose_patch",
                arguments: JSON.stringify({
                  doc,
                  anchor: "雾从海面涌上来。",
                  replace: "海雾涌上来，铁锈味很冲。",
                  why: "补一层可感的细节"
                })
              }
            }
          ]
        }
      }
    ]
  };
}

// 打断用的慢流：思考与正文都切成小帧，且不派任何工具调用——
// 半截正文只有「还没变成提案」才验得出「Esc 之后绝不写盘」。
function slowFrames() {
  const reasoning = "先读一遍上下文，再决定动哪一段。雾从海面涌上来，这句太抽象。";
  const content = "我打算把开头那句收紧，补一层可感的细节。";
  const out = [];
  for (let i = 0; i < reasoning.length; i += 4) {
    out.push({ choices: [{ delta: { reasoning_content: reasoning.slice(i, i + 4) } }] });
  }
  for (let i = 0; i < content.length; i += 4) {
    out.push({ choices: [{ delta: { content: content.slice(i, i + 4) } }] });
  }
  out.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
  return out;
}

/**
 * 每轮两个开关（#101）在桩这一侧的回显：思考档与联网工具各自打进 reasoning 一句标记。
 * 桩不演业务规则，但必须演「服务端看得见的形状」——否则输入区那两枚 chip 在真机上无法证伪。
 * 关档时没有任何标记：不发 reasoning_effort、tools 里也没有 web_search，回显跟着出站形状走。
 */
function webSearchRequested(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.some(
    (tool) => tool !== null && typeof tool === "object" && tool.type === "web_search"
  );
}

function reasoningText(body) {
  const marks = [];
  if (typeof body.reasoning_effort === "string") marks.push(`思考档 ${body.reasoning_effort}`);
  if (webSearchRequested(body)) marks.push("已联网");
  const head = marks.length === 0 ? "" : `（${marks.join(" · ")}）`;
  return `${head}先读一遍上下文，再决定动哪一段。`;
}

function framesFor(body, text) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (isFollowUp(messages)) {
    const closing = "提案已经挂在下面，等你点批准才落盘。";
    const step = text.includes("慢") ? 2 : 8;
    const out = [];
    for (let i = 0; i < closing.length; i += step) {
      out.push({ choices: [{ delta: { content: closing.slice(i, i + step) } }] });
    }
    out.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
    return out;
  }
  if (text.includes("慢") || text.includes("打断")) return slowFrames();
  const out = [{ choices: [{ delta: { reasoning_content: reasoningText(body) } }] }];
  if (text.includes("计划")) out.push(...planBlock());
  if (text.includes("文本块")) {
    out.push(...patchBlock());
    out.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    return out;
  }
  out.push(toolCallFrame());
  out.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", (chunk) => parts.push(chunk));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * 把一帧 SSE 从**字节中间**劈开两次写出，逼真地考验客户端缓冲与流式解码。
 * 客户端打断后 res.write 会抛 EPIPE/ERR_STREAM_DESTROYED：这里吞掉并返回 false，
 * 让调用方停止后续帧——否则整个桩进程会被一次未处理的 error 事件带走。
 */
async function writeSplit(res, text, gapMs) {
  if (res.destroyed || res.writableEnded) return false;
  const buf = Buffer.from(text, "utf8");
  let half = Math.ceil(buf.length / 2);
  // 刻意落在 UTF-8 续字节（0b10xxxxxx）上：这样前一片以半个汉字结尾，
  // 客户端的 TextDecoder({stream:true}) 只有真缓冲才拼得回来。
  for (let i = half; i < buf.length; i += 1) {
    if ((buf[i] & 0xc0) === 0x80) {
      half = i;
      break;
    }
  }
  try {
    res.write(buf.subarray(0, half));
    await sleep(gapMs);
    if (res.destroyed || res.writableEnded) return false;
    res.write(buf.subarray(half));
    await sleep(gapMs);
  } catch {
    return false;
  }
  return !(res.destroyed || res.writableEnded);
}

const server = createServer((req, res) => {
  // 客户端 abort 会让 res 触发 error 事件；没有监听器时它会变成未捕获异常并打死桩进程。
  res.on("error", () => {});
  void handle(req, res).catch(() => {
    if (!res.destroyed && !res.writableEnded) res.end();
  });
});

async function handle(req, res) {
  const url = req.url ?? "";
  if (url === "/__health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (url === "/__requests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(requests));
    return;
  }
  const raw = await readBody(req);
  let parsed = {};
  try {
    if (raw !== "") parsed = JSON.parse(raw);
  } catch {
    // 坏 body 也照样进日志（只记到「没有消息」这一层），但绝不把原始字节留在内存里
  }
  // 密钥只记「有没有带」，绝不落进日志：spec §8 的单向性在这里也要成立
  requests.push({
    url,
    method: req.method,
    hasAuth: Boolean(req.headers.authorization),
    model: parsed.model,
    messages: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
    // 每轮两个开关的出站形状如实回显（缺省记 null/false，好让「漏传」与「传了 off」在日志上分得开）
    reasoningEffort: typeof parsed.reasoning_effort === "string" ? parsed.reasoning_effort : null,
    webSearch: webSearchRequested(parsed)
  });
  if (!url.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "未知路径" } }));
    return;
  }
  const text = lastUserText(parsed);
  if (text.includes("503")) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "上游繁忙，请稍后再试" } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  const gap = text.includes("慢") || text.includes("打断") ? 60 : 3;
  for (const frame of framesFor(parsed, text)) {
    const keepGoing = await writeSplit(res, `data: ${JSON.stringify(frame)}\n\n`, gap);
    if (!keepGoing) return;
  }
  await writeSplit(res, "data: [DONE]\n\n", gap);
  if (!res.destroyed && !res.writableEnded) res.end();
}

server.listen(Number.isFinite(port) ? port : 8787, "127.0.0.1", () => {
  process.stdout.write(`[mochen-mock] http://127.0.0.1:${port}/v1 doc=${doc}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

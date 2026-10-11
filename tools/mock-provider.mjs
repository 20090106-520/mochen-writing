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

// #104：桩扮的远端模型名单。刻意**乱序**并让 mochen-mock **出现两次**——
// 去重与排序归主进程 provider-models.ts 的解析器，桩要是替它排好了，
// 那条链在真机上就永远测不出「解析器没做这件事」。
const MOCK_MODELS = ["mochen-mock-long", "mochen-mock", "aether-7b-instruct", "mochen-mock"];

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

/**
 * 联网搜索那一轮（2026-10-06 批次 5-⑨）。
 *
 * 为什么桩里要单独有一枚：web_search 是唯一一条**回执带结构化来源**的工具，
 * 来源要走 contracts → ToolOutcome → tool-loop 事件 → preload → timeline → 工具卡共六层。
 * 那条链没有真模型可验（本机到境外各家都不通），只能拿桩当模型把这条链接通——
 * 否则每一层单独测都绿，缝上却可能是断的。
 *
 * 派发条件除了关键字，还要求这一轮**真的带了 web_search 工具**：
 * 开关关着时也派，模型就等于凭空调用了一枚自己手上没有的工具。
 */
function webSearchFrame(query, id = "call-net") {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id,
              function: { name: "web_search", arguments: JSON.stringify({ query }) }
            }
          ]
        }
      }
    ]
  };
}

/**
 * 这一轮已经派过几次 web_search（批次 5-⑩）。
 *
 * 判据看 **assistant 消息里的 tool_calls**，不是数 tool 回投：真实的第二轮必然是
 * 「assistant(tool_calls) → tool」成对出现的，只数 tool 回投的话，
 * 桩会把「第一次搜索的当场回投」也算成已经搜过一次，于是第一次的补搜永远轮不到。
 *
 * 而且**只数最近一次 user 之后的**：历史里必然带着上一轮那两次搜索，数全量的话，
 * 用户第二轮一开口就被判成「已经搜够了」，模型直接收尾——2026-10-06 真机连着跑两轮时撞出来的。
 */
function countWebSearchCalls(messages) {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (item && item.role === "user") break;
    if (item && item.role === "assistant" && Array.isArray(item.tool_calls))
      count += item.tool_calls.filter((call) => call?.function?.name === "web_search").length;
  }
  return count;
}

/**
 * 这一轮**所有** tool 回投的正文：从最后一次往前扫到最近一次 user 为止。
 *
 * 为什么不是只看最后一条（批次 5-⑬ 改）：真机跑出来过——第一搜成功递了 10 条来源，
 * 第二次搜索失败（查询被源拆成了词义查询），桩只从最后那条回执里摘键，
 * 于是它把**第一轮已经拿到手的资料整个忘了**，收尾时写「这一轮没搜到可用的来源」。
 *
 * 真实模型这一轮能看见每一条工具回执，它不会只读最后一条就忘了前面。
 * 桩只读最后一条，那就不是模型读得笨，是桩自己演得不像——
 * 而这会让「模型引用 ⟷ 卡片上的键」那条端到端判据永远验不成（空集对空集）。
 */
function toolTextsOfTurn(messages) {
  const out = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (item && item.role === "user") break;
    if (item && item.role === "tool") out.unshift(String(item.content ?? ""));
  }
  return out;
}

/** 从回执里把来源键摘出来（回执格式见 main/web-search.ts 的 webSearchReceipt）。 */
function sourceKeysFrom(text) {
  return [...String(text).matchAll(/^\[([^\]]+)\]/gm)].map((hit) => hit[1]);
}

/**
 * 换词重搜用的第二个查询。桩只做一件真事：把词换掉，让第二次搜索**真的换了说法**——
 * 换了说法才递得出重叠的结果，而「重叠的结果怎么处理」正是这一轮要验的东西。
 */
function reword(query) {
  return `${query} 详细解释`;
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
 * 「模型自己把这一轮截断了」那一档（P2-5 的真机取证用）。
 * 形状照 OpenAI：正文说了半截，最后一帧的 `finish_reason` 是 `length` 而不是 `stop`。
 * 桩不判「该不该提示」——那句人话住 `provider-client.ts` 的 `truncationNotice`，这里只负责把它送进真链路。
 */
function truncatedFrames() {
  const content = "海雾从船头漫过来，甲板上那盏灯的轮廓先软了半";
  const out = [];
  for (let i = 0; i < content.length; i += 4) {
    out.push({ choices: [{ delta: { content: content.slice(i, i + 4) } }] });
  }
  out.push({ choices: [{ delta: {}, finish_reason: "length" }] });
  return out;
}

/**
 * 每轮两个开关（#101）在桩这一侧的回显：思考档与联网工具各自打进 reasoning 一句标记。
 * 桩不演业务规则，但必须演「服务端看得见的形状」——否则输入区那两枚 chip 在真机上无法证伪。
 * 关档时没有任何标记：不发 reasoning_effort、tools 里也没有 web_search，回显跟着出站形状走。
 *
 * 认的是 **function 形态**的那一枚（`{type:"function", function:{name:"web_search"}}`）。
 * 这里原来找的是裸 `{type:"web_search"}`（hosted tool 形状），2026-10-08 那个形状被真机打掉：
 * 严格校验的 OpenAI 兼容端点把它反序列化成 `tools[i].function` 后发现缺 `parameters`，整笔 400。
 * 运行时从此不再发它，桩也必须跟着改判据——否则它演的是一个已经不存在的服务端。
 */
function webSearchRequested(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.some((tool) => tool?.type === "function" && tool?.function?.name === "web_search");
}

function reasoningText(body) {
  const marks = [];
  if (typeof body.reasoning_effort === "string") marks.push(`思考档 ${body.reasoning_effort}`);
  if (webSearchRequested(body)) marks.push("已联网");
  const head = marks.length === 0 ? "" : `（${marks.join(" · ")}）`;
  return `${head}先读一遍上下文，再决定动哪一段。`;
}

/**
 * 插件工具那一支（2026-10-07 批次 5-㉘，5-㉙ 扩到内置插件两个工具，5-㊱ 加了 roster 的 book_cast）。
 *
 * 判据与 web_search 那一支同款：派发条件除了关键字，还要求这一轮
 * **真的带了那个工具**（在 body.tools 里）。开关不在手就派，等于模型凭空调用
 * 一枚自己手上没有的工具——那样「模型真用得上插件」这条判据就成了自说自话。
 *
 * 【5-㉙ 的改动】原来这一支硬编在 rhythm_check 上，内置插件再带一个 book_outline 就够不着。
 * 现在按「用户这句话点到哪个内置工具」来选，且仍然要求它这一轮真在 tools 里。
 * 两个条件都满足才派；都不满足就走默认分支——桩不会凭空造工具调用。
 *
 * 【5-㊱ 的改动】加了 book_cast（roster）。关键字取「出场」——
 * 与前两条一样取一个**只可能指到那个工具**的词：取「表」会撞上「列表」，
 * 取「谁」会撞上任何一句话，于是判据就退化成「用户提到了某个字」。
 */
const PLUGIN_TOOLS = [
  { keyword: "骨架", name: "book_outline", id: "call-outline" },
  { keyword: "节奏", name: "rhythm_check", id: "call-rhythm" },
  { keyword: "出场", name: "book_cast", id: "call-cast" }
];

/** 用户这句话点到哪个内置工具（点不到就是 null，不猜）。 */
function wantedPluginTool(text) {
  return PLUGIN_TOOLS.find((one) => text.includes(one.keyword)) ?? null;
}
/**
 * 这轮发了哪些 function 工具的名字。
 *
 * 【形状照抄出站那一段】provider-client 把每个 function 工具包成
 * `{ type: "function", function: { name, … } }`（OpenAI 兼容形状），
 * 名字在 **function 里面**，不在顶层。第一版写成 `tool.name` 判，
 * 于是这一支永远不成立——症状是「插件明明挂上了、模型却从不调它」，
 * 而桩若无其事地走了默认分支，看起来像模型自己不愿意用。
 */
function functionToolNames(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools
    .filter((tool) => tool !== null && typeof tool === "object" && tool.type === "function")
    .map((tool) => tool.function?.name)
    .filter((name) => typeof name === "string");
}

/**
 * 派一枚插件工具调用。
 *
 * 【参数从回执里递的话一个字都不自己编】book_outline 没有入参；
 * rhythm_check 的 text 取用户那句话里「节奏」之后的那一段——
 * 那正好是用户自己写的，不是桩生成的。真机上模型再把这套数复述一遍，
 * 于是「结论真的来自插件」这件事有两处独立字面可比。
 */
function pluginToolFrame(text, id = "call-plugin") {
  const arg = text.includes("节奏") ? text.slice(text.indexOf("节奏")) : "潮汛";
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id,
              function: { name: "rhythm_check", arguments: JSON.stringify({ text: arg }) }
            }
          ]
        }
      }
    ]
  };
}

/**
 * 派一个**无入参**的插件工具。book_outline 与 book_cast 都是这一档。
 *
 * 【5-㊱ 抽出这一支的原因】原来只有 `outlineToolFrame` 一个名字，加 book_cast 时
 * 照着再写一个几乎逐字相同的函数 ⇒ 同一段 SSE 形状有两份。
 * 一旦桩要改派发的 id 形状，两处都得改，漏一处的那一种工具就静默地派不出去了。
 * ⇒ 收成一个带 name 的函数，调用点按 `wanted.name` 分流。
 */
function noArgToolFrame(name, id) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id, function: { name, arguments: "{}" } }]
        }
      }
    ]
  };
}

function framesFor(body, text) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  // 插件轮排在最前：它和联网轮一样是「先派工具、后收尾」，而它更简单——
  // 一枚工具、一次回投、再收尾，一轮就能验完。
  //
  // 【两个条件都要满足才派】用户这句话点到哪个内置工具，**且**它这一轮真在 tools 里。
  // 点到但不在这轮的手上（插件没挂上 / 工具被花名册挡了），就**不派**——
  // 派了就等于「模型凭空调了一枚它没有的工具」，那这条验收就成了自说自话。
  const wanted = wantedPluginTool(text);
  if (wanted !== null && functionToolNames(body).includes(wanted.name)) {
    const out = [{ choices: [{ delta: { reasoning_content: reasoningText(body) } }] }];
    if (!isFollowUp(messages)) {
      out.push(
        wanted.name === "rhythm_check"
          ? pluginToolFrame(text, wanted.id)
          : noArgToolFrame(wanted.name, wanted.id)
      );
      out.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      return out;
    }
    const seen = toolTextsOfTurn(messages).join("\n");
    out.push({
      choices: [{ delta: { content: `看完了：${seen.slice(0, 160) || "（桩没读到回投）"}。` } }]
    });
    out.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
    return out;
  }
  // 联网搜索轮必须排在 isFollowUp **前面**：第二次搜索恰好就是「工具回投轮」，
  // 排在后面的话这里永远走不到，桩便成了只会搜一次的替身——
  // 而模型第一轮搜不准就换词重搜，正是这批要验的常态。
  if (text.includes("联网") || text.includes("查")) {
    const out = [{ choices: [{ delta: { reasoning_content: reasoningText(body) } }] }];
    // 关键字 + 这一轮真带了 web_search，两个条件都要满足。
    // 少第二个条件就等于让模型凭空调用自己手上没有的工具。
    if (!webSearchRequested(body)) {
      out.push({ choices: [{ delta: { content: "这一轮没带联网工具，我先用自己的话答。" } }] });
      out.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
      return out;
    }
    const done = countWebSearchCalls(messages);
    if (done === 0) {
      out.push(webSearchFrame(queryFrom(text), "call-net-1"));
      out.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      return out;
    }
    if (done === 1) {
      out.push(webSearchFrame(reword(queryFrom(text)), "call-net-2"));
      out.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      return out;
    }
    // 两次搜完：收尾，并且**照回执里给的键**引用。键是从这一轮**每一条** tool 回投里摘出来的，
    // 不是桩自己编的——真机截图上模型引用的键与工具卡上显示的键必须字面一致，
    // 这条设计才算是真跑通了。
    const keys = toolTextsOfTurn(messages).flatMap(sourceKeysFrom);
    const closing =
      keys.length === 0
        ? "这一轮没搜到可用的来源，我先按已有文稿写。"
        : `按 ${keys
            .slice(0, 2)
            .map((key) => `[${key}]`)
            .join("、")} 核对过才动笔的。`;
    const step = 6;
    for (let i = 0; i < closing.length; i += step) {
      out.push({ choices: [{ delta: { content: closing.slice(i, i + step) } }] });
    }
    out.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
    return out;
  }
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
  if (text.includes("截断")) return truncatedFrames();
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

/**
 * 从用户那句话里取出搜索词：取「查」后面的正文，去掉尾部的标点。
 * 桩不猜同义词、不做分词——它只是把用户**原样**要查的东西递下去，
 * 这样真机截图里回执的 query 与用户输入一致，能一眼看出串没串。
 */
/**
 * 用户那句话里真正要查的东西。
 *
 * 只做一件事：把**用户自己的词**里那截问句尾巴去掉（是什么 / 有哪些 / 问号…），
 * 剩下的原样送去搜——不去猜同义词、不加词、不换词。
 *
 * 为什么去尾巴（2026-10-06 批次 5-⑬）：系统提示词已经要求模型用 2–4 个关键词，
 * 而必应源只认 query 开头的词，「黑暗森林法则是什么」十条结果会全塌成「什么（汉语词语）」。
 * 桩是**当模型用的**，所以它得像个听话的模型那样发关键词，否则真机只验得到闸门、
 * 验不到成功路径。但「原样」这条底线不变：词来自用户那句，不是桩编的。
 */
function queryFrom(text) {
  const at = text.indexOf("查");
  const tail = at === -1 ? text : text.slice(at + 1);
  const cleaned = tail
    .replace(/^(一下|下|一查)\s*/, "")
    // 先摘句末标点，再摘问句尾巴：**顺序反了就摘不掉**——
    // 「黑暗森林法则是什么。」的尾巴是「。」不是「是什么」。
    .replace(/[。.!！,，、?？\s]+$/, "")
    .replace(/(是什么|有什么|有哪些|怎么样的|吗|呢)+$/, "")
    .replace(/[。.!！,，、?？\s]+$/, "")
    .trim();
  return cleaned === "" ? "黑暗森林法则" : cleaned;
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
  if (url.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ object: "list", data: MOCK_MODELS.map((id) => ({ id })) }));
    return;
  }
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

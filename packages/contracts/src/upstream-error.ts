/**
 * 上游错误 → 人话。**唯一真身**（铁律 6：同一判定不许有第二份实现）。
 *
 * ## 为什么住在 contracts 而不是某一层
 *
 * 这份判据有**两个消费者**，而它们互相看不见对方的包：
 *
 * 1. **主进程**（`packages/agent-runtime/src/provider-client.ts`）：新失败发生时就要翻，
 *    翻完的那句中文随会话落进 jsonl。
 * 2. **渲染层**（对话时间线里的失败条）：还要翻**盘上早就落下来的旧记录**——
 *    2026-10-08 之前的主进程没有这套判据，`***.BadRequestError: OpenAIException - {…}`
 *    这样的原始异常就那么原样存进了 jsonl，回放时原样端上桌（用户原话：「不应该显示这个」）。
 *
 * 渲染层**禁止** import `@mochen/agent-runtime`（包边界闸 `tools/check-package-boundary.mjs`），
 * 所以「两边共用一份实现」唯一能落的地方就是 contracts：agent-runtime 依赖它，渲染层也依赖它。
 *
 * ## 为什么旧记录也要翻
 *
 * 旧记录是**历史事实**：主进程当年写下的就是那句英文，改不了盘上的字。
 * 但**显示**是渲染层的事——屏上那句话必须是人话，这是产品纪律（§一百六十二 / §一百六十三 两刀之后
 * 仍欠着的这半：主进程那侧只覆盖了**新**错误，旧落盘记录原样透出）。
 *
 * ## 幂等
 *
 * 主进程翻过的句子含中文，渲染层再翻一次必须是**原样不动**（`presentableFailureMessage` 的 CJK 闸）。
 * 否则同一句话会被翻两遍、或者被二次改写。
 */

/** 失败句的固定开头。渲染层靠它认出「这是一条失败句」。 */
export const FAILURE_PREFIX = "模型服务端返回";

/** 上游错误体压平后的长度上限（与 2026-10-11 起的老行为一致：200 字，尾部加省略号）。 */
const SNIPPET_MAX = 200;

/** 中文判定：句子里已经有中文 ⇒ 上游那句已经是人话（或已被翻过），不许再动。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** 压平空白并截到 200 字（尾部加省略号）。 */
export function upstreamSnippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= SNIPPET_MAX ? flat : `${flat.slice(0, SNIPPET_MAX)}…`;
}

/** 从已 JSON.parse 的错误体里挑那句消息：先看 error.message，再看顶层 message。 */
export function upstreamErrorMessage(parsed: unknown): string {
  if (typeof parsed !== "object" || parsed === null) return "";
  const root = parsed as Record<string, unknown>;
  const nested = root["error"];
  const nestedMessage =
    typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)["message"]
      : undefined;
  const candidate = typeof nestedMessage === "string" ? nestedMessage : root["message"];
  return typeof candidate === "string" ? candidate.trim() : "";
}

/**
 * 从**可能畸形**（被截断）的错误体里挖出那句消息。
 *
 * 为什么要有这一条：落盘的旧记录长这样——
 * `{"error":{"message":"Invalid JSON data: Failed to deserialize … at line 1 column …"}`
 * ——**JSON 没闭合**，`JSON.parse` 一定失败。只走 parse 那条路的渲染层会拿到整段 JSON 当"消息"，
 * 于是那句英文异常照样整段端上桌（用户看到的那一条正是如此）。
 *
 * 兜底走正则：从 `"message"` 后面挖到第一个未转义的引号或行尾。
 */
export function upstreamMessageOf(body: string): string {
  const flat = upstreamSnippet(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined) {
    const message = upstreamErrorMessage(parsed);
    return message === "" ? flat : upstreamSnippet(message);
  }
  const found = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(body);
  if (found !== null) {
    const raw = found[1] ?? "";
    return upstreamSnippet(raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return flat;
}

/**
 * 上游有几句话是「英文 + 能给出下一步」，原文丢给用户等于没说。
 * 这里只翻**确定性**的几种（模态选错、思考档位叫法不同、密钥无效），改不了的就原样保留——
 * 乱猜一句中文比露出原文更糟（用户会照着错的提示去改配置）。
 *
 * 判据一律扫**整段原文**，不要求原文是干净的 message：旧落盘记录里那句消息裹在
 * `{"error":{"message":"…"}}` 里面，而关键词（`Failed to deserialize` / `tools[9]`）照样在段内。
 */
export function humanizeUpstreamError(message: string): string {
  const imageModel = message.match(/Model\s+([^\s]+)\s+is an image model/i);
  if (imageModel !== null) {
    const name = imageModel[1] ?? "";
    return `「${name}」是图像生成模型，不能用来对话；请在左下角齿轮（设置）里换一个对话模型。`;
  }
  const videoModel = message.match(/Model\s+([^\s]+)\s+is a video model/i);
  if (videoModel !== null) {
    const name = videoModel[1] ?? "";
    return `「${name}」是视频生成模型，不能用来对话；请在左下角齿轮（设置）里换一个对话模型。`;
  }
  /*
   * 2026-10-23（真机走查）：网关把「工具清单不合它的 schema」也走非 2xx 回给我们，原文是一段
   * serde 反序列化报错——英文异常类名 + `tools[9].function` + 字节偏移（`at line 1 column 8706`）。
   * 用户看到的就是一段内部异常，而它其实指着一个很具体的下一步：某个插件给的工具定义不完整。
   *
   * 判据取「反序列化失败」与「tools[N]」两段**同时**在——只认其中一条会把别的英文错误体也吞掉
   * （下一条用例就钉着「不认识的一律原样透传」）。
   */
  const toolSchema = message.match(
    /Failed to deserialize[\s\S]*?\btools\[(\d+)\][\s\S]*?missing field[^A-Za-z_]{0,3}([A-Za-z_]\w*)/i
  );
  if (toolSchema !== null) {
    const index = Number(toolSchema[1] ?? "0") + 1;
    const field = toolSchema[2] ?? "";
    return (
      `工具清单被服务端退了：清单里第 ${index} 个工具少一个必填字段${field === "" ? "" : `（${field}）`}，` +
      `整轮对话一条也发不出去。多半是某个插件给的工具定义不完整——到左栏「插件」里逐个停用，就能找出是哪一个。`
    );
  }
  /*
   * 2026-10-09（批次 5-㊻）那桩「地址与密钥全对却一个字也发不出去」：端点把最高那档思考叫 `xhigh`，
   * 我们发 `high` 上去被整笔 400 拒收。原话：`Unexpected reasoning effort high. Supported types are
   * xhigh (default), medium, and low.`——这句有个**能照着做的下一步**：设置里那条连接有一个
   * 「深度思考在线上叫什么」的下拉（`ModelProfileDialog.vue`），改成 xhigh 那一档即可。
   * 落盘的老记录（2026-10-09 那次）就是这么写的，所以这条判据同时救**新**错与**旧**记录。
   */
  const reasoningEffort = message.match(/Unexpected reasoning effort\s+([A-Za-z]+)/i);
  if (reasoningEffort !== null) {
    const sent = reasoningEffort[1] ?? "";
    return (
      `这个端点不认「${sent}」这一档深度思考——它把最高那一档叫「xhigh」。` +
      `到左下角齿轮（设置）里把这条连接的「深度思考在线上叫什么」改成 xhigh 那一档，再发一次。`
    );
  }
  return message;
}

/**
 * 上游错误体优先取 error.message / message；取不到再压平截断，不把裸 JSON 丢给用户。
 * 空体返回空串，由调用处的 `|| "无响应体"` 兜住。JSON.parse 必须 try/catch：
 * 一段畸形体不许把整轮炸成异常，退回原样片段就是 F-5 之前的行为。
 */
export function upstreamErrorHint(text: string): string {
  const flat = upstreamSnippet(text);
  if (flat === "") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return humanizeUpstreamError(flat);
  }
  const message = upstreamErrorMessage(parsed);
  return humanizeUpstreamError(message === "" ? flat : upstreamSnippet(message));
}

/**
 * 失败句的组装（主进程那条通路）：`模型服务端返回 400：<那句人话>`。
 * 状态码与前半句是**原样保留**的既有格式——界面、日志、落盘都按它认。
 */
export function upstreamFailureMessage(status: number, errorText: string): string {
  return `${FAILURE_PREFIX} ${status}：${upstreamErrorHint(errorText) || "无响应体"}`;
}

/**
 * 渲染层那条通路：把**盘上已经落下来**的失败句翻成人话。
 *
 * 三条纪律：
 * 1. **幂等**：句子里已经有中文 ⇒ 原样返回（主进程翻过的那批不许被翻第二遍）。
 * 2. **只认失败句**：不是 `模型服务端返回 <码>：` 这条句式的（边界拒绝、连接失败等）原样返回。
 * 3. **改不了就原样保留**：没有对应判据时，回退到上游**自己那句话**（`upstreamMessageOf`），
 *    而不是把整段 JSON 或异常类名端给用户——那才是用户点名「不应该显示这个」的东西。
 */
export function presentableFailureMessage(stored: string): string {
  const matched = new RegExp(`^(${FAILURE_PREFIX}\\s*\\d{3}：)([\\s\\S]*)$`).exec(stored);
  if (matched === null) return stored;
  const prefix = matched[1] ?? "";
  const rest = matched[2] ?? "";
  if (rest.trim() === "") return stored;
  // 已经是人话：主进程翻过的那批，原样不动（幂等）。
  if (CJK.test(rest)) return stored;
  // 先在整段上判一次：旧落盘记录里那句消息裹在 JSON 里，而判据的关键词照样在段内。
  const whole = humanizeUpstreamError(rest);
  if (whole !== rest) return `${prefix}${whole}`;
  // 再把那句消息单独挖出来判一次（JSON 完整时走这条路）。
  const message = upstreamMessageOf(rest);
  const human = humanizeUpstreamError(message);
  if (human !== message) return `${prefix}${human}`;
  // 没有对应判据：留上游自己的那句话，不留异常类名与整段 JSON。
  return `${prefix}${message === "" ? rest : message}`;
}

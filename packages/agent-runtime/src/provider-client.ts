import { sseDataFrames } from "./sse.js";
import { toWireMessages, type AssistantToolCall, type ChatMessage } from "./chat-message.js";
import { thinkingBodyField, wireToolsFor } from "./per-run-fields.js";
import type { AuthHeader, ThinkingLevel, ThinkingWire } from "@mochen/contracts";

export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderFetchInput {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface ProviderFetchResult {
  status: number;
  stream: AsyncIterable<Uint8Array> | null;
  errorText: string;
}

export type ProviderFetch = (input: ProviderFetchInput) => Promise<ProviderFetchResult>;

export type StreamEvent =
  | { kind: "reasoning-delta"; text: string }
  | { kind: "text-delta"; text: string }
  | { kind: "tool-call"; call: AssistantToolCall }
  /**
   * 参数没收全、因此**没有**交给执行的那条调用（P2-5）。
   *
   * 它不是可执行调用——上面 `argumentsComplete` 那道门禁一个字没松，半截 JSON 仍然不许出站
   * （Task 8 原样 JSON.parse 会炸，严格端点回喂半截 arguments 直接 400）。
   * 新增这一条是因为「丢弃」这个动作曾经是**静默**的：用户看到「模型答完了」，
   * 实际有一条工具调用凭空消失。现在它成为一个事实，由 runTurn 落成一张 ok:false 的回执卡。
   */
  | { kind: "tool-call-truncated"; call: AssistantToolCall }
  | { kind: "finish"; reason: string };

/**
 * 「这一轮是被截断的」那句人话（P2-5）。句子只住这一处，与它判的那个 reason 同源：
 * runTurn 只负责把非空串发成既有的 `error` 事件，渲染层与 agent-service 都不许再抄一份
 * `reason === "length"`（铁律 6）。不是截断的收尾（stop / tool_calls / aborted）回空串，
 * 界面就不出行——「对答完的人道歉」是这类 notice 最常见的坏死法。
 */
export function truncationNotice(reason: string): string {
  if (reason === "length")
    return "这一轮被模型的输出长度上限截断了：上面那段不是完整回答。要更长的内容请把要求拆开、分几次发。";
  if (reason === "incomplete")
    return "这一轮的响应流在中途断了，模型没有说完，工具调用也可能压根没发出来。重来一次，或把要求拆短一点再发。";
  return "";
}

/**
 * 半截 tool_call 那张回执卡上的句子（与 truncationNotice 同一处措辞）。
 * 口径照 `SKIPPED_BY_INTERRUPT`：一句中文说清「没有执行」，逐条配对，绝不静默丢。
 */
export const TRUNCATED_TOOL_CALL_RECEIPT =
  "模型这一轮的这条工具调用参数没有传全（JSON 解析不了），所以它没有被执行。";

export interface StreamRequest {
  fetchImpl: ProviderFetch;
  baseURL: string;
  apiKey: string;
  /**
   * 密钥放进哪个请求头。默认 Bearer；小米 MiMo 那类端点只认 `api-key` 头（2026-10-06 批次 5-⑤）。
   * 可选是为了不打断既有构造方——**别**把它改成必填然后逐个调用点补 undefined，
   * 真正要改的是「这个请求归哪条连接」这件事，见 `ProviderSettings.config()`。
   */
  authHeader?: AuthHeader;
  /** 最高档思考在线上叫什么（`xhigh` 那类端点）。与 provider 同源，循环只负责往下传。 */
  thinkingWire?: ThinkingWire;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolSpec[];
  signal: AbortSignal;
  /** 每轮开关：档位与联网，映射集中在 per-run-fields.ts，这里只负责拼进出站 body。 */
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
  /**
   * 连接期自动重试的间隔（毫秒）。只给测试注入小值用——生产走默认 1.5 秒，别从外面覆写。
   */
  retryDelayMs?: number;
}

/**
 * 连接期一次性自动重试（2026-10-11）：免费源与共享网关最常见的病就是 429/5xx 闪断——
 * 请求根本没进模型，重试零风险（**任何字节都还没吐**，重试不可能造成半截回答）。
 * 429（限流）与 500/502/503/504（网关/上游瞬时故障）各默哀一秒半再试一次：
 * 用户看到的是「多等了一小会儿」，而不是一张要手动重发的错误卡。
 * 400/401/403 这类「请求本身不对」的错误不重试——重试只会原样再错一次。
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
export const STREAM_RETRY_DELAY_MS = 1_500;

export class ProviderError extends Error {}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`;
}

/** 从已 JSON.parse 的错误体里挑那句中文：先看 error.message，再看顶层 message。 */
function upstreamMessage(parsed: unknown): string {
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
 * 上游错误体优先取 error.message / message；取不到再压平截断，不把裸 JSON 丢给用户。
 * 空体返回空串，由调用处的 `|| "无响应体"` 兜住。JSON.parse 必须 try/catch：
 * 一段畸形体不许把整轮炸成异常，退回原样片段就是 F-5 之前的行为。
 */
function errorHint(text: string): string {
  const flat = snippet(text);
  if (flat === "") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return flat;
  }
  const message = upstreamMessage(parsed);
  return message === "" ? flat : snippet(message);
}

function completionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

function readDelta(raw: unknown): {
  reasoning: string;
  content: string;
  finishReason: string;
  toolCalls: Record<string, unknown>[];
} {
  const root = (raw ?? {}) as Record<string, unknown>;
  const choice =
    (Array.isArray(root.choices) ? (root.choices[0] as Record<string, unknown>) : undefined) ?? {};
  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  const thinking = [delta.reasoning_content, delta.reasoning].filter(
    (v): v is string => typeof v === "string"
  );
  return {
    reasoning: thinking.join(""),
    content: typeof delta.content === "string" ? delta.content : "",
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
    toolCalls: Array.isArray(delta.tool_calls)
      ? (delta.tool_calls as Record<string, unknown>[])
      : []
  };
}

/**
 * §6.3 规则 2：参数未收全的 tool_call 视为不存在。
 * complete 的判据即 JSON.parse(args) 成功；收不全（截断、非法 JSON）就不交给下游，
 * 后续 Task 8 会把这些 arguments 原样 JSON.parse，半截串会在那里炸。
 *
 * 空串是**合法**的：无参工具（如 list_docs）在很多端点上干脆不发 `arguments` 字段，
 * readDelta 于是把 held.args 留在 ""；tools.ts 的 dispatchToolCall 也明写
 * `call.args === "" ? "{}" : call.args` 按「无参」执行。若这里判 false，
 * 模型这条调用就会被静默丢弃——正是收全门禁要避免的反面。
 * 判定只放在这一处：正常收尾与断流收尾两个分支共用同一个 verdict。
 */
function argumentsComplete(args: string): boolean {
  if (args === "") return true;
  try {
    JSON.parse(args);
    return true;
  } catch {
    return false;
  }
}

/**
 * 收尾时把攒下的分片调用摊成事件——正常 finish_reason 与断流两个分支共用同一段判定。
 *
 * 按 index 升序；`name` 为空的当作没发生过（§6.3 规则 2）；参数没收全的那一条
 * **不再静默 continue**，改成 tool-call-truncated 递下去（P2-5）。仍然不作为可执行调用交出，
 * 所以「半截 JSON 不许进 messages / 不许回喂上游」这半边一点没松。
 */
function pendingCallEvents(calls: Map<number, PendingCall>): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
    if (call.name === "") continue;
    const shaped: AssistantToolCall = {
      id: call.id === "" ? `call_${index}_${calls.size}` : call.id,
      name: call.name,
      args: call.args
    };
    events.push(
      argumentsComplete(call.args)
        ? { kind: "tool-call", call: shaped }
        : { kind: "tool-call-truncated", call: shaped }
    );
  }
  return events;
}

export async function* streamChat(req: StreamRequest): AsyncGenerator<StreamEvent> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream"
  };
  // 空 apiKey 时连这个头都不发，方便本地 Ollama/LM Studio。
  // 头名由**连接**决定：小米 MiMo 官方只认 `api-key`（发 Bearer 会永远 401，而代码里看不出原因）。
  if (req.apiKey !== "") {
    if (req.authHeader === "api-key") headers["api-key"] = req.apiKey;
    else headers.Authorization = `Bearer ${req.apiKey}`;
  }
  const payload: Record<string, unknown> = {
    model: req.model,
    messages: toWireMessages(req.messages),
    ...thinkingBodyField(req.thinkingLevel, req.thinkingWire)
  };
  // 联网开关只决定 `web_search` 这枚 function 工具有没有出站（映射在 wireToolsFor 一处）。
  // 出站形状只许一种：`{ type: "function", function: { name, description, parameters } }`。
  // 少一个 parameters 就会被严格端点整批拒收——2026-10-08 真机 400/422 `tools[9].function`，
  // 那时这里还往数组尾上追加一枚裸的 `{ type: "web_search" }`。
  const wireTools = wireToolsFor(req.tools, req.webSearchEnabled).map((tool) => ({
    type: "function",
    function: tool
  }));
  if (wireTools.length > 0) {
    payload.tools = wireTools;
    payload.tool_choice = "auto";
  }
  payload.stream = true;

  // 连接期（发请求 → 拿到响应头）带一次性重试：见 RETRYABLE_STATUS 处的说明。
  // 字节一旦开始吐就不再有重试——那之后的失败由既有的看门狗与 abort 语义接管。
  const retryDelayMs = req.retryDelayMs ?? STREAM_RETRY_DELAY_MS;
  let result: ProviderFetchResult | null = null;
  let connectError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    connectError = null;
    result = await req
      .fetchImpl({
        url: completionsUrl(req.baseURL),
        headers,
        body: JSON.stringify(payload),
        signal: req.signal
      })
      .catch((error: unknown) => {
        connectError = error;
        return null;
      });
    // 打断优先于一切：用户按了 Esc（或上一轮已 abort），无论是 fetch 抛的还是没抛。
    if (req.signal.aborted) {
      yield { kind: "finish", reason: "aborted" };
      return;
    }
    const retryable =
      result === null || // 连接期异常（DNS 失败、连接被拒那类——不是用户打断）
      (result !== null && RETRYABLE_STATUS.has(result.status));
    // 不可重试的失败（4xx 之类）或已是第二次尝试：跳出循环，走下面既有的错误通路。
    if (!retryable || attempt === 1) break;
    // 默哀一秒半再试。abort-aware：等待期间被打断就直接收成 aborted——
    // 人都叫停了，第二发不该再出网。
    const aborted = await new Promise<boolean>((resolve) => {
      if (req.signal.aborted) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), retryDelayMs);
      req.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        { once: true }
      );
    });
    if (aborted) {
      yield { kind: "finish", reason: "aborted" };
      return;
    }
  }
  if (result === null) {
    if (req.signal.aborted) {
      yield { kind: "finish", reason: "aborted" };
      return;
    }
    // 已经是人话的 ProviderError（上游看门狗那句「30 秒没响应」）原样抛出，不再套前缀。
    // 为什么不套：本层的「无法连接模型服务端」只描述连不上，而看门狗触发时连接往往是通的、
    // 只是对面不再吐字节——套上前缀会让用户改去看网络/密钥，方向就错了。
    // 而且这句话在 provider-fetch.ts 里只写了一遍（铁律 6），这里再包一层等于两处说同一件事。
    // 非 ProviderError（真·发不出请求，如 DNS 失败）仍走原有包装，语义一字不改。
    const error = connectError;
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      `无法连接模型服务端：${snippet(error instanceof Error ? error.message : String(error))}`,
      {
        cause: error
      }
    );
  }
  if (result.status < 200 || result.status >= 300)
    throw new ProviderError(
      `模型服务端返回 ${result.status}：${errorHint(result.errorText) || "无响应体"}`
    );
  if (result.stream === null) throw new ProviderError("模型服务端没有返回可读取的流");

  const calls = new Map<number, PendingCall>();
  try {
    for await (const frame of sseDataFrames(result.stream)) {
      if (req.signal.aborted) {
        yield { kind: "finish", reason: "aborted" };
        return;
      }
      // 空帧策略：裸 `data:`（载荷为空或只剩空白）不携带任何内容，直接跳过。
      // 若送去 JSON.parse("")，它会抛 SyntaxError，一条杂帧就能误杀整条流。
      if (frame.trim() === "") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(frame);
      } catch (error) {
        throw new ProviderError("流式响应不是合法 JSON：" + snippet(frame), { cause: error });
      }
      const delta = readDelta(raw);
      if (delta.reasoning !== "") yield { kind: "reasoning-delta", text: delta.reasoning };
      if (delta.content !== "") yield { kind: "text-delta", text: delta.content };
      for (const fragment of delta.toolCalls) {
        const index = typeof fragment.index === "number" ? fragment.index : 0;
        const fn = (fragment.function ?? {}) as Record<string, unknown>;
        const held = calls.get(index) ?? { id: "", name: "", args: "" };
        if (typeof fragment.id === "string" && fragment.id !== "") held.id = fragment.id;
        if (typeof fn.name === "string" && fn.name !== "") held.name = fn.name;
        if (typeof fn.arguments === "string") held.args += fn.arguments;
        calls.set(index, held);
      }
      if (delta.finishReason !== "") {
        for (const event of pendingCallEvents(calls)) yield event;
        yield { kind: "finish", reason: delta.finishReason };
        return;
      }
    }
  } catch (error) {
    // 读流期守卫：与上面连接期 .catch 的守卫同性质，不是新策略。真 fetch 被打断后，
    // 未收完的 reader.read() 直接 reject AbortError——**收不到下一帧**，循环体内的
    // aborted 检查永远轮不到；只有在这里折成 finish:aborted，runTurn 才认得出「打断」（§6.3/§9）。
    // 未被 abort 的异常（坏帧 ProviderError 等）原样抛，语义一字不改。
    if (!req.signal.aborted) throw error;
    yield { kind: "finish", reason: "aborted" };
    return;
  }
  // 端点没给 finish_reason 就断流了：收全的调用照常交出，没收全的那条标成截断（不再静默丢），
  // 再由收尾原因 incomplete 让 runTurn 把「这一轮没说完」说给人听（P2-5）。
  for (const event of pendingCallEvents(calls)) {
    // 打断这一路不报截断：那条半截参数是用户这次 Esc 自己的产物，
    // 循环那侧已有 INTERRUPTED_MESSAGE，再冒一句「模型被截断」就是把打断说成模型的错。
    if (event.kind === "tool-call-truncated" && req.signal.aborted) continue;
    yield event;
  }
  yield { kind: "finish", reason: req.signal.aborted ? "aborted" : "incomplete" };
}

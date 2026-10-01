import { sseDataFrames } from "./sse.js";
import { toWireMessages, type AssistantToolCall, type ChatMessage } from "./chat-message.js";

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
  | { kind: "finish"; reason: string };

export interface StreamRequest {
  fetchImpl: ProviderFetch;
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolSpec[];
  signal: AbortSignal;
}

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

export async function* streamChat(req: StreamRequest): AsyncGenerator<StreamEvent> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream"
  };
  // 空 apiKey 时连 Authorization 都不发，方便本地 Ollama/LM Studio。
  if (req.apiKey !== "") headers.Authorization = `Bearer ${req.apiKey}`;
  const payload: Record<string, unknown> = {
    model: req.model,
    messages: toWireMessages(req.messages)
  };
  if (req.tools.length > 0) {
    payload.tools = req.tools.map((tool) => ({ type: "function", function: tool }));
    payload.tool_choice = "auto";
  }
  payload.stream = true;

  const result = await req
    .fetchImpl({
      url: completionsUrl(req.baseURL),
      headers,
      body: JSON.stringify(payload),
      signal: req.signal
    })
    .catch((error: unknown) => {
      if (req.signal.aborted) return null;
      throw new ProviderError(
        `无法连接模型服务端：${snippet(error instanceof Error ? error.message : String(error))}`,
        {
          cause: error
        }
      );
    });
  if (result === null) {
    yield { kind: "finish", reason: "aborted" };
    return;
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
        for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
          if (call.name === "") continue;
          // §6.3 与下方断流分支同一条门禁：端点正常收尾（finish_reason）时，
          // 参数未收全的 tool_call 也必须丢弃——Task 8 会把这些 arguments 原样 JSON.parse，半截串就炸。
          if (!argumentsComplete(call.args)) continue;
          yield {
            kind: "tool-call",
            call: {
              id: call.id === "" ? `call_${index}_${calls.size}` : call.id,
              name: call.name,
              args: call.args
            }
          };
        }
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
  // 端点没给 finish_reason 就断流了：只把参数收全的工具调用交出去，其余丢弃，再标 incomplete。
  for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
    if (call.name === "") continue;
    if (!argumentsComplete(call.args)) continue;
    yield {
      kind: "tool-call",
      call: {
        id: call.id === "" ? `call_${index}_${calls.size}` : call.id,
        name: call.name,
        args: call.args
      }
    };
  }
  yield { kind: "finish", reason: req.signal.aborted ? "aborted" : "incomplete" };
}

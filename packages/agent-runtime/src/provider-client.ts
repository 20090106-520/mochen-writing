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
 */
function argumentsComplete(args: string): boolean {
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
      `模型服务端返回 ${result.status}：${snippet(result.errorText) || "无响应体"}`
    );
  if (result.stream === null) throw new ProviderError("模型服务端没有返回可读取的流");

  const calls = new Map<number, PendingCall>();
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

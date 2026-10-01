export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface AssistantToolCall {
  id: string;
  name: string;
  args: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** role === "tool" 时是这轮 tool_call 的 id；其余为空串。 */
  toolCallId: string;
  toolCalls: AssistantToolCall[];
}

export function chatMessage(role: ChatRole, content: string): ChatMessage {
  return { role, content, toolCallId: "", toolCalls: [] };
}

export function toolMessage(callId: string, content: string): ChatMessage {
  return { role: "tool", content, toolCallId: callId, toolCalls: [] };
}

export function assistantToolMessage(content: string, toolCalls: AssistantToolCall[]): ChatMessage {
  return { role: "assistant", content, toolCallId: "", toolCalls };
}

/** OpenAI 兼容 wire 形状；无 tool_calls 的 assistant 不带该字段，避免小模型解析失败。 */
export function toWireMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool")
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    if (message.role === "assistant" && message.toolCalls.length > 0)
      return {
        role: "assistant",
        content: message.content === "" ? null : message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args }
        }))
      };
    return { role: message.role, content: message.content };
  });
}

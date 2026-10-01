import type { AgentEvent, AgentToolName } from "@mochen/contracts";

export interface StreamingTail {
  reasoning: string;
  message: string;
}

export interface PlanItemView {
  text: string;
  done: boolean;
}

export type TimelineBlock =
  | { kind: "user"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string; streaming: boolean; interrupted: boolean }
  | { kind: "plan"; id: string; items: PlanItemView[] }
  | { kind: "message"; id: string; text: string; streaming: boolean; interrupted: boolean }
  | { kind: "tool"; id: string; label: string; args: string; ok: boolean; resultText: string }
  | { kind: "error"; id: string; text: string }
  | { kind: "interrupted"; id: string; pending: number };

/**
 * 工具卡的中文标签（中栏给用户看的名字，不是工具 id）。
 * 裁定 r：键类型用 `AgentToolName`（唯一来源 `AGENT_TOOL_NAMES`）而不是 `string`——
 * 工具改名或新增时这张表必须编译报错，靠类型穷尽而不是靠人记得来改映射。
 */
export const TOOL_LABELS: Record<AgentToolName, string> = {
  read_doc: "读取文档",
  list_docs: "列出文档",
  search_docs: "全书检索",
  propose_patch: "提出改稿提案",
  write_doc: "写入文档"
};

/**
 * 持久事件 → 四层时间线（思考摘要 / 计划 / 正文 / 工具卡）。
 * 提案、裁决、写入三类事件刻意不进时间线：它们只挂在对应的提案卡上，
 * 免得同一件事在中栏出现两遍（spec §4 的中栏分工）。
 */
export function buildTimeline(items: AgentEvent[], tail: StreamingTail): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const event of items) {
    if (event.type === "user-message") {
      blocks.push({ kind: "user", id: event.id, text: event.text });
      continue;
    }
    if (event.type === "reasoning") {
      blocks.push({
        kind: "thinking",
        id: event.id,
        text: event.text,
        streaming: false,
        interrupted: event.interrupted
      });
      continue;
    }
    if (event.type === "plan") {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "plan") {
        last.items = event.items;
        last.id = event.id;
        continue;
      }
      blocks.push({ kind: "plan", id: event.id, items: event.items });
      continue;
    }
    if (event.type === "message") {
      blocks.push({
        kind: "message",
        id: event.id,
        text: event.text,
        streaming: false,
        interrupted: event.interrupted
      });
      continue;
    }
    if (event.type === "tool-call") {
      blocks.push({
        kind: "tool",
        id: event.id,
        // 取值处保留运行期兜底（裁定 r）：store 的闸门（useAgentStore.ts:79-111）只校验
        // threadKey/turnId/type，不校验嵌套的 event.tool，preload 也是裸 `payload as AgentOutbound`，
        // 所以表外的工具名确实能一路走到这里。类型上「不可能」，运行时可能——cast 不是装饰。
        label: (TOOL_LABELS as Partial<Record<string, string>>)[event.tool] ?? event.tool,
        args: event.args,
        ok: event.ok,
        resultText: event.resultText
      });
      continue;
    }
    if (event.type === "error") {
      blocks.push({ kind: "error", id: event.id, text: event.message });
      continue;
    }
    if (event.type === "interrupted") {
      blocks.push({ kind: "interrupted", id: event.id, pending: event.pendingProposals });
    }
  }
  if (tail.reasoning.trim() !== "")
    blocks.push({
      kind: "thinking",
      id: "tail-thinking",
      text: tail.reasoning,
      streaming: true,
      interrupted: false
    });
  if (tail.message.trim() !== "")
    blocks.push({
      kind: "message",
      id: "tail-message",
      text: tail.message,
      streaming: true,
      interrupted: false
    });
  return blocks;
}

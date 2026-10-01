import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
  type EditProposal,
  type PermissionMode
} from "@mochen/contracts";
import type { AssistantToolCall } from "./chat-message.js";
import type { ChatToolSpec } from "./provider-client.js";

/** 派发层向 host 暴露的当前会话上下文。 */
export interface ToolContext {
  docRelPath: string | null;
  permissionMode: PermissionMode;
}

export interface ToolOutcome {
  ok: boolean;
  text: string;
  proposals: EditProposal[];
}

/** Task 8 的 runTurn 只认这个接口；Task 10 给 fs 实现，测试给假实现。 */
export interface ToolHost {
  context(): ToolContext;
  call(name: AgentToolName, args: Record<string, unknown>): Promise<ToolOutcome>;
}

export function toolNameOf(name: string): AgentToolName | null {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name) ? (name as AgentToolName) : null;
}

const object = (
  properties: Record<string, unknown>,
  required: string[] = []
): ChatToolSpec["parameters"] => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {})
});

/** 花名册的唯一工具清单（§6：五个，不多不少）；顺序与 AGENT_TOOL_NAMES 一致。 */
export const TOOL_SPECS: ChatToolSpec[] = [
  {
    name: "read_doc",
    description: "读书稿全文（含 frontmatter）。改稿前先用它确认原文逐字。",
    parameters: object(
      { doc: { type: "string", description: "书内相对路径，如 chapters/03-章名.md" } },
      ["doc"]
    )
  },
  {
    name: "list_docs",
    description: "列书名稿清单，可按类型过滤（chapter/outline/character/plot/material）。",
    parameters: object({ kind: { type: "string", description: "可选：文稿类型" } })
  },
  {
    name: "search_docs",
    description: "全书子串检索，返回 路径:行号: 内容 前 20 条。",
    parameters: object({ query: { type: "string", description: "要检索的字面文本" } }, ["query"])
  },
  {
    name: "propose_patch",
    description: "提出一处替换：doc + anchor（文中唯一原文）+ replace + why（中文理由）。不写盘。",
    parameters: object(
      {
        doc: { type: "string" },
        anchor: { type: "string", description: "被替换的原文，必须逐字且唯一" },
        replace: { type: "string" },
        why: { type: "string", description: "中文修改理由，用户在卡片上看这条" }
      },
      ["doc", "anchor", "replace", "why"]
    )
  },
  {
    name: "write_doc",
    description: "整篇写入 doc（新建或重写）。同样需要用户逐条批准，且受权限档约束。",
    parameters: object(
      { doc: { type: "string" }, content: { type: "string" }, why: { type: "string" } },
      ["doc", "content", "why"]
    )
  }
];

export async function dispatchToolCall(
  host: ToolHost,
  call: AssistantToolCall
): Promise<ToolOutcome> {
  const name = toolNameOf(call.name);
  if (name === null)
    return {
      ok: false,
      text: `没有这个工具：${call.name}。可用工具只有 ${AGENT_TOOL_NAMES.join("、")}。`,
      proposals: []
    };
  let args: unknown;
  try {
    args = JSON.parse(call.args === "" ? "{}" : call.args);
  } catch {
    return {
      ok: false,
      text: `工具 ${call.name} 的参数不是合法 JSON，请重新给出：${call.args.slice(0, 120)}`,
      proposals: []
    };
  }
  if (args === null || typeof args !== "object" || Array.isArray(args))
    return { ok: false, text: `工具 ${call.name} 的参数必须是对象。`, proposals: [] };
  return host.call(name, args as Record<string, unknown>);
}

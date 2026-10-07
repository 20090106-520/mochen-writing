export const AGENT_TOOL_NAMES = [
  "read_doc",
  "list_docs",
  "search_docs",
  "propose_patch",
  "write_doc",
  "web_search"
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** 只有这两个工具会产生待写入动作；其余都是只读参考（web_search 出网但只读，不落盘）。 */
export const WRITE_TOOLS = [
  "propose_patch",
  "write_doc"
] as const satisfies readonly AgentToolName[];
export type WriteToolName = (typeof WRITE_TOOLS)[number];

export function isWriteTool(name: AgentToolName): name is WriteToolName {
  return (WRITE_TOOLS as readonly AgentToolName[]).includes(name);
}

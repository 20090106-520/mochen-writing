export const AGENT_TOOL_NAMES = [
  "read_doc",
  "list_docs",
  "search_docs",
  "propose_patch",
  "write_doc",
  "web_search",
  // 2026-10-11 追加 web_read（网页正文抓取）：web_search 只回标题+摘要，扫榜/资料任务
  // 拿不到正文；这一枚把一条来源的网页正文剥出来给模型读。同样主进程出网、不要 key。
  "web_read",
  // 2026-10-23 追加 use_skill（技能自选，放宽 spec §11）：技能此前只能由用户手选挂入；
  // 这一枚让模型自己列技能库、按需载入。只读，不写盘、不出网。
  "use_skill"
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

/** 会出网的两枚工具。联网开关（输入区那枚 chip）闸的是**这一类**，不是 web_search 一枚。 */
export const WEB_SEARCH_TOOL_NAME = "web_search";
export const WEB_READ_TOOL_NAME = "web_read";
export const NETWORK_TOOL_NAMES = [WEB_SEARCH_TOOL_NAME, WEB_READ_TOOL_NAME] as const;
export type NetworkToolName = (typeof NETWORK_TOOL_NAMES)[number];

export function isNetworkTool(name: AgentToolName): boolean {
  return (NETWORK_TOOL_NAMES as readonly string[]).includes(name);
}

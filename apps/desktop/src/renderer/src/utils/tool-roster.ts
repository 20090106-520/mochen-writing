import { AGENT_TOOL_NAMES, isWriteTool, type AgentToolName } from "@mochen/contracts";

/**
 * 工具 ▾ 的真清单（task #101）。
 *
 * 行集合**只能**从 contracts 的 `AGENT_TOOL_NAMES` 映射出来：名字、条数、顺序都是那一份数据，
 * 这里不抄第二份名单。`TOOL_LABELS` 用 `Record<AgentToolName, …>` 而非普通对象——
 * contracts 加了第六个工具而这里漏了一行，裸 tsc 当场报 TS2741（缺键），
 * 比一枚「清单里没有这个工具」的假面板诚实得多。
 *
 * 这一格是**只读清单**，不是开关：本仓的运行时对五个工具一视同仁地交给模型自选
 * （`tool_choice: "auto"`），没有任何「单独禁用某一枚工具」的通路。
 * 画成可点掉的开关就是「按了没反应的按钮」，违本仓铁律。
 */
export interface ToolRosterRow {
  /** 模型看到的 function 名，与出站 tools 里一字不差。 */
  name: AgentToolName;
  /** 中文短名。 */
  label: string;
  /** 读 / 写：来自 contracts 的 isWriteTool，不在这份文件里重数一遍 WRITE_TOOLS。 */
  kind: "读" | "写";
  /** 这一枚工具对用户意味着什么。 */
  effect: string;
}

const TOOL_LABELS: Record<AgentToolName, { label: string; effect: string }> = {
  read_doc: { label: "读文稿", effect: "把整篇原稿读给它看，改稿的锚点逐字取自这里。" },
  list_docs: { label: "列清单", effect: "列出书稿文件清单，可按文稿类型过滤。" },
  search_docs: { label: "全书检索", effect: "子串检索整本书，返回路径:行号:内容，最多 20 条。" },
  propose_patch: {
    label: "提修改",
    effect: "对一处原文提出替换，生成待你批准的修改提案卡，不直接写盘。"
  },
  write_doc: {
    label: "写全篇",
    effect: "新建或整篇重写一份文稿，同样要你逐条批准，并受权限档约束。"
  }
};

export function toolRoster(): ToolRosterRow[] {
  return AGENT_TOOL_NAMES.map((name) => ({
    name,
    label: TOOL_LABELS[name].label,
    kind: isWriteTool(name) ? "写" : "读",
    effect: TOOL_LABELS[name].effect
  }));
}

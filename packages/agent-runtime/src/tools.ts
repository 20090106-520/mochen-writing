import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
  type EditProposal,
  type PermissionMode,
  type WebSource,
  type WorkMode
} from "@mochen/contracts";
import { wireToolsFor } from "./per-run-fields.js";
import type { AssistantToolCall } from "./chat-message.js";
import type { ChatToolSpec } from "./provider-client.js";

/** 派发层向 host 暴露的当前会话上下文。 */
export interface ToolContext {
  docRelPath: string | null;
  permissionMode: PermissionMode;
  /**
   * 工作模式（2026-10-05 批次 4）。必填、无默认：老书的「没有这一格 ⇒ 直接动手」
   * 由调用方用 contracts 的 `workModeOf(meta)` 解析一次再传进来——
   * 把整个 meta 摊给 host 不合适，而在这里兜个默认值就等于两处各有一份（铁律 6）。
   */
  workMode: WorkMode;
}

export interface ToolOutcome {
  ok: boolean;
  text: string;
  proposals: EditProposal[];
  /**
   * 这一轮联网搜到的来源（2026-10-06 批次 5-⑨）。**只有 web_search 会带**。
   * `text` 是给模型读的人话排版，`sources` 是给界面点的数据——两者同源不同用，
   * 渲染层不从 text 里反解 URL（那是把排版当成数据源）。
   */
  sources?: WebSource[];
  /**
   * 工具**跑通了，但没东西可给**（2026-10-06 批次 5-⑮）。目前只有 web_search 会带。
   *
   * 为什么单开一个字段而不是把 `ok` 改成三态：`ok` 答的是「这次调用有没有出错」，
   * 而「源都能用，只是这个说法没搜着东西」**不是错**——对模型来说那是一条正常的回执，
   * 它据此去换关键词就够了。把它记成 `ok: false` 会让工具循环以为要报错；
   * 可只记成 `ok: true` 又让界面无从区分，于是工具卡一律显示「完成」——
   * 一次没搜着的搜索看上去像是搜到了（真机截图即如此）。
   *
   * 所以这是**第三种情形**，不是第二个布尔：它只说「空」，不说「坏」。
   */
  empty?: boolean;
}

/** Task 8 的 runTurn 只认这个接口；Task 10 给 fs 实现，测试给假实现。 */
export interface ToolHost {
  context(): ToolContext;
  /**
   * 名字放宽到 string（2026-10-07 批次 5-㉘）：花名册仍是那五个（§6），
   * 但**插件注册进来的工具**也要能叫得动，而插件的工具名运行时才知道。
   * 用方法签名（非箭头属性）⇒ 参数双变，已有实现不写 `extraSpecs` 也照样成立。
   */
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  /**
   * 插件工具的规格。**没有插件就返回空数组**，这时对外行为与插件之前逐字一致。
   * 刻意放在 host 上而不是做成全局可变表：全局表在单测里会互相污染，
   * 而 host 是每一轮自己造的那一个，天然隔离。
   */
  extraSpecs?(): ChatToolSpec[];
}

export function toolNameOf(name: string): AgentToolName | null {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name) ? (name as AgentToolName) : null;
}

/** 插件工具的规格（没有就是空数组）。 */
export function extraSpecsOf(host: ToolHost): ChatToolSpec[] {
  const specs = host.extraSpecs?.() ?? [];
  // 插件不许顶掉花名册那五个的名字：同名时**丢掉插件那份**，
  // 而不是让它覆盖——模型发来 read_doc 时，用户要的是本仓的实现。
  return specs.filter((spec) => toolNameOf(spec.name) === null);
}

/** 花名册那五个 + 插件注册进来的那些：本轮还没按开关过滤之前的全量。 */
function rosterSpecs(host: ToolHost): ChatToolSpec[] {
  return [...TOOL_SPECS, ...extraSpecsOf(host)];
}

/**
 * 这一轮真正在场的工具清单（出站与派发的**同一份**判据，P1-2）。
 *
 * 改之前这里只有一句 `extraSpecsOf` 拼接、联网开关只作用在发给模型的 tools 上
 * （`wireToolsFor` 在 provider-client 那一处），于是「关掉联网」只是**看不见**，
 * 模型仿历史里那条 `web_search` 调一次照样真出网——清单和权限用了两套判据。
 * 现在两边都从这一个函数取，`wireToolsFor` 仍是唯一那份映射（这里调它，不改它）。
 */
export function toolsFor(host: ToolHost, webSearchEnabled: boolean): ChatToolSpec[] {
  return wireToolsFor(rosterSpecs(host), webSearchEnabled);
}

/**
 * 这个名字这一轮叫不叫得动，以及叫不动时那句给人看/给模型读的中文。
 * 判据与清单同源：`allowed` 就是「在这轮的 toolsFor 里」，理由也只有这一处措辞。
 *
 * 分成 `unknown` 与 `off-this-round` 两档是因为**处置不同**：
 * 前者是模型凭空造了一枚不存在的工具（走 error 事件，界面上没有对应的工具卡可画），
 * 后者是工具明明在、只是用户这一轮把它关了（走既有的工具失败回执，画一张「失败」的工具卡，
 * 用户在时间线上看得见「它想搜，被闸住了」，而不是一句飘着的错误）。
 */
export type ToolGate =
  { allowed: true } | { allowed: false; kind: "unknown" | "off-this-round"; reason: string };

export function toolGateOf(host: ToolHost, name: string, webSearchEnabled: boolean): ToolGate {
  const round = toolsFor(host, webSearchEnabled);
  if (round.some((spec) => spec.name === name)) return { allowed: true };
  const roster = round.map((spec) => spec.name).join("、");
  if (!rosterSpecs(host).some((spec) => spec.name === name))
    return {
      allowed: false,
      kind: "unknown",
      reason: `模型请求了不存在的工具「${name}」，这条调用已被忽略。可用工具只有 ${roster}。`
    };
  return {
    allowed: false,
    kind: "off-this-round",
    reason:
      `这一轮的联网开关是关闭的，所以「${name}」没有执行，也一个字都没有出网。` +
      "要查网络资料请先在输入区打开联网开关再问一次；这一轮请基于已有文稿回答。"
  };
}

/**
 * 这个名字叫不叫得动：花名册那五个（或插件注册进来的那些）**并且**这一轮的开关没把它摘掉。
 * `webSearchEnabled` 是必填的第三枚——**故意不给默认值**：这一层漏判一次就是「关掉联网仍出网」
 * （P1-1/P1-2 的原案），默认值只会让新调用点悄悄复制同一个洞。
 */
export function isCallableTool(host: ToolHost, name: string, webSearchEnabled: boolean): boolean {
  return toolGateOf(host, name, webSearchEnabled).allowed;
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
    description:
      "列书名稿清单，可按类型过滤（chapter/volume/outline/worldview/character/faction/location/timeline/plot/material/glossary/skill）。",
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
  },
  {
    name: "web_search",
    description:
      "联网搜索（免费源，无需 API key）。返回若干条结果的标题、链接与摘要，每条带编号。" +
      "结果本身不落盘——要保存就整理后用 write_doc 写进对应文稿（如素材库/技能库）。" +
      "在回复里引用其中任何一条时，必须带上它的编号和链接，让人能点进去核对。",
    parameters: object({ query: { type: "string", description: "搜索词，中英文皆可" } }, ["query"])
  }
];

/** 本轮真正叫得动的全部工具名（花名册 + 插件，再按本轮开关过滤），按清单顺序。 */
export function callableToolNames(host: ToolHost, webSearchEnabled: boolean): string[] {
  return toolsFor(host, webSearchEnabled).map((spec) => spec.name);
}

export async function dispatchToolCall(
  host: ToolHost,
  call: AssistantToolCall,
  webSearchEnabled: boolean
): Promise<ToolOutcome> {
  const gate = toolGateOf(host, call.name, webSearchEnabled);
  if (!gate.allowed)
    return {
      ok: false,
      text: gate.reason,
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
  return host.call(call.name, args as Record<string, unknown>);
}

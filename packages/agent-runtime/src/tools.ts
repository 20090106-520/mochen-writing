import {
  AGENT_TOOL_NAMES,
  defaultProfile,
  type AgentProfile,
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
  /**
   * 这一轮用的档案（P0-1）。工具白名单与写入范围都以它为准。
   * 可缺省只为兼容既有测试宿主；生产装配（agent-service.buildHost）每一轮都显式传。
   */
  profile?: AgentProfile;
}

export interface ToolOutcome {
  ok: boolean;
  text: string;
  proposals: EditProposal[];
  /**
   * 这一轮联网工具带回的来源（2026-10-06 批次 5-⑨；2026-10-11 起 web_read 也带——
   * 它读的那一页本身就是来源）。`text` 是给模型读的人话排版，`sources` 是给界面点的数据——
   * 两者同源不同用，渲染层不从 text 里反解 URL（那是把排版当成数据源）。
   */
  sources?: WebSource[];
  /**
   * 工具**跑通了，但没东西可给**（2026-10-06 批次 5-⑮）。web_search 搜不到、web_read
   * 读完剥不出正文都会带。
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
   * 名字放宽到 string（2026-10-07 批次 5-㉘）：花名册仍是那七枚（§6），
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

/** 花名册那七枚 + 插件注册进来的那些：本轮还没按开关过滤之前的全量。 */
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
 *
 * P0-1（2026-11-08）：花名册工具再按 `profile.tools` 过一道白名单。此前只按联网开关
 * 与本轮禁用过滤，六档案的 `tools` 字段只是数据、运行时没生效——审稿档案名义上只读，
 * 实际仍拿得到 `write_doc`。插件工具不受档案限制：那是用户显式装的扩展。
 */
export function toolsFor(
  host: ToolHost,
  webSearchEnabled: boolean,
  disabledTools: readonly string[] = [],
  profile: AgentProfile = defaultProfile()
): ChatToolSpec[] {
  const allowed = rosterSpecs(host).filter((spec) => {
    const known = toolNameOf(spec.name);
    return known === null || profile.tools.includes(known);
  });
  return wireToolsFor(allowed, webSearchEnabled).filter(
    (spec) => !disabledTools.includes(spec.name)
  );
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
  | { allowed: true }
  | { allowed: false; kind: "unknown" | "off-this-round" | "not-for-profile"; reason: string };

export function toolGateOf(
  host: ToolHost,
  name: string,
  webSearchEnabled: boolean,
  disabledTools: readonly string[] = [],
  profile: AgentProfile = defaultProfile()
): ToolGate {
  const round = toolsFor(host, webSearchEnabled, disabledTools, profile);
  if (round.some((spec) => spec.name === name)) return { allowed: true };
  const roster = round.map((spec) => spec.name).join("、");
  if (!rosterSpecs(host).some((spec) => spec.name === name))
    return {
      allowed: false,
      kind: "unknown",
      reason: `模型请求了不存在的工具「${name}」，这条调用已被忽略。可用工具只有 ${roster}。`
    };
  // 工具在花名册里，但当前档案的白名单没开它（P0-1）：与「本轮被开关摘掉」是两回事，
  // 理由必须说对——否则模型会以为用户关了什么开关，反复换个写法重试。
  const known = toolNameOf(name);
  if (known !== null && !profile.tools.includes(known))
    return {
      allowed: false,
      kind: "not-for-profile",
      reason: `「${name}」不在这枚档案「${profile.name}」的工具范围里，这条调用已被忽略。当前可用工具只有 ${roster}。`
    };
  return {
    allowed: false,
    kind: "off-this-round",
    reason: disabledTools.includes(name)
      ? `这一轮你在输入区的工具面板里把「${name}」关掉了，所以它没有执行。要让它重新工作，点开工具面板把它切回「带上」再问一次。`
      : `这一轮的联网开关是关闭的，所以「${name}」没有执行，也一个字都没有出网。` +
        "要查网络资料请先在输入区打开联网开关再问一次；这一轮请基于已有文稿回答。"
  };
}

/**
 * 这个名字叫不叫得动：花名册那五个（或插件注册进来的那些）**并且**这一轮的开关没把它摘掉。
 * `webSearchEnabled` 是必填的第三枚——**故意不给默认值**：这一层漏判一次就是「关掉联网仍出网」
 * （P1-1/P1-2 的原案），默认值只会让新调用点悄悄复制同一个洞。
 */
export function isCallableTool(
  host: ToolHost,
  name: string,
  webSearchEnabled: boolean,
  disabledTools: readonly string[] = [],
  profile: AgentProfile = defaultProfile()
): boolean {
  return toolGateOf(host, name, webSearchEnabled, disabledTools, profile).allowed;
}

const object = (
  properties: Record<string, unknown>,
  required: string[] = []
): ChatToolSpec["parameters"] => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {})
});

/** 花名册的唯一工具清单（§6：七枚，不多不少）；顺序与 AGENT_TOOL_NAMES 一致。 */
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
    // 2026-10-22 扩形：原来只有 query，答不了「按人物卡搜」「哪些章提到漕运」这两类最常问的问题。
    // 新参数全是可选的，只给 query 时回执与旧版同一形状（逐行 路径:行号: 内容）。
    name: "search_docs",
    description:
      "全书子串检索。默认逐行返回「路径:行号: 内容」；" +
      "kind 可把检索限定在一类文稿（chapter/character/location/worldview/foreshadow…）；" +
      'group="doc" 改为按篇聚合，只报每篇命中几处与首处位置——问「哪些章节提到漕运」时用这一档。' +
      "精确零命中时会自动按一字之差再扫一遍，回执会写明那是容错命中，引用前必须核对原文。",
    parameters: object(
      {
        query: { type: "string", description: "要检索的字面文本" },
        kind: {
          type: "string",
          description:
            "可选：只在这一类文稿里搜。chapter=章节，character=人物，location=场景/地点，" +
            "worldview=世界观，foreshadow=伏笔，outline=大纲，volume=分卷，material=素材…"
        },
        group: {
          type: "string",
          description: "可选：doc = 按篇聚合（查「哪些章提到它」），line = 逐行列出（默认）"
        },
        limit: {
          type: "number",
          description: "可选：最多返回多少处（逐行档）或多少篇（聚合档），默认 20，上限 50"
        }
      },
      ["query"]
    )
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
  },
  {
    // 2026-10-11 追加：web_search 只回标题+摘要；这一枚把其中一条来源的**网页正文**
    // 剥出来（去脚本/样式/导航，按码点截断）。顺序照 AGENT_TOOL_NAMES：排在 web_search 之后。
    name: "web_read",
    description:
      "读取一条网页链接的正文（优先用 web_search 结果里给出的链接）。" +
      "返回页面标题与正文纯文本（已去掉脚本、样式与导航杂讯；过长会截断并注明）。" +
      "只收 http/https 链接；同一页读完不必重复读。内容要保存就整理后用 write_doc 写进文稿。",
    parameters: object({ url: { type: "string", description: "要读的网页链接（http/https）" } }, [
      "url"
    ])
  },
  {
    // 2026-10-23 技能自选（spec §11 放宽）：不带参数列出技能库（id/名称/说明），
    // 带 skill（id）载入那一份正文。只读——技能是提示词文本，不改盘、不进文稿树。
    name: "use_skill",
    description:
      "技能库：不带参数调用会列出所有可用技能的 id、名称与说明；带上某个 id（参数 skill）再调一次，会返回该技能正文。" +
      "当用户的任务正好命中某个技能的用途时，先不带参数列一遍，再载入需要的那一个，照着它写的步骤做。",
    parameters: object({
      skill: {
        type: "string",
        description: "可选：要从技能库载入的技能 id；不给就先列出全部可用技能"
      }
    })
  }
];

/** 本轮真正叫得动的全部工具名（花名册 + 插件，再按档案白名单与本轮开关过滤），按清单顺序。 */
export function callableToolNames(
  host: ToolHost,
  webSearchEnabled: boolean,
  profile: AgentProfile = defaultProfile()
): string[] {
  return toolsFor(host, webSearchEnabled, [], profile).map((spec) => spec.name);
}

export async function dispatchToolCall(
  host: ToolHost,
  call: AssistantToolCall,
  webSearchEnabled: boolean,
  profile: AgentProfile = defaultProfile()
): Promise<ToolOutcome> {
  const gate = toolGateOf(host, call.name, webSearchEnabled, [], profile);
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

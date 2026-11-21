import type { BookKind } from "./book.js";
import type { AgentToolName } from "./tools.js";

/**
 * 智能体档案（spec §5.1 的「墨宸花名册」）。
 *
 * 这一层是**配置**，不是分支：agent-runtime 里没有任何一处写死「主笔就该怎么怎样」，
 * 新增第七个档案 = 往 AGENT_PROFILES 里加一条，不改判定代码。
 *
 * 两条不可越界的约束（spec §5.1 约束 3 / §6）：
 * - profile.writeScope 是**上限，不是授权**。实际能不能落盘仍由 permissionMode 三档裁决，
 *   权限档收紧时以档为准（只读档下主笔也只能出提案）。
 * - profile.tools 只能从 AGENT_TOOL_NAMES 里取子集，不得凭空多出工具。
 */

/** 当前章正文装进上下文包的方式（spec §5「续写：本章全文，尾部不截断」）。 */
export type ChapterMode = "none" | "excerpt" | "full";

/** 上下文包构造器：纯数据声明「这一枚档案要装哪些条目」。 */
export interface ContextScope {
  /** 当前章正文怎么装。 */
  currentChapter: ChapterMode;
  /** 现大纲摘要。 */
  outlineSummary: boolean;
  /** 出场人物卡（按章节 frontmatter characters 与正文人名命中）。 */
  castCharacters: boolean;
  /** 前情提要：取前 N 章的尾部摘要，0 = 不取。 */
  priorChapters: number;
  /** 全书章节摘要（总编看节奏用）。 */
  chapterDigests: boolean;
  /** 素材库。 */
  materials: boolean;
  /** 世界观 / 设定集。 */
  worldbuilding: boolean;
  /** 用户显式挂入的素材与技能。 */
  pinned: boolean;
}

/**
 * 上下文包里一条目的**类别**。刻意窄于 BookKind：装配层只产得出这六类，
 * 「卷 / 地图 / 专有名词」那些不会单独成条。
 *
 * 标签表住在 contracts 而不是各侧自抄（铁律 6）：主进程拼给模型的提示词块与渲染层
 * 占用条显示的是同一批条目，两边各写一份迟早会把「本章」标到不同的类上。
 * Record<联合, string> 是穷尽表——加一类不写标签，编译不过。
 */
export type ContextKind =
  | "chapter"
  | "outline"
  | "character"
  | "material"
  | "world"
  | "pinned"
  | "skill"
  // 2026-11-20：伏笔台账里「待收」（status: planted）的那一小段清单也进上下文包了，
  // 单列一类而不是并进「设定」（world）——伏笔是「本章该怎么写」的指令，不是设定资料，
  // 混在一格里作者就看不见模型到底带没带「这里该有个交代」。
  | "foreshadow";

export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  chapter: "正文",
  outline: "大纲",
  character: "人物",
  material: "素材",
  world: "设定",
  pinned: "挂入",
  // P0-2：技能只装清单（名称/用途/何时用），正文由 use_skill 按需读取，占用条单独计量。
  skill: "技能",
  // 2026-11-20：待收伏笔清单的屏显说法。穷尽表：不加这行，Record<联合> 编译不过。
  foreshadow: "伏笔"
};

/** 当前正在写的那一章：条目前缀「（本章）」，只在这一条上打标。 */
export function contextKindLabel(kind: ContextKind, active: boolean): string {
  const base = CONTEXT_KIND_LABELS[kind];
  return active ? `${base}（本章）` : base;
}

/**
 * 批准之后的写入范围上限。
 * - none：只出批注式提案，write_doc 一律拒绝（审稿）
 * - current-chapter：仅当前章；appendOnly 时默认只追加，改前文要单独提案（续写）
 * - kinds：限定到若干 kind（世界/总编/角色）
 */
export type WriteScope =
  | { readonly kind: "none" }
  | { readonly kind: "current-chapter"; readonly appendOnly?: boolean }
  | { readonly kind: "kinds"; readonly kinds: readonly BookKind[] };

export interface AgentProfile {
  readonly id: string;
  /** 屏显名（含「墨宸 · 」前缀，花名册的对外身份）。 */
  readonly name: string;
  /** 一句话职责，给档案选择器做副标题。 */
  readonly duty: string;
  /** 默认挂在哪个阶段（阶段 id 不写死在这里，靠 resolveProfileForStage 的表）。 */
  readonly prompt: string;
  /** 允许工具集：AGENT_TOOL_NAMES 的子集。 */
  readonly tools: readonly AgentToolName[];
  readonly context: ContextScope;
  readonly writeScope: WriteScope;
}

const READ_TOOLS = [
  "read_doc",
  "list_docs",
  "search_docs",
  // P0-1 起工具白名单真正生效：use_skill 是「读技能正文」的只读工具，
  // 六档案都该能按需载入技能，所以放进公共只读集，而不是每份 tools 里各抄一遍。
  "use_skill",
  // 联网两枚也归公共只读集：**是否真的出网由输入区联网开关决定**，不由档案决定。
  // 放进白名单只是让「档案过滤」不把它们误伤；关着时 wireToolsFor 与派发闸仍会摘掉。
  "web_search",
  "web_read"
] as const satisfies readonly AgentToolName[];
const WRITE_TOOLS_ALLOWED = [
  ...READ_TOOLS,
  "propose_patch",
  "propose_bible",
  "write_doc"
] as const satisfies readonly AgentToolName[];

/** 墨宸花名册：六个实例，顺序即 UI 里的展示顺序。 */
export const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    id: "world",
    name: "墨宸 · 世界",
    duty: "世界观构建：设定、地理、规则、势力",
    prompt:
      "你在构思阶段，负责把这部书的世界搭起来：地理、规则、势力、禁忌。写进素材库与大纲，不动正文。",
    tools: WRITE_TOOLS_ALLOWED,
    context: {
      currentChapter: "none",
      outlineSummary: true,
      castCharacters: false,
      priorChapters: 0,
      chapterDigests: false,
      materials: true,
      worldbuilding: true,
      pinned: true
    },
    writeScope: { kind: "kinds", kinds: ["material", "outline"] }
  },
  {
    id: "chief-editor",
    name: "墨宸 · 总编",
    duty: "剧情规划：卷章节奏、冲突布置、伏笔登记",
    prompt: "你在大纲阶段，负责剧情结构：卷章节奏、冲突布置、伏笔埋设与回收。只改大纲与剧情线。",
    tools: WRITE_TOOLS_ALLOWED,
    context: {
      currentChapter: "excerpt",
      outlineSummary: true,
      castCharacters: true,
      priorChapters: 0,
      chapterDigests: true,
      materials: false,
      worldbuilding: true,
      pinned: true
    },
    writeScope: { kind: "kinds", kinds: ["outline", "plot"] }
  },
  {
    id: "character",
    name: "墨宸 · 角色",
    duty: "人物塑造：动机、口吻、关系网",
    prompt: "你在人物阶段，负责单个人物的塑造：动机、口吻、关系网、弧线。只改人物卡。",
    tools: WRITE_TOOLS_ALLOWED,
    context: {
      currentChapter: "excerpt",
      outlineSummary: false,
      castCharacters: true,
      priorChapters: 2,
      chapterDigests: true,
      materials: false,
      worldbuilding: true,
      pinned: true
    },
    writeScope: { kind: "kinds", kinds: ["character"] }
  },
  {
    id: "lead-writer",
    name: "墨宸 · 主笔",
    duty: "正文创作：按大纲起稿本章",
    prompt: "你在正文阶段，负责按大纲起稿本章正文。落笔前先对齐大纲与出场人物的设定。",
    tools: WRITE_TOOLS_ALLOWED,
    context: {
      currentChapter: "excerpt",
      outlineSummary: true,
      castCharacters: true,
      priorChapters: 2,
      chapterDigests: false,
      materials: true,
      worldbuilding: false,
      pinned: true
    },
    writeScope: { kind: "current-chapter" }
  },
  {
    id: "continuer",
    name: "墨宸 · 续写",
    duty: "长篇续写：顺着已写文本往下走，保口吻与伏笔",
    prompt:
      "你在正文阶段做续写。顺着已写的文本往下走，保住既有口吻与已埋伏笔；默认只在文末追加，改前文要单独提案。",
    tools: WRITE_TOOLS_ALLOWED,
    context: {
      // 续写要看到本章写过的全部内容，否则接不上口吻
      currentChapter: "full",
      outlineSummary: true,
      castCharacters: true,
      priorChapters: 2,
      chapterDigests: false,
      materials: false,
      worldbuilding: false,
      pinned: true
    },
    writeScope: { kind: "current-chapter", appendOnly: true }
  },
  {
    id: "reviewer",
    name: "墨宸 · 审稿",
    duty: "逻辑与文风检查：矛盾、节奏漂移、口吻走形",
    prompt: "你在修订阶段做审稿：查逻辑矛盾、节奏漂移、口吻走形。只出批注式提案，不直接改正文。",
    tools: [...READ_TOOLS, "propose_patch", "propose_bible"] as const,
    context: {
      currentChapter: "full",
      outlineSummary: true,
      castCharacters: true,
      priorChapters: 2,
      chapterDigests: false,
      materials: false,
      worldbuilding: true,
      pinned: true
    },
    // 审稿只批注：write_doc 不在 tools 里，写入范围也归零
    writeScope: { kind: "none" }
  }
];

const PROFILE_BY_ID = new Map(AGENT_PROFILES.map((p) => [p.id, p]));

export function findProfile(id: string | null | undefined): AgentProfile | null {
  if (!id) return null;
  return PROFILE_BY_ID.get(id) ?? null;
}

/** 全局兜底档案：正文阶段默认主笔（spec §5.1）。 */
export const DEFAULT_PROFILE_ID = "lead-writer";

export function defaultProfile(): AgentProfile {
  return PROFILE_BY_ID.get(DEFAULT_PROFILE_ID)!;
}

/**
 * 阶段 → 默认档案。表在这里而不是散进各组件，是为了「新增一个阶段」时只改这一处。
 * 一阶段可以有多枚（spec §5.1 约束 1：正文阶段默认主笔，但中栏可切到续写）。
 * 未登记的阶段一律落到 DEFAULT_PROFILE_ID。
 */
const STAGE_DEFAULT_PROFILES: Record<string, readonly string[]> = {
  idea: ["world"],
  outline: ["chief-editor"],
  character: ["character"],
  // 正文阶段两枚：主笔起稿、续写往下接
  draft: ["lead-writer", "continuer"],
  revision: ["reviewer"]
};

/** 该阶段注册了哪一枚作为默认（取第一枚）：未登记时为 null。 */
function stageDefaultProfileId(stageId: string): string | null {
  return STAGE_DEFAULT_PROFILES[stageId]?.[0] ?? null;
}

/**
 * 解析一部书当前该用哪一枚档案。优先级（spec §5.1 约束 1）：
 * 书级 activeProfile > 阶段自带 profile > 阶段的默认档案 > 全局兜底。
 *
 * 切档案**不换会话线程**（同一章仍是同一条线程），所以这里只返回档案，不碰 threadKey。
 */
export function resolveProfile(input: {
  activeProfile?: string | null | undefined;
  stages: readonly { id: string; name: string; profile?: string | undefined }[];
  activeStage: string | null;
}): AgentProfile {
  const explicit = findProfile(input.activeProfile);
  if (explicit) return explicit;

  const stage = input.stages.find((s) => s.id === input.activeStage) ?? null;
  const fromStage = findProfile(stage?.profile);
  if (fromStage) return fromStage;

  if (input.activeStage !== null) {
    const byTable = findProfile(stageDefaultProfileId(input.activeStage));
    if (byTable) return byTable;
  }
  return defaultProfile();
}

/**
 * 某一阶段可选的档案：阶段自带的那一枚排最前，其后是阶段注册的默认档案，按此顺序去重。
 * 一枚都取不到时给全局兜底那一枚——返回空数组会让档案选择器开天窗，
 * 而「选择器里没有能选的」比「选了个兜底」更让人以为功能坏了。
 */
export function profilesForStage(
  stages: readonly { id: string; name: string; profile?: string | undefined }[],
  stageId: string
): AgentProfile[] {
  const stage = stages.find((s) => s.id === stageId) ?? null;
  const ids: string[] = [];
  const own = findProfile(stage?.profile);
  if (own) ids.push(own.id);
  for (const id of STAGE_DEFAULT_PROFILES[stageId] ?? []) {
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) ids.push(DEFAULT_PROFILE_ID);

  const out: AgentProfile[] = [];
  for (const id of ids) {
    const profile = findProfile(id);
    if (profile) out.push(profile);
  }
  return out;
}

/**
 * 写盘范围是否允许某一类目标（spec §5.1 约束 3：这是上限，不是授权）。
 *
 * `current-chapter` 只认调用方算出的「current-chapter」这一枚目标，**不再放宽到所有 chapter**：
 * 放宽等于「主笔可以随手改别章」，与档案职责不符。调用方拿当前文稿路径比对后再传。
 */
export function writeScopeAllows(scope: WriteScope, target: BookKind | "current-chapter"): boolean {
  if (scope.kind === "none") return false;
  if (scope.kind === "current-chapter") return target === "current-chapter";
  return scope.kinds.includes(target as BookKind);
}

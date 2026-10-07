import type { BookKind } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import { BOOK_KIND_LABELS } from "./book-kinds";

/**
 * 侧边栏功能导航的唯一真身表（2026-10-04 演示图裁定：完整按图）。
 * 子项三种现实：
 * - `docs`   —— 已有真身：定位到文稿树对应类型的分组（展开它；没有文档就引导新建）。
 * - `action` —— 已有真身：组件里挂一个现成动作（新对话 / 打开章节 / 展开对话面板 / AI 检查）。
 * - `planned`—— 还没落地的功能：入口照图摆出来，点击打开诚实的占位说明。
 *               （2026-10-04 深夜：演示图里的占位项已全部落地——本表暂时没有 planned 实例，
 *               机制保留给未来的新占位。）
 * 表只管「有什么、叫什么、什么现实」；点击后的响应判定在 sideNavChildState（纯函数，单测钉住）。
 */
export type SideNavChildReality =
  | { kind: "docs"; docKind: BookKind }
  | {
      kind: "action";
      action:
        | "new-thread"
        | "chapter-editor"
        | "ai-check-consistency"
        | "ai-check-plot"
        | "ai-check-logic"
        // 伏笔台账（2026-10-05）：聚合视图，开关住在 store 的 foreshadowsOpen 那一格。
        | "foreshadow-ledger"
        // 时间线核对（2026-10-05 批次 5-①）：聚合视图，开关住在 useTimelineStore.open。
        | "timeline-ledger";
    }
  | { kind: "planned" };

export interface SideNavChild {
  label: string;
  reality: SideNavChildReality;
}

export interface SideNavGroup {
  id: string;
  label: string;
  icon: IconName;
  /** 初始开合（演示图：小说大脑展开，故事规划/写作/审核检查收起）。 */
  defaultOpen: boolean;
  children: SideNavChild[];
}

export const SIDE_NAV_GROUPS: SideNavGroup[] = [
  {
    id: "brain",
    label: "小说大脑",
    icon: "brain",
    defaultOpen: true,
    // 2026-10-05：子项名一律取 BOOK_KIND_LABELS 这一份真身——早先这里手写过「人物库」「设定集」，
    // 与左栏树分组、中栏提示（「这本书还没有素材库分组」）是两套中文名，用户按提示找不到。
    children: [
      { label: BOOK_KIND_LABELS.worldview, reality: { kind: "docs", docKind: "worldview" } },
      { label: BOOK_KIND_LABELS.character, reality: { kind: "docs", docKind: "character" } },
      { label: BOOK_KIND_LABELS.faction, reality: { kind: "docs", docKind: "faction" } },
      { label: BOOK_KIND_LABELS.location, reality: { kind: "docs", docKind: "location" } },
      { label: BOOK_KIND_LABELS.timeline, reality: { kind: "docs", docKind: "timeline" } },
      { label: BOOK_KIND_LABELS.material, reality: { kind: "docs", docKind: "material" } },
      { label: BOOK_KIND_LABELS.glossary, reality: { kind: "docs", docKind: "glossary" } }
    ]
  },
  {
    id: "plan",
    label: "故事规划",
    icon: "map",
    defaultOpen: false,
    children: [
      { label: BOOK_KIND_LABELS.outline, reality: { kind: "docs", docKind: "outline" } },
      { label: BOOK_KIND_LABELS.volume, reality: { kind: "docs", docKind: "volume" } },
      // 这一项不是「章节」的标签而是动作名（进章节分组做增删改序），故不取 BOOK_KIND_LABELS。
      { label: "章节管理", reality: { kind: "docs", docKind: "chapter" } },
      // 伏笔台账是**聚合视图**（要看所有伏笔的状态），不是某一类文稿的筛选，
      // 所以走 action 而不是 docs；分派处见 LeftSidebar 的 foreshadow-ledger 分支。
      { label: "伏笔台账", reality: { kind: "action", action: "foreshadow-ledger" } },
      // 时间线一致性检查（2026-10-05，批次 5-①）：同样是聚合视图——要把全书的时间线
      // 读一遍排顺序、查矛盾，不是筛某类文稿。分派见 LeftSidebar 的 timeline-ledger 分支。
      { label: "时间线核对", reality: { kind: "action", action: "timeline-ledger" } }
    ]
  },
  {
    id: "writing",
    label: "写作",
    icon: "pen",
    defaultOpen: false,
    children: [
      { label: "AI 写作", reality: { kind: "action", action: "new-thread" } },
      { label: "章节编辑器", reality: { kind: "action", action: "chapter-editor" } }
    ]
  },
  {
    id: "review",
    label: "审核检查",
    icon: "shield",
    defaultOpen: false,
    children: [
      { label: "一致性检查", reality: { kind: "action", action: "ai-check-consistency" } },
      { label: "剧情审核", reality: { kind: "action", action: "ai-check-plot" } },
      { label: "逻辑检查", reality: { kind: "action", action: "ai-check-logic" } }
    ]
  }
];

/** 底部标语（演示图逐字）。 */
export const BRAND_TAGLINE = "AI 智能体 · 小说创作系统";
export const FOOTER_TAGLINE = "墨宸 AI · 让每一个故事，都有灵魂";

/** 占位子项的统一说辞：诚实承认没做完。 */
export const PLANNED_HINT = "规划中——这个功能还没落地，落地后这里直接能用";
/** 没打开任何作品时的引导：指向两个真实入口（打开目录 / 新建作品）。 */
export const NEED_BOOK_HINT = "还没打开作品——点这里打开或新建一部";
/** 有作品但还没有这类文档：指向树内的行内新建。 */
export const EMPTY_DOCS_HINT = "这本书还没有这类文档——点这里新建一篇";
/** 数据统计一级项的 hover 说明（它是真功能，说清点开会看到什么）。 */
export const STATS_HINT = "查看这本书的篇数与字数";
/**
 * 技能库一级项的 hover 说明（spec §11）。要点名「只读」与「挂入是另一颗按钮」——
 * 否则用户会以为点开就等于挂上了，而点开只是浏览。
 */
export const SKILLS_HINT = "浏览全局与书内技能（只读；要挂入请在技能卡上按「加入当前上下文」）";
/**
 * 插件一级项的 hover 说明（2026-10-07 批次 5-㉚）。要点名「停用之后模型调不到」——
 * 用户最担心的就是「停了它还在偷偷用」，而那确实是不挂它的效果，说出来才算数。
 */
export const PLUGINS_HINT = "查看装了哪些插件、它们给对话加了哪些能力；停用之后模型就调不到了";
/**
 * 皮肤广场一级项的 hover 说明（2026-10-07 批次 5-㊴）。
 * 要点是「整套」而不是「换个色」——墨宸的皮肤 = 配色三色 + 质感四层，
 * 说成「浏览配色预设」会让用户以为进去看到的还是设置中心那一页的东西。
 */
export const SKINS_HINT = "浏览整套皮肤：配色三色 + 纹理、圆角、描边、光晕；浅色与深色一并应用";

/**
 * AI 检查的预填提问（文案唯一真身）：点击审核三项 → 打开对话面板并把这句填进输入框，
 * 用户确认后发送——AI 真的会按这个口径检查当前章节。预填不自动发送（用户保留最后一道编辑权）。
 */
export const AI_CHECK_PROMPTS = {
  consistency:
    "请对当前章节做一致性检查：对照已有的人物、设定与剧情，指出与它们矛盾或前后不一致的地方；没有就明确说没有。",
  plot: "请对当前章节做剧情审核：评估情节推进是否合理、节奏与冲突是否成立、伏笔与回收是否妥当，并给出具体修改建议。",
  logic: "请对当前章节做逻辑检查：找出因果链断裂、动机不足、时间线对不上的地方；没有就明确说没有。"
} as const;

export type AiCheckKind = keyof typeof AI_CHECK_PROMPTS;

/** 由 action id 取回检查口径（组件分派用；平铺 id 与表键一一对应）。 */
export function aiCheckOf(action: string): AiCheckKind | null {
  if (action.startsWith("ai-check-") === false) return null;
  const kind = action.slice("ai-check-".length);
  return kind in AI_CHECK_PROMPTS ? (kind as AiCheckKind) : null;
}

/**
 * 子项点击后的响应模式（纯函数，唯一真身）。每一项都可点，点了必有响应：
 * - `ready`     真功能就绪，组件直接执行既有动作。
 * - `need-book` 还没打开作品 → 弹引导（打开目录 / 新建作品，都是现成真身）。
 * - `need-doc`  有作品但没这类文档 → 展开树分组并聚到行内新建。
 * - `planned`   功能没落地 → 打开诚实的占位说明。
 */
export type SideNavChildState =
  | { mode: "ready"; hint: string }
  | { mode: "need-book"; hint: string }
  | { mode: "need-doc"; hint: string; docKind: BookKind }
  | { mode: "planned"; hint: string };

export function sideNavChildState(
  child: SideNavChild,
  docs: { kind: BookKind }[]
): SideNavChildState {
  const reality = child.reality;
  if (reality.kind === "planned") return { mode: "planned", hint: PLANNED_HINT };
  if (reality.kind === "docs") {
    if (docs.some((doc) => doc.kind === reality.docKind)) return { mode: "ready", hint: "" };
    // 一篇文档都没有 = 大概率没打开作品（打开空目录也走「先有作品」引导，不亏）。
    return docs.length === 0
      ? { mode: "need-book", hint: NEED_BOOK_HINT }
      : { mode: "need-doc", hint: EMPTY_DOCS_HINT, docKind: reality.docKind };
  }
  return { mode: "ready", hint: "" };
}

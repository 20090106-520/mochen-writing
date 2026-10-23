import { AI_FLAVOR_CATEGORY_LABELS, type AiFlavorReport, type BookKind } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import { BOOK_KIND_LABELS } from "./book-kinds";

/**
 * 侧边栏功能导航的唯一真身表（2026-10-04 演示图裁定：完整按图）。
 * 子项三种现实：
 * - `docs`   —— 已有真身：定位到文稿树对应类型的分组（展开它；没有文档就引导新建）。
 *               （2026-10-23：与树分组同名的 9 个子项收掉后，表里暂时没有 docs 实例；机制保留。）
 * - `action` —— 已有真身：组件里挂一个现成动作（开素材库面板 / 开伏笔台账 / 开时间线核对）。
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
        // 伏笔台账（2026-10-05）：聚合视图，开关住在 store 的 foreshadowsOpen 那一格。
        | "foreshadow-ledger"
        // 时间线核对（2026-10-05 批次 5-①）：聚合视图，开关住在 useTimelineStore.open。
        | "timeline-ledger"
        // 素材库面板（2026-10-23）：不再是「跳到树里那一组」——它有真面板了
        // （列全书 materials/ 文稿 + 导入 + 让 AI 整理入库）。开关住 useMaterialStore.open，
        // 锚点那枚按钮在右栏头部，分派见 LeftSidebar 的 materials-panel 分支。
        | "materials-panel";
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
  /** 初始开合（2026-10-23 起只剩一组，默认展开）。 */
  defaultOpen: boolean;
  children: SideNavChild[];
}

export const SIDE_NAV_GROUPS: SideNavGroup[] = [
  {
    id: "plan",
    label: "素材与台账",
    icon: "map",
    defaultOpen: true,
    /*
     * 2026-10-23（用户评「小说大脑 / 故事规划都是空壳，没啥用」）：这一组里**只剩真身**。
     *
     * 原先两组（小说大脑 / 故事规划）共 11 个跳转子项，逐个收掉了 9 个——它们的真身就是
     * 「跳到左栏『我的作品』树里那一组」，而树本来就在同一屏上，于是那一栏读起来像两个去处。
     * 留下的三项都**有自己的东西**，不是树的影子：
     *   · 素材库 —— 有真面板（列全书 materials/ + 导入 + 让 AI 整理入库）；
     *   · 伏笔台账 / 时间线核对 —— 跨文稿的聚合视图，要读全书再排/再判，不是筛某一类文稿。
     */
    children: [
      // 素材库（2026-10-23）：有自己的面板，锚点在右栏头部；分派见 LeftSidebar 的 materials-panel 分支。
      { label: BOOK_KIND_LABELS.material, reality: { kind: "action", action: "materials-panel" } },
      // 伏笔台账是**聚合视图**（要看所有伏笔的状态），不是某一类文稿的筛选，
      // 所以走 action 而不是 docs；分派处见 LeftSidebar 的 foreshadow-ledger 分支。
      { label: "伏笔台账", reality: { kind: "action", action: "foreshadow-ledger" } },
      // 时间线一致性检查（2026-10-05，批次 5-①）：同样是聚合视图——要把全书的时间线
      // 读一遍排顺序、查矛盾，不是筛某类文稿。分派见 LeftSidebar 的 timeline-ledger 分支。
      { label: "时间线核对", reality: { kind: "action", action: "timeline-ledger" } }
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
 * 检查口径文案（2026-10-23 起只剩 `style` 一个消费者：书稿体检的「一键改写」那一支）。
 * 左栏「审核检查」四项已改为内置技能（`apps/desktop/src/main/builtin-skills.ts`）——
 * 它们在对话框里由模型经 `use_skill` 工具自选载入，不再走这里的预填。其余三段保留作口径参考。
 */
export const AI_CHECK_PROMPTS = {
  consistency:
    "请对当前章节做一致性检查：对照已有的人物、设定与剧情，指出与它们矛盾或前后不一致的地方；没有就明确说没有。",
  plot: "请对当前章节做剧情审核：评估情节推进是否合理、节奏与冲突是否成立、伏笔与回收是否妥当，并给出具体修改建议。",
  logic: "请对当前章节做逻辑检查：找出因果链断裂、动机不足、时间线对不上的地方；没有就明确说没有。",
  style:
    "请对当前章节做文风检查（去 AI 味）：找出 AI 腔的套话与句式——如「嘴角勾起」「眼底闪过」「勾起一抹」「深吸一口气」「空气仿佛凝固」「他知道，……」式开头、连续长短雷同的句子、「缓缓/微微/不禁」堆叠——逐处指出原文并给出更像人写的改法；全文没有就明确说没有。"
} as const;

/**
 * 文风检查的动态预填（2026-10-10 去AI味二段）：静态口径之上，把**这一篇真扫出来的**
 * 命中清单塞进提问——模型拿到的是具体目标，不是一句泛泛的「找出 AI 腔」。
 * 词表与书稿体检同源（contracts 的 analyzeAiFlavor）；命中的每一处都要求直接给
 * propose_patch 替换提案，批准才落盘——「指出」不算数，「改掉」才算。
 * 没扫到（null 或空清单）就回落静态口径，不编清单。
 */
export function styleCheckPrompt(report: AiFlavorReport | null): string {
  const hits = report?.entries ?? [];
  if (hits.length === 0) return AI_CHECK_PROMPTS.style;
  return (
    AI_CHECK_PROMPTS.style +
    "\n\n本章扫到的 AI 味命中（词库与书稿体检同源）：\n" +
    hits
      .map(
        ({ term, category, count }) =>
          `- ${term}（${AI_FLAVOR_CATEGORY_LABELS[category]}）× ${count} 次`
      )
      .join("\n") +
    "\n请先用 read_doc 读本章拿上下文，再对每一处给出替换写法，并直接用 propose_patch " +
    "提交替换提案（我批准后才落盘）；确要保留的写法在提案 why 里说明理由，不要擅自整段重写。"
  );
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

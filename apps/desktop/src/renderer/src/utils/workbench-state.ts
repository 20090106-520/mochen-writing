import type { BookKind, DocRef } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import { conversationBrief, type ConversationBrief } from "./conversation-brief";

/**
 * 作品工作台的判定表（示意稿 A 的中栏）。
 *
 * 为什么整张表住在 `.ts`：本仓的 `.vue` 既不过 `tsc` 也没有组件测试环境，
 * 把「哪张卡对应哪个分组、点它填哪句话」写进模板就等于写了一段永远测不到的逻辑。
 * 放在这里，`Record<WorkbenchCardId, …>` 就是编译期关卡——contracts 或这里加第六张卡而漏一行，
 * 裸 `tsc` 当场报 TS2741，而不是画出一张缺格的假工作台。
 */
export type WorkbenchCardId = "chief-write" | "character" | "world" | "outline" | "inspire";

export const WORKBENCH_CARD_LABELS: Record<WorkbenchCardId, string> = {
  "chief-write": "主笔创作",
  character: "角色塑造",
  world: "世界构建",
  outline: "大纲规划",
  inspire: "灵感激发"
};

/** 卡上的图标名（原先这张表抄在 BookWorkbench.vue 里，`.vue` 不过 tsc ⇒ 下沉到这里才有关卡）。 */
export const WORKBENCH_CARD_ICONS: Record<WorkbenchCardId, IconName> = {
  "chief-write": "wand",
  character: "user",
  world: "globe",
  outline: "list",
  inspire: "brain"
};

/**
 * 点了之后填进输入区的那句人话；`null` ⇒ 这张卡不填字，只把右栏落到浏览态。
 * 装配处（CenterColumn）分支认的就是这一枚 `null`，于是「谁填字、谁浏览」全仓只有一处可改。
 */
export const WORKBENCH_CARD_PREFILL: Record<WorkbenchCardId, string | null> = {
  "chief-write": "我想改这一章：先读它，再给我三处可以动的地方。",
  character: null,
  world: null,
  outline: null,
  inspire: "给我三个能接着往下写的点子，各写一句代价；先别动我的稿子。"
};

/**
 * 每张卡归属的文稿类型（唯一真身）：既决定「没有现成目标时去哪一类分组新建」，
 * 也是 workbenchTarget 取目标的依据——一张表的两份用途，不抄第二份。
 * 2026-10-05 裁定：空卡不再 disabled（与侧边栏「全部可点」同源），点击引导到这一类去建一篇。
 */
export const WORKBENCH_CARD_KIND: Record<WorkbenchCardId, BookKind> = {
  "chief-write": "chapter",
  character: "character",
  world: "material",
  outline: "outline",
  inspire: "chapter"
};

export interface WorkbenchCard {
  id: WorkbenchCardId;
  label: string;
  hint: string;
  /** 点了直接做的目标；null ⇒ 这一类还没有文档，点击走引导（展开左栏分组并新建一篇）。 */
  target: string | null;
  /** 该卡归属的文稿类型（引导用）。 */
  kind: BookKind;
}

/** 空卡悬停时补的那一句：点了会发生什么，不承诺此刻做不到的动作。 */
export const WORKBENCH_GUIDE_SUFFIX = "点一下去左栏新建一篇。";

const CARD_ORDER: WorkbenchCardId[] = ["chief-write", "character", "world", "outline", "inspire"];

// world 卡落 materials/ 分组（scan.ts:45 把 materials/ 归 material kind）；character→characters、outline→outline。
// chief-write 与 inspire 都落在章节上：前者提改稿，后者要点子，动作同一条通路、句子不同。
const CARD_TARGET_KIND: Record<Exclude<WorkbenchCardId, "chief-write" | "inspire">, BookKind> = {
  character: WORKBENCH_CARD_KIND.character,
  world: WORKBENCH_CARD_KIND.world,
  outline: WORKBENCH_CARD_KIND.outline
};

/**
 * 有目标时的动作说明（与 WORKBENCH_EMPTY_HINTS 成对：一句说动作，一句说缺什么）。
 * 2026-10-23：原先三张浏览卡写「浏览…落到右栏浏览态」——「浏览态」是内部叫法，
 * 用户不知道那是什么；「浏览」还在一句里重复两次。改成说清结果：在右栏读它。
 * chief-write 的「再交给你逐条审批」主语悬空（谁交给谁），改成提案等你点头。
 */
export const WORKBENCH_CARD_HINTS: Record<WorkbenchCardId, string> = {
  "chief-write": "打开当前章，预填一句改稿指令；改稿提案逐条等你批准。",
  character: "打开人物分组第一篇，在右栏读它。",
  world: "打开素材库分组第一篇，在右栏读它。",
  outline: "打开大纲分组第一篇，在右栏读它。",
  inspire: "打开当前章，预填一句要点子的话；发不发由你。"
};

/** 该卡的目标分组在本书里不存在时的实话：不承诺动作，只说明缺什么。 */
export const WORKBENCH_EMPTY_HINTS: Record<WorkbenchCardId, string> = {
  "chief-write": "这本书还没有章节，先在左栏新建一篇。",
  character: "这本书还没有人物分组。",
  world: "这本书还没有素材库分组。",
  outline: "这本书还没有大纲分组。",
  inspire: "这本书还没有章节，先在左栏新建一篇。"
};

/** hero 那句引言：示意稿 A 右上位的文案，纯静态展示，不挂任何动作。 */
export const WORKBENCH_HERO_QUOTE = "以文字为舟，载你抵达想象的彼岸。";

/**
 * 能力气泡的六条（示意稿 A 那条「我可以帮你进行：」）。
 * 逐条都落在本版真有的通路上：五枚工具（读/列/检索/提案/写全篇）+ 逐条审批；
 * 不写「自动写入」这一类本版没有的话。
 */
export const WORKBENCH_CAPABILITIES: readonly string[] = [
  "改稿：先整篇读，再逐条给替换提案，你批准才落盘。",
  "人物：核对设定与台词，点出人设前后对不上的地方。",
  "世界观与素材：整理素材条目，标出还没用上的伏笔。",
  "大纲：按现有章节倒推结构，给出下一节的落点。",
  "全书检索：报出 路径:行号:原文，改哪一段都指得回去。",
  "续写与开头备选：一次给几个方向，各写一句代价。"
];

/**
 * 建议 pill（示意稿 A 输入区上方那一排）。
 * 两条出路：`prefill` ⇒ 把 `prefill` 那句填进当前章的线程；`palette` ⇒ 打开 `/` 命令面板。
 * 没有第三条：本版的「更多功能」就是面板本身，不另造一个只能弹 toast 的按钮。
 */
export type WorkbenchSuggestion =
  | { id: string; kind: "prefill"; text: string; prefill: string }
  | { id: string; kind: "palette"; text: string };

/**
 * 一枚 pill 的出场条件读的是「这本书的实况」这一份判定
 * （`utils/conversation-brief.ts`），不是各写各的。
 *
 * 【为什么不能是固定五枚】(2026-11-20 对话区智能刀)
 * 固定五枚 = 一份产品说明书，与这本书无关。
 * 实况挑：
 *  - 「帮我构思三个开头」只在**目标章就是第一章**时出——书已经写到第三章
 *    还推「三个开头」，是把开局该做的事摊到中局。
 *  - 「扩写最薄的一段」只在目标章**有足够字数**时出：一章不到 400 字时
 *    「最薄的一段」判不准（薄到挑不出段落），点进去只能得到一句废话。
 *  - 其余两枚（有章就有出场人物、有稿才谈得上体检）跟着有没有章走。
 */
type SuggestionRule =
  | {
      id: string;
      kind: "prefill";
      text: string;
      prefill: string;
      when: (brief: ConversationBrief) => boolean;
    }
  | {
      id: string;
      kind: "palette";
      text: string;
      when: (brief: ConversationBrief) => boolean;
    };

const SUGGESTION_RULES: readonly SuggestionRule[] = [
  {
    id: "openings",
    kind: "prefill",
    text: "帮我构思三个开头",
    prefill: "帮我构思三个不同的开头，各写一句它把读者往哪儿带。",
    when: (brief) => brief.targetIsFirstChapter
  },
  {
    id: "cast",
    kind: "prefill",
    text: "点出这一章的人物",
    prefill: "列出这一章出场的人物，指出谁的目标和代价还没写清楚。",
    when: (brief) => brief.stage === "drafting"
  },
  {
    id: "thicken",
    kind: "prefill",
    text: "扩写最薄的一段",
    prefill: "找出这一章最薄的一段，扩写到站得住，先给我看提案。",
    when: (brief) => brief.targetChapterChars !== null && brief.targetChapterChars >= 400
  },
  {
    id: "checkup",
    kind: "prefill",
    text: "给这一章做体检",
    prefill: "通读这一章，指出三处节奏或逻辑上的问题，并给出改法。",
    when: (brief) => brief.stage === "drafting"
  },
  { id: "more", kind: "palette", text: "更多功能", when: () => true }
];

/** pill 的 title：报得出这条出路真会发生的事，不写「敬请期待」。 */
export const WORKBENCH_SUGGESTION_TITLES: Record<WorkbenchSuggestion["kind"], string> = {
  prefill: "点一下把这句话填进输入区，发不发由你；不发它一个字也不动。",
  palette: "打开 / 命令面板，看这一版能敲的命令。"
};

/** 无书降级的整块引导由装配处按 `cards.length === 0` 决定；这里只保证无书时一张死卡都不出。 */
export function workbenchVisible(hasBook: boolean): boolean {
  return hasBook;
}

export function workbenchTarget(input: {
  id: WorkbenchCardId;
  docs: DocRef[];
  activeChapter: string | null;
}): string | null {
  if (input.id === "chief-write" || input.id === "inspire") {
    const active = input.activeChapter?.trim() ?? "";
    if (active !== "") return active;
    return input.docs.find((doc) => doc.kind === "chapter")?.relPath ?? null;
  }
  const kind = CARD_TARGET_KIND[input.id];
  return input.docs.find((doc) => doc.kind === kind)?.relPath ?? null;
}

export function workbenchCards(input: {
  hasBook: boolean;
  docs: DocRef[];
  activeChapter: string | null;
}): WorkbenchCard[] {
  if (!workbenchVisible(input.hasBook)) return [];
  return CARD_ORDER.map((id) => {
    const target = workbenchTarget({ id, docs: input.docs, activeChapter: input.activeChapter });
    return {
      id,
      label: WORKBENCH_CARD_LABELS[id],
      // target 为 null（本书里没有该分组）⇒ 发实话；有目标才发动作说明。
      hint: target === null ? WORKBENCH_EMPTY_HINTS[id] : WORKBENCH_CARD_HINTS[id],
      target,
      kind: WORKBENCH_CARD_KIND[id]
    };
  });
}

/**
 * 卡的悬停文案：有目标就是动作说明；没有就在实话后面补一句「点了会带你去建一篇」。
 * 判定只有这一处（组件不抄第二份 `target === null`）。
 */
export function workbenchCardTitle(card: WorkbenchCard): string {
  return card.target === null ? `${card.hint}${WORKBENCH_GUIDE_SUFFIX}` : card.hint;
}

/**
 * 建议 pill 的出场条件与 chief-write 卡同源：没有可填字的章节线程，就一枚都不出。
 * （摆一枚点了填不进任何东西的 pill，就是本仓禁的那类「按了没反应的按钮」。）
 *
 * 2026-11-20：出场条件从「固定五枚」改成**按实况挑**（判定见 `SuggestionRule.when`）。
 */
export function workbenchSuggestions(input: {
  hasBook: boolean;
  docs: DocRef[];
  activeChapter: string | null;
}): WorkbenchSuggestion[] {
  if (!workbenchVisible(input.hasBook)) return [];
  if (
    workbenchTarget({ id: "chief-write", docs: input.docs, activeChapter: input.activeChapter }) ===
    null
  )
    return [];
  const brief = conversationBrief({
    hasBook: input.hasBook,
    docs: input.docs,
    activeChapter: input.activeChapter
  });
  return SUGGESTION_RULES.flatMap((rule): WorkbenchSuggestion[] => {
    if (!rule.when(brief)) return [];
    if (rule.kind === "palette") return [{ id: rule.id, kind: "palette", text: rule.text }];
    return [{ id: rule.id, kind: "prefill", text: rule.text, prefill: rule.prefill }];
  });
}

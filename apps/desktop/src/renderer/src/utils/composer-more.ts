/**
 * 「更多」弹层二级选项表（2026-11-09 用户裁定）。
 *
 * 截图里四项形态不齐：工具 / `/ 命令` 带下拉，多稿关 / 直接动手却是一按就切。
 * 现在四项统一成「点一下 → 展开同款选项列表 → 选中才生效」，所以每一组的
 * 标题、提示、条目文案、图标、当前态、禁用理由都只在这一张决策表里判定（铁律 6）：
 * 组件只 v-for 渲染、只把选中的 id 交回去，不自行拼一份选项。
 *
 * 数据来源全部是既有真身：档位来自 contracts 的 DRAFT_SAMPLE_COUNTS / WORK_MODES，
 * 工具来自 utils/tool-roster，命令来自 utils/slash-commands（并过 store 里那道可用性闸）。
 * 这里不自造第二条命令表，也不新增任何派发口。
 */
import {
  DRAFT_SAMPLE_COUNTS,
  WORK_MODES,
  WORK_MODE_LABELS,
  type DraftSampleCount,
  type WorkMode
} from "@mochen/contracts";
import type { IconName } from "../types/icons";
import {
  SLASH_COMMAND_DESCRIPTIONS,
  SLASH_COMMAND_GROUPS,
  SLASH_COMMAND_META,
  type SlashCommand
} from "./slash-commands";
import { toolRoster } from "./tool-roster";

/**
 * 「更多」弹层首层的四行，顺序与 composer-chips 的 more 分区一致：首层照这张表逐行画。
 * 2026-11-10 用户裁定「自动技能不要在里面」：它挪到输入卡首行独立成 chip，
 * 因此既不在 more 分区、也不在这张表里；它那张卡片改由 autoSkillSheetView 单独出视图。
 */
export const MORE_GROUP_IDS = ["draft", "tools", "palette", "work-mode"] as const;
export type MoreGroupId = (typeof MORE_GROUP_IDS)[number];

/** ComposerMoreSheet 能渲染的卡片：四组「更多」+ 一组独立入口的自动技能。 */
export type ComposerSheetGroup = MoreGroupId | "auto-skills";

/** 工具清单按用途归堆的顺序：组标题只在组首画一次，组不连续就会冒出重名标题。 */
const TOOL_GROUP_ORDER: Record<string, number> = { 只读检索: 0, 会改稿: 1, 更多: 2 };

/** 选中一项之后要走的那一类动作；组件按它分派，不在模板里写第二份判断。 */
export type MoreOptionAction =
  | "draft"
  | "tools"
  | "roster"
  | "command"
  | "summon"
  | "work-mode"
  | "auto-toggle"
  | "skill-toggle"
  | "skills-page"
  | "auto-clear"
  | "auto-reset";

export interface MoreOption {
  id: string;
  label: string;
  /** 一句实话：这一档/这枚工具/这条命令到底会做什么。 */
  detail: string;
  icon: IconName;
  /** 右端角标：档数、命令名、开关态。 */
  badge: string;
  selected: boolean;
  disabled: boolean;
  action: MoreOptionAction;
  /** 分组标题（同一组只在第一行画一次）。 */
  group: string;
}

export interface MoreSheetState {
  hasBook: boolean;
  sampleCount: DraftSampleCount;
  workMode: WorkMode;
  webSearchEnabled: boolean;
  disabledTools: readonly string[];
  /** 已经过 useReferenceMenuStore 那道可用性闸的命令名。 */
  commands: readonly SlashCommand[];
  /** 自动技能那一组的现场：开关态、本线程暂停态、上榜技能与理由、被否决的条数。 */
  autoSkills: AutoSkillState;
}

/** 技能卡里的一行：库里的某一枚，加上它这一轮的状态。 */
export interface LibrarySkill {
  id: string;
  /** 显示名：取技能库同一份（frontmatter name，没写才退回目录名）。 */
  name: string;
  /** 一句实话：自动挑的给「为什么挑它」，其余的给技能自己的用途。 */
  detail: string;
  /** 这一轮挂着吗（= 会进上下文）。 */
  pinned: boolean;
  /** 是不是自动挂进来的。用户亲手挂的不冒充自动的功劳。 */
  auto: boolean;
}

/**
 * 技能二级卡片要显示的东西（2026-11-10 用户裁定）。
 *
 * 【为什么带全库而不是只带「识别到的」】原来这张卡只列自动挑中的那几枚，
 * 用户想换一枚得先跑去中栏技能库页挂，再回来——「自己选用哪个技能」在输入卡上是断的。
 * 现在整库都在这里，点一行就挂上/取下，自动挂的那几枚只是标了「自动」。
 */
export interface AutoSkillState {
  enabled: boolean;
  /** 「全部取下」之后整条自动挂入暂停，直到「恢复自动推荐」。 */
  paused: boolean;
  /** 技能库全表 + 这一轮的状态。顺序即显示顺序，判据在组件那边按 id 排好。 */
  library: readonly LibrarySkill[];
  blockedCount: number;
}

export interface MoreSheetView {
  title: string;
  hint: string;
  icon: IconName;
  foot: string;
  empty: string;
  options: MoreOption[];
}

/**
 * 从当前档循环到目标档要按几次「下一档」。
 * 多稿的真身仍是 `agent.cycleDraftSample()`（唯一写入口），目录里选一档 = 把它按到位，
 * 不另造第二个 setter，也不在组件里用计时器连点。档序只认 contracts 那一份。
 */
export function draftSampleSteps(from: DraftSampleCount, to: DraftSampleCount): number {
  const length = DRAFT_SAMPLE_COUNTS.length;
  const at = DRAFT_SAMPLE_COUNTS.indexOf(from);
  const target = DRAFT_SAMPLE_COUNTS.indexOf(to);
  if (at < 0 || target < 0) return 0;
  return (target - at + length) % length;
}

/**
 * 同一组的标题只在第一行画：返回该行的分组名，其余行返回 null。
 * 二级目录与行内命令菜单共用这一份判定——分组标题画几次是同一件事，不该有两份实现。
 */
export function groupHeadingAt(
  options: readonly { group?: string }[],
  index: number
): string | null {
  const current = options[index]?.group;
  if (current === undefined) return null;
  return index === 0 || options[index - 1]?.group !== current ? current : null;
}

function draftView(state: MoreSheetState): MoreSheetView {
  const options: MoreOption[] = DRAFT_SAMPLE_COUNTS.map((count) => ({
    id: String(count),
    label: count === 1 ? "单稿（默认）" : `一次 ${count} 稿`,
    detail:
      count === 1
        ? "一轮只跑一次生成，直接给一稿；token 成本不变。"
        : `一轮里静默跑 ${count} 次生成，把 ${count} 稿一起摆给你挑，token 成本约 ${count} 倍。`,
    icon: "copy",
    badge: count === 1 ? "默认" : `×${count}`,
    selected: count === state.sampleCount,
    disabled: false,
    action: "draft",
    group: "本轮生成次数"
  }));
  return {
    title: "多稿生成",
    hint: "决定一轮里跑几次生成；选中的一档只影响之后的发送",
    icon: "copy",
    foot: "选完立即生效；开着的档数会在「更多」按钮上亮一档",
    empty: "没有可选的生成档位",
    options
  };
}

function toolsView(state: MoreSheetState): MoreSheetView {
  const rows = toolRoster(state.webSearchEnabled);
  const options: MoreOption[] = rows.map((row) => {
    const off = state.disabledTools.includes(row.name);
    return {
      id: row.name,
      label: row.label,
      detail: row.effect,
      icon: row.kind === "写" ? "edit" : "search",
      badge: off ? "已关" : "带上",
      selected: !off,
      disabled: false,
      action: "tools",
      group: row.kind === "写" ? "会改稿" : "只读检索"
    };
  });
  options.push({
    id: "__roster__",
    label: "查看完整清单",
    detail: "打开带说明与逐枚开关的完整工具面板。",
    icon: "list",
    badge: "",
    selected: false,
    disabled: false,
    action: "roster",
    group: "更多"
  });
  // toolRoster 的原序是「读 / 写 / 读」交替；稳定排序只归堆、不重排组内次序。
  options.sort((a, b) => (TOOL_GROUP_ORDER[a.group] ?? 3) - (TOOL_GROUP_ORDER[b.group] ?? 3));
  const enabledCount = rows.filter((row) => !state.disabledTools.includes(row.name)).length;
  return {
    title: "这一轮带的工具",
    hint: `这一轮带出 ${enabledCount} / ${rows.length} 枚；点一行即可摘下或带回`,
    icon: "list",
    foot: "工具由模型自己挑；能改盘的那几枚仍要过输入区的权限档",
    empty: "这一轮没有可带的工具",
    options
  };
}

function paletteView(state: MoreSheetState): MoreSheetView {
  const options: MoreOption[] = [
    {
      id: "__summon__",
      label: "输入 / 搜索命令",
      detail: "回到输入框，按 / 唤出带搜索的行内命令菜单（与裸 / 键同一个入口）。",
      icon: "search",
      badge: "/",
      selected: false,
      disabled: false,
      action: "summon",
      group: "快捷入口"
    }
  ];
  // 分组顺序只认 SLASH_COMMAND_GROUPS 这一份；组内顺序仍是可执行名单的顺序。
  for (const group of SLASH_COMMAND_GROUPS) {
    for (const command of state.commands) {
      const meta = SLASH_COMMAND_META[command];
      if (meta.group !== group) continue;
      options.push({
        id: command,
        label: meta.title,
        detail: SLASH_COMMAND_DESCRIPTIONS[command],
        icon: meta.icon,
        badge: `/${command}`,
        selected: false,
        disabled: false,
        action: "command",
        group
      });
    }
  }
  return {
    title: "/ 命令",
    hint: "选中即执行，与在输入框打 / 唤出的是同一批命令",
    icon: "sparkles",
    foot: "当前不能用的命令不会列出来；执行不会把命令当成消息发出去",
    empty: "这一刻没有可执行的命令",
    options
  };
}

function workModeView(state: MoreSheetState): MoreSheetView {
  const details: Record<WorkMode, string> = {
    plan: "这一轮只讲打算、不动稿；提案批了也不落盘。",
    act: "提案经你批准就会写入磁盘，改动会留在书稿里。"
  };
  const icons: Record<WorkMode, IconName> = { plan: "ledger", act: "pen" };
  const options: MoreOption[] = WORK_MODES.map((mode) => ({
    id: mode,
    label: WORK_MODE_LABELS[mode],
    detail: state.hasBook
      ? details[mode]
      : `${details[mode]}（还没打开作品目录，这一档暂时改不了。）`,
    icon: icons[mode],
    badge: mode === "plan" ? "计划" : "动手",
    selected: state.hasBook && mode === state.workMode,
    disabled: !state.hasBook,
    action: "work-mode",
    group: "这本书的模式"
  }));
  return {
    title: "工作模式",
    hint: state.hasBook
      ? "决定提案经你批准后写不写盘；这是这本书的设置"
      : "还没打开作品目录，模式要跟着书走",
    icon: "pen",
    foot: "选中后会写进 book.json，切书不会串档",
    empty: "没有可选的工作模式",
    options
  };
}

/**
 * 自动技能卡片（2026-11-09「技能自动识别自动运用」；2026-11-10 用户裁定「不要在里面」）。
 * 开关、这一轮挂了什么、为什么挂、怎么撤，全在同一张卡片上——自动不等于黑箱。
 * 名字与理由来自 skill-pick 的判据，本表只排选项卡，不重算任何分数。
 * 它**不是「更多」的一组**：入口在输入卡首行那枚独立 chip 与提示行的「管理」，
 * 所以单独导出、不进 moreSheetView 的 switch，但版式仍由同一个 ComposerMoreSheet 渲染。
 */
export function autoSkillSheetView(state: MoreSheetState): MoreSheetView {
  const auto = state.autoSkills;
  const pinnedSkills = auto.library.filter((one) => one.pinned);
  const restSkills = auto.library.filter((one) => !one.pinned);
  // 「全部取下」动的是**自动挑的那几枚**（clearAll 的语义），不是全部挂着的：
  // 拿总挂着数当角标会让人以为点了会连亲手挂的一起撤掉——那枚数骗人。
  const autoPinnedCount = pinnedSkills.filter((one) => one.auto).length;
  /** 库里的某一枚：点一行就是「挂上 / 取下」这一下，选中的就是这一轮真会进上下文的。 */
  const row = (one: LibrarySkill, group: string): MoreOption => ({
    id: one.id,
    label: one.name,
    detail: one.detail === "" ? "这份技能没写用途，点开技能库能改。" : one.detail,
    icon: "wand",
    // 只有已挂的才有角标：标「自动」是为了让用户知道这枚不是你选的，
    // 关掉总开关它会自己消失（关开关不动你亲手挂的）。
    badge: one.pinned ? (one.auto ? "自动" : "手动") : "",
    selected: one.pinned,
    disabled: false,
    action: "skill-toggle",
    group
  });
  const options: MoreOption[] = [
    {
      id: "toggle",
      label: auto.enabled ? "自动识别并运用：已开启" : "自动识别并运用：已关闭",
      detail: !auto.enabled
        ? "关着时技能仍可手动挂入，书级默认照旧生效；不会自动改这一轮的上下文。"
        : auto.paused
          ? "开着，但这一轮你已经「全部取下」：本线程自动挂入已暂停，点「恢复自动推荐」继续。"
          : "按当前阶段、文稿和你正敲的字，自动挑最多 3 枚技能挂进这一轮；挑了哪几枚，下面标着「自动」。",
      icon: "sparkles",
      badge: auto.enabled ? "开" : "关",
      selected: auto.enabled,
      disabled: false,
      action: "auto-toggle",
      group: "总开关"
    },
    ...pinnedSkills.map((one) => row(one, "这一轮用着")),
    ...restSkills.map((one) => row(one, "库里其余")),
    {
      id: "clear",
      label: "全部取下",
      detail: "撤掉这一轮自动挂入的技能，并暂停本线程自动挂入，直到你点「恢复自动推荐」。",
      icon: "minus",
      badge: auto.paused ? "已暂停" : `${autoPinnedCount} 枚`,
      selected: false,
      disabled: !auto.enabled || auto.paused || autoPinnedCount === 0,
      action: "auto-clear",
      group: "操作"
    },
    {
      id: "reset",
      label: "恢复自动推荐",
      detail: auto.paused
        ? `解除本线程的自动挂入暂停${auto.blockedCount > 0 ? `，并清掉 ${auto.blockedCount} 条手动否决` : ""}，让自动识别重新有机会。`
        : auto.blockedCount > 0
          ? `清掉本线程 ${auto.blockedCount} 条手动否决，让自动识别重新有机会。`
          : "本线程没有被手动否决的技能。",
      icon: "refresh",
      badge: "",
      selected: false,
      disabled: !auto.paused && auto.blockedCount === 0,
      action: "auto-reset",
      group: "操作"
    },
    {
      id: "skills-page",
      label: "打开技能库页",
      detail:
        "装新的、从网上扒、自己写一份、改正文——那些都在技能库那一页，这里只管这一轮用哪几枚。",
      icon: "library",
      badge: "",
      selected: false,
      disabled: false,
      action: "skills-page",
      group: "操作"
    }
  ];
  return {
    title: "技能",
    /* 2026-11-10：原句 30 字，在 370px 宽的卡里只放得下 24 字（真机量：241px 可用 / 10px 字号），
       屏上是「…也能让它在下面按阶段…」——一句话被切在半个词组上，比不写还难看。收到 23 字。 */
    hint: "这一轮用哪几枚，自己挑；也能让它按阶段自动挑",
    icon: "wand",
    foot: "点一行即挂上/取下；「自动」是它替你挑的，关总开关只撤这些，不动你亲手挂的",
    // 空库不是错误，是「还没装」：卡片里说清下一步去哪儿，别只留一句「没有」。
    empty: "技能库里还没有技能——去技能库页装一份，或者自己写一份。",
    options
  };
}

/** 「更多」四组视图的唯一分派口：加一组而漏了这里，编译不过（穷尽 switch 由 MORE_GROUP_IDS 钉住）。 */
export function moreSheetView(group: MoreGroupId, state: MoreSheetState): MoreSheetView {
  switch (group) {
    case "draft":
      return draftView(state);
    case "tools":
      return toolsView(state);
    case "palette":
      return paletteView(state);
    case "work-mode":
      return workModeView(state);
    default: {
      const unhandled: never = group;
      return unhandled;
    }
  }
}

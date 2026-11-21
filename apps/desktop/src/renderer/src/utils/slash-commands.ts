/**
 * `/` 命令面板的判定层（spec §6）：命令表、运行期可用性、权限档名反查、弹层自己吃的键。
 * 行内引用菜单只画这张表并把选中的命令交给 useAgentStore.runSlashCommand，本文件以外不允许判断「这条命令现在能不能用」。
 * Task 106 裁定 D1：退役面板专用的 `parseSlashInput` / `filterCommands` / `paletteOwnsKey` 三枚 helper
 * 随 SlashPalette.vue 一起删——过滤的真身现在是 utils/inline-reference-menu.ts 的 filterReferenceOptions，
 * 键→动作的真身现在是 utils/hotkeys.ts，留着就是第二份实现（铁律 6）。
 */
import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import { hasNoMods, type HotkeyMods } from "./hotkeys";

export const SLASH_COMMANDS = [
  "model",
  "permissions",
  "status",
  "stage",
  "skills",
  "plugins",
  "skins",
  "export",
  "wordcount",
  "newbook",
  "resume",
  "clear"
] as const;
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

export interface PaletteFocus {
  hasBook: boolean;
  turnRunning: boolean;
}

/**
 * 穷尽表（铁律 6）：加成员不写说明就编译不过。说明里不重抄权限档名，档位文案的唯一来源仍是 PERMISSION_LABELS。
 *
 * 2026-11-09「命令面板优化」：说明一律写成「这条命令替你做什么」，不写实现细节、
 * 不写「与某处同一处」这类只有开发者看得懂的出处；命令名与分组另见 SLASH_COMMAND_META。
 */
export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommand, string> = {
  model: "换模型：API 地址、模型名和密钥都在设置里改",
  permissions: "调权限档：决定 AI 能不能直接改你的稿子",
  status: "把本轮进度和待批提案数写进状态条",
  stage: "切创作阶段，可直接带阶段名，如 /stage 大纲",
  skills: "打开技能库浏览；要挂进上下文按卡片上的「加入当前上下文」",
  plugins: "打开插件面板：看装了什么、能停用或卸载",
  skins: "打开皮肤广场，挑外观并整窗预览",
  export: "导出这本书：Markdown / TXT / EPUB",
  wordcount: "字数统计：总字数、章节分布与写作目标",
  newbook: "新建一本作品：选目录、起书名",
  resume: "重新读取这条线程的历史消息",
  clear: "只清屏，不动盘上保存的会话历史"
};

/** 命令的用途分组（目录与行内菜单共用这一份顺序，不在组件里再排一次）。 */
export const SLASH_COMMAND_GROUPS = ["书稿", "会话", "视图", "数据", "配置"] as const;
export type SlashCommandGroup = (typeof SLASH_COMMAND_GROUPS)[number];

export interface SlashCommandMeta {
  /** 中文短名：命令名给人看要能一眼认出，裸 `/model` 只留在右端键帽里。 */
  title: string;
  group: SlashCommandGroup;
  /** 每条一枚，类型就是 IconName——写错图标名裸 tsc 当场拒绝。 */
  icon: IconName;
}

/**
 * 命令面板「里面所有东西」的唯一装饰表（2026-11-09）。
 * 仍是 Record 穷尽：SLASH_COMMANDS 加一条而这里漏写，编译就红，绝不会长出一条没有名字和图标的裸命令。
 * 说明文案不在这里重抄——`SLASH_COMMAND_DESCRIPTIONS` 仍是那一处（铁律 6）。
 */
export const SLASH_COMMAND_META: Record<SlashCommand, SlashCommandMeta> = {
  model: { title: "模型设置", group: "配置", icon: "model" },
  permissions: { title: "权限档", group: "配置", icon: "shield" },
  status: { title: "本轮状态", group: "会话", icon: "chart" },
  stage: { title: "创作阶段", group: "书稿", icon: "map" },
  skills: { title: "技能库", group: "视图", icon: "wand" },
  plugins: { title: "插件", group: "视图", icon: "library" },
  skins: { title: "皮肤广场", group: "视图", icon: "image" },
  export: { title: "导出书稿", group: "数据", icon: "download" },
  wordcount: { title: "字数统计", group: "数据", icon: "chart" },
  newbook: { title: "新建作品", group: "书稿", icon: "plus" },
  resume: { title: "重读历史", group: "会话", icon: "history" },
  clear: { title: "清空本页", group: "会话", icon: "trash" }
};

/** turn 运行中仍可用的命令（换上下文/重建视图的那几条会和进行中的一轮抢状态）。 */
const DURING_TURN_COMMANDS: readonly SlashCommand[] = ["model", "permissions", "status", "clear"];

/**
 * 需要已打开一本书的命令。
 * 阶段来自 book.json 的 stages，没书时列出来就是一条按下 Enter 什么都不发生的命令——
 * 项目律「拒绝一律回单句中文原因，不静默丢弃」，而「不列出来」正是这里合规的拒绝形式。
 * （波 1 的 GATED_COMMANDS 曾把 stage 整条门控掉，等的就是档案落地；那条门控已随六档案删除。）
 */
const NEEDS_BOOK: readonly SlashCommand[] = [
  "resume",
  "permissions",
  "stage",
  // skills 不在门控里（2026-11-20）：技能库页无书也能开（首页快捷入口就在开），
  // 派发只是 layout.showCenter("skills")——把它列这儿是无书的假拒绝。
  // 导出 / 字数统计要有书才有内容：两处都读 book.docs，没书就只有一排零。
  "export",
  "wordcount"
];

export function availableCommands(focus: PaletteFocus): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => {
    if (NEEDS_BOOK.includes(command) && !focus.hasBook) return false;
    if (focus.turnRunning) return DURING_TURN_COMMANDS.includes(command);
    return true;
  });
}

/**
 * 这一键归不归输入法（批次 5-㊶）。
 *
 * 【为什么必须是唯一一份】组合态里按下的回车/上档键，是输入法在选词，不是在触发快捷键。
 * 真机 P536O 量到：查找框里拼音「yu」按回车选词，冒泡阶段 defaultPrevented 变 true——
 * 候选词被吃掉，拼音留在框里。而同一测量在正文输入框上是 false（全局闸门是好的），
 * 也就是说这道闸在这十个弹层/输入框上**根本没写**。
 * 判据将来只会有一种形状（真身 + 老式 229 兜底 + 别的输入法差异），
 * 散在十处写就是改一次要改十处、漏一处又是一枚新的「回车吃掉候选」。
 *
 * 【为什么老式 229 也算】个别输入法与部分 Electron/Windows 组合只会给出 keyCode 229 而
 * 不把 isComposing 置真；那一类按键同样属于输入法。两个信号取或。
 */
export function imeOwnsKey(event: KeyboardEvent): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/**
 * 权限档 popover 自己吃的键：只有**裸 Esc** 归弹层（关掉它，不切档），其余键一律放行给上层。
 * 合成期间一律不接、带任何修饰都不接——两条判据都与 utils/hotkeys.ts 同口径：
 * 弹层会 stopPropagation，全局 `resolveHotkey` 因此永远看不见这一键，
 * 所以「裸键」这道闸必须在这里也过一遍；判据本身用 hotkeys.ts 的 `hasNoMods`，这里不另写一份。
 */
export function popoverOwnsKey(key: string, mods: HotkeyMods, isComposing: boolean): boolean {
  if (isComposing || !hasNoMods(mods)) return false;
  return key === "Escape";
}

/** 中文档位名反查 PermissionMode：查不到返回 null，由调用处给一句中文提示（spec §6）。 */
export function matchPermissionMode(text: string): PermissionMode | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  for (const [mode, label] of Object.entries(PERMISSION_LABELS) as [PermissionMode, string][]) {
    if (label === trimmed) return mode;
  }
  return null;
}

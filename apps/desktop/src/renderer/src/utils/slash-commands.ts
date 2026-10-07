/**
 * `/` 命令面板的判定层（spec §6）：命令表、运行期可用性、权限档名反查、弹层自己吃的键。
 * 行内引用菜单只画这张表并把选中的命令交给 useAgentStore.runSlashCommand，本文件以外不允许判断「这条命令现在能不能用」。
 * Task 106 裁定 D1：退役面板专用的 `parseSlashInput` / `filterCommands` / `paletteOwnsKey` 三枚 helper
 * 随 SlashPalette.vue 一起删——过滤的真身现在是 utils/inline-reference-menu.ts 的 filterReferenceOptions，
 * 键→动作的真身现在是 utils/hotkeys.ts，留着就是第二份实现（铁律 6）。
 */
import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";
import { hasNoMods, type HotkeyMods } from "./hotkeys";

export const SLASH_COMMANDS = [
  "model",
  "permissions",
  "status",
  "stage",
  "skills",
  "plugins",
  "resume",
  "clear"
] as const;
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

export interface PaletteFocus {
  hasBook: boolean;
  turnRunning: boolean;
}

/** 穷尽表（铁律 6）：加成员不写说明就编译不过。说明里不重抄权限档名，档位文案的唯一来源仍是 PERMISSION_LABELS。 */
export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommand, string> = {
  model: "打开模型设置：baseURL、模型名与密钥",
  permissions: "打开权限档选择器（当前档显示在中栏头部）",
  status: "把这条线程的现状写进状态条",
  stage: "切换创作阶段（带阶段名可直接切，如 /stage 大纲）",
  skills: "打开技能库浏览（只读；选中技能不装配，要挂入得按卡片上的「加入当前上下文」）",
  plugins: "打开插件面板（看装了哪些、它们加了哪些能力；可停用或卸载）",
  resume: "重新读取这条线程的历史",
  clear: "只清空本页显示，不动盘上的会话历史"
};

/** turn 运行中仍可用的命令（换上下文/重建视图的那几条会和进行中的一轮抢状态）。 */
const DURING_TURN_COMMANDS: readonly SlashCommand[] = ["model", "permissions", "status", "clear"];

/**
 * 需要已打开一本书的命令。
 * 阶段来自 book.json 的 stages，没书时列出来就是一条按下 Enter 什么都不发生的命令——
 * 项目律「拒绝一律回单句中文原因，不静默丢弃」，而「不列出来」正是这里合规的拒绝形式。
 * （波 1 的 GATED_COMMANDS 曾把 stage 整条门控掉，等的就是档案落地；那条门控已随六档案删除。）
 */
const NEEDS_BOOK: readonly SlashCommand[] = ["resume", "permissions", "stage", "skills"];

export function availableCommands(focus: PaletteFocus): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => {
    if (NEEDS_BOOK.includes(command) && !focus.hasBook) return false;
    if (focus.turnRunning) return DURING_TURN_COMMANDS.includes(command);
    return true;
  });
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

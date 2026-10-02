/**
 * `/` 命令面板的判定层（spec §6）：命令表、运行期可用性、输入解析、面板自己吃的键。
 * SlashPalette.vue 只画这张表并把选中的命令交出去，本文件以外不允许判断「这条命令现在能不能用」。
 */
import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";
import { hasNoMods, type HotkeyMods } from "./hotkeys";

export const SLASH_COMMANDS = [
  "model",
  "permissions",
  "status",
  "stage",
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
  stage: "切换创作阶段（要连同智能体档案一起切，波 2 接通）",
  resume: "重新读取这条线程的历史",
  clear: "只清空本页显示，不动盘上的会话历史"
};

/**
 * 波 1 里按下去还没有通路可走的命令：`stage` 的切阶段要连档案一起切（spec §6 的 profilesReady 缘由），
 * 档案是波 2 的产物。波 2 的 Task 18 删掉这一行、改由 PaletteFocus.profilesReady 驱动。
 * 枚举与说明表仍含 stage——被列出来却只会报错的命令才禁止，被滤掉不列出来是合规的。
 */
const GATED_COMMANDS: readonly SlashCommand[] = ["stage"];

/** turn 运行中仍可用的命令（换上下文/重建视图的那几条会和进行中的一轮抢状态）。 */
const DURING_TURN_COMMANDS: readonly SlashCommand[] = ["model", "permissions", "status", "clear"];

export function availableCommands(focus: PaletteFocus): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => {
    if (GATED_COMMANDS.includes(command)) return false;
    if (command === "resume" && !focus.hasBook) return false;
    if (focus.turnRunning) return DURING_TURN_COMMANDS.includes(command);
    return true;
  });
}

export function parseSlashInput(text: string): { command: SlashCommand | null; argument: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { command: null, argument: "" };
  const body = trimmed.slice(1).trim();
  if (body === "") return { command: null, argument: "" };
  const [head = "", ...rest] = body.split(/\s+/);
  const matched = SLASH_COMMANDS.find((command) => command === head.toLowerCase());
  return { command: matched ?? null, argument: rest.join(" ").trim() };
}

/** 面板列表：过滤发生在 availableCommands 的结果上，输入里的前缀既认 "sta" 也认 "/sta"。 */
export function filterCommands(text: string, focus: PaletteFocus): SlashCommand[] {
  const pool = availableCommands(focus);
  const typed = text.trim().replace(/^\//, "").trim().toLowerCase();
  if (typed === "") return pool;
  const [head = ""] = typed.split(/\s+/);
  return pool.filter((command) => command.startsWith(head));
}

/** 面板自处理这四个键（spec §5 护栏 5）；合成期间一律不接，与 utils/hotkeys.ts 的闸门同口径。 */
export function paletteOwnsKey(key: string, isComposing: boolean): boolean {
  if (isComposing) return false;
  return key === "ArrowUp" || key === "ArrowDown" || key === "Enter" || key === "Escape";
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

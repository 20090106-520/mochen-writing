/**
 * 键位判定层（spec §5）：只回答「哪个键在什么焦点下等于哪个动作」。
 * 入参是拆开的修饰键而不是 KeyboardEvent——不依赖 DOM，也不会有人偷偷传 event 读别的字段。
 * 键位表（spec §5）与五条护栏冲突时以护栏为准：表是摘要，白名单才是裁决边界。
 * Esc：只有裸键 delegated（带修饰的 Esc 属于 OS 或别人）；Esc 的裁决全在 utils/escape-policy
 * 的 resolveEscape（优先级：保字 > 取消该条 > 收浮层 > 打断 > 无动作），这里绝不复制一份。
 */
export interface HotkeyMods {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface HotkeyFocus {
  composerIsFocused: boolean;
  composerHasText: boolean;
  /** 文稿编辑器 / 说明框 / 设置输入 / 检索类输入统一算它。 */
  textInputIsFocused: boolean;
  proposalIsFocused: boolean;
  proposalIsPending: boolean;
  turnRunning: boolean;
  isComposing: boolean;
  hasBook: boolean;
  tabCount: number;
}

export type HotkeyAction =
  | "submit"
  | "newline"
  | "queue"
  | "delegated"
  | "none"
  | "approve-once"
  | "approve-session"
  | "approve-prefix"
  | "deny-guidance"
  | "next-tab"
  | "prev-tab"
  | "jump-tab"
  | "toggle-left"
  | "open-settings"
  | "open-book"
  | "open-palette";

export interface HotkeyResult {
  action: HotkeyAction;
  tabIndex?: number;
}

/**
 * 「裸键」的唯一判据：四个修饰键一个都不能按上（spec §5 键位表 Esc 行）。
 * 全局 `resolveHotkey` 与各 popover 的自处理键共用这一条，不再各写一份四元与。
 */
export function hasNoMods(mods: HotkeyMods): boolean {
  return !mods.ctrl && !mods.shift && !mods.alt && !mods.meta;
}

const APPROVAL_KEYS: Record<string, HotkeyAction> = {
  y: "approve-once",
  a: "approve-session",
  p: "approve-prefix",
  d: "deny-guidance"
};

export function resolveHotkey(focus: HotkeyFocus, key: string, mods: HotkeyMods): HotkeyResult {
  // 护栏 1（M4）：输入法合成期间一律不截键——候选框回车被吃掉是这类应用最刺眼的错。
  if (focus.isComposing) return { action: "none" };

  const bare = !mods.ctrl && !mods.alt && !mods.meta; // 是否只可能带 shift（或不带）
  const noMods = hasNoMods(mods); // 是否纯键（无任何修饰）
  const k = key.length === 1 ? key.toLowerCase() : key;

  // Esc：先于 Ctrl 族、后于合成闸门判定，但**只有裸键**才委托——
  // Alt+Esc 在 Windows 是系统切窗口键，Ctrl/Shift/Meta+Esc 归 OS 或归别人，一律 none。
  if (k === "Escape") return noMods ? { action: "delegated" } : { action: "none" };

  // 全局 Ctrl 族（先于编辑态判断：即便在文本框里也应放行）
  if (mods.ctrl && !mods.alt && !mods.meta) {
    if (!mods.shift) {
      if (k === "b") return { action: "toggle-left" };
      if (k === ",") return { action: "open-settings" };
      // 左栏「打开作品目录」的键标（`LeftSidebar.vue` 的 `<kbd>Ctrl O</kbd>`）从这里落地，
      // 不许再出现「屏上标了键、按下什么都不是」的第三种状态。
      if (k === "o") return { action: "open-book" };
      if (focus.hasBook && k === "PageDown") return { action: "next-tab" };
      if (focus.hasBook && k === "PageUp") return { action: "prev-tab" };
      if (/^[1-9]$/.test(k)) {
        const index = Number(k) - 1;
        if (focus.hasBook && index < focus.tabCount) return { action: "jump-tab", tabIndex: index };
        return { action: "none" }; // 越界 / 无书
      }
      if (focus.composerIsFocused && k === "j") return { action: "newline" }; // Ctrl+J
    }
    return { action: "none" }; // 其余 Ctrl 组合不在键位表
  }

  // / 开面板：composer 无焦点且不在文本框、无修饰键
  if (k === "/" && noMods && !focus.composerIsFocused && !focus.textInputIsFocused)
    return { action: "open-palette" };

  // Tab 排队：仅运行中有文本，且焦点不在文本输入里；其余保留焦点移动（无障碍优先）。
  // 焦点条件写在护栏 2 的白名单里（textInputIsFocused 时只放行 newline/submit/全局 Ctrl+*），
  // spec §5 的 Tab 行漏了它——以护栏为准：文稿编辑器里按 Tab 是缩进，不能被排队抢走。
  if (k === "Tab" && noMods)
    return focus.turnRunning && focus.composerHasText && !focus.textInputIsFocused
      ? { action: "queue" }
      : { action: "none" };

  // Enter / Shift+Enter（composer 焦点）
  if (k === "Enter" && focus.composerIsFocused && bare) {
    if (mods.shift) return { action: "newline" };
    return focus.turnRunning ? { action: "none" } : { action: "submit" };
  }

  // 审批四键：只作用于聚焦的那一张待审卡，且不在文本框里（护栏 2、4）
  if (
    noMods &&
    focus.proposalIsFocused &&
    focus.proposalIsPending &&
    !focus.textInputIsFocused &&
    k in APPROVAL_KEYS
  )
    return { action: APPROVAL_KEYS[k] as HotkeyAction };

  return { action: "none" };
}

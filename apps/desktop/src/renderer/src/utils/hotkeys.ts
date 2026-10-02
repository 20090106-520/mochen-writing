/**
 * 键位判定层（spec §5）：只回答「哪个键在什么焦点下等于哪个动作」。
 * 入参是拆开的修饰键而不是 KeyboardEvent——不依赖 DOM，也不会有人偷偷传 event 读别的字段。
 * Esc 一律 delegated：真正的三态裁决仍在 utils/escape-policy.ts 的 resolveEscape，这里绝不复制一份。
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
  | "open-palette";

export interface HotkeyResult {
  action: HotkeyAction;
  tabIndex?: number;
}

const APPROVAL_KEYS: Record<string, HotkeyAction> = {
  y: "approve-once",
  a: "approve-session",
  p: "approve-prefix",
  d: "deny-guidance"
};

export function resolveHotkey(focus: HotkeyFocus, key: string, mods: HotkeyMods): HotkeyResult {
  const none: HotkeyResult = { action: "none" };
  // 护栏 1（M4）：输入法合成期间一律不截键——候选框回车被吃掉是这类应用最刺眼的错。
  if (focus.isComposing) return none;

  const bare = !mods.ctrl && !mods.alt && !mods.meta; // 是否只可能带 shift（或不带）
  const noMods = bare && !mods.shift; // 是否纯键（无任何修饰）
  const k = key.length === 1 ? key.toLowerCase() : key;

  // 全局 Ctrl 族（先于编辑态判断：即便在文本框里也应放行）
  if (mods.ctrl && !mods.alt && !mods.meta) {
    if (!mods.shift) {
      if (k === "b") return { action: "toggle-left" };
      if (k === ",") return { action: "open-settings" };
      if (focus.hasBook && k === "PageDown") return { action: "next-tab" };
      if (focus.hasBook && k === "PageUp") return { action: "prev-tab" };
      if (/^[1-9]$/.test(k)) {
        const index = Number(k) - 1;
        if (focus.hasBook && index < focus.tabCount) return { action: "jump-tab", tabIndex: index };
        return none; // 越界 / 无书
      }
      if (focus.composerIsFocused && k === "j") return { action: "newline" }; // Ctrl+J
    }
    return none; // 其余 Ctrl 组合不在键位表
  }

  // Esc：委托给 resolveEscape（裁决不在这层）
  if (k === "Escape") return { action: "delegated" };

  // / 开面板：composer 无焦点且不在文本框、无修饰键
  if (k === "/" && noMods && !focus.composerIsFocused && !focus.textInputIsFocused)
    return { action: "open-palette" };

  // Tab 排队：仅运行中有文本；其余保留焦点移动（无障碍优先）
  if (k === "Tab" && noMods)
    return focus.turnRunning && focus.composerHasText ? { action: "queue" } : none;

  // Enter / Shift+Enter（composer 焦点）
  if (k === "Enter" && focus.composerIsFocused && bare) {
    if (mods.shift) return { action: "newline" };
    return focus.turnRunning ? none : { action: "submit" };
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

  return none;
}

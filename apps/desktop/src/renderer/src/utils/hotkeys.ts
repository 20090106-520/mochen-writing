/**
 * 键位判定层（spec §5）：只回答「哪个键在什么焦点下等于哪个动作」。
 * 入参是拆开的修饰键而不是 KeyboardEvent——不依赖 DOM，也不会有人偷偷传 event 读别的字段。
 * 键位表（spec §5）与五条护栏冲突时以护栏为准：表是摘要，白名单才是裁决边界。
 * Esc：只有裸键 delegated（带修饰的 Esc 属于 OS 或别人）；Esc 的裁决全在 utils/escape-policy
 * 的 resolveEscape（优先级：保字 > 取消该条 > 收浮层 > 打断 > 无动作），这里绝不复制一份。
 */
import type { SubmitKey } from "./send-key-preference";

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
  /** 行内引用菜单（`/` 与 `@`）正开着（#106）。真身在 utils/inline-reference-menu.ts 的匹配态，由 store 提供。 */
  referenceMenuIsOpen: boolean;
  /** 发送键档（设置页「智能体」可换）：默认 enter 与原表同值；ctrl-enter 把回车留给换行。 */
  submitKey: SubmitKey;
}

export type HotkeyAction =
  | "submit"
  | "newline"
  | "queue"
  | "delegated"
  | "open-find-replace"
  | "panel-shortcut"
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
  | "open-help"
  | "open-book"
  | "open-palette"
  | "reference-insert"
  | "reference-move-up"
  | "reference-move-down";

/**
 * Ctrl+Shift / Ctrl+Alt 族唤起的面板。
 * 判定层只报「是哪一枚」——开还是翻转由装配层按那一枚的语义定（App.vue 的 panelShortcut），
 * 这里不替面板做决定，免得「哪些面板是切换、哪些是常开」在两处各写一份。
 */
export type PanelShortcutId =
  "search" | "notes" | "templates" | "outline" | "goals" | "story-bible" | "editor-view";

export interface HotkeyResult {
  action: HotkeyAction;
  tabIndex?: number;
  /** 仅 action === "panel-shortcut" 时有值。 */
  panel?: PanelShortcutId;
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

/**
 * Ctrl+Shift 族 → 面板。原先这七枚是 App.vue 里另挂的第二个 keydown 监听自己判的，
 * 于是它们既不在本表（设置页「快捷键」查不到），也破了「全局 keydown 只有一处」的裁定 G5。
 * 搬进判定层之后，快捷键页与 hotkey-guide 的 needle 契约同时成立。
 */
const PANEL_KEYS: Record<string, PanelShortcutId> = {
  f: "search",
  n: "notes",
  t: "templates",
  o: "outline",
  g: "goals",
  b: "story-bible",
  p: "editor-view"
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
    if (mods.shift) {
      const panel = PANEL_KEYS[k];
      if (panel) return { action: "panel-shortcut", panel };
    }
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
      // 文档内查找（Ctrl+F）：全局，与焦点状态同义，注册表此处落地一处。
      if (k === "f") return { action: "open-find-replace" };
      // 发送键第二档（设置页可换）：Ctrl+Enter 发送。必须住在 Ctrl 分支里——
      // 落到下面裸 Enter 分支的键已经排除了 Ctrl，写那儿就永远轮不到。
      if (focus.composerIsFocused && focus.submitKey === "ctrl-enter" && k === "Enter")
        return focus.turnRunning ? { action: "none" } : { action: "submit" };
    }
    return { action: "none" }; // 其余 Ctrl 组合不在键位表
  }

  // / 召唤命令菜单：composer 无焦点且不在文本框、无修饰键。
  // #106 起这条动作的落点从「另一块面板」改成行内引用菜单（唤起处见 CenterColumn），
  // 动作名不动：它是键位表的成员，改名会牵动 #105 的 chip 表与其测试，收益只有好听。
  if (k === "/" && noMods && !focus.composerIsFocused && !focus.textInputIsFocused)
    return { action: "open-palette" };

  // ? 召唤快捷键指南（落在设置浮层的「快捷键」页，那一页的真身是 HotkeysPanel.vue）。
  // 放行条件用 bare 而不是 noMods：US 布局上 ? 是 Shift+/ 打出来的，event.key 已是 "?" 且 shiftKey
  // 为真——要求纯键等于这枚键永远按不出来。Ctrl/Alt/Meta 三枚仍一个都不许按（Ctrl 族在上面的分支就返回 none）。
  // 焦点条件与 / 同一款：composer 或任一文本框有焦点时 ? 只是打字，不许截走（护栏 2）。
  if (k === "?" && bare && !focus.composerIsFocused && !focus.textInputIsFocused)
    return { action: "open-help" };

  // Tab 排队：仅运行中有文本，且焦点不在文本输入里；其余保留焦点移动（无障碍优先）。
  // 焦点条件写在护栏 2 的白名单里（textInputIsFocused 时只放行 newline/submit/全局 Ctrl+*），
  // spec §5 的 Tab 行漏了它——以护栏为准：文稿编辑器里按 Tab 是缩进，不能被排队抢走。
  if (k === "Tab" && noMods)
    return focus.turnRunning && focus.composerHasText && !focus.textInputIsFocused
      ? { action: "queue" }
      : { action: "none" };

  // 行内引用菜单（#106 裁定 D2）：菜单开着且焦点仍在 composer 时，↑↓ 挪高亮、Enter 交给你看中的那一条。
  // 位置刻意排在 Tab 之后、Enter 之前——Tab 排队的既有通路不许被菜单吃掉（裁定 D3），
  // 而 Enter 必须在这里改道：菜单开着时它既不是发送也不是换行。带任何修饰都不进菜单（Shift+Enter 照旧换行）。
  // Esc 不在这里：它仍走 delegated ⇒ utils/escape-policy.ts 的同一条裁决链。
  if (focus.referenceMenuIsOpen && noMods && focus.composerIsFocused) {
    if (k === "ArrowUp") return { action: "reference-move-up" };
    if (k === "ArrowDown") return { action: "reference-move-down" };
    if (k === "Enter") return { action: "reference-insert" };
  }

  // Enter / Shift+Enter（composer 焦点）
  if (k === "Enter" && focus.composerIsFocused && bare) {
    // ctrl-enter 档：回车整档让给换行（含 Shift+Enter），发送只走上面 Ctrl 分支那一条。
    if (focus.submitKey === "ctrl-enter") return { action: "newline" };
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

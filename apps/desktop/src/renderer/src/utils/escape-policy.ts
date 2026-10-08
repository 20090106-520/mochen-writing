export type EscapeAction =
  | "keep-guidance"
  | "cancel-proposal"
  | "close-find-replace"
  | "close-reference-menu"
  | "close-skin-overlay"
  | "close-overlay"
  | "interrupt"
  | "none";

export interface EscapeFocusState {
  hasFocusedProposal: boolean;
  focusedProposalPending: boolean;
  guidanceIsDirty: boolean;
  turnRunning: boolean;
  /** 文档内查找替换面板开着（Ctrl+F）：Esc 先收它，照常一次只关一层。 */
  findReplaceIsOpen: boolean;
  /** 行内引用菜单（`/` 与 `@`）开着（#106）：它是这一串层里最内的一层。 */
  referenceMenuIsOpen: boolean;
  /**
   * 皮肤广场的浮层（整窗预览条 / 并排对比栏）开着（5-㊷）。
   *
   * 【这一支为什么必须在 `settingsIsOpen` 之前】
   * 皮肤广场占的是中栏 + 右栏那一格（`centerView === "skins"`），它**不是**设置浮层，
   * 但整窗预览会把 `<html>` 上的皮肤换成没落盘的那一套。此时按 Esc 的意图是
   * 「先退掉我这刚打开的那一层」，而不是「把整个皮肤页关掉」——
   * 顺序反过来就会一次关掉用户正在挑东西的那一页。
   *
   * 【调用方还要问一句「有没有落点」】与 5-㊴ 的 Ctrl+F、#106 的引用菜单同一条规矩：
   * 预览条挂在皮肤广场页上，人已经离开那一页时它不在屏幕上，
   * 没有落点的标记只会白吃一次 Esc，而用户看不出第一下按去了哪。
   */
  skinOverlayIsOpen: boolean;
  settingsIsOpen: boolean;
}

/**
 * spec §6.2 的唯一裁决入口，波 1.5 把「收设置浮层」插进这条链（设计决定 1：裁决点只有这一处）。
 * 优先级（逐字，与下面的实现同序）：
 *   说明框保字 > 取消该条 > 收查找替换 > 收行内引用菜单 > 收皮肤浮层 > 收设置浮层 > 打断 > 无动作。
 * 说明框已有字时先保住字（只失焦）——绝不吞掉用户输入；审批卡永远优先于打断。
 * #106 插进「收菜单」一支：菜单是最内层，Esc 一次只收一层，绝不允许越级把正在跑的那一轮打断掉
 * （对齐 deepwrite ConversationComposer 的 handleKeydown：菜单开着时 Escape 只关菜单并 return）。
 * 5-㊷ 插进「收皮肤浮层」一支，排在设置之前：整窗预览是这一串里最新打开的那一层。
 */
export function resolveEscape(state: EscapeFocusState): EscapeAction {
  if (state.hasFocusedProposal && state.focusedProposalPending)
    return state.guidanceIsDirty ? "keep-guidance" : "cancel-proposal";
  if (state.findReplaceIsOpen) return "close-find-replace";
  if (state.referenceMenuIsOpen) return "close-reference-menu";
  if (state.skinOverlayIsOpen) return "close-skin-overlay";
  if (state.settingsIsOpen) return "close-overlay";
  if (state.turnRunning) return "interrupt";
  return "none";
}

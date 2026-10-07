export type EscapeAction =
  | "keep-guidance"
  | "cancel-proposal"
  | "close-find-replace"
  | "close-reference-menu"
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
  settingsIsOpen: boolean;
}

/**
 * spec §6.2 的唯一裁决入口，波 1.5 把「收设置浮层」插进这条链（设计决定 1：裁决点只有这一处）。
 * 优先级（逐字）：说明框保字 > 取消该条 > 收行内引用菜单 > 收设置浮层 > 打断 > 无动作。
 * 说明框已有字时先保住字（只失焦）——绝不吞掉用户输入；审批卡永远优先于打断。
 * #106 插进「收菜单」一支：菜单是最内层，Esc 一次只收一层，绝不允许越级把正在跑的那一轮打断掉
 * （对齐 deepwrite ConversationComposer 的 handleKeydown：菜单开着时 Escape 只关菜单并 return）。
 */
export function resolveEscape(state: EscapeFocusState): EscapeAction {
  if (state.hasFocusedProposal && state.focusedProposalPending)
    return state.guidanceIsDirty ? "keep-guidance" : "cancel-proposal";
  if (state.findReplaceIsOpen) return "close-find-replace";
  if (state.referenceMenuIsOpen) return "close-reference-menu";
  if (state.settingsIsOpen) return "close-overlay";
  if (state.turnRunning) return "interrupt";
  return "none";
}

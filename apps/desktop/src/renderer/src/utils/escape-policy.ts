export type EscapeAction =
  "keep-guidance" | "cancel-proposal" | "close-overlay" | "interrupt" | "none";

export interface EscapeFocusState {
  hasFocusedProposal: boolean;
  focusedProposalPending: boolean;
  guidanceIsDirty: boolean;
  turnRunning: boolean;
  settingsIsOpen: boolean;
}

/**
 * spec §6.2 的唯一裁决入口，波 1.5 把「收设置浮层」插进这条链（设计决定 1：裁决点只有这一处）。
 * 优先级（逐字）：说明框保字 > 取消该条 > 收设置浮层 > 打断 > 无动作。
 * 说明框已有字时先保住字（只失焦）——绝不吞掉用户输入；审批卡永远优先于打断。
 */
export function resolveEscape(state: EscapeFocusState): EscapeAction {
  if (state.hasFocusedProposal && state.focusedProposalPending)
    return state.guidanceIsDirty ? "keep-guidance" : "cancel-proposal";
  if (state.settingsIsOpen) return "close-overlay";
  if (state.turnRunning) return "interrupt";
  return "none";
}

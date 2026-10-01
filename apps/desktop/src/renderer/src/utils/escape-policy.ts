export type EscapeAction = "keep-guidance" | "cancel-proposal" | "interrupt" | "none";

export interface EscapeFocusState {
  hasFocusedProposal: boolean;
  focusedProposalPending: boolean;
  guidanceIsDirty: boolean;
  turnRunning: boolean;
}

/**
 * spec §6.2 的唯一裁决入口：审批卡优先于打断，打断优先于无动作。
 * 说明框已有字时先保住字（只失焦）——绝不吞掉用户输入。
 */
export function resolveEscape(state: EscapeFocusState): EscapeAction {
  if (state.hasFocusedProposal && state.focusedProposalPending)
    return state.guidanceIsDirty ? "keep-guidance" : "cancel-proposal";
  if (state.turnRunning) return "interrupt";
  return "none";
}

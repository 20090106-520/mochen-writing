import { describe, expect, it } from "vitest";
import { resolveEscape, type EscapeFocusState } from "./escape-policy";

function state(overrides: Partial<EscapeFocusState> = {}): EscapeFocusState {
  return {
    hasFocusedProposal: false,
    focusedProposalPending: false,
    guidanceIsDirty: false,
    turnRunning: false,
    ...overrides
  };
}

describe("resolveEscape", () => {
  it("聚焦待审卡且说明非空：只失焦，不清字", () => {
    expect(
      resolveEscape(
        state({ hasFocusedProposal: true, focusedProposalPending: true, guidanceIsDirty: true })
      )
    ).toBe("keep-guidance");
  });

  it("聚焦待审卡且说明为空：取消该条提案", () => {
    expect(resolveEscape(state({ hasFocusedProposal: true, focusedProposalPending: true }))).toBe(
      "cancel-proposal"
    );
  });

  it("审批卡优先于打断：卡待审、turn 也在跑，走卡不走打断", () => {
    expect(
      resolveEscape(
        state({ hasFocusedProposal: true, focusedProposalPending: true, turnRunning: true })
      )
    ).toBe("cancel-proposal");
  });

  it("聚焦的是已裁决卡：跳过它，落回打断", () => {
    expect(
      resolveEscape(
        state({ hasFocusedProposal: true, focusedProposalPending: false, turnRunning: true })
      )
    ).toBe("interrupt");
  });

  it("无卡可管且 turn 在跑：打断", () => {
    expect(resolveEscape(state({ turnRunning: true }))).toBe("interrupt");
  });

  it("什么都没发生：无动作（绝不关工作台、绝不清草稿）", () => {
    expect(resolveEscape(state())).toBe("none");
  });
});

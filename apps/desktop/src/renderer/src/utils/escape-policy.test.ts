import { describe, expect, it } from "vitest";
import { resolveEscape, type EscapeFocusState } from "./escape-policy";

function state(overrides: Partial<EscapeFocusState> = {}): EscapeFocusState {
  return {
    hasFocusedProposal: false,
    focusedProposalPending: false,
    guidanceIsDirty: false,
    turnRunning: false,
    settingsIsOpen: false,
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

describe("resolveEscape 收设置浮层优先级（缺陷①）", () => {
  it("设置浮层开着且回合运行中：先收浮层，而不是打断", () => {
    expect(resolveEscape(state({ settingsIsOpen: true, turnRunning: true }))).toBe("close-overlay");
  });

  it("设置浮层开着但没在跑回合：收浮层", () => {
    expect(resolveEscape(state({ settingsIsOpen: true }))).toBe("close-overlay");
  });

  it("聚焦待审卡且浮层也开着：卡优先，取消该条而不是收浮层", () => {
    expect(
      resolveEscape(
        state({
          hasFocusedProposal: true,
          focusedProposalPending: true,
          settingsIsOpen: true
        })
      )
    ).toBe("cancel-proposal");
  });

  it("说明框有字且浮层开着：先保字（说明框保字 > 收浮层）", () => {
    expect(
      resolveEscape(
        state({
          hasFocusedProposal: true,
          focusedProposalPending: true,
          guidanceIsDirty: true,
          settingsIsOpen: true
        })
      )
    ).toBe("keep-guidance");
  });

  it("浮层没开、回合在跑：照旧打断", () => {
    expect(resolveEscape(state({ settingsIsOpen: false, turnRunning: true }))).toBe("interrupt");
  });
});

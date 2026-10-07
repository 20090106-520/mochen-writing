import { describe, expect, it } from "vitest";
import { resolveEscape, type EscapeFocusState } from "./escape-policy";

function state(overrides: Partial<EscapeFocusState> = {}): EscapeFocusState {
  return {
    hasFocusedProposal: false,
    focusedProposalPending: false,
    guidanceIsDirty: false,
    turnRunning: false,
    findReplaceIsOpen: false,
    settingsIsOpen: false,
    referenceMenuIsOpen: false,
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

  it("菜单开着且回合在跑：先收菜单，绝不越级打断（#106 目标形态 2「Esc 只收菜单」）", () => {
    expect(resolveEscape(state({ referenceMenuIsOpen: true, turnRunning: true }))).toBe(
      "close-reference-menu"
    );
  });

  it("菜单与设置浮层同开：一层一层收，先收菜单（内层优先）", () => {
    expect(
      resolveEscape(state({ referenceMenuIsOpen: true, settingsIsOpen: true, turnRunning: true }))
    ).toBe("close-reference-menu");
  });

  it("聚焦待审卡优先于收菜单：卡上按 Esc 撤的是卡", () => {
    expect(
      resolveEscape(
        state({ hasFocusedProposal: true, focusedProposalPending: true, referenceMenuIsOpen: true })
      )
    ).toBe("cancel-proposal");
  });

  it("菜单没开时一律维持既有裁决（反向用例：多一个字段不能改变旧行为）", () => {
    expect(resolveEscape(state({ referenceMenuIsOpen: false, turnRunning: true }))).toBe(
      "interrupt"
    );
    expect(resolveEscape(state({ referenceMenuIsOpen: false, settingsIsOpen: true }))).toBe(
      "close-overlay"
    );
    expect(resolveEscape(state({}))).toBe("none");
  });

  it("浮层没开、回合在跑：照旧打断", () => {
    expect(resolveEscape(state({ settingsIsOpen: false, turnRunning: true }))).toBe("interrupt");
  });
});

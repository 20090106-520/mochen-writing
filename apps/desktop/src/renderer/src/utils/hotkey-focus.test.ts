import { describe, expect, it } from "vitest";
import {
  deriveHotkeyFocus,
  type ComposerSource,
  type FocusSource,
  type HotkeyFocusSources
} from "./hotkey-focus";

/**
 * 本仓没有 jsdom/happy-dom，故这里一律传**鸭子类型的普通对象**：
 * 焦点判定只碰 tagName / isContentEditable / getAttribute / value 四个成员，
 * 谁都不 instanceof HTMLElement —— 正是这一点让「composer 与文本框互斥」变得可测。
 */
function node(
  options: { tag?: string; editable?: boolean; status?: string; value?: string } = {}
): ComposerSource {
  const status = options.status;
  return {
    tagName: options.tag ?? "TEXTAREA",
    isContentEditable: options.editable ?? false,
    value: options.value ?? "",
    getAttribute(name: string): string | null {
      return name === "data-proposal-status" ? (status ?? null) : null;
    }
  };
}

function plain(options: { tag?: string; editable?: boolean; status?: string } = {}): FocusSource {
  return node(options);
}

function sources(overrides: Partial<HotkeyFocusSources> = {}): HotkeyFocusSources {
  return {
    eventTarget: null,
    activeElement: null,
    composer: null,
    focusedCard: null,
    turnRunning: false,
    isComposing: false,
    hasBook: false,
    tabCount: 0,
    ...overrides
  };
}

describe("deriveHotkeyFocus · composer 与文本框互斥（裁定 G2 / Task 6 派发要点）", () => {
  it("composer 自己就是 textarea：composerIsFocused 真，textInputIsFocused 必须假", () => {
    const composer = node({ value: "改第二段" });
    const focus = deriveHotkeyFocus(
      sources({ composer, eventTarget: composer, activeElement: composer })
    );
    expect(focus.composerIsFocused).toBe(true);
    // 这一条若为真，Task 6 裁定 F1（Tab 排队要求 !textInputIsFocused）就把排队键永远锁死了。
    expect(focus.textInputIsFocused).toBe(false);
    expect(focus.composerHasText).toBe(true);
  });

  it("composer 在 DOM 里但焦点在右栏文稿编辑器：两个标志各归各位", () => {
    const composer = node({ value: "留着没发的草稿" });
    const editor = plain({ tag: "TEXTAREA" });
    const focus = deriveHotkeyFocus(
      sources({ composer, eventTarget: editor, activeElement: editor })
    );
    expect(focus.textInputIsFocused).toBe(true);
    expect(focus.composerIsFocused).toBe(false);
    // composerHasText 只说明框里有字，与焦点无关——Tab 排队的门槛由焦点标志把关。
    expect(focus.composerHasText).toBe(true);
  });

  it("INPUT / SELECT / contenteditable 都算文本框；纯空白草稿不算有文本", () => {
    expect(
      deriveHotkeyFocus(sources({ activeElement: plain({ tag: "DIV", editable: true }) }))
        .textInputIsFocused
    ).toBe(true);
    expect(
      deriveHotkeyFocus(sources({ eventTarget: plain({ tag: "INPUT" }) })).textInputIsFocused
    ).toBe(true);
    expect(
      deriveHotkeyFocus(sources({ eventTarget: plain({ tag: "SELECT" }) })).textInputIsFocused
    ).toBe(true);
    expect(deriveHotkeyFocus(sources({ composer: node({ value: "   " }) })).composerHasText).toBe(
      false
    );
  });

  it("焦点落在说明框（卡内的 textarea）：文本框为真，同时那张卡仍算聚焦且待审", () => {
    const card = plain({ tag: "ARTICLE", status: "pending" });
    const guidance = plain({ tag: "TEXTAREA" });
    const focus = deriveHotkeyFocus(
      sources({
        composer: node(),
        eventTarget: guidance,
        activeElement: guidance,
        focusedCard: card
      })
    );
    expect(focus.textInputIsFocused).toBe(true);
    expect(focus.composerIsFocused).toBe(false);
    expect(focus.proposalIsFocused).toBe(true);
    expect(focus.proposalIsPending).toBe(true);
  });
});

describe("deriveHotkeyFocus · 提案卡状态", () => {
  it("pending 卡聚焦 ⇒ proposalIsFocused 且 proposalIsPending", () => {
    const focus = deriveHotkeyFocus(sources({ focusedCard: plain({ status: "pending" }) }));
    expect(focus.proposalIsFocused).toBe(true);
    expect(focus.proposalIsPending).toBe(true);
  });

  it("同一张卡换成 expired ⇒ 聚焦仍真，pending 必须假（护栏 4：审批四键按不出去）", () => {
    const focus = deriveHotkeyFocus(sources({ focusedCard: plain({ status: "expired" }) }));
    expect(focus.proposalIsFocused).toBe(true);
    expect(focus.proposalIsPending).toBe(false);
  });

  it("没有聚焦卡 ⇒ 两个标志都假", () => {
    const focus = deriveHotkeyFocus(sources({ activeElement: plain({ tag: "ARTICLE" }) }));
    expect(focus.proposalIsFocused).toBe(false);
    expect(focus.proposalIsPending).toBe(false);
  });
});

describe("deriveHotkeyFocus · store 侧标志原样透传", () => {
  it("turnRunning / isComposing / hasBook / tabCount 一字不改", () => {
    const focus = deriveHotkeyFocus(
      sources({ turnRunning: true, isComposing: true, hasBook: true, tabCount: 7 })
    );
    expect(focus).toMatchObject({
      turnRunning: true,
      isComposing: true,
      hasBook: true,
      tabCount: 7
    });
  });

  it("什么都没有（无焦点、无 composer、无卡）⇒ 全 false / 0", () => {
    expect(deriveHotkeyFocus(sources())).toEqual({
      composerIsFocused: false,
      composerHasText: false,
      textInputIsFocused: false,
      proposalIsFocused: false,
      proposalIsPending: false,
      turnRunning: false,
      isComposing: false,
      hasBook: false,
      tabCount: 0
    });
  });
});

import { describe, expect, it } from "vitest";
import { resolveHotkey, type HotkeyFocus, type HotkeyMods } from "./hotkeys";

function focus(overrides: Partial<HotkeyFocus> = {}): HotkeyFocus {
  return {
    composerIsFocused: false,
    composerHasText: false,
    textInputIsFocused: false,
    proposalIsFocused: false,
    proposalIsPending: false,
    turnRunning: false,
    isComposing: false,
    hasBook: false,
    tabCount: 0,
    ...overrides
  };
}

function mods(overrides: Partial<HotkeyMods> = {}): HotkeyMods {
  return { ctrl: false, shift: false, alt: false, meta: false, ...overrides };
}

describe("resolveHotkey · 输入法合成闸门（M4）", () => {
  it("isComposing 为真时连 Enter/Esc 都一律 none：候选框回车不提交", () => {
    const composing = focus({ composerIsFocused: true, composerHasText: true, isComposing: true });
    expect(resolveHotkey(composing, "Enter", mods()).action).toBe("none");
    expect(resolveHotkey(focus({ isComposing: true }), "Escape", mods()).action).toBe("none");
    expect(resolveHotkey(focus({ isComposing: true }), "b", mods({ ctrl: true })).action).toBe(
      "none"
    );
  });
});

describe("resolveHotkey · composer 区", () => {
  it("Enter 无修饰、composer 有焦点、未在合成、!turnRunning ⇒ submit", () => {
    expect(resolveHotkey(focus({ composerIsFocused: true }), "Enter", mods()).action).toBe(
      "submit"
    );
  });
  it("Enter 但 turnRunning ⇒ none（要追加指令走 Tab）", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true, turnRunning: true }), "Enter", mods()).action
    ).toBe("none");
  });
  it("Shift+Enter 与 Ctrl+J ⇒ newline", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true }), "Enter", mods({ shift: true })).action
    ).toBe("newline");
    expect(
      resolveHotkey(focus({ composerIsFocused: true }), "j", mods({ ctrl: true })).action
    ).toBe("newline");
  });
  it("Tab：运行中有文本 ⇒ queue；其余 ⇒ none（保焦点移动）", () => {
    expect(
      resolveHotkey(
        focus({ composerIsFocused: true, composerHasText: true, turnRunning: true }),
        "Tab",
        mods()
      ).action
    ).toBe("queue");
    expect(resolveHotkey(focus({ composerHasText: true }), "Tab", mods()).action).toBe("none");
  });
});

describe("resolveHotkey · Esc 委托", () => {
  it("Escape 一律 delegated（Esc 的裁决仍在 resolveEscape，不在这里复制）", () => {
    expect(resolveHotkey(focus({ hasBook: true }), "Escape", mods()).action).toBe("delegated");
  });
});

describe("resolveHotkey · 审批四键", () => {
  it("聚焦待审卡、不在文本框：y/a/p/d 各给一个审批态", () => {
    const f = focus({ proposalIsFocused: true, proposalIsPending: true });
    expect(resolveHotkey(f, "y", mods()).action).toBe("approve-once");
    expect(resolveHotkey(f, "a", mods()).action).toBe("approve-session");
    expect(resolveHotkey(f, "p", mods()).action).toBe("approve-prefix");
    expect(resolveHotkey(f, "d", mods()).action).toBe("deny-guidance");
  });
  it("卡已非 pending（含 expired）⇒ 四键全 none", () => {
    const f = focus({ proposalIsFocused: true, proposalIsPending: false });
    for (const k of ["y", "a", "p", "d"]) expect(resolveHotkey(f, k, mods()).action).toBe("none");
  });
  it("文本框有焦点时四键全 none（编辑态护栏）", () => {
    const f = focus({ proposalIsFocused: true, proposalIsPending: true, textInputIsFocused: true });
    for (const k of ["y", "a", "p", "d"]) expect(resolveHotkey(f, k, mods()).action).toBe("none");
  });
});

describe("resolveHotkey · 全局 Ctrl 族", () => {
  it("Ctrl+B / Ctrl+, 任意焦点生效；Ctrl+PageDown/Up 需有书", () => {
    expect(resolveHotkey(focus(), "b", mods({ ctrl: true })).action).toBe("toggle-left");
    expect(resolveHotkey(focus(), ",", mods({ ctrl: true })).action).toBe("open-settings");
    expect(resolveHotkey(focus({ hasBook: false }), "PageDown", mods({ ctrl: true })).action).toBe(
      "none"
    );
    expect(resolveHotkey(focus({ hasBook: true }), "PageDown", mods({ ctrl: true })).action).toBe(
      "next-tab"
    );
    expect(resolveHotkey(focus({ hasBook: true }), "PageUp", mods({ ctrl: true })).action).toBe(
      "prev-tab"
    );
  });
  it("Ctrl+1..9：越界或无书 ⇒ none；n≤tabCount ⇒ jump-tab 且 tabIndex=n-1", () => {
    expect(resolveHotkey(focus({ hasBook: true, tabCount: 3 }), "3", mods({ ctrl: true }))).toEqual(
      {
        action: "jump-tab",
        tabIndex: 2
      }
    );
    expect(
      resolveHotkey(focus({ hasBook: true, tabCount: 3 }), "9", mods({ ctrl: true })).action
    ).toBe("none");
    expect(
      resolveHotkey(focus({ hasBook: false, tabCount: 3 }), "1", mods({ ctrl: true })).action
    ).toBe("none");
    expect(
      resolveHotkey(focus({ hasBook: true, tabCount: 3 }), "0", mods({ ctrl: true })).action
    ).toBe("none");
  });
});

describe("resolveHotkey · / 开面板", () => {
  it("composer 无焦点、不在文本框、无修饰键 ⇒ open-palette", () => {
    expect(resolveHotkey(focus({ hasBook: true }), "/", mods()).action).toBe("open-palette");
  });
  it("composer 有焦点时 / 只是打字 ⇒ none", () => {
    expect(resolveHotkey(focus({ composerIsFocused: true }), "/", mods()).action).toBe("none");
  });
  it("其余按键 ⇒ none", () => {
    expect(resolveHotkey(focus(), "z", mods()).action).toBe("none");
  });
});

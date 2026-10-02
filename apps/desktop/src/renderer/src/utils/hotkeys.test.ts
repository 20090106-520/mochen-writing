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
  it("Tab 反向：运行中但 composer 是空的 ⇒ none（排队得先有文本）", () => {
    expect(
      resolveHotkey(
        focus({ composerIsFocused: true, composerHasText: false, turnRunning: true }),
        "Tab",
        mods()
      ).action
    ).toBe("none");
  });
  it("Tab 护栏 2 反向：焦点在文稿编辑器里，运行中且 composer 有草稿 ⇒ none（Tab 是缩进，不是排队）", () => {
    expect(
      resolveHotkey(
        focus({ composerHasText: true, turnRunning: true, textInputIsFocused: true }),
        "Tab",
        mods()
      ).action
    ).toBe("none");
  });
});

describe("resolveHotkey · Esc 委托", () => {
  it("裸键 Escape ⇒ delegated（Esc 的三态裁决仍在 resolveEscape，不在这里复制）", () => {
    expect(resolveHotkey(focus({ hasBook: true }), "Escape", mods()).action).toBe("delegated");
  });
  it("带任何修饰的 Escape ⇒ none（Alt+Esc 是 Windows 系统键，Ctrl/Shift/Meta+Esc 不归我们）", () => {
    const f = focus({ hasBook: true, composerIsFocused: true });
    for (const m of [
      { ctrl: true },
      { shift: true },
      { alt: true },
      { meta: true },
      { ctrl: true, shift: true }
    ])
      expect(resolveHotkey(f, "Escape", mods(m)).action).toBe("none");
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
  it("Ctrl+O ⇒ open-book（左栏那颗按钮一直标着这个键位，键必须真的能用）", () => {
    // 没开书时更要能按——这正是「打开作品目录」唯一有用的场合。
    expect(resolveHotkey(focus({ hasBook: false }), "o", mods({ ctrl: true })).action).toBe(
      "open-book"
    );
    // 全局 Ctrl 族先于编辑态判定（护栏 2 白名单），在文本框里也放行。
    expect(
      resolveHotkey(focus({ textInputIsFocused: true, hasBook: true }), "o", mods({ ctrl: true }))
        .action
    ).toBe("open-book");
    expect(resolveHotkey(focus(), "o", mods({ ctrl: true, shift: true })).action).toBe("none");
    expect(resolveHotkey(focus({ isComposing: true }), "o", mods({ ctrl: true })).action).toBe(
      "none"
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
  it("护栏 2 反向：文本框（文稿编辑器/设置输入）里打 / ⇒ none，不开面板", () => {
    expect(
      resolveHotkey(focus({ hasBook: true, textInputIsFocused: true }), "/", mods()).action
    ).toBe("none");
  });
  it("其余按键 ⇒ none", () => {
    expect(resolveHotkey(focus(), "z", mods()).action).toBe("none");
  });
});

describe("resolveHotkey · 修饰键必须参与判定", () => {
  it("Shift+y 落在聚焦待审卡上 ⇒ none（审批四键要纯键）", () => {
    const f = focus({ proposalIsFocused: true, proposalIsPending: true });
    expect(resolveHotkey(f, "y", mods({ shift: true })).action).toBe("none");
  });
  it("Shift+Tab 运行中有草稿 ⇒ none（那是反向焦点移动，不是排队）", () => {
    expect(
      resolveHotkey(
        focus({ composerIsFocused: true, composerHasText: true, turnRunning: true }),
        "Tab",
        mods({ shift: true })
      ).action
    ).toBe("none");
  });
  it("Ctrl+Shift+B ⇒ none（左栏开关只认纯 Ctrl+B）", () => {
    expect(resolveHotkey(focus(), "b", mods({ ctrl: true, shift: true })).action).toBe("none");
  });
  it("Shift+/ （问号）空闲态也不开面板 ⇒ none", () => {
    expect(resolveHotkey(focus({ hasBook: true }), "/", mods({ shift: true })).action).toBe("none");
  });
  it("Ctrl+J 护栏：composer 无焦点 ⇒ none（换行键属于 composer）", () => {
    expect(
      resolveHotkey(
        focus({ composerIsFocused: false, textInputIsFocused: true }),
        "j",
        mods({ ctrl: true })
      ).action
    ).toBe("none");
  });
});

describe("resolveHotkey · 结果对象不共享可变状态", () => {
  it("两条 none 不是同一个引用：改一条不污染另一条", () => {
    const a = resolveHotkey(focus(), "z", mods());
    const b = resolveHotkey(focus(), "x", mods());
    expect(a).not.toBe(b);
    a.action = "submit";
    expect(b.action).toBe("none");
  });
});

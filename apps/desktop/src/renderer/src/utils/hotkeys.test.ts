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
    referenceMenuIsOpen: false,
    submitKey: "enter",
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
  it("Enter 但 turnRunning ⇒ queue（运行中追指令走同一条排队通路，不再静默丢弃）", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true, turnRunning: true }), "Enter", mods()).action
    ).toBe("queue");
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
  it("裸键 Escape ⇒ delegated（Esc 的裁决仍在 resolveEscape，这里不复制）", () => {
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
  it("Ctrl+= / Ctrl+- / Ctrl+0 是界面缩放，三个键面都要认（+ 与 _ 是 Shift 位的同一枚）", () => {
    expect(resolveHotkey(focus(), "=", mods({ ctrl: true })).action).toBe("zoom-in");
    // US 布局上放大是 Ctrl+Shift+=，event.key 已经是 "+" 且 shiftKey 为真：
    // 不许落进面板族被判成 none（那正是「按了没反应」）。
    expect(resolveHotkey(focus(), "+", mods({ ctrl: true, shift: true })).action).toBe("zoom-in");
    expect(resolveHotkey(focus(), "-", mods({ ctrl: true })).action).toBe("zoom-out");
    expect(resolveHotkey(focus(), "_", mods({ ctrl: true, shift: true })).action).toBe("zoom-out");
    expect(resolveHotkey(focus(), "0", mods({ ctrl: true })).action).toBe("zoom-reset");
    // 缩放是全局的：焦点在文稿编辑器里也该放行（与 Ctrl+B 同一款，不属于护栏 2 的编辑键）。
    expect(
      resolveHotkey(focus({ textInputIsFocused: true }), "=", mods({ ctrl: true })).action
    ).toBe("zoom-in");
    // 无修饰的 = - 0 是打字，什么都不是。
    expect(resolveHotkey(focus(), "=", mods({})).action).toBe("none");
    expect(resolveHotkey(focus(), "0", mods({})).action).toBe("none");
    // 合成期间一律不截键（护栏 1 仍然最高）。
    expect(resolveHotkey(focus({ isComposing: true }), "=", mods({ ctrl: true })).action).toBe(
      "none"
    );
  });

  it("Ctrl+O ⇒ open-book（书架空态钮与输入卡书格同走这条通路，键必须真的能用）", () => {
    // 没开书时更要能按——这正是「打开作品目录」唯一有用的场合。
    expect(resolveHotkey(focus({ hasBook: false }), "o", mods({ ctrl: true })).action).toBe(
      "open-book"
    );
    // 全局 Ctrl 族先于编辑态判定（护栏 2 白名单），在文本框里也放行。
    expect(
      resolveHotkey(focus({ textInputIsFocused: true, hasBook: true }), "o", mods({ ctrl: true }))
        .action
    ).toBe("open-book");
    // Ctrl+Shift+O 归大纲面板，但绝不能被当成 Ctrl+O 的开书动作（这层断言的原意）。
    expect(resolveHotkey(focus(), "o", mods({ ctrl: true, shift: true }))).toEqual({
      action: "panel-shortcut",
      panel: "outline"
    });
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
    // Ctrl+0 不再落进「越界数字」那一支：它是界面缩放的复位档（2026-11-11），
    // 而跳页只有 1..9 ——两族在判定层就分开，别让 0 变成「无动作」再被当成越界。
    expect(
      resolveHotkey(focus({ hasBook: true, tabCount: 3 }), "0", mods({ ctrl: true })).action
    ).toBe("zoom-reset");
  });
});

describe("resolveHotkey · 行内引用菜单（#106 裁定 D2/D3）", () => {
  it("菜单开着：Enter 归菜单插入，不再是 submit（连 turnRunning 时也不发）", () => {
    const open = focus({
      composerIsFocused: true,
      composerHasText: true,
      referenceMenuIsOpen: true
    });
    expect(resolveHotkey(open, "Enter", mods()).action).toBe("reference-insert");
    expect(resolveHotkey({ ...open, turnRunning: true }, "Enter", mods()).action).toBe(
      "reference-insert"
    );
  });

  it("菜单开着：↑↓ 是移动高亮；菜单关着时同一对键什么都不是", () => {
    const open = focus({ composerIsFocused: true, referenceMenuIsOpen: true });
    expect(resolveHotkey(open, "ArrowUp", mods()).action).toBe("reference-move-up");
    expect(resolveHotkey(open, "ArrowDown", mods()).action).toBe("reference-move-down");
    expect(resolveHotkey(focus({ composerIsFocused: true }), "ArrowUp", mods()).action).toBe(
      "none"
    );
    expect(resolveHotkey(focus({ composerIsFocused: true }), "Enter", mods()).action).toBe(
      "submit"
    );
  });

  it("裁定 D3：菜单开着 Tab 仍是排队（运行中有草稿），菜单不吃这条既有通路", () => {
    expect(
      resolveHotkey(
        focus({
          composerIsFocused: true,
          composerHasText: true,
          turnRunning: true,
          referenceMenuIsOpen: true
        }),
        "Tab",
        mods()
      ).action
    ).toBe("queue");
    // 非运行态的 Tab 保留焦点移动，菜单同样不劫持。
    expect(
      resolveHotkey(focus({ composerIsFocused: true, referenceMenuIsOpen: true }), "Tab", mods())
        .action
    ).toBe("none");
  });

  it("修饰键仍归原语义：Shift+Enter 换行、Alt+↑ 不动高亮（反向用例）", () => {
    const open = focus({ composerIsFocused: true, referenceMenuIsOpen: true });
    expect(resolveHotkey(open, "Enter", mods({ shift: true })).action).toBe("newline");
    expect(resolveHotkey(open, "ArrowUp", mods({ alt: true })).action).toBe("none");
  });

  it("护栏 1 仍最高：输入法合成期间菜单开着也一律 none（候选框回车不吞键）", () => {
    expect(
      resolveHotkey(
        focus({ composerIsFocused: true, isComposing: true, referenceMenuIsOpen: true }),
        "Enter",
        mods()
      ).action
    ).toBe("none");
  });

  it("焦点不在 composer：菜单即使没关也不接管 Enter（那是别人的输入现场）", () => {
    expect(resolveHotkey(focus({ referenceMenuIsOpen: true }), "Enter", mods()).action).toBe(
      "none"
    );
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

describe("resolveHotkey · ? 开快捷键指南", () => {
  // 键位表里「?」这一枚原先什么都没有：HotkeysPanel.vue 完整渲染着 HOTKEY_GUIDE，
  // 但它只住在设置浮层的「快捷键」页里——屏幕上那张表没有任何一个键能直接跳到它。
  // 真实键盘上 ? 是 Shift+/ 打出来的（event.key === "?"、shiftKey === true），
  // 所以这里放行的是 bare（Ctrl/Alt/Meta 三枚一个都不许按），不是 noMods。
  it("焦点空闲时 ?（Shift+/）⇒ open-help", () => {
    expect(resolveHotkey(focus({ hasBook: true }), "?", mods({ shift: true })).action).toBe(
      "open-help"
    );
  });
  it("不需 Shift 的布局：纯 ? 同样开指南", () => {
    expect(resolveHotkey(focus(), "?", mods()).action).toBe("open-help");
  });
  it("composer 有焦点时 ? 只是打字 ⇒ none", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true }), "?", mods({ shift: true })).action
    ).toBe("none");
  });
  it("护栏 2 反向：文本框（文稿编辑器 / 设置输入）里打 ? ⇒ none，不开指南", () => {
    expect(
      resolveHotkey(focus({ textInputIsFocused: true }), "?", mods({ shift: true })).action
    ).toBe("none");
  });
  it("Ctrl / Alt / Meta + ? 不在键位表 ⇒ none（只认带 Shift 或不带）", () => {
    expect(resolveHotkey(focus(), "?", mods({ ctrl: true, shift: true })).action).toBe("none");
    expect(resolveHotkey(focus(), "?", mods({ alt: true, shift: true })).action).toBe("none");
    expect(resolveHotkey(focus(), "?", mods({ meta: true, shift: true })).action).toBe("none");
  });
  it("护栏 1 反向：输入法合成期间打 ? ⇒ none（候选框里不许截键）", () => {
    expect(resolveHotkey(focus({ isComposing: true }), "?", mods({ shift: true })).action).toBe(
      "none"
    );
  });
  it("/ 的通路没被 ? 吃掉：纯 / 仍是 open-palette", () => {
    expect(resolveHotkey(focus(), "/", mods()).action).toBe("open-palette");
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
  it("Ctrl+Shift+B ⇒ 故事圣经面板，且绝不是左栏开关（左栏只认纯 Ctrl+B）", () => {
    expect(resolveHotkey(focus(), "b", mods({ ctrl: true, shift: true }))).toEqual({
      action: "panel-shortcut",
      panel: "story-bible"
    });
    expect(resolveHotkey(focus(), "b", mods({ ctrl: true })).action).toBe("toggle-left");
  });
  it('键名是 "/" 而带 Shift ⇒ none：/ 那枚仍只认纯键（真问号是 "?"，见 ? 分组）', () => {
    expect(resolveHotkey(focus({ hasBook: true }), "/", mods({ shift: true })).action).toBe("none");
  });
  it("Ctrl+Shift 族七枚各自落到对应面板，且都报得出是哪一枚", () => {
    const expected: Array<[string, string]> = [
      ["f", "search"],
      ["n", "notes"],
      ["t", "templates"],
      ["o", "outline"],
      ["g", "goals"],
      ["b", "story-bible"],
      ["p", "editor-view"]
    ];
    for (const [key, panel] of expected) {
      expect(resolveHotkey(focus(), key, mods({ ctrl: true, shift: true }))).toEqual({
        action: "panel-shortcut",
        panel
      });
    }
  });
  it("Ctrl+Shift 族不认没登记的键 ⇒ none（不许静默吞掉）", () => {
    expect(resolveHotkey(focus(), "q", mods({ ctrl: true, shift: true })).action).toBe("none");
    expect(resolveHotkey(focus(), "k", mods({ ctrl: true, shift: true })).action).toBe("none");
  });
  it("Ctrl+Alt 组合无登记 ⇒ none（专注模式的 Ctrl+Alt+F 已随该功能一起下线）", () => {
    // 反向钉：F 曾是「专注模式」的登记键，功能下线后这里必须回到 none，
    // 而不是留一条指向已删面板的 panel-shortcut（那会 dispatch 到 default 的 never 守卫）。
    expect(resolveHotkey(focus(), "f", mods({ ctrl: true, alt: true })).action).toBe("none");
    expect(resolveHotkey(focus(), "n", mods({ ctrl: true, alt: true })).action).toBe("none");
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

describe("resolveHotkey · 发送键第二档（2026-10-05 设置页新增）", () => {
  it("ctrl-enter 档：裸 Enter ⇒ newline（回车整档让给换行，含 Shift+Enter）", () => {
    const ctrlMode = focus({ composerIsFocused: true, submitKey: "ctrl-enter" });
    expect(resolveHotkey(ctrlMode, "Enter", mods()).action).toBe("newline");
    expect(resolveHotkey(ctrlMode, "Enter", mods({ shift: true })).action).toBe("newline");
  });
  it("ctrl-enter 档：Ctrl+Enter ⇒ submit；turnRunning 时 ⇒ queue（运行中追指令排队，不再丢弃）", () => {
    const running = focus({ composerIsFocused: true, submitKey: "ctrl-enter", turnRunning: true });
    expect(
      resolveHotkey(
        focus({ composerIsFocused: true, submitKey: "ctrl-enter" }),
        "Enter",
        mods({
          ctrl: true
        })
      ).action
    ).toBe("submit");
    expect(resolveHotkey(running, "Enter", mods({ ctrl: true })).action).toBe("queue");
  });
  it("ctrl-enter 档：composer 无焦点时 Ctrl+Enter ⇒ none（发送键属于 composer）", () => {
    expect(
      resolveHotkey(focus({ submitKey: "ctrl-enter" }), "Enter", mods({ ctrl: true })).action
    ).toBe("none");
  });
  it("默认 enter 档：Ctrl+Enter 仍是 none（键位表没有这一条，不因偏好模块引入新语义）", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true }), "Enter", mods({ ctrl: true })).action
    ).toBe("none");
  });
  it("ctrl-enter 档不影响引用菜单：菜单开着时 Enter 仍先改道 reference-insert", () => {
    expect(
      resolveHotkey(
        focus({ composerIsFocused: true, submitKey: "ctrl-enter", referenceMenuIsOpen: true }),
        "Enter",
        mods()
      ).action
    ).toBe("reference-insert");
  });
});

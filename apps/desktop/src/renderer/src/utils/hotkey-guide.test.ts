/// <reference types="node" />
/**
 * hotkey-guide 与判定层的一致性契约：指南表只是给屏幕读的摘要，
 * 判定真身在 utils/hotkeys.ts（键→动作）与 utils/escape-policy.ts（Esc 裁决链）。
 * 每一行 guide 的 needle 必须能在判定层源码里逐字找到——键名抄错、判定层改名没同步，这里红。
 * （源码读取方式同 vue-source-reader：node:fs 直读，无需 jsdom。）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESCAPE_POLICY_SUMMARY, HOTKEY_GUIDE } from "./hotkey-guide";
import { resolveHotkey, type HotkeyFocus } from "./hotkeys";

const UTILS_DIR = fileURLToPath(new URL("./", import.meta.url));
const hotkeysSource = readFileSync(join(UTILS_DIR, "hotkeys.ts"), "utf8");
const escapeSource = readFileSync(join(UTILS_DIR, "escape-policy.ts"), "utf8");

/* 这句优先级是**两边共用的那一条字面量**：escape-policy.ts 头注写它，hotkey-guide 的
 * ESCAPE_POLICY_SUMMARY 也写它，屏幕上那行（HotkeysPanel）渲染的就是后者。
 * 5-㊷ 加了「收查找替换」与「收皮肤浮层」两支——原先这里少两支，红在真机上不是样式问题，
 * 是帮助面板教的收层顺序比实际少一层。写成一份常量（铁律 6），两处断言读同一句。 */
const ESCAPE_PRIORITY =
  "说明框保字 > 取消该条 > 收查找替换 > 收行内引用菜单 > 收皮肤浮层 > 收设置浮层 > 打断 > 无动作";

describe("hotkey-guide 每一行都能在判定层源码里找到锚点", () => {
  it("五个分组每行 needle 逐字命中 hotkeys.ts", () => {
    for (const group of HOTKEY_GUIDE) {
      for (const row of group.rows) {
        if (row.keys === "Esc") {
          // Esc 行的锚点在 escape-policy（裁决链真身），其余行在 hotkeys.ts。
          expect(escapeSource).toContain(row.needle);
        } else {
          expect(
            hotkeysSource,
            `指南「${group.title} · ${row.keys}」的锚点在 utils/hotkeys.ts 里找不到了`
          ).toContain(row.needle);
        }
      }
    }
  });

  it("Esc 裁决链摘要与 escape-policy 的优先级注释逐字同源", () => {
    // escape-policy.ts 头注写了同一句优先级：摘要抄错顺序这里红。
    expect(escapeSource).toContain(ESCAPE_PRIORITY);
    expect(ESCAPE_POLICY_SUMMARY).toBe(ESCAPE_PRIORITY);
    // 层数对不上也不行：摘要少一支，屏幕上教用户的收层顺序就比实际少一层
    // （5-㊷ 之前正是这个形状——实现里有「收查找替换」，摘要没有）。
    // 基准取 `EscapeAction` 的并集，不取实现体：并集是这条链的完整清单，
    // 实现少返回一支时类型关卡自己会红，不需要这里重复把关。
    const union = /export type EscapeAction =([\s\S]*?);/.exec(escapeSource)?.[1] ?? "";
    const actions = [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(
      actions.length,
      `EscapeAction 的并集只数出 ${actions.length} 支（正则或那段注释改了形）`
    ).toBeGreaterThanOrEqual(8);
    expect(ESCAPE_PRIORITY.split(" > "), "摘要层数与 EscapeAction 支数不一致").toHaveLength(
      actions.length
    );
  });

  it("屏显键名不许写「Ctrl+」形态（kbd 用空格分隔，与左栏 <kbd>Ctrl O</kbd> 同款）", () => {
    for (const group of HOTKEY_GUIDE) {
      for (const row of group.rows) {
        expect(row.keys).not.toContain("Ctrl+");
      }
    }
  });

  /**
   * 2026-11-20（批次①）：速查表最后一行原是「Ctrl Alt F → 专注模式」。
   * 那是个**死行**——专注模式 2026-10-05 整条下线（hotkeys.test.ts 已钉住 Ctrl+Alt+F 解析为 none），
   * 而判定层根本没有 Ctrl+Alt 这一族分支（Ctrl+Alt 一律落到 none）。
   * 更阴的是它的 needle 写的是 `k === "f"`，那串字命中的是 **Ctrl+F**（文内查找）那一行——
   * 于是 needle 契约「看着是绿的」，屏上却教着一枚按不出来的键。
   *
   * 这条禁令按**族**钉，而不是按这一行钉：判定层支持的只有裸键 / Ctrl / Ctrl+Shift，
   * 所以速查表里任何一行带 Ctrl+Alt 都是死行。
   */
  it("速查表里不许出现 Ctrl+Alt 组合：判定层没有这一族分支（Ctrl+Alt 落到 none）", () => {
    for (const group of HOTKEY_GUIDE) {
      for (const row of group.rows) {
        expect(
          row.keys,
          `「${group.title} · ${row.keys}」是死行：判定层没有 Ctrl+Alt 这一族，按下去什么都不会发生`
        ).not.toMatch(/Ctrl\s*Alt/i);
      }
    }
  });

  it("已下线的功能不许留在速查表里（专注模式 2026-10-05 整条下线）", () => {
    const labels = HOTKEY_GUIDE.flatMap((group) => group.rows.map((row) => row.label));
    expect(labels.some((label) => label.includes("专注模式"))).toBe(false);
  });

  it("文内查找（Ctrl F）得在表里：判定层有这一条，表漏了作者就无从知道", () => {
    const rows = HOTKEY_GUIDE.flatMap((group) => group.rows);
    const find = rows.find((row) => row.keys === "Ctrl F");
    expect(find, "速查表里没有「Ctrl F」这一行").toBeDefined();
    // 真身确实存在：Ctrl+F 解析成 open-find-replace，不是 none。
    const focus: HotkeyFocus = {
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
      submitKey: "enter"
    };
    expect(
      resolveHotkey(focus, "f", { ctrl: true, shift: false, alt: false, meta: false }).action
    ).toBe("open-find-replace");
  });
});

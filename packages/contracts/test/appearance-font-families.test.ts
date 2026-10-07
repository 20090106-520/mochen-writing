/**
 * 字体族清单（2026-10-06 批次 5-⑧：界面 3→6 档、正文 5→10 档）。
 *
 * 钉的是**三件容易悄悄坏掉的事**：
 * ① 每个族都要有中文标签（界面上摆的是标签，不是 id）；
 * ② 每个族的栈**首尾都要有回退**——栈里一个可识别的族名都没有时，浏览器会掉到
 *    `serif`/`sans-serif` 兜底，于是「选楷体」在某些机器上显示成宋体，而且没有任何报错；
 * ③ 同一族在界面与正文两侧的栈**不许各写一份**（正文里那几族直接引用界面那份），
 *    否则改了一处另一处不跟着，两边字形不一样。
 */
import { describe, expect, it } from "vitest";
import {
  APPEARANCE_EDITOR_FONT_FAMILIES,
  APPEARANCE_EDITOR_FONT_STACKS,
  APPEARANCE_FONT_FAMILY_LABELS,
  APPEARANCE_UI_FONT_FAMILIES,
  APPEARANCE_UI_FONT_STACKS,
  listAppearanceEditorFontFamilyOptions,
  listAppearanceUiFontFamilyOptions,
  resolveAppearanceEditorFontStack,
  resolveAppearanceUiFontStack
} from "../src/appearance.js";

/** 一条字体栈里至少要有一个**不是**通用兜底族的候选，否则等于没指定字体。 */
const GENERIC_ONLY = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui"
]);

function hasRealCandidate(stack: string): boolean {
  return stack
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s !== "")
    .some((family) => !GENERIC_ONLY.has(family.toLowerCase()));
}

describe("界面字体族（6 档）", () => {
  it("每一档都有中文标签，标签不重", () => {
    const labels = APPEARANCE_UI_FONT_FAMILIES.map((f) => APPEARANCE_FONT_FAMILY_LABELS[f]);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      // 标签里不许露出英文 id——界面上摆的是给人看的中文
      expect(label).not.toMatch(/^[a-z-]+$/);
    }
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("每一档的栈里都有真族名（没有就等于没选字体，会静默掉到 sans-serif）", () => {
    for (const family of APPEARANCE_UI_FONT_FAMILIES) {
      expect(
        hasRealCandidate(APPEARANCE_UI_FONT_STACKS[family]),
        `${family} 的栈里没有真族名`
      ).toBe(true);
    }
  });

  it("每一档的栈都收尾在通用族上（最后一项必须是 serif/sans-serif/monospace 之一）", () => {
    for (const family of APPEARANCE_UI_FONT_FAMILIES) {
      const last = APPEARANCE_UI_FONT_STACKS[family].split(",").pop()!.trim().toLowerCase();
      expect(GENERIC_ONLY.has(last), `${family} 的栈没收尾在通用族，收尾是 ${last}`).toBe(true);
    }
  });

  it("中文族名写进去了（KaiTi 这类只有 Windows 认的名字不足以跨平台）", () => {
    // 楷体/仿宋/隶书/幼圆至少要在栈里出现「通用中文名」或另一个平台的族名，
    // 否则只在一台机器上生效。粗判：栈里中文字符数 ≥ 2，或有 3 个以上候选。
    for (const family of ["kai", "fangsong", "li", "youyuan"] as const) {
      const stack = APPEARANCE_EDITOR_FONT_STACKS[family];
      const han = (stack.match(/[一-鿿]/g) ?? []).length;
      const candidates = stack.split(",").length;
      expect(han >= 2 || candidates >= 4, `${family} 的栈只在一台机器上认得`).toBe(true);
    }
  });

  it("六档的栈互不相同（写重了就是「加了等于没加」）", () => {
    const stacks = APPEARANCE_UI_FONT_FAMILIES.map((f) => APPEARANCE_UI_FONT_STACKS[f]);
    expect(new Set(stacks).size).toBe(stacks.length);
  });
});

describe("正文字体族（10 档）", () => {
  it("每一档都有中文标签且不重", () => {
    const labels = APPEARANCE_EDITOR_FONT_FAMILIES.map((f) => APPEARANCE_FONT_FAMILY_LABELS[f]);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("每一档的栈里都有真族名", () => {
    for (const family of APPEARANCE_EDITOR_FONT_FAMILIES) {
      expect(
        hasRealCandidate(APPEARANCE_EDITOR_FONT_STACKS[family]),
        `${family} 的栈里没有真族名`
      ).toBe(true);
    }
  });

  it("与界面共用的那几档，**引用**界面那份栈而不是各写一份（铁律 6）", () => {
    for (const shared of ["sans", "yuan", "hei", "mono"] as const) {
      expect(APPEARANCE_EDITOR_FONT_STACKS[shared]).toBe(APPEARANCE_UI_FONT_STACKS[shared]);
    }
  });

  it("十档的栈互不相同", () => {
    const stacks = APPEARANCE_EDITOR_FONT_FAMILIES.map((f) => APPEARANCE_EDITOR_FONT_STACKS[f]);
    expect(new Set(stacks).size).toBe(stacks.length);
  });

  it("宋/楷/仿宋三档不许指向同一个栈（那是三档里两档等于没加）", () => {
    const song = APPEARANCE_EDITOR_FONT_STACKS.song;
    expect(APPEARANCE_EDITOR_FONT_STACKS.kai).not.toBe(song);
    expect(APPEARANCE_EDITOR_FONT_STACKS.fangsong).not.toBe(song);
  });
});

describe("选项列表与解析", () => {
  it("选项列表的条数与族表一致（界面上摆的每一档都要有标签与栈）", () => {
    const ui = listAppearanceUiFontFamilyOptions();
    const editor = listAppearanceEditorFontFamilyOptions();
    expect(ui).toHaveLength(APPEARANCE_UI_FONT_FAMILIES.length);
    expect(editor).toHaveLength(APPEARANCE_EDITOR_FONT_FAMILIES.length);
    for (const option of [...ui, ...editor]) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.stack.length).toBeGreaterThan(0);
    }
  });

  it("认不出来的值退回默认档，不抛也不返回空串（设置文件可能被人手改过）", () => {
    for (const bad of [undefined, "", "nope", 123, null, {}]) {
      expect(resolveAppearanceUiFontStack(bad as string | undefined).length).toBeGreaterThan(0);
      expect(resolveAppearanceEditorFontStack(bad as string | undefined).length).toBeGreaterThan(0);
    }
  });

  it("默认档没有变（system / song）——改档位表不许动默认值", () => {
    expect(resolveAppearanceUiFontStack(undefined)).toBe(APPEARANCE_UI_FONT_STACKS.system);
    expect(resolveAppearanceEditorFontStack(undefined)).toBe(APPEARANCE_EDITOR_FONT_STACKS.song);
  });
});

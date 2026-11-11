/**
 * 界面字号档（2026-11-11）。
 *
 * 纯函数：给定当前字号与方向，返回下一档。三条边界是这次的重点——
 * 顶到底不许回绕、历史遗留的非档位值先吸附、平手往小走（一次只跳一档）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stepUiFontSize, UI_FONT_SIZE_RESET, UI_FONT_SIZE_STEPS } from "./ui-font-size";

const src = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("界面字号阶梯", () => {
  it("七档是 12 / 13 / 14 / 15 / 16 / 18 / 20，且复位档在档上", () => {
    expect([...UI_FONT_SIZE_STEPS]).toEqual([12, 13, 14, 15, 16, 18, 20]);
    expect(UI_FONT_SIZE_STEPS).toContain(UI_FONT_SIZE_RESET);
  });

  it("逐档步进：+1 走下一档，-1 走上一档", () => {
    expect(stepUiFontSize(12, 1)).toBe(13);
    expect(stepUiFontSize(15, 1)).toBe(16);
    expect(stepUiFontSize(16, 1)).toBe(18); // 16→18 是全表最大的一跳，仍是「一档」
    expect(stepUiFontSize(20, -1)).toBe(18);
    expect(stepUiFontSize(14, -1)).toBe(13);
  });

  it("两头钉死，不回绕：到底再按一次还是那一档", () => {
    expect(stepUiFontSize(20, 1)).toBe(20);
    expect(stepUiFontSize(12, -1)).toBe(12);
  });

  it("历史值先吸附再走：契约允许 10~24，档外表按最近档算，平手往小", () => {
    // 13.5 距 13 / 14 各 0.5 ⇒ 平手取小（13），再 +1 ⇒ 14：一次只升一档。
    expect(stepUiFontSize(13.5, 1)).toBe(14);
    // 10 比首档还小 ⇒ 吸附到 12，再 -1 仍是 12。
    expect(stepUiFontSize(10, -1)).toBe(12);
    expect(stepUiFontSize(24, 1)).toBe(20);
    // 17 距 16 / 18 各 1 ⇒ 平手往小 ⇒ 16，再 +1 ⇒ 18。
    expect(stepUiFontSize(17, 1)).toBe(18);
  });
});

describe("接线：外观页与键盘缩放共用同一张表", () => {
  it("外观页不再自建一份数组", () => {
    const panel = src("../components/AppearancePanel.vue");
    expect(panel).toContain("const UI_FONT_SIZE_OPTIONS = UI_FONT_SIZE_STEPS;");
    expect(panel).not.toMatch(/UI_FONT_SIZE_OPTIONS = \[\s*12,\s*13/);
  });

  it("Ctrl+= / - / 0 在判定层就落成三个动作，且排在面板族之前", () => {
    const hotkeys = src("./hotkeys.ts");
    expect(hotkeys).toContain('if (k === "=" || k === "+") return { action: "zoom-in" };');
    expect(hotkeys).toContain('if (k === "-" || k === "_") return { action: "zoom-out" };');
    expect(hotkeys).toContain('if (k === "0") return { action: "zoom-reset" };');
    // Ctrl+Shift+= 的 key 是 "+"，若先落进 `if (mods.shift)` 面板族，放大键永远按不出来。
    const zoomAt = hotkeys.indexOf('if (k === "=" || k === "+")');
    const panelAt = hotkeys.indexOf("if (mods.shift) {");
    expect(zoomAt).toBeGreaterThan(0);
    expect(panelAt).toBeGreaterThan(zoomAt);
  });

  it("派发同时写两套皮肤（只写一套时换肤字号会跳回去）", () => {
    const shell = src("../composables/useHotkeys.ts");
    expect(shell).toContain('stepUiFontSize(current, action === "zoom-in" ? 1 : -1)');
    expect(shell).toMatch(/light: \{ \.\.\.appearance\.settings\.light, uiFontSize: next \}/);
    expect(shell).toMatch(/dark: \{ \.\.\.appearance\.settings\.dark, uiFontSize: next \}/);
    // 已经顶到头就不写盘（否则每次按键都发一遍 IPC，还会闪一下）。
    expect(shell).toContain("if (next === current) return;");
  });
});

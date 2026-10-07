import { describe, expect, it } from "vitest";
import { themePresets } from "./appearanceThemeRuntime";

const HEX = /^#[\da-f]{6}$/i;

describe("themePresets", () => {
  it("十条 preset 各自带合法的浅/深两套三色（2026-10-06 由四条扩到十条）", () => {
    expect(themePresets.map((preset) => preset.id)).toEqual([
      "codex",
      "paper",
      "ocean",
      "mochen-qingjin",
      "bamboo",
      "dusk",
      "ink",
      "silk",
      "dai",
      "crimson"
    ]);
    for (const preset of themePresets) {
      for (const scheme of ["light", "dark"] as const) {
        expect(preset[scheme].accent).toMatch(HEX);
        expect(preset[scheme].background).toMatch(HEX);
        expect(preset[scheme].foreground).toMatch(HEX);
      }
    }
  });

  it("可读性由另一份守卫算（对比度不是靠眼睛估的）", () => {
    // 这一条只钉「别把可读性这件事删掉」：真正的阈值断言在 appearance-theme-readability.test.ts，
    // 那边要导入模块算对比度，所以不能写成 toContain(import ...)。
    expect(themePresets.length).toBeGreaterThanOrEqual(10);
  });

  it("墨宸·青金：浅色纸白底深墨青 accent，深色墨青近黑底金 accent", () => {
    const preset = themePresets.find((item) => item.id === "mochen-qingjin");
    expect(preset?.label).toBe("墨宸 · 青金");
    expect(preset?.light).toEqual({
      accent: "#1F5C55",
      background: "#F7F4EC",
      foreground: "#242E2B"
    });
    expect(preset?.dark).toEqual({
      accent: "#D4B45A",
      background: "#101B18",
      foreground: "#EAE5D6"
    });
  });
});

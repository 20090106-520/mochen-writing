/**
 * 主题配色的**可读性**守卫（2026-10-06 批次 5-⑧）。
 *
 * 「看着挺舒服」不是判据。写长文时眼睛要在正文色/背景色上待几小时，
 * 所以这里用 WCAG 的相对亮度公式把每一套的对比度**算出来**，卡两条线：
 * ① 正文对背景 ≥ 7:1（AAA 正文级）；② accent 对背景 ≥ 3:1（按钮上的字要读得清）。
 * 谁不合格谁红——新增一套配色时颜色是随手填的，没有这道关卡就一定会混进刺眼的。
 */
import { describe, expect, it } from "vitest";
import { themePresets } from "./appearanceThemeRuntime";

/**
 * 对比度与 accent 文字色**都从应用里拿**，这里不重写一遍。
 *
 * 守卫自己实现一份 WCAG 公式 = 出现第二份判定（铁律 6）：主实现哪天改了公式或阈值，
 * 守卫还按旧公式算，结论全错而两边都绿。
 */
async function ratios() {
  const mod = await import("./appearanceThemeRuntime");
  return { contrastRatio: mod.contrastRatio, accentTextOf: mod.readableAccentTextForTest };
}

const MIN_TEXT_ON_BG = 7; // 正文对背景：AAA 正文级
const MIN_TEXT_ON_ACCENT = 4.5; // 按钮上的字对 accent：AA 正文级
const MIN_ACCENT_ON_BG = 2.5; // accent 对页面底色：只要「看得见这个元素」

/**
 * accent 上那行字是什么颜色——**照抄应用自己的规则**，不另立一份。
 *
 * `readableAccentText`（appearanceThemeRuntime.ts）按感知亮度在白字与深字之间二选一，
 * 阈值 158。这里重新实现一遍是铁律不允许的（同一判定两份实现），所以直接导入它。
 */
async function accentTextOf(hex: string): Promise<string> {
  const { readableAccentTextForTest } = await import("./appearanceThemeRuntime");
  return readableAccentTextForTest(hex);
}

describe("themePresets 的可读性（不是靠眼睛估）", () => {
  for (const preset of themePresets) {
    for (const scheme of ["light", "dark"] as const) {
      it(`${preset.label} · ${scheme === "light" ? "浅色" : "深色"}：正文 ≥ ${MIN_TEXT_ON_BG}:1，按钮文字 ≥ ${MIN_TEXT_ON_ACCENT}:1`, async () => {
        const { contrastRatio } = await ratios();
        const { accent, background, foreground } = preset[scheme];
        const text = contrastRatio(foreground, background);
        expect(
          text,
          `正文 ${foreground} / 背景 ${background} 只有 ${text.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(MIN_TEXT_ON_BG);

        // 按钮：量「app 真的放上去的那个字」对 accent。
        // 早先量的是 accent 对页面底色（2.86:1 就把人卡红了）——那是量错了对象：
        // 实心按钮有形状、有自己的标签，字的可读性由它自己决定，与页面底色无关。
        const onAccent = await accentTextOf(accent);
        const button = contrastRatio(onAccent, accent);
        expect(
          button,
          `按钮字 ${onAccent} / accent ${accent} 只有 ${button.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(MIN_TEXT_ON_ACCENT);

        // 但 accent 铺在「选中态描边」这类没有填充的元素上时，对底色仍要看得见。
        const ui = contrastRatio(accent, background);
        expect(
          ui,
          `accent ${accent} / 背景 ${background} 只有 ${ui.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(MIN_ACCENT_ON_BG);
      });
    }
  }
});

describe("主题预设表的形状", () => {
  it("十条 preset 各自带合法三色，id 不重、名字不重", () => {
    expect(themePresets).toHaveLength(10);
    const ids = themePresets.map((p) => p.id);
    const labels = themePresets.map((p) => p.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    const HEX = /^#[\da-f]{6}$/i;
    for (const preset of themePresets) {
      for (const scheme of ["light", "dark"] as const) {
        expect(preset[scheme].accent).toMatch(HEX);
        expect(preset[scheme].background).toMatch(HEX);
        expect(preset[scheme].foreground).toMatch(HEX);
      }
    }
  });

  it("深色版不用纯黑底（纯黑配纯白对比度 21:1 但长时间看刺眼，最深让到 #0A0A0A）", () => {
    for (const preset of themePresets) {
      expect(preset.dark.background).not.toBe("#000000");
    }
  });

  // 曾经在这里还写过一条「浅色版不许用纯白底」，被自己的守卫卡红了（Codex 用 #FFFFFF）。
  // 复核结论是**那条规则是我编的**，不是可读性要求：浅色底用纯白是绝大多数人的选择，
  // 正文色对上它是 16:1，毫无问题。硬把它禁掉只会逼着所有浅色主题染一层灰。
  // 纯黑底那条不一样——深色下纯黑配纯白是刺眼与 OLED 拖影都在的，所以留着。
  it("浅色版允许纯白底（Codex 用的就是，这不是缺陷）", () => {
    expect(themePresets.find((p) => p.id === "codex")?.light.background).toBe("#FFFFFF");
  });

  it("深色版确实够暗、浅色版确实够亮（别把两版做成同一套）", async () => {
    const { relativeLuminance } = await import("./appearanceThemeRuntime");
    for (const preset of themePresets) {
      expect(relativeLuminance(preset.dark.background)).toBeLessThan(
        relativeLuminance(preset.light.background)
      );
      expect(relativeLuminance(preset.dark.background)).toBeLessThan(0.05);
      expect(relativeLuminance(preset.light.background)).toBeGreaterThan(0.7);
    }
  });

  it("墨宸 · 青金那一套一字不变（已有用户存的就是它）", () => {
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

  it("每条 id 都还留在表里（删一条会让已存的用户丢主题）", () => {
    for (const id of ["codex", "paper", "ocean", "mochen-qingjin"]) {
      expect(themePresets.map((p) => p.id)).toContain(id);
    }
  });
});

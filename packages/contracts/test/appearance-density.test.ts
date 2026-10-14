/**
 * 界面密度档（2026-10-15 设计稿对表 Wave 3，来自变体 B「密度」）。
 *
 * 这一档管的是**界面 chrome 的节奏**（导航行、页签、chip、卡片内距那一族的尺寸），
 * 不管正文版式——行距、字号、列宽已经有「写作」页那三档（`--editor-leading` /
 * `--editor-font-size` / `--editor-measure`），在这里再摆一档就是同一件事两份真相。
 *
 * 钉三件会悄悄坏掉的事：
 * ① 老 JSON 没有这个字段时**解析得动**并退到 `standard`——这条通路一旦断，
 *    用户的整份 appearance.json 会被判非法，而主进程那边是「坏了退默认」，
 *    症状是「我存过的配色全没了」；
 * ② 档位只有两档且 `standard` 排第一（它同时是出厂值与 DOM 上那个属性的值，
 *    渲染层那边按名字写 `data-density`，名字对不上 CSS 就不显形）；
 * ③ 非法值必须在**落盘那一刻**被拒，而不是让它流进 CSS 属性里。
 */
import { describe, expect, it } from "vitest";
import {
  APPEARANCE_DENSITIES,
  AppearanceDensitySchema,
  AppearanceSettingsSchema,
  createDefaultAppearanceSettings,
  DEFAULT_APPEARANCE_DENSITY
} from "../src/appearance.js";

describe("界面密度档 · 契约形状", () => {
  it("只有标准与紧凑两档，标准排第一并且就是出厂值", () => {
    expect(APPEARANCE_DENSITIES).toEqual(["standard", "compact"]);
    expect(DEFAULT_APPEARANCE_DENSITY).toBe("standard");
    expect(createDefaultAppearanceSettings().density).toBe("standard");
  });

  it("老 JSON 少这个字段时解析得动，补的是标准档", () => {
    const legacy = { ...createDefaultAppearanceSettings() } as Record<string, unknown>;
    delete legacy.density;
    const parsed = AppearanceSettingsSchema.safeParse(legacy);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.success && parsed.data.density).toBe("standard");
  });

  it("非法档位落盘前就被拒，不会流进 CSS", () => {
    const broken = { ...createDefaultAppearanceSettings(), density: "huge" };
    expect(AppearanceSettingsSchema.safeParse(broken).success).toBe(false);
  });

  it("枚举本身也认得同样宽严：空串与大小写变体都不算数", () => {
    expect(AppearanceDensitySchema.safeParse("").success).toBe(false);
    expect(AppearanceDensitySchema.safeParse("Compact").success).toBe(false);
    expect(AppearanceDensitySchema.safeParse("compact").success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_TONES,
  DEFAULT_APPEARANCE_SKIN_ID,
  createDefaultAppearanceSettings
} from "@mochen/contracts";
import { resolveTitleBarOverlayColors, resolveTitleBarPreferDark } from "./title-bar.js";

describe("title-bar · 窗控叠加区配色跟主题走", () => {
  it("preferDark：system 跟随系统，light/dark 直接定", () => {
    expect(resolveTitleBarPreferDark("system", true)).toBe(true);
    expect(resolveTitleBarPreferDark("system", false)).toBe(false);
    expect(resolveTitleBarPreferDark("light", true)).toBe(false);
    expect(resolveTitleBarPreferDark("dark", false)).toBe(true);
  });

  /**
   * 出厂默认的三色在 2026-10-08 第二刀换了人：原来是那套**没有画面的** codex 素面配色
   * （`#FFFFFF` / `#17191C`），素面一族整族删除之后，出厂默认只能是广场第一套带画皮肤
   * （`DEFAULT_APPEARANCE_SKIN_ID` = 汐 · 昼阁）。
   *
   * 【这两条为什么改成「跟 DEFAULT_APPEARANCE_TONES 对照」而不是写死新色值】
   * 写死就变成第二份真相：皮肤表哪天换第一套，contracts 的默认色会跟着改，
   * 而这里还钉着上一个色值——红是红了，报的却是「title-bar 配错了」，病因在表那头。
   * 现在钉的是**这条通路**：叠加区取的必须正是 contracts 的出厂三色，一色都不许自己编。
   * 而「contracts 的出厂三色 == 皮肤表第一套」由
   * `composables/appearance-skins.test.ts` 的「出厂默认」那一组逐字段钉住。
   */
  it("浅色主题：默认配置取 light 的背景做底、前景做符号色", () => {
    const settings = createDefaultAppearanceSettings();
    expect(settings.light.skin, "出厂默认已经不是广场第一套，这条对照要跟着改").toBe(
      DEFAULT_APPEARANCE_SKIN_ID
    );
    expect(resolveTitleBarOverlayColors(settings, false)).toEqual({
      color: DEFAULT_APPEARANCE_TONES.light.background,
      symbolColor: DEFAULT_APPEARANCE_TONES.light.foreground
    });
  });

  it("深色主题：取 dark 的一套，窗控不悬在浅底上", () => {
    const settings = createDefaultAppearanceSettings();
    expect(resolveTitleBarOverlayColors(settings, true)).toEqual({
      color: DEFAULT_APPEARANCE_TONES.dark.background,
      symbolColor: DEFAULT_APPEARANCE_TONES.dark.foreground
    });
    // 深浅两版必须仍是两套值——写成同一个就是「深色下窗控悬在浅底上」。
    expect(DEFAULT_APPEARANCE_TONES.dark.background).not.toBe(
      DEFAULT_APPEARANCE_TONES.light.background
    );
  });

  it("自定义主题改了配色，叠加区跟着变，不偷读默认值", () => {
    const settings = createDefaultAppearanceSettings();
    settings.dark = { ...settings.dark, background: "#101418", foreground: "#DCE3EA" };
    expect(resolveTitleBarOverlayColors(settings, true)).toEqual({
      color: "#101418",
      symbolColor: "#DCE3EA"
    });
  });
});

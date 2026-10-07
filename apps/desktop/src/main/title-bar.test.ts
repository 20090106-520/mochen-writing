import { describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings } from "@mochen/contracts";
import { resolveTitleBarOverlayColors, resolveTitleBarPreferDark } from "./title-bar.js";

describe("title-bar · 窗控叠加区配色跟主题走", () => {
  it("preferDark：system 跟随系统，light/dark 直接定", () => {
    expect(resolveTitleBarPreferDark("system", true)).toBe(true);
    expect(resolveTitleBarPreferDark("system", false)).toBe(false);
    expect(resolveTitleBarPreferDark("light", true)).toBe(false);
    expect(resolveTitleBarPreferDark("dark", false)).toBe(true);
  });

  it("浅色主题：默认配置取 light 的背景做底、前景做符号色", () => {
    const settings = createDefaultAppearanceSettings();
    expect(resolveTitleBarOverlayColors(settings, false)).toEqual({
      color: "#FFFFFF",
      symbolColor: "#1A1C1F"
    });
  });

  it("深色主题：取 dark 的一套，窗控不悬在浅底上", () => {
    const settings = createDefaultAppearanceSettings();
    expect(resolveTitleBarOverlayColors(settings, true)).toEqual({
      color: "#17191C",
      symbolColor: "#F3F4F6"
    });
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

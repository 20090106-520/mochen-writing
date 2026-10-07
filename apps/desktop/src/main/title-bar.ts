import type { AppearanceMode, AppearanceSettings } from "@mochen/contracts";

/** 窗控叠加区（右上角 —□×）的配色：底色 + 符号色。 */
export interface TitleBarOverlayColors {
  color: string;
  symbolColor: string;
}

/** 外观的 mode 解析成「用哪套主题」：system 跟随系统深浅，light/dark 直接定。 */
export function resolveTitleBarPreferDark(mode: AppearanceMode, systemDark: boolean): boolean {
  if (mode === "system") return systemDark;
  return mode === "dark";
}

/** 叠加区配色取自主题本身：背景做底、前景做符号色——窗控按钮不悬在错色上。 */
export function resolveTitleBarOverlayColors(
  settings: AppearanceSettings,
  preferDark: boolean
): TitleBarOverlayColors {
  const theme = preferDark ? settings.dark : settings.light;
  return { color: theme.background, symbolColor: theme.foreground };
}

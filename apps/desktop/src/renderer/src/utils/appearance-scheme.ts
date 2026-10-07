import type { AppearanceColorScheme, AppearanceMode } from "@mochen/contracts";

/**
 * mode → 实际生效的配色方案。system 跟随系统布尔，light/dark 原样。
 * 唯一真身：App.vue 的 matchMedia 只喂布尔，判定在这里可单测。
 */
export function resolveColorScheme(
  mode: AppearanceMode,
  prefersDark: boolean
): AppearanceColorScheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/**
 * 密度档的运行时落点（2026-10-15 Wave 3）。
 *
 * `density-tier.test.ts` 钉的是 CSS 与源码之间的对表；这份钉的是**另一头**：
 * 设置里那一档真的变成 `<html>` 上的属性，而且切回来时属性跟着变回去。
 * 这一条只有真跑一次才验得出来——源码里写着 `dataset.density` 而传进来的值是
 * `undefined`（比如 App.vue 忘了带）时，字面量检索全绿，屏幕上却永远不紧凑。
 */
import { describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings } from "@mochen/contracts";
import { applyAppearanceThemeToDocument } from "./appearanceThemeRuntime";

interface FakeRoot {
  dataset: Record<string, string | undefined>;
  style: { colorScheme: string; setProperty(name: string, value: string): void };
}

function withFakeDocument(run: (root: FakeRoot) => void): void {
  const root: FakeRoot = {
    dataset: {},
    style: { colorScheme: "", setProperty: (): void => undefined }
  };
  const fake = {
    documentElement: root,
    querySelector: (): null => null
  };
  const previous = globalThis.document;
  // 运行时读的是全局 `document`，node 环境里本就没有；临时挂上再摘掉，用例之间不留残影。
  (globalThis as { document: unknown }).document = fake;
  try {
    run(root);
  } finally {
    (globalThis as { document: unknown }).document = previous;
  }
}

describe("applyAppearanceThemeToDocument · 密度落进 data-density", () => {
  it("紧凑档写的是 compact，标准档写的是 standard（两档都写属性，不靠摘属性）", () => {
    const settings = createDefaultAppearanceSettings();
    withFakeDocument((root) => {
      applyAppearanceThemeToDocument({
        scheme: "light",
        theme: settings.light,
        uiFontFamily: settings.uiFontFamily,
        editorFontFamily: settings.editorFontFamily,
        density: "compact"
      });
      expect(root.dataset.density).toBe("compact");
    });
    withFakeDocument((root) => {
      applyAppearanceThemeToDocument({
        scheme: "light",
        theme: settings.light,
        uiFontFamily: settings.uiFontFamily,
        editorFontFamily: settings.editorFontFamily,
        density: "standard"
      });
      expect(root.dataset.density).toBe("standard");
    });
  });

  it("深浅两档都带密度：换主题不会把这一档刷回出厂值", () => {
    const settings = createDefaultAppearanceSettings();
    for (const scheme of ["light", "dark"] as const) {
      withFakeDocument((root) => {
        applyAppearanceThemeToDocument({
          scheme,
          theme: settings[scheme],
          uiFontFamily: settings.uiFontFamily,
          editorFontFamily: settings.editorFontFamily,
          density: "compact"
        });
        expect(root.dataset.theme).toBe(scheme);
        expect(root.dataset.density).toBe("compact");
      });
    }
  });
});

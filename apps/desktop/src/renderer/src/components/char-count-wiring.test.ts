import { describe, expect, it } from "vitest";
import { listComponentFiles, scriptSource, templateSource } from "../utils/vue-source-reader";

/**
 * 字数格式化的接线（判定住在 `utils/char-count.ts`，那边 5 条纯函数用例）。
 *
 * 扫描总单里这一条是"同一本书在不同面板显示成不同字数"：`formatChars` 在五处各写一份，
 * 万位有的 `.toFixed(1)` 有的 `.toFixed(2)`，有的带千位分隔符有的不带，大纲还独有一份「千字」档。
 * 这里钉的是：那五处都改调同一份，且全仓不再有第二个 `function formatChars`。
 */
const PANELS = [
  "OutlinePanel.vue",
  "ProjectSettingsPanel.vue",
  "ProjectSwitcher.vue",
  "WordCountPanel.vue"
] as const;

describe("字数只有一份口径", () => {
  for (const name of PANELS) {
    it(`${name} 调的是 utils 那一份，本地那份已删`, () => {
      const script = scriptSource(`components/${name}`);
      // 调用点全在模板里，脚本段只需要把那一份引进来——所以两处分开钉。
      expect(script).toContain('import { formatCharCount } from "../utils/char-count";');
      expect(script).not.toMatch(/function\s+formatChars\s*\(/);
      // 「千字」档只在大纲那份里出现过；统一口径后任何面板都不许再说千字
      expect(script).not.toContain("千字");
      expect(templateSource(`components/${name}`)).toContain("formatCharCount(");
      expect(templateSource(`components/${name}`)).not.toContain("formatChars(");
    });
  }

  it("全仓普查：渲染层再没有第二份 formatChars 定义", () => {
    const offenders = listComponentFiles()
      .map((file) => ({ file, script: scriptSource(file) }))
      .filter((o) => /function\s+formatChars\s*\(/.test(o.script))
      .map((o) => o.file);
    expect(offenders.join(", ")).toBe("");
  });

  it("普查有鉴别力：同一份正则认得出被删掉的那种写法", () => {
    expect(/function\s+formatChars\s*\(/.test("function formatChars(n: number): string {")).toBe(
      true
    );
    expect(/function\s+formatChars\s*\(/.test("const formatCharCount = formatCharCount;")).toBe(
      false
    );
  });
});

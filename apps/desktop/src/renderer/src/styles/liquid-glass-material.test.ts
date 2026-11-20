/**
 * 液态玻璃的**材质**守卫（2026-11-20 · 对话区材质刀）。
 *
 * `components/liquid-glass-guard.test.ts` 管的是「参数只有一处定义 / 只给浮层 / 对比度」。
 * 这一份管的是另一半——**玻璃要读得出来**这件事本身。三条：
 *
 *  ① **玻璃背后必须有东西**。`backdrop-filter` 糊的是「自己背后的那一层」。
 *     背后是一张纯色纸时，blur 只是把纯色搅匀，屏上什么都读不出来——
 *     开着总闸也等于没开。这是 2026-11-20 真机撞出来的头号根因：
 *     输入区那一圈铺着**不透明**的纸色渐变（`--surface-main`），
 *     于是输入卡的玻璃底下是死纸，糊了个寂寞。
 *
 *  ② **一块玻璃板不许被切成三段**。对话框的动作条原先另铺一层实底，
 *     于是「玻璃弹窗」读成「一条玻璃 + 一条纸色横带」。
 *
 *  ③ **总闸之外不许有第二个玻璃**。`.agent-statusbar` 自己写死了一份
 *     `backdrop-filter: blur(8px)`，不归总闸管 ⇒ 液态玻璃关掉它照样糊着，
 *     而且用的是第三套模糊数值（8px ≠ `--lg-blur` 的 12px），
 *     同一栏里三处 chrome 是三种材质。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));

function readStyle(file: string): string {
  return readFileSync(path.join(SRC, "styles", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const liquid = readStyle("liquid-glass.css");
const themeRuntime = readStyle("theme-runtime.css");
const dialog = readStyle("dialog.css");
const agentPane = readStyle("agent-pane.css");

/**
 * 取出「选择器以 suffix 结尾」的那些规则体。
 *
 * 用 endsWith 而不是全等：液态玻璃那一族的选择器都带总闸前缀
 * （`html[data-liquid-glass="on"] .composer-input-surface`），
 * 全等一个都匹配不上。
 */
function blocksOf(source: string, suffix: string): string[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]!.split(",").some((selector) => selector.trim().endsWith(suffix)))
    .map((match) => match[2]!);
}

describe("液态玻璃 · 玻璃背后必须有东西", () => {
  it("输入区那一圈不再铺不透明纸色", () => {
    const blocks = blocksOf(themeRuntime, ".composer-wrap");
    expect(blocks.length, "theme-runtime.css 里找不到 .composer-wrap 的规则").toBeGreaterThan(0);
    for (const block of blocks) {
      // 渐变末色带着实心的 --surface-main ⇒ 玻璃底下是死纸，糊了也读不出来。
      expect(block, "输入区仍铺着不透明纸色，玻璃底下没有东西可透").not.toMatch(
        /var\(--surface-main\)\s*20px/
      );
      expect(block, "输入区那圈渐变要留出透明度，底下的插画才透得上来").toMatch(
        /color-mix\([^;]*--surface-main[^;]*transparent/
      );
    }
  });
});

describe("液态玻璃 · 一块玻璃板不许被切成三段", () => {
  it("对话框的动作条不再另铺一层实底", () => {
    const blocks = blocksOf(dialog, ".dialog-actions");
    expect(blocks.length, "dialog.css 里找不到 .dialog-actions 的规则").toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, "动作条另铺实底 ⇒ 玻璃弹窗被切成三段").not.toMatch(
        /background:\s*var\(--surface-main/
      );
    }
  });
});

describe("液态玻璃 · 总闸之外不许有第二个玻璃", () => {
  it("状态栏的基态不再自带模糊数值（模糊一律归总闸）", () => {
    const blocks = blocksOf(agentPane, ".agent-statusbar");
    expect(blocks.length, "agent-pane.css 里找不到 .agent-statusbar 的规则").toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, "状态栏自带 backdrop-filter：总闸关不掉它").not.toContain("backdrop-filter");
      expect(block, "状态栏不许写死模糊数值（模糊只有 --lg-blur 一处）").not.toMatch(/blur\(\s*\d/);
    }
  });

  it("状态栏进玻璃族：与栏头、输入卡读成同一块玻璃", () => {
    const blocks = blocksOf(liquid, ".agent-statusbar");
    expect(blocks.length, "液态玻璃族里没有 .agent-statusbar").toBeGreaterThan(0);
    const joined = blocks.join("\n");
    expect(joined).toMatch(/backdrop-filter:\s*blur\(var\(--lg-blur\)\)/);
    expect(joined).toContain("var(--lg-fill)");
  });

  it("左栏进玻璃族：左栏不再是一块与中栏无关的死色", () => {
    const blocks = blocksOf(liquid, ".left-sidebar");
    expect(blocks.length, "液态玻璃族里没有 .left-sidebar").toBeGreaterThan(0);
    const joined = blocks.join("\n");
    expect(joined).toMatch(/backdrop-filter:\s*blur\(var\(--lg-blur\)\)/);
    expect(joined).toContain("var(--lg-fill)");
  });

  it("对话栏头也加模糊：底下是半透明的插画层，不是本栏不透明底", () => {
    const blocks = blocksOf(liquid, ".conversation-header");
    expect(blocks.length, "液态玻璃族里没有 .conversation-header").toBeGreaterThan(0);
    expect(blocks.join("\n")).toMatch(/backdrop-filter:\s*blur\(var\(--lg-blur\)\)/);
  });

  it("族里每一处模糊都吃 --lg-blur，不许有第二套数值", () => {
    expect(liquid).not.toMatch(/blur\(\s*\d+(\.\d+)?px\s*\)/);
    expect(liquid).not.toMatch(/saturate\(\s*\d/);
  });
});

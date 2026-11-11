/// <reference types="node" />
/**
 * 统一交互态的接线契约（2026-11-11）。
 *
 * 这一层最怕的不是「不生效」，是**反过来把已有规则顶掉**：
 * 一条特异性压过各按钮类的全局 :hover，会把 140 条各自调好的配色全刷成同一档；
 * 一条带 transform 的全局 :active，会让内部有绝对定位子元素的按钮整块错位。
 * 所以这里钉的是「零特异性、只补不改、动效口径同源」三件事。
 */
import { describe, expect, it } from "vitest";
import {
  strippedStyleSource,
  styleSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const css = strippedStyleSource("state-layer.css");
const motionCss = strippedStyleSource("motion.css");
const runtime = typeScriptSource("composables/appearanceThemeRuntime.ts");

describe("只补缺的：全部零特异性，不抢已有按钮规则", () => {
  it("三条规则的选择器都包在 :where() 里", () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim());
    const rules = selectors.filter((s) => s.includes("button"));
    expect(rules.length).toBe(2);
    for (const selector of rules) expect(selector.startsWith(":where(")).toBe(true);
    expect(css).not.toContain(".icon-button");
    expect(css).not.toContain("!important");
  });

  it("禁用态与 aria-disabled 都排除，.disabled 的按钮不会跟着亮一下", () => {
    expect(css.match(/:not\(:disabled\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(css.match(/:not\(\[aria-disabled="true"\]\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("不碰 transform / background-image / box-shadow 声明，避开三种已知覆写风险", () => {
    expect(css).not.toContain("transform:");
    expect(css).not.toContain("background-image:");
    expect(css).not.toContain("box-shadow: inset");
    expect(css).not.toContain("position: relative");
  });
});

describe("动效与主题口径同源", () => {
  it("过渡读两枚动效 token，不另写一份毫秒数", () => {
    expect(css).toContain("var(--dur-fast) var(--ease-out-soft)");
    expect(css).not.toMatch(/\d+ms/);
  });

  it("减少动效仍由 motion.css 那道全局总闸裁决，本文件不另开开关", () => {
    expect(motionCss).toContain('html[data-reduced-motion="true"] *');
    expect(css).not.toContain("prefers-reduced-motion");
  });

  it("深浅两档按压方向相反，且暗色档挂在运行时真会写的那个属性上", () => {
    expect(css).toContain("--state-press-brightness: 0.96");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain("--state-press-brightness: 1.1");
    expect(runtime).toContain("root.dataset.theme = scheme");
  });

  it("按压只用 filter 一处，且亮度来自 token", () => {
    expect(css).toContain("filter: brightness(var(--state-press-brightness))");
    expect(css.match(/filter:/g)?.length).toBe(1);
  });

  it("接进 styles.css，仍排在 density.css 之前", () => {
    const imports = vueSource("styles.css");
    expect(imports).toContain('@import "./styles/state-layer.css";');
    expect(imports.indexOf('@import "./styles/state-layer.css";')).toBeLessThan(
      imports.indexOf('@import "./styles/density.css";')
    );
    expect(styleSource("state-layer.css")).toContain("state layer");
  });
});

/// <reference types="node" />
/**
 * 系统级外观适配的接线契约（2026-11-11）。
 *
 * 这一段最容易「写了却全不生效」：@import 全在 styles.css 文件头部，主文件里那些
 * 同特异性的 `button:focus-visible` / `::selection` 永远排在后面；不带 `:root` / `html `
 * 前缀的兜底规则会被一条不剩地盖掉，而高对比度平时不开，界面上根本看不出来。
 * 所以这里钉的是**压得住**的选择器，不是「文件里有这行字」。
 */
import { describe, expect, it } from "vitest";
import { strippedStyleSource, vueSource } from "../utils/vue-source-reader";

const css = strippedStyleSource("system-appearance.css");
const glassCss = strippedStyleSource("liquid-glass.css");

describe("两档系统偏好都接进来了，且不抢玻璃族那一族", () => {
  it("styles.css 里 @import 了它，仍排在 density.css 之前", () => {
    const imports = vueSource("styles.css");
    expect(imports).toContain('@import "./styles/system-appearance.css";');
    expect(imports.indexOf('@import "./styles/system-appearance.css";')).toBeLessThan(
      imports.indexOf('@import "./styles/density.css";')
    );
  });

  it("只管 forced-colors 与 prefers-contrast 两档", () => {
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-contrast: more)");
    expect(css.match(/@media/g)?.length).toBe(2);
  });

  it("减少透明度仍由 liquid-glass.css 独家处理，这里不造第二份开关", () => {
    expect(glassCss).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).not.toContain("prefers-reduced-transparency");
    expect(css).not.toContain("backdrop-filter");
  });
});

describe("压得住主文件的同特异性规则", () => {
  it("焦点环选择器带 :root 前缀，且两档都覆盖五类可聚焦元素", () => {
    const kinds = ["button", "input", "select", "textarea", '[role="button"]'];
    for (const kind of kinds) {
      expect(css, `${kind} 没进高对比度焦点环`).toContain(`:root ${kind}:focus-visible`);
    }
    expect(css.match(/:root button:focus-visible/g)?.length).toBe(2);
  });

  it("选区带 html 前缀：不带就永远输给 styles.css 文件后半那条 ::selection", () => {
    expect(css.match(/html ::selection/g)?.length).toBe(2);
    expect(vueSource("styles.css")).toContain("::selection {");
  });

  it("高对比度吃系统色关键字，不用本仓那套会被强制换掉的半透明色", () => {
    expect(css).toContain("outline: 2px solid Highlight");
    expect(css).toContain("color: HighlightText");
    expect(css).toContain("border: 1px solid CanvasText");
    expect(css).not.toContain("!important");
  });

  it("按钮描边补的是被 `button { border: 0 }` 去掉的那条，且排除禁用态", () => {
    expect(vueSource("styles.css")).toContain("button {\n  border: 0;\n}");
    expect(css).toContain(":root button:not(:disabled)");
  });

  it("只有 Tooltip 允许保留自己的反色，其余层交给系统换色", () => {
    expect(css.match(/forced-color-adjust: none/g)?.length).toBe(1);
    expect(css).toContain(".mochen-tooltip {\n    forced-color-adjust: none;\n  }");
  });
});

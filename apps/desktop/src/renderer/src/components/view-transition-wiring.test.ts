/// <reference types="node" />
/**
 * 视图过渡的接线守卫（批次 5-㊸）。
 *
 * 真身的单测在 utils/view-transition.test.ts。这一份钉的是**谁真的走了那条路**——
 * 单测再全，调用方一个没接上也是全绿（与 ime-guard-wiring 同一条道理：判据活着不等于接线活着）。
 *
 * 三组：
 * ① 接线：三处视图切换 + 换皮肤，各自带的方向；
 * ② 样式：谁挂了名字、名字有没有被关掉的那两段覆盖、弹簧有没有兜底；
 * ③ 一条自洽守卫：**凡在本文件挂过 `view-transition-name` 的名字，三种伪元素都必须出现在关闭段里**。
 *    ③ 是这组里唯一会自己长大的那条——将来给第六个页面挂名字而忘了关动效，只有它会红。
 */
import { describe, expect, it } from "vitest";
import {
  cssRules,
  scriptSource,
  strippedStyleSource,
  styleSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const LAYOUT = typeScriptSource("stores/layoutStore.ts");
const APP = scriptSource("App.vue");
const STYLES_CSS = styleSource("../styles.css");
// 用剥掉注释的那一份：本文件头那段注释里点名了 view-transition-name 与各道闸，
// 拿原文去断言就是让注释自己把断言喂饱（utils/vue-source-reader.ts 写的就是这件事）。
const VIEW_CSS = strippedStyleSource("view-transition.css");
const VIEW_TS = typeScriptSource("utils/view-transition.ts");

/** 某个函数的函数体（含它自己的那一圈花括号），注释已在上游剥掉。 */
function functionBody(source: string, name: string): string {
  const at = source.indexOf(`function ${name}`);
  expect(at, `源文件里找不到函数 ${name}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`函数 ${name} 的花括号没配平`);
}

describe("接线：三处视图切换 + 换皮肤都走同一个真身", () => {
  it("layoutStore 的三个切换函数都调 runViewTransition，且各带自己的方向", () => {
    expect(functionBody(LAYOUT, "showSettings")).toContain(
      'runViewTransition(apply, { direction: "forward" })'
    );
    expect(functionBody(LAYOUT, "showCenter")).toContain(
      'runViewTransition(apply, { direction: "forward" })'
    );
    // 回程方向相反：CSS 那两支滑入才是同一支的对头。
    expect(functionBody(LAYOUT, "showWorkspace")).toContain(
      'runViewTransition(apply, { direction: "back" })'
    );
  });

  it("换皮肤走同一个真身（App.vue 的 applyTheme），且只在「整套配色换掉」时才淡", () => {
    const body = functionBody(APP, "applyTheme");
    expect(body).toContain("runViewTransition(paint)");
    // 首刷没有旧样子可淡；同一套再刷一次（预览里切页签之类）也不必淡。
    expect(body).toContain("previous === null || previous === key");
  });

  it("判据只有一份：contentSlotSwitches 只定义一次，三处切换都读它", () => {
    const hits = LAYOUT.split("contentSlotSwitches").length - 1;
    // 1 次定义 + 3 次调用 = 4
    expect(hits, "多一份就是同一判定两份实现").toBe(4);
  });

  it("反向钉：判据不许偷看字号/字体/侧栏——那些是连续微调，不该整窗淡一次", () => {
    const body = functionBody(APP, "skinPaintKey");
    expect(body).toContain("view[scheme].skin");
    expect(body).toContain("view[scheme].art");
    for (const forbidden of [
      "uiFontSize",
      "editorFontSize",
      "translucentSidebar",
      "uiFontFamily",
      "leading"
    ]) {
      expect(body, `skinPaintKey 里不该出现 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("真身本身：方向名与 CSS 里用的那两个逐字相同（两边各写一遍就会漂）", () => {
    expect(VIEW_TS).toContain('forward: "mochen-forward"');
    expect(VIEW_TS).toContain('back: "mochen-back"');
    expect(VIEW_CSS).toContain(":active-view-transition-type(mochen-forward)");
    expect(VIEW_CSS).toContain(":active-view-transition-type(mochen-back)");
  });
});

describe("样式：名字挂在谁身上", () => {
  it("中栏四页互斥共用 mochen-center，右栏编辑器 mochen-right", () => {
    for (const selector of [
      ".conversation-pane",
      ".extensions-page",
      ".skin-gallery",
      ".settings-page"
    ]) {
      expect(VIEW_CSS, `${selector} 必须与另外三页共用 mochen-center`).toContain(selector);
    }
    expect(VIEW_CSS).toMatch(/\.editor-pane\s*\{[^}]*view-transition-name:\s*mochen-right/);
    // 左栏那根导航轴不许挂名字：挂了它就会跟着闪，而它在这几次切换里一模一样。
    expect(VIEW_CSS).not.toMatch(/\.left-sidebar[^{]*\{[^}]*view-transition-name/);
  });

  it("styles.css 把它排在 motion.css 之后（关闭段要压得住 motion.css 那张出场动画表）", () => {
    const motion = STYLES_CSS.indexOf("motion.css");
    const view = STYLES_CSS.indexOf("view-transition.css");
    expect(motion, "styles.css 得先引 motion.css").toBeGreaterThan(-1);
    expect(view, "styles.css 没引 view-transition.css").toBeGreaterThan(-1);
    expect(view, "view-transition.css 必须排在 motion.css 之后").toBeGreaterThan(motion);
  });

  it("弹簧缓动有 @supports 兜底：引擎不认 linear() 时退到原来的曲线，而不是变成默认 ease", () => {
    expect(VIEW_CSS).toContain("@supports (animation-timing-function: linear(0, 1))");
    const fallbackAt = VIEW_CSS.indexOf("--ease-view: cubic-bezier");
    const springAt = VIEW_CSS.indexOf("--ease-view: linear(");
    expect(fallbackAt, "兜底值必须写在前面").toBeGreaterThan(-1);
    expect(springAt, "弹簧曲线必须真的写出来").toBeGreaterThan(fallbackAt);
  });

  it("弹簧曲线过冲有界且收得住（线性插值点首 0 末 1，中间不得跳出 [0, 1.15]）", () => {
    const block = /--ease-view:\s*linear\(([^)]*)\)/.exec(VIEW_CSS)?.[1] ?? "";
    const points = block
      .split(",")
      .map((p) => Number(p.trim().split(/\s+/).at(-1)))
      .filter((n) => Number.isFinite(n));
    expect(points.length, "至少要有十几个采样点").toBeGreaterThan(10);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(Math.max(...points), "过冲不许超过 15%，否则是晃不是弹").toBeLessThanOrEqual(1.15);
    expect(Math.min(...points), "不许掉到 0 以下").toBeGreaterThanOrEqual(0);
  });

  it("自洽：凡挂过 view-transition-name 的名字，三种伪元素都得出现在关闭动效的那两段里", () => {
    const names = [...VIEW_CSS.matchAll(/view-transition-name:\s*([\w-]+)/g)].map(
      (m) => m[1] ?? ""
    );
    expect(names.length, "本轮至少挂了两个名字").toBeGreaterThanOrEqual(2);
    const disabled = cssRules(VIEW_CSS).filter((r) =>
      r.body.includes("animation: none !important")
    );
    const disabledSelectors = disabled
      .filter((r) => !r.selector.trimStart().startsWith("@"))
      .map((r) => r.selector);
    // 关闭段有两道闸：OS 媒体查询 + 应用内偏好属性，两道都得覆盖全。
    const withMedia = disabled.some((r) => r.selector.trimStart().startsWith("@media"));
    expect(withMedia, "少了一道 OS 级 prefers-reduced-motion 的闸").toBe(true);
    expect(
      disabledSelectors.some((s) => s.includes('html[data-reduced-motion="true"]')),
      "少了一道应用内偏好的闸"
    ).toBe(true);
    for (const name of names) {
      for (const kind of ["group", "old", "new"]) {
        expect(
          disabledSelectors.some((s) => s.includes(`::view-transition-${kind}(${name})`)),
          `::view-transition-${kind}(${name}) 没有被关掉——* 匹配不到伪元素，光靠 motion.css 的总闸关不住`
        ).toBe(true);
      }
    }
  });
});

describe("反向钉：几处最容易走偏的地方", () => {
  it("不许在组件里自己写 document.startViewTransition（绕过真身就等于绕过减少动效与并发闸）", () => {
    const app = vueSource("App.vue");
    expect(app).not.toContain("document.startViewTransition");
    expect(LAYOUT).not.toContain("document.startViewTransition");
    expect(VIEW_TS).toMatch(/document as unknown as ViewTransitionHost/);
  });

  it("刷主题那条不许被拆成第二条刷 DOM 的通路（--skin-* 的作者必须只有一个）", () => {
    const applyCalls = APP.split("applyAppearanceThemeToDocument(").length - 1;
    expect(applyCalls, "App.vue 里只该有一处调用（import 那行不带括号，量不到）").toBe(1);
  });
});

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
const MOTION_PREF_TS = typeScriptSource("utils/motion-preference.ts");

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

  it("这一层用全仓那一条 --ease-out-soft，不另立一份手感", () => {
    // 2026-10-11：原先这里挂的是那条 34 停靠点的弹簧曲线，已撤。
    // ::view-transition-* 是伪元素、不在 DOM 里，GSAP 的选择器根本选不中它们（理由见那个文件头），
    // 所以曲线留在 CSS，并统一到浮层那条——而不是就地再抄一条 cubic-bezier。
    expect(VIEW_CSS).toContain("var(--ease-out-soft)");
    expect(VIEW_CSS, "这一层不许自己抄一条缓动曲线").not.toContain("cubic-bezier(");
  });

  /**
   * **反向钉：这一层不许再有 linear() 曲线。**
   *
   * 原值是 linear(0, 0.0655, …) 这样的 34 段字符串，而它是本仓最贵的一次静默失效的现场
   * （2026-10-10 真机撞出）：引擎只认「逗号分隔的单个数字」，写错形状整条声明在计算值阶段被丢弃——
   * animation-name 算出来是 none、getAnimations() 为空、控制台零报错，
   * 而当时那条 @supports 闸探的恰好是引擎唯一收的那种形式，**闸是过的，曲线从没生效过**。
   *
   * 曲线搬到 utils/motion-spring.ts（JS 侧算）之后，样式表里一份都不该剩。
   * 这三条断言一起把「加回来」这条路堵死：曲线字面量、@supports 闸、以及那个变量本身。
   */
  it("CSS 里一份弹簧都不许剩（曲线字面量 / @supports 闸 / 那个变量，全都退役）", () => {
    expect(VIEW_CSS, "这一层又出现了 linear() 曲线").not.toContain("linear(");
    expect(VIEW_CSS, "那条 @supports 闸也一并退役了").not.toContain(
      "@supports (animation-timing-function"
    );
    expect(VIEW_CSS, "弹簧变量也一并退役了").not.toContain("--ease-view");
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
    // 宿主从 document 取时必须走结构类型的断言：`document` 上没有 startViewTransition 这个成员。
    // 2026-10-11 起这个断言搬到了 motion-preference.ts（认档的家），
    // view-transition.ts 那一处改为把同一个对象看成更宽的结构类型——两处都要在，缺一就红。
    expect(MOTION_PREF_TS).toMatch(/document as unknown as ReducedMotionHost/);
    expect(VIEW_TS).toMatch(/currentReducedMotionHost\(\) as ViewTransitionHost \| null/);
  });

  it("刷主题那条不许被拆成第二条刷 DOM 的通路（--skin-* 的作者必须只有一个）", () => {
    const applyCalls = APP.split("applyAppearanceThemeToDocument(").length - 1;
    expect(applyCalls, "App.vue 里只该有一处调用（import 那行不带括号，量不到）").toBe(1);
  });
});

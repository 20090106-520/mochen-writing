/// <reference types="node" />
/**
 * 思考态空窗期的接线守卫（批次 5-㊹）。
 *
 * 判据的单测在 utils/thinking-window.test.ts。这一份钉的是三件单测钉不到的事：
 * ① 判据**真的被接上了**（组件传了 open，中心列传了 running）——
 *    单测再全，调用方一个没接也是全绿；
 * ② 这一格的位置（末尾，且在 v-for 之外）；
 * ③ 可访问性与「减少动效」两档的静止档——这两样量错了不报错，只是默默失效。
 */
import { describe, expect, it } from "vitest";
import {
  cssRules,
  scriptSource,
  strippedStyleSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const TIMELINE_TPL = templateSource("components/AgentTimeline.vue");
const TIMELINE_SCRIPT = scriptSource("components/AgentTimeline.vue");
const CENTER_SCRIPT = scriptSource("components/CenterColumn.vue");
const CENTER_TPL = templateSource("components/CenterColumn.vue");
const WINDOW_TPL = templateSource("components/ThinkingWindow.vue");
const WINDOW_SCRIPT = scriptSource("components/ThinkingWindow.vue");
const CSS = strippedStyleSource("thinking-window.css");
const UTIL = typeScriptSource("utils/thinking-window.ts");
const STYLES_CSS = styleSource("../styles.css");

describe("接线", () => {
  it("时间线把判据的 open 传给组件（模板不许自己判 '正在不在跑'）", () => {
    expect(TIMELINE_SCRIPT).toContain("thinkingWindowState");
    expect(TIMELINE_SCRIPT).toContain("running: props.running");
    expect(TIMELINE_TPL).toContain('<ThinkingWindow :open="thinkingWindow.open" />');
    // 组件只有一个入参：判据已经在外面算好了，组件自己再收 items/tail 就是第二份判据。
    expect(WINDOW_SCRIPT).not.toContain("thinkingWindowState");
  });

  it("中心列把 running 传下去（少这一个，判断永远是 false，这一格永远不出现）", () => {
    expect(CENTER_SCRIPT).toContain("const running = computed");
    expect(CENTER_TPL).toContain(
      '<AgentTimeline :items="items" :tail="tail" :running="running" :emotion="assistantFace" />'
    );
  });

  it("这一格挂在 v-for 之外、且在时间线末尾：时间线是追加的，开头那个位置属于上一轮", () => {
    // v-for 的收尾 </section> 之后、容器收尾 </div> 之前。
    const at = TIMELINE_TPL.indexOf("<ThinkingWindow");
    const loopEnd = TIMELINE_TPL.lastIndexOf("</section>");
    expect(at, "这一格没挂在时间线里").toBeGreaterThan(-1);
    expect(loopEnd, "找不到 v-for 的收尾 </section>").toBeGreaterThan(-1);
    expect(at, "这一格必须在 v-for 之外（在里面 = 每块都挂一行'正在想'）").toBeGreaterThan(loopEnd);
    const after = TIMELINE_TPL.slice(at);
    expect(after.trimEnd().endsWith("</div>"), "它后面只该剩时间线容器的收尾").toBe(true);
  });

  it("「正在想」只有一句话：流式思考卡那枚徽标与空窗期这一行共用一个常量", () => {
    expect(WINDOW_SCRIPT).toContain("thinkingWindowLabel(elapsedMs.value)");
    expect(WINDOW_SCRIPT).toContain("thinkingWindowElapsedText(elapsedMs.value)");
    // 模板里不许再出现字面量：两处说的是同一个状态，措辞两份就会漂
    // （真机上撞过：新写的「在想…」与卡片上原有的「正在想」是同一句话的两种说法）。
    expect(TIMELINE_TPL).not.toContain("正在想<");
    expect(TIMELINE_TPL).toContain("{{ THINKING_LIVE_LABEL }}");
    expect(UTIL).toContain('THINKING_LIVE_LABEL = "正在想"');
  });

  it("反向钉：秒数的门槛不许在组件里另写一个数字", () => {
    expect(WINDOW_SCRIPT).toContain("ELAPSED_SHOW_AFTER_MS");
    expect(WINDOW_SCRIPT).not.toMatch(/\d{3,}\s*\)?\s*(===|>|<)/);
    expect(UTIL).toContain("ELAPSED_SHOW_AFTER_MS");
  });
});

describe("可访问性：这一格是状态，不是插曲", () => {
  it("role=status + polite（状态变化，不是打断用户的那类播报）", () => {
    expect(WINDOW_TPL).toContain('role="status"');
    expect(WINDOW_TPL).toContain('aria-live="polite"');
  });

  it("秒数那格 aria-hidden——它每秒变一次，留在 live region 里会把读屏用户淹掉", () => {
    const elapsedTag = WINDOW_TPL.match(/<span[^>]*thinking-window-elapsed[^>]*>/)?.[0] ?? "";
    expect(elapsedTag, "秒数那一格在模板里找不到了").not.toBe("");
    expect(elapsedTag).toContain('aria-hidden="true"');
  });

  it("给读屏的隐藏文本有静止档（.sr-only 三条缺一条就漏成可见的小字）", () => {
    const srOnly = cssRules(CSS).find((r) => r.selector === ".sr-only")?.body ?? "";
    expect(srOnly).toContain("position: absolute");
    expect(srOnly).toContain("width: 1px");
    expect(srOnly).toContain("overflow: hidden");
    expect(srOnly).toContain("clip: rect(0 0 0 0)");
  });
});

describe("减少动效：两档都得给出静止档", () => {
  /** 关掉动画的那几段选择器（媒体查询与应用内偏好属性各算一段）。 */
  function disabledSelectors(): string[] {
    return cssRules(CSS)
      .filter((r) => r.body.includes("animation: none"))
      .filter((r) => !r.selector.trimStart().startsWith("@"))
      .map((r) => r.selector);
  }

  it("OS 媒体查询那一档：点停住，且三枚点仍在、亮度一致", () => {
    expect(CSS, "少了 @media (prefers-reduced-motion: reduce) 那一档").toContain(
      "@media (prefers-reduced-motion: reduce)"
    );
    const selectors = disabledSelectors();
    expect(selectors.some((s) => s.includes(".thinking-window-dots i"))).toBe(true);
    const staticDots = cssRules(CSS).filter(
      (r) => r.selector === ".thinking-window-dots i" && r.body.includes("opacity: 0.7")
    );
    expect(
      staticDots.length,
      "总闸把时长压到 0.01ms 时，三枚点会停在基础档那一帧（opacity 0.35）——'关掉动效'就变成了'看起来没在动'"
    ).toBeGreaterThan(0);
  });

  it("应用内偏好那一档：同一份静止档也要给（那是并行的第二通路）", () => {
    const selectors = disabledSelectors();
    expect(
      selectors.some((s) => s.includes('html[data-reduced-motion="true"] .thinking-window-dots i')),
      "少了一道应用内偏好的闸"
    ).toBe(true);
  });
});

describe("样式表的落位", () => {
  it("引进 styles.css，且排在 motion.css 之后（缓动曲线是那边定义的）", () => {
    // 2026-10-11：原先排的是 view-transition.css，因为曲线在那个文件里；
    // 曲线随对话框一起搬到 GSAP 之后，这里改读 motion.css 的 --ease-out-soft，落位跟着改。
    const motion = STYLES_CSS.indexOf("motion.css");
    const window = STYLES_CSS.indexOf("thinking-window.css");
    expect(window, "styles.css 没引 thinking-window.css").toBeGreaterThan(-1);
    expect(window).toBeGreaterThan(motion);
  });

  it("呼吸点与入场共用 motion.css 那一条 --ease-out-soft，不另写一条曲线", () => {
    // 这一格留在 CSS 是有意的：呼吸点是 infinite 循环，一条永远播不完的弹簧曲线
    // 本身就是错的形状（弹簧是用来落位的），而常驻 rAF 驱动三颗 4px 的点也比合成器上的 opacity 更费。
    expect(CSS).toContain("--ease-out-soft");
    expect(CSS, "这一族不许自己抄一条缓动曲线").not.toContain("cubic-bezier(");
    // 也不许把弹簧请回来：真正的弹簧在 utils/motion-spring.ts，只有对话框入场在用。
    expect(CSS, "这条 CSS 曲线已经退役").not.toContain("--ease-view");
    expect(CSS, "这一层不许再出现 linear() 曲线").not.toContain("linear(");
  });
});

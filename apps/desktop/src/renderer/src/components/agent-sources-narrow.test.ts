/**
 * 来源清单在窄窗口下的排版守卫（2026-10-06 批次 5-⑰）。
 *
 * **为什么值得单钉**：这一段全是「判错不报错」的视觉缺陷。真机量到的三档：
 * ① 键恒定占掉 52%（`max-width: 52%`），清单一窄就把标题挤没——视口 1100 时标题只剩 101px，
 *    约五个字，同时键自己也被截在 116px（需要 193px）。两头一起废，那一行认不出是哪个来源。
 * ② 窄了要能改成竖排（键一行、标题一行），否则上面那档没救。
 * ③ **容器查询块写错位置会「看起来生效」**：它不加特异度，同特异度下后来者赢。
 *    第一版把它写在 `.source-open` / `.source-key` **前面**，`align-items: flex-start` 被下面的
 *    `baseline` 吃掉、`max-width: 100%` 被下面的 `52%` 吃掉，只剩一条 `flex-direction` 落地的半残态——
 *    真机症状是 1200px 那档「像是命中了，键却仍被截在 52%」。这条最容易复发，所以钉死顺序。
 *
 * 读法走 vue-source-reader：CSS 没有类型关卡，`.vue` 又零自动化覆盖，只能读源码钉形状。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, styleSource, templateSource } from "../utils/vue-source-reader";

const CSS = styleSource("agent-pane.css");
const TPL = templateSource("components/AgentTimeline.vue");

const CONTAINER = "@container sources";

/**
 * 真机 A/B 量出的分界带（注入同一份声明造出竖排态，十条真实长度的来源取前五条）：
 *   清单内容盒 503px → 横排开始截标题（0/5·1/5），竖排 0/5·0/5，竖排赢
 *   清单内容盒 543px → 两边都 0/5·0/5，打平，横排赢在每条省 17px
 * 分界因此落在 (503, 543]。阈值取 520（两侧各留十几像素余量）。
 *
 * **别把这三个数写回 CSS 当判据**：它们是量出来的，测试只钉「阈值落在量到的带里」，
 * 免得改阈值的人只是把数字对齐到断言上、却从没重新量过。
 */
const MEASURED_BAND = { lo: 503, hi: 543 } as const;

function containerThreshold(css: string): number {
  const match = /@container sources \(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error("样式表里没有 @container sources (max-width: …px) 这条竖排规则");
  }
  return Number(match[1]);
}

describe("来源清单：容器查询的前提", () => {
  it(".tool-sources 自己就是那个容器：不声明 container，那条 @container 永远不成立", () => {
    expect(ruleBlock(CSS, ".tool-sources")).toContain("container: sources / inline-size");
  });

  it("预览清单确实在这个容器里面（挪出去查询就静默失效）", () => {
    const start = TPL.indexOf('class="tool-sources"');
    expect(start).toBeGreaterThan(-1);
    const end = TPL.indexOf('class="source-more"');
    expect(end).toBeGreaterThan(start);
    expect(TPL.slice(start, end)).toContain('class="source-list"');
  });

  it("阈值落在真机量出的分界带里，不是拍脑袋的数", () => {
    const t = containerThreshold(CSS);
    expect(t).toBeGreaterThanOrEqual(MEASURED_BAND.lo);
    expect(t).toBeLessThanOrEqual(MEASURED_BAND.hi);
  });
});

describe("来源清单：竖排那块必须排在它要覆盖的规则之后", () => {
  it("@container 块晚于 .source-key 的基础规则（同特异度下后来者赢）", () => {
    const containerAt = CSS.indexOf(CONTAINER);
    const keyAt = CSS.indexOf(".source-key {");
    expect(containerAt).toBeGreaterThan(-1);
    expect(keyAt).toBeGreaterThan(-1);
    // 顺序反了 ⇒ align-items / max-width 被下面的基础样式吃掉，竖排只剩半条 flex-direction。
    expect(containerAt).toBeGreaterThan(keyAt);
  });

  it("@container 块晚于 .source-open 的基础规则", () => {
    expect(CSS.indexOf(CONTAINER)).toBeGreaterThan(CSS.indexOf(".source-open {"));
  });

  it("竖排三件套齐全：方向、对齐、以及键放行到整行", () => {
    const at = CSS.indexOf(CONTAINER);
    const block = CSS.slice(at, CSS.indexOf("\n}", at) + 2);
    expect(block).toContain("flex-direction: column");
    expect(block).toContain("align-items: flex-start");
    // 键仍被 52% 卡着的话，竖排只换了个方向，键照样被截——真机 1200px 那档的症状。
    expect(block).toMatch(/\.source-key\s*\{[^}]*max-width:\s*100%/);
  });
});

describe("来源清单：宽窗口的排版没被动过", () => {
  it("基础规则仍是横排 + 键占一半（5-⑰ 只加窄档，宽档一个字都不该改）", () => {
    const open = ruleBlock(CSS, ".source-open");
    expect(open).not.toContain("flex-direction");
    expect(open).toContain("align-items: baseline");
    expect(ruleBlock(CSS, ".source-key")).toContain("max-width: 52%");
  });
});

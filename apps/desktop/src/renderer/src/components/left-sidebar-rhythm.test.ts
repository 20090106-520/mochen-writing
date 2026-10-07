/**
 * ⑧ 左栏行高（2026-10-06 批次 5-⑧）。
 *
 * **先量，再改**：这一批里 CSS 里的 `min-height` 不作数——真机 CDP 量到的是
 * nav-row 高 34 / **pitch 36**，而树行高 30 / **pitch 31**。31 = 30 + 1px，
 * 那 1px 来自 `.resource-tree { gap: 1px }`，是左栏里**唯一**不成 2 的行间隙。
 *
 * 于是同一栏出现两种节奏，其中一种还是奇数——它既不与导航对齐（36），也不是任何整除关系，
 * 读起来像手滑而不是取舍。改成 2px 后树 pitch 32，整栏落在同一个间隙单位上；
 * 行与行的密度差（36 vs 32）**仍然保留**，因为那是有意的层级（树要装得下一整本书的章节）。
 *
 * **为什么自己读规则、不用 `vue-source-reader` 的 `ruleBlock`**：那条的匹配是
 * `selector\s*\{`，没有行首锚点，于是 `ruleBlock(css, ".nav-row")` 读到的是文件里**第一个**
 * `.nav-row` 子串——`.nav-group-head .nav-row` 那块（只有 flex/min-width），量出来的 min-height
 * 是 NaN。锚在行首（前面必须是行首或一个 `}`）才读得到顶层那块规则本身。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const navCss = readFileSync(
  fileURLToPath(new URL("../styles/left-nav.css", import.meta.url)),
  "utf8"
);

/** 左栏的行间隙单位：nav 那几行的 36px pitch = 34 高 + 2 缝，全栏都按这个缝。 */
const PANEL_ROW_GAP_PX = 2;

/** 顶层规则的正文：选择器必须**行首**（前面是行首或 `}`），不许命中后代选择器。 */
function topRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (m === null || m[1] === undefined) {
    throw new Error(`样式表里找不到顶层规则 ${selector}`);
  }
  return m[1];
}

function minHeightOf(css: string, selector: string): number {
  const raw = /min-height:\s*(\d+)px/.exec(topRule(css, selector))?.[1];
  if (raw === undefined) throw new Error(`${selector} 里没有 min-height 的 px 值`);
  return Number(raw);
}

function topRuleCount(css: string, selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{`, "gm"))].length;
}

describe("树行与导航行用同一个间隙单位", () => {
  it("树的行间隙就是面板那个单位（真机上 pitch 31 的来源就是这里那个 1px）", () => {
    const gap = /gap:\s*(\d+)px/.exec(topRule(navCss, ".resource-tree"))?.[1];
    expect(gap, ".resource-tree 的 gap 必须是显式 px 值").toBeDefined();
    expect(Number(gap)).toBe(PANEL_ROW_GAP_PX);
  });

  it(".resource-tree 在这份样式表里只有一块（原来有两块：定 grid 的与定边框的各一块）", () => {
    // 两块都在用、改一块忘了另一块，正是这种重复写法埋的雷。合并后只许剩一块。
    expect(topRuleCount(navCss, ".resource-tree")).toBe(1);
  });

  it("反向：树行不许比导航行更高（那样整栏头轻脚重）", () => {
    const navH = minHeightOf(navCss, ".nav-row");
    const treeH = minHeightOf(navCss, ".resource-tree > .tree-node > .tree-row");
    expect(navH).toBe(34);
    expect(treeH).toBeGreaterThan(0);
    expect(treeH).toBeLessThanOrEqual(navH);
  });

  it("两段的**行距**都是偶数（同一个间隙单位出来的，不是凑出来的）", () => {
    const navH = minHeightOf(navCss, ".nav-row");
    const treeH = minHeightOf(navCss, ".resource-tree > .tree-node > .tree-row");
    const navPitch = navH + PANEL_ROW_GAP_PX;
    const treePitch = treeH + PANEL_ROW_GAP_PX;
    // 旧值树 pitch = 31（30 + 1px），奇数 —— 那一条就是「看着像手滑」的来源。
    expect(navPitch % 2).toBe(0);
    expect(treePitch % 2).toBe(0);
    expect(navPitch).toBe(36);
    expect(treePitch).toBe(32);
  });

  it("树比导航更密是**有意的层级**，不是失误（所以这条只钉方向，不钉差值）", () => {
    const navH = minHeightOf(navCss, ".nav-row");
    const treeH = minHeightOf(navCss, ".resource-tree > .tree-node > .tree-row");
    // 一整本书可能有几百个章节，树必须比导航密才装得下。钉「不许反过来」即可。
    expect(treeH).toBeLessThan(navH);
  });
});

describe("阶段标题那一行", () => {
  it("标题容器与 nav 行同高（它是导航区的一部分，不该自己矮一截）", () => {
    expect(minHeightOf(navCss, ".resource-section-heading")).toBe(minHeightOf(navCss, ".nav-row"));
  });

  it("里面的 section-toggle 比容器矮是对的（居中内嵌），但不许差过 2px", () => {
    const headH = minHeightOf(navCss, ".resource-section-heading");
    const toggleH = minHeightOf(navCss, ".section-toggle");
    expect(toggleH).toBeLessThanOrEqual(headH);
    expect(headH - toggleH).toBeLessThanOrEqual(2);
  });
});

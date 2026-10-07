/**
 * 输入区工具栏在窄容器下的分配守卫（2026-10-06 批次 5-⑱）。
 *
 * **为什么单钉**：这一段真出过**整排控件叠在一起**的缺陷，而且判错不报错。
 * 真机（视口 1024、对话区被挤到 284px）截图里模型名、关闭、联网搜索、工具、命令、
 * 直接动手、权限档的图标与文字互相压住，量到 17 处矩形相交、左端内容溢出框外 228px。
 * 与 5-⑪「模型 chip 只剩 5.6px」、5-⑰「来源标题只剩 101px」是同一类：工具链全绿，界面不可读。
 *
 * 成因两条，都不是「空间不够」，是分配与地板算错了：
 * ① `.composer-toolbar-left` 是 `flex: 1 1 0`——收缩权重 = shrink × **basis**，basis 为 0
 *    ⇒ 权重为 0，可它又是唯一可缩的大项，缺额全砸在它头上：容器 354 时被压到 80px（内容要 238px）。
 * ② 模型名那条 `min-width: 4.5em`（5-⑪ 加的地板）比 chip 自己的地板 44px 还大，
 *    于是内容永远画到 chip 框外——「有地板」反而制造了溢出。
 *
 * 钉四件事：窄档的两级门槛在、修法是「可缩可不吃」而不是「不吃让别处饿死」、
 * 顺序在被覆盖的规则之后、以及**不许出现已知的坏写法**（左端 `flex: 1 0 auto`：
 * 真量过——右端被压成 0px，发送键整个消失，比叠字更糟）。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, styleSource } from "../utils/vue-source-reader";

const CSS = styleSource("agent-pane.css");

const ALLOC_TIER = "@container composer (max-width: 620px)";
const WRAP_TIER = "@container composer (max-width: 560px)";

/** 从某条 at-rule 的 `{` 起，切到它在列 0 的那个 `}` 为止（内层规则都是缩进的）。 */
function atRuleBlock(css: string, atRule: string): string {
  const at = css.indexOf(atRule);
  if (at === -1) throw new Error(`样式表里没有 ${atRule}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("\n}", open);
  if (close === -1) throw new Error(`${atRule} 的块没闭合`);
  return css.slice(open + 1, close);
}

describe("工具栏窄档：两级门槛与修法", () => {
  it("两级窄档都在：一级改分配，一级换行", () => {
    expect(CSS).toContain(ALLOC_TIER);
    expect(CSS).toContain(WRAP_TIER);
  });

  it("换行级比分配级更窄（门槛 560 < 620），否则两档塌成一档", () => {
    const alloc = Number(/max-width: (\d+)px\)/.exec(CSS.slice(CSS.indexOf(ALLOC_TIER)))?.[1]);
    const wrap = Number(/max-width: (\d+)px\)/.exec(CSS.slice(CSS.indexOf(WRAP_TIER)))?.[1]);
    expect(alloc).toBe(620);
    expect(wrap).toBe(560);
    expect(wrap).toBeLessThan(alloc);
  });

  it("分配级：左端是「可缩可不吃」，不是「不吃」", () => {
    const block = atRuleBlock(CSS, ALLOC_TIER);
    // `flex: 1 0 auto` 是量过的坏写法：左端抢到 316px，右端被饿成 0px，发送键消失。
    expect(block).toMatch(/\.composer-toolbar-left\s*\{[^}]*flex:\s*0 1 auto/);
    expect(block).not.toMatch(/\.composer-toolbar-left\s*\{[^}]*flex:\s*1 0 auto/);
  });

  it("分配级：模型名不再被 4.5em 钉住（那条地板比 chip 自己的 44px 还大，内容注定出框）", () => {
    const block = atRuleBlock(CSS, ALLOC_TIER);
    expect(block).toMatch(
      /\.composer-toolbar-left \.composer-chip--model \.composer-chip-label\s*\{[^}]*min-width:\s*0/
    );
  });

  it("分配级：chip 守自己的地板 28/44，不许再往下压", () => {
    const block = atRuleBlock(CSS, ALLOC_TIER);
    expect(block).toMatch(/\.composer-chip\s*\{[^}]*min-width:\s*28px/);
    expect(block).toMatch(/:has\(\.composer-chip-caret\)\s*\{[^}]*min-width:\s*44px/);
  });

  it("换行级：工具栏折行、左端独占一行、右端靠右", () => {
    const block = atRuleBlock(CSS, WRAP_TIER);
    expect(block).toMatch(/\.composer-toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(block).toMatch(/\.composer-toolbar-left\s*\{[^}]*flex:\s*1 0 100%/);
    expect(block).toMatch(/\.composer-toolbar-right\s*\{[^}]*margin-left:\s*auto/);
  });
});

describe("工具栏窄档：顺序", () => {
  it("分配级晚于基础规则 `flex: 1 1 0`（同特异度下后来者赢）", () => {
    const baseAt = CSS.indexOf(".composer-toolbar-left {");
    expect(ruleBlock(CSS, ".composer-toolbar-left")).toContain("flex: 1 1 0");
    expect(CSS.indexOf(ALLOC_TIER)).toBeGreaterThan(baseAt);
  });

  it("分配级晚于模型名的 4.5em 地板与 589 级的 9em 上限", () => {
    expect(CSS.indexOf(ALLOC_TIER)).toBeGreaterThan(
      CSS.indexOf(".composer-toolbar-left .composer-chip--model .composer-chip-label")
    );
    expect(CSS.indexOf(ALLOC_TIER)).toBeGreaterThan(
      CSS.indexOf("@container composer (max-width: 589px)")
    );
  });

  it("换行级晚于分配级（560 更窄，要能叠在它上面）", () => {
    expect(CSS.indexOf(WRAP_TIER)).toBeGreaterThan(CSS.indexOf(ALLOC_TIER));
  });
});

describe("工具栏窄档：宽档一个字都不该动", () => {
  it("基础规则仍是 basis:0 + 右端 0 0 auto（1440 那一档量过是干净的）", () => {
    expect(ruleBlock(CSS, ".composer-toolbar-left")).toContain("flex: 1 1 0");
    expect(ruleBlock(CSS, ".composer-toolbar-right")).toContain("flex: 0 0 auto");
  });
});

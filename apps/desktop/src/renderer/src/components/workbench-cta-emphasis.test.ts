/**
 * 2026-10-14 设计稿对表批次：无书空态那两枚钮的**层级差**与工作台恒五张卡的栅格。
 *
 * 出处是分享板 `.superdesign/design-system.md` 那侧的优化稿（`tmp/mochen-state-empty-book-opt.html`
 * 末段与 `tmp/mochen-workbench-opt.html`），判真之后落进 `styles/conversation-pane.css`。
 * 两条各自钉一段，理由都在 CSS 注释里，这里只钉「别再腐回去」：
 * ① 主 CTA 只换面色字重不够——`conversation-pane.css:285` 那段自陈的欠账是「权重反而更低」，
 *    优化稿补的是**尺寸**一档（36px 高 / 16px 内距 / 0.875rem 字），且刻意只提主 CTA。
 *    两枚一起放大等于没放大。
 * ② 恒五张能力卡（真身 `utils/workbench-state.ts`）在 auto-fit 下排成 3+2，右下吊一个洞；
 *    恰好五张锁两列才齐整。这条与 ① 一样是纯 CSS 判据，删一行没人会发现，所以得有闸。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, strippedStyleSource } from "../utils/vue-source-reader";

const PANE = strippedStyleSource("conversation-pane.css");

describe("无书空态：主 CTA 提一档尺寸，次要那枚保持原样", () => {
  const primary = ruleBlock(PANE, ".workbench-open-book.is-primary");
  const base = ruleBlock(PANE, ".workbench-open-book");

  it("主 CTA 拿到 36px 高 / 16px 内距 / 0.875rem 字（优化稿那一档，一条不许少）", () => {
    expect(primary).toContain("min-height: 36px");
    expect(primary).toContain("padding: 0 16px");
    expect(primary).toContain("font-size: 0.875rem");
  });

  it("基线那枚仍是 31px / 12px —— 层级差来自主 CTA 单独提档，不是一起放大", () => {
    expect(base).toContain("min-height: 31px");
    expect(base).toContain("padding: 0 12px");
  });

  it("字号写 rem 不写 px：px 的话用户调「界面字号」这一档不动（ui-font-scale-guard 同一条纪律）", () => {
    expect(primary).toMatch(/font-size:\s*0\.875rem/);
    expect(primary).not.toMatch(/font-size:\s*\d+px/);
  });
});

describe("工作台恒五张卡：恰好五张锁两列", () => {
  const five = ruleBlock(PANE, ".workbench-cards:has(> :nth-child(5)):not(:has(> :nth-child(6)))");

  it("五张时锁 repeat(2, minmax(0,1fr))，消掉 3+2 的右下孤洞", () => {
    expect(five).toContain("repeat(2, minmax(0, 1fr))");
  });

  it("锁列那条不带 148px 下限：窄栏宁可卡窄一点，也不把栅格撑出容器", () => {
    expect(five).not.toContain("148px");
  });
});

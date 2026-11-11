/**
 * 2026-10-14 设计稿对表批次：无书空态那两枚钮的**层级差**与工作台恒五张卡的栅格。
 *
 * 出处是分享板 `.superdesign/design-system.md` 那侧的优化稿（`tmp/mochen-state-empty-book-opt.html`
 * 末段与 `tmp/mochen-workbench-opt.html`），判真之后落进 `styles/conversation-pane.css`。
 * 两条各自钉一段，理由都在 CSS 注释里，这里只钉「别再腐回去」：
 * ① 主 CTA 只换面色字重不够——`conversation-pane.css:285` 那段自陈的欠账是「权重反而更低」，
 *    优化稿补的是**尺寸**一档（36px 高 / 16px 内距 / 0.857143rem 字），且刻意只提主 CTA。
 *    两枚一起放大等于没放大。
 * ② 恒五张能力卡（真身 `utils/workbench-state.ts`）的收口两条：auto-fit 的列宽下限
 *    148 → 200px（中栏约 520px 内容宽下原排 3 列、每张 167px，提示断成末行只剩「批。」的
 *    孤字行），以及奇数张时末张跨整列。这两条与 ① 一样是纯 CSS 判据，删一行没人会发现，
 *    所以得有闸。原先那条「恰好五张锁两列」的 :has() 判据已被 200px 下限取代（见下面的 not 那条）。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, strippedStyleSource } from "../utils/vue-source-reader";

const PANE = strippedStyleSource("conversation-pane.css");

describe("无书空态：主 CTA 提一档尺寸，次要那枚保持原样", () => {
  const primary = ruleBlock(PANE, ".workbench-open-book.is-primary");
  const base = ruleBlock(PANE, ".workbench-open-book");

  it("主 CTA 拿到 36px 高 / 16px 内距 / 0.857143rem 字（优化稿那一档，一条不许少）", () => {
    expect(primary).toContain("min-height: 36px");
    expect(primary).toContain("padding: 0 16px");
    expect(primary).toContain("font-size: 0.857143rem");
  });

  it("基线那枚仍是 31px / 12px —— 层级差来自主 CTA 单独提档，不是一起放大", () => {
    expect(base).toContain("min-height: 31px");
    expect(base).toContain("padding: 0 12px");
  });

  it("字号写 rem 不写 px：px 的话用户调「界面字号」这一档不动（ui-font-scale-guard 同一条纪律）", () => {
    expect(primary).toMatch(/font-size:\s*0\.857143rem/);
    expect(primary).not.toMatch(/font-size:\s*\d+px/);
  });
});

describe("工作台恒五张卡：列宽下限 200px + 奇数张末张通栏", () => {
  const cards = ruleBlock(PANE, ".workbench-cards");
  const lastOdd = ruleBlock(PANE, ".workbench-cards > :last-child:nth-child(odd)");

  it("列宽下限提到 200px：520px 内容宽下保持 2 列（255px/张），提示不再断成孤字行", () => {
    expect(cards).toContain("repeat(auto-fit, minmax(200px, 1fr))");
  });

  it("奇数张时末张跨整列，收掉右侧空半屏；判的是奇偶不是「第 5 张」这个位置", () => {
    expect(lastOdd).toContain("grid-column: 1 / -1");
    expect(lastOdd).not.toContain("nth-child(5)");
  });

  it("按张数锁两列那条已被 200px 下限取代，不许两套并存", () => {
    // 两套并存时窄栏那档会互相打架：auto-fit 自己按 200px 下限决定列数，
    // :has() 会在同一批元素上再强按一次，且 :has() 那条不带下限、会把栅格撑破容器。
    expect(PANE).not.toContain(":nth-child(5)");
  });
});

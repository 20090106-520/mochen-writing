/// <reference types="node" />
/**
 * 皮肤卡片脚部的排法（2026-11-12）。
 *
 * 【为什么单独一份，而不是塞进 appearance-skin-plaza-wiring.test.ts】
 * 那份已经 797 行，离本仓的 800 行源码预算只剩三行（`check-source-line-budget`）。
 * 拆点照那一次的原则：按**钉的对象**切，不按行数硬切——
 * 那份钉的是「广场页的说明文案、筛选档、并排对比」，这一份钉的是**一张卡内部怎么排**。
 *
 * 【真机撞到的】
 * `.skin-card-foot` 是 `justify-content: space-between` 的一行：左边质感词、右边三枚操作。
 * 质感词不带 flex-grow，于是被压到 **78px** —— 比它自己最长的一枚词
 * （「胶囊圆角」56px + 12px 内边距）还窄一点点，六枚词**一枚一行**竖着摞下来：
 * 量到质感区 116px、整张卡 400px。屏上看是一列孤零零的灰胶囊贴在卡片左下角，右半边全空，
 * 卡片读起来像一张崩了的表格。
 *
 * 【为什么必须折行 + 质感词独占一行】
 * 一行装不下的东西分两行摆，是卡片里唯一不随词数变化的排法：
 * 词从 4 枚变 9 枚时，卡片只长一行，不会跟着长成九行。
 * 修后真机量到质感区 116 → 36px（两行词）、卡高 400 → 368px。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, strippedStyleSource } from "../utils/vue-source-reader";

const CSS = strippedStyleSource("skin-gallery.css");

describe("皮肤卡片脚部 · 质感词不许被压成一列", () => {
  it("脚部允许折行（只有允许折行，三枚钮才可能让位到第二行）", () => {
    expect(ruleBlock(CSS, ".skin-card-foot")).toContain("flex-wrap: wrap");
  });

  it("不再用 space-between 把质感词和三枚钮塞进同一行", () => {
    expect(
      ruleBlock(CSS, ".skin-card-foot"),
      "space-between 回来了 —— 质感词又会被压成一列"
    ).not.toContain("justify-content: space-between");
  });

  it("质感词整行独占（flex: 1 1 100% 是「横着排」的前提）", () => {
    expect(ruleBlock(CSS, ".skin-card-feel")).toContain("flex: 1 1 100%");
  });

  it("三枚操作仍靠右：靠第一枚把左边距吃掉，而不是整体 justify-content 右推", () => {
    // 整行 `justify-content: flex-end` 会把独占一行的质感词也推到右边，所以那一条不能用。
    expect(CSS).toContain(".skin-card-feel + .skin-btn");
    expect(ruleBlock(CSS, ".skin-card-feel + .skin-btn")).toContain("margin-left: auto");
  });
});

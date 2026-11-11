/// <reference types="node" />
/**
 * 可点区域阶梯（2026-11-11）。
 *
 * 桌面端的点击精度比触屏高，但仍有一条下限：24px 是「要用鼠标瞄两次」的分界。
 * 这一轮真机量到三档不一致：图标钮 32、分组加号 30、作品库移除 24、头部文字钮 30 ——
 * 同一屏里四枚功能相同的按钮四种高度，排在一起上沿不在一条线上。
 *
 * 裁定：
 *  - 标准图标钮 32（icon-button 一族）；
 *  - 行内小动作 28（作品库移除、行尾按钮）；
 *  - 分组加号 30（左栏行高 30，跟着行走）；
 *  - 头部文字钮 32（与同排图标钮齐）；
 *  - 发送键 34（卡片里最大的一枚，视觉落点）。
 * 这里钉的是**下限与对齐关系**，不禁止以后整体抬高。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, styleSource } from "../utils/vue-source-reader";

function px(rule: string, prop: string): number {
  const match = new RegExp(`(?:^|\\n)\\s*${prop}\\s*:\\s*(\\d+)px`).exec(rule);
  expect(match, `规则里没有 ${prop}`).not.toBeNull();
  return Number(match![1]);
}

describe("可点区域：下限 28，同排同高", () => {
  it("标准图标钮 32×32", () => {
    const rule = ruleBlock(styleSource("conversation-pane.css"), ".icon-button");
    expect(px(rule, "width")).toBe(32);
    expect(px(rule, "height")).toBe(32);
  });

  it("作品库移除钮 28×28（原 24：鼠标要瞄两次）", () => {
    const rule = ruleBlock(styleSource("book-library.css"), ".book-library-forget");
    expect(px(rule, "width")).toBe(28);
    expect(px(rule, "height")).toBe(28);
  });

  it("左栏分组加号 30 —— 跟着 30px 行高走，不单独抬高", () => {
    const rule = ruleBlock(styleSource("left-nav.css"), ".section-add");
    expect(px(rule, "width")).toBe(30);
    expect(px(rule, "height")).toBe(30);
  });

  it("头部文字钮与同排图标钮齐平（32，不是 30）", () => {
    const rule = ruleBlock(styleSource("conversation-pane.css"), ".header-text-button");
    expect(px(rule, "min-height")).toBe(32);
  });

  it("发送键 34×34，仍是卡片里最大的一枚", () => {
    const rule = ruleBlock(styleSource("agent-pane.css"), ".send-button");
    expect(px(rule, "width")).toBe(34);
    expect(px(rule, "height")).toBe(34);
  });
});

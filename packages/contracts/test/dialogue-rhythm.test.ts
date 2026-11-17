import { describe, expect, it } from "vitest";
import { dialogueParagraphShapeOf } from "../src/dialogue-rhythm.js";

/**
 * 对白段落形态（2026-11-16）：含对白的段落里，纯台词段与「台词＋节拍」段各多少。
 * 用例钉的是计数口径与样本门槛，不是「纯对白多少算病」（那要真人语料分位，本仓不编）。
 */

const repeat = (line: string, times: number): string[] => Array.from({ length: times }, () => line);

describe("dialogueParagraphShapeOf · 对白段落形态", () => {
  it("台词与动作同段 ⇒ 全部计入 mixed，pure 为 0", () => {
    const shape = dialogueParagraphShapeOf(repeat("「走吧。」他把门推开。", 10));
    expect(shape).toEqual({ withDialogue: 10, pure: 0, mixed: 10 });
  });

  it("引号外只剩标点/符号也算纯对白段（竖排对白常见的收尾记号线）", () => {
    const shape = dialogueParagraphShapeOf([
      ...repeat("「走吧。」", 5),
      ...repeat("「走吧。」——", 5)
    ]);
    expect(shape).toEqual({ withDialogue: 10, pure: 10, mixed: 0 });
  });

  it("纯对白与同段节拍各半时，分母只数含对白的段落", () => {
    const shape = dialogueParagraphShapeOf([
      ...repeat("「走吧。」", 4),
      ...repeat("「走吧。」他说。", 4),
      ...repeat("雨还在下。", 4)
    ]);
    expect(shape).toEqual({ withDialogue: 8, pure: 4, mixed: 4 });
  });

  it("半角引号同样认（与 dialogue.ts 的 scanQuotes 同一口径）", () => {
    const shape = dialogueParagraphShapeOf(repeat('"走吧。"', 10));
    expect(shape).toEqual({ withDialogue: 10, pure: 10, mixed: 0 });
  });

  it("段落不足样本门槛 ⇒ null（不是 0）", () => {
    expect(dialogueParagraphShapeOf(repeat("「走吧。」", 9))).toBeNull();
  });

  it("够段数但没有对白段 ⇒ null（没有样本，不是比例 0）", () => {
    expect(dialogueParagraphShapeOf(repeat("雨还在下。", 12))).toBeNull();
  });
});

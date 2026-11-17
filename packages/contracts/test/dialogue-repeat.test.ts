import { describe, expect, it } from "vitest";
import { DIALOGUE_REPEAT_MIN_CHARS, dialogueRepeatsOf } from "../src/dialogue-repeat.js";

/**
 * 对白复读（2026-11-16）：同一句台词原话在书里出现 ≥2 次才点名。
 * 用例钉口径：只取引号内、短应答不算、按次数降序。
 */

describe("dialogueRepeatsOf · 对白复读", () => {
  it("同一句台词两次 ⇒ 一条复读，计数 2", () => {
    expect(dialogueRepeatsOf(["「知道了。」他点头。", "「知道了。」她没抬头。"])).toEqual([
      { line: "知道了。", count: 2 }
    ]);
  });

  it("叙述里的相同短句不算——只取引号内的字", () => {
    expect(dialogueRepeatsOf(["他走了。", "他走了。"])).toEqual([]);
  });

  it("一两个字的应答不数（门槛是至少 3 个非标点字）", () => {
    expect(DIALOGUE_REPEAT_MIN_CHARS).toBe(3);
    expect(dialogueRepeatsOf(["「好。」", "「好。」"])).toEqual([]);
    expect(dialogueRepeatsOf(["「走吧。」", "「走吧。」"])).toEqual([]);
    expect(dialogueRepeatsOf(["「知道了。」", "「知道了。」"])).toEqual([
      { line: "知道了。", count: 2 }
    ]);
  });

  it("半角引号同样认（与 scanQuotes 同一口径）", () => {
    expect(dialogueRepeatsOf(['"知道了。"', '"知道了。"'])).toEqual([
      { line: "知道了。", count: 2 }
    ]);
  });

  it("只出现一次的不进清单；多次的按次数降序", () => {
    const lines = [
      "「知道了。」",
      "「知道了。」",
      "「知道了。」",
      "「随你便。」",
      "「随你便。」",
      "「走吧。」"
    ];
    expect(dialogueRepeatsOf(lines)).toEqual([
      { line: "知道了。", count: 3 },
      { line: "随你便。", count: 2 }
    ]);
  });
});

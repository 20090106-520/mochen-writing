import { describe, expect, it } from "vitest";
import {
  SENTENCE_OPENING_CHARS,
  SENTENCE_OPENING_MIN_COUNT,
  SENTENCE_OPENING_TOP,
  sentenceOpeningsOf
} from "../src/sentence-opening.js";

/**
 * 句首趋同读数（2026-11-17 从 main 下沉到 contracts）。
 *
 * 这条读数只钉**口径**：前 2 个实字、≥2 次才上榜、最多 5 条。
 * 不钉「重复率多少算病」——那要语料分位，不是这里的事。
 */
describe("sentenceOpeningsOf · 口径", () => {
  it("句首取剥掉前置标点／引号后的前 2 个实字", () => {
    expect(SENTENCE_OPENING_CHARS).toBe(2);
    // 每句各出现 3 次：句首是「你又」「他推」「她站」，引号不参与。
    // 同次数按字符序（zh 排序），所以顺序是「你又」在「他推」前。
    const text = "「你又来了。」他推门。她站着。".repeat(3);
    expect(sentenceOpeningsOf([text])).toEqual([
      { opening: "你又", count: 3 },
      { opening: "他推", count: 3 },
      { opening: "她站", count: 3 }
    ]);
  });

  it("出现 1 次不上榜（≥2 次是结构性定义，不是质量线）", () => {
    expect(SENTENCE_OPENING_MIN_COUNT).toBe(2);
    expect(sentenceOpeningsOf(["他只来了一次。"])).toEqual([]);
  });

  it("按次数降序，最多 5 条", () => {
    expect(SENTENCE_OPENING_TOP).toBe(5);
    const lines: string[] = [];
    // 七个互不相同的句首，各 2 次 —— 上榜的只应有 5 条。
    for (const opening of ["甲乙", "丙丁", "戊己", "庚辛", "壬癸", "子丑", "寅卯"]) {
      lines.push(`${opening}。`, `${opening}。`);
    }
    const openings = sentenceOpeningsOf([lines.join("")]);
    expect(openings).toHaveLength(SENTENCE_OPENING_TOP);
    expect(openings.every((entry) => entry.count === 2)).toBe(true);
  });
});

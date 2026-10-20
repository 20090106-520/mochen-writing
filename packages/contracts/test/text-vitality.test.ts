import { describe, expect, it } from "vitest";
import {
  AI_FLAVOR_GATE,
  aiFlavorGate,
  charNgramEntropy,
  sentenceBurstiness,
  sentenceRhythmOf,
  typeTokenRatio,
  vitalityOf,
  VITALITY_NGRAM_N
} from "../src/index.js";

/**
 * 文本活性代理指标（P1-⑥）。
 *
 * 这里钉两类事：
 * ① 三枚读数的手算值与 null 边界（越界就是编数）；
 * ② 一条**反推不变量**——突发度必须能由 `sentenceRhythmOf` 的读数反推出来。
 *    这条是「切句与句长统计只此一份」的机器判据：将来谁在活性模块里另切一遍句，
 *    精度与门槛立刻走岔，这里就红。
 */

/** n 句**句句等长**的正文：spread = 0 ⇒ 突发度必须是 −1。 */
const FLAT = Array.from({ length: 10 }, () => "他走过来。").join("\n");

/** 长短交替（3 字 / 9 字）：均值 6、σ 3、spread 0.5 ⇒ 突发度 = (0.5−1)/(0.5+1) = −0.33。 */
const VARIED = Array.from({ length: 10 }, (_, i) =>
  i % 2 === 0 ? "他走。" : "他慢慢地走过来了。"
).join("\n");

describe("charNgramEntropy · 字串熵（困惑度的代理）", () => {
  it("默认 2-gram：手算定值", () => {
    // "abab" ⇒ ab×2、ba×1，共 3 枚：H = −(⅔·log2⅔ + ⅓·log2⅓) = 0.918…
    expect(charNgramEntropy("abab")).toBe(0.92);
    // "aabb" ⇒ aa / ab / bb 各一枚，等概率：H = log2 3 = 1.585…
    expect(charNgramEntropy("aabb")).toBe(1.58);
  });

  it("同一枚 gram 反复出现 ⇒ 熵为 0（完全可预测）", () => {
    expect(charNgramEntropy("aaaa")).toBe(0);
  });

  it("n 可换：3-gram 手算", () => {
    // "abcabc" ⇒ abc×2、bca×1、cab×1，共 4 枚：H = 0.5 + 1 = 1.5
    expect(charNgramEntropy("abcabc", 3)).toBe(1.5);
    expect(VITALITY_NGRAM_N).toBe(2);
  });

  it("错落的文本熵更高（代理指标的方向）", () => {
    const flat = charNgramEntropy("他他他他他他");
    const varied = charNgramEntropy("他走了又回来坐下");
    expect(flat).not.toBeNull();
    expect(varied).not.toBeNull();
    expect(flat!).toBeLessThan(varied!);
  });

  it("短于 n 字 ⇒ null；n 不合法 ⇒ null（不在边界上编数）", () => {
    expect(charNgramEntropy("a")).toBeNull();
    expect(charNgramEntropy("")).toBeNull();
    expect(charNgramEntropy("abc", 0)).toBeNull();
  });
});

describe("sentenceBurstiness · 句长突发度", () => {
  it("反推不变量：恒等于 (spread − 1) / (spread + 1)，且门槛与 sentenceRhythmOf 同源", () => {
    for (const text of [FLAT, VARIED, "他一走。"]) {
      const rhythm = sentenceRhythmOf(text);
      if (rhythm === null) {
        expect(sentenceBurstiness(text)).toBeNull();
        continue;
      }
      expect(sentenceBurstiness(text)).toBe(
        Math.round(((rhythm.spread - 1) / (rhythm.spread + 1)) * 100) / 100
      );
    }
  });

  it("句句等长 ⇒ −1（σ = 0 的端点）", () => {
    expect(sentenceBurstiness(FLAT)).toBe(-1);
  });

  it("长短交替 ⇒ 手算 −0.33", () => {
    expect(sentenceBurstiness(VARIED)).toBe(-0.33);
  });

  it("不足 10 句 ⇒ null（与句长节奏同一门槛，不自己另定一条）", () => {
    expect(sentenceBurstiness("他一走。")).toBeNull();
    expect(sentenceBurstiness("")).toBeNull();
  });
});

describe("typeTokenRatio · 字多样性", () => {
  it("手算：不同字数 ÷ 总字数（按码点、空白不计）", () => {
    expect(typeTokenRatio("他他他他")).toBe(0.25);
    expect(typeTokenRatio("甲乙丙丁")).toBe(1);
  });

  it("空白与换行不计入 token", () => {
    expect(typeTokenRatio("他 他\n他")).toBe(0.333);
    expect(typeTokenRatio("他\t他  他")).toBe(0.333);
  });

  it("空串与纯空白 ⇒ null", () => {
    expect(typeTokenRatio("")).toBeNull();
    expect(typeTokenRatio("  \n\t ")).toBeNull();
  });
});

describe("vitalityOf · 三枚读数装一起", () => {
  it("字数口径与退稿闸同一份（charCount === text.length）", () => {
    const text = "他一走。\n她笑了。";
    expect(vitalityOf(text).charCount).toBe(text.length);
    expect(vitalityOf(text).charCount).toBe(aiFlavorGate(text).charCount);
    expect(AI_FLAVOR_GATE.minChars).toBe(200);
  });

  it("短文：熵与多样性有值、突发度算不出（三项各算各的，互不牵连）", () => {
    const reading = vitalityOf("他一走。");
    expect(reading.ngramEntropy).not.toBeNull();
    expect(reading.burstiness).toBeNull();
    expect(reading.diversity).toBe(1);
  });

  it("足够长的正文：三项齐（活性读数在真实篇幅上算得出来）", () => {
    const reading = vitalityOf(`${VARIED}\n${VARIED}\n${VARIED}`);
    expect(reading.ngramEntropy).not.toBeNull();
    expect(reading.burstiness).toBe(-0.33);
    expect(reading.diversity).not.toBeNull();
  });

  it("空串：三枚全 null，字数 0", () => {
    expect(vitalityOf("")).toEqual({
      charCount: 0,
      ngramEntropy: null,
      burstiness: null,
      diversity: null
    });
  });
});

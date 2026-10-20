import { describe, expect, it } from "vitest";
import {
  DEGENERATION_PARTICLE_CHARS,
  DEGENERATION_SHORT_SENTENCE_MAX_CHARS,
  degenerationOf,
  particlePerThousand,
  shortSentenceRatio
} from "../src/text-degeneration.js";
import { aiFlavorGate, sentenceRhythmOf } from "../src/ai-flavor.js";

/**
 * 退化读数（P1-⑦）的代理指标：虚词密度、短句占比、平均句长。
 * 三枚**都不设判线、不聚合**（同 §一百三十五 活性读数）——本组钉的是读数本身算得准、口径与真身同源。
 */

/** 长短交替的十句：五句 3 字（短）、五句 9 字（长），一串拼成一行（不插换行，免得字数被换行搅乱）。 */
const ALTERNATING = "他走。他慢慢地走过来了。".repeat(5);

describe("degenerationOf · 门口（算不出就说算不出，不硬报 0）", () => {
  it("空文本：三枚读数全 null（0 除 0 没有意义）", () => {
    expect(degenerationOf("")).toEqual({
      charCount: 0,
      particlePerThousand: null,
      shortSentenceRatio: null,
      meanSentenceLength: null
    });
  });

  it("不足十句：句级两枚为 null，虚词密度照出（它只看字数，不看句数）", () => {
    const reading = degenerationOf("他走。他走。他走。");
    expect(reading.shortSentenceRatio).toBeNull();
    expect(reading.meanSentenceLength).toBeNull();
    expect(reading.particlePerThousand).toBe(0);
    expect(reading.charCount).toBe("他走。他走。他走。".length);
  });
});

describe("degenerationOf · 三枚读数算得准", () => {
  // 十句共 60 字；虚词命中：短句 0 枚 ×5 ＋ 长句（地／过／了 各 1）×5 = 15 ⇒ 15/60×1000 = 250。
  it("虚词密度：15 枚 / 60 字 ⇒ 250 每千字", () => {
    expect(degenerationOf(ALTERNATING).particlePerThousand).toBe(250);
    expect(particlePerThousand(ALTERNATING)).toBe(250);
  });

  it("短句占比：10 句里 5 句短 ⇒ 0.5", () => {
    expect(degenerationOf(ALTERNATING).shortSentenceRatio).toBe(0.5);
    expect(shortSentenceRatio(ALTERNATING)).toBe(0.5);
  });

  it("短句刻度是「含句末标点 ≤4 字」：4 字算短、5 字不算", () => {
    expect(DEGENERATION_SHORT_SENTENCE_MAX_CHARS).toBe(4);
    // 「他走了。」＝4 字（含句号）⇒ 全短；「他们走了。」＝5 字 ⇒ 全不算短。
    expect(degenerationOf("他走了。".repeat(10)).shortSentenceRatio).toBe(1);
    expect(degenerationOf("他们走了。".repeat(10)).shortSentenceRatio).toBe(0);
  });
});

describe("degenerationOf · 口径与真身同源（要能机器判）", () => {
  it("平均句长恒等于 sentenceRhythmOf 的读数，不重算一份", () => {
    expect(degenerationOf(ALTERNATING).meanSentenceLength).toBe(
      sentenceRhythmOf(ALTERNATING)?.mean
    );
    expect(degenerationOf(ALTERNATING).meanSentenceLength).toBe(6);
    // 算不出时同源为 null。
    expect(degenerationOf("他走。").meanSentenceLength).toBe(sentenceRhythmOf("他走。"));
  });

  it("字数与退稿闸同口径", () => {
    expect(degenerationOf(ALTERNATING).charCount).toBe(ALTERNATING.length);
    expect(degenerationOf(ALTERNATING).charCount).toBe(aiFlavorGate(ALTERNATING).charCount);
  });
});

describe("degenerationOf · 清单只此一份", () => {
  it("虚词清单非空、全是单字、无重复", () => {
    expect(DEGENERATION_PARTICLE_CHARS.length).toBe(26);
    for (const char of DEGENERATION_PARTICLE_CHARS) {
      expect([...char].length).toBe(1);
    }
    expect(new Set(DEGENERATION_PARTICLE_CHARS).size).toBe(DEGENERATION_PARTICLE_CHARS.length);
  });
});

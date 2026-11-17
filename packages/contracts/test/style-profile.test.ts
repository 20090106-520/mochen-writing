import { describe, expect, it } from "vitest";
import { dialogueBalance } from "../src/dialogue.js";
import { STYLE_PROFILE_MIN_CHARS, styleProfileOf } from "../src/style-profile.js";

/**
 * 「本书腔调摘要」的**测量真身**（2026-10-19 · P0-③）。
 *
 * 这本摘要要治的是长篇最常见的退化：每一章都在「写好」，于是每一章都不像前面那些章。
 * 它把技能库《给这本书立一本文风手册》的六维拆法里**量得出来的四维**落地——
 * 句长、标点脾气、对白占比、段末收法；另两维（叙述距离、冲突戏怎么写）量不出来，
 * 不硬凑（spec §一）。
 *
 * 用例里的数都是手算的：单位文本的字数、标点数写死在注释里，一旦口径被改就红。
 */

/** 作用段：20 个非空白字（含一对破折号），句末一个句号 —— 26 段 = 520 字、26 处破折号。 */
const ACTION = "他把碗放下，手在桌沿停了停——她没抬头。";
/** 分号段：9 个字、1 处分号 —— 60 段 = 540 字、60 处分号。 */
const SEMI = "他停下来；她没有。";
/** 省略号段：10 个字（…… 占两个码点）、1 处省略号 —— 52 段 = 520 字、52 处。 */
const ELLIPSIS = "他愣住了……她没有。";

describe("styleProfileOf · 样本门槛", () => {
  it("非空白字数不足 500 不立手册（开书之前没有样本可拆）", () => {
    expect(STYLE_PROFILE_MIN_CHARS).toBe(500);
    // ACTION 每段 20 字：24 段 = 480（不足），25 段 = 500（刚到线）。
    expect(styleProfileOf([ACTION.repeat(24)])).toBeNull();
    expect(styleProfileOf([ACTION.repeat(25)])).not.toBeNull();
  });

  it("空白稿不立手册（不算负样本）", () => {
    expect(styleProfileOf(["   \n\n  "])).toBeNull();
  });

  it("多篇合成一份：字数按篇累加（同一口径，不重算）", () => {
    const a = ACTION.repeat(13);
    const b = ACTION.repeat(13);
    const profile = styleProfileOf([a, b]);
    expect(profile?.charCount).toBe(dialogueBalance(a + "\n" + b).total);
    expect(profile?.charCount).toBe(520);
  });
});

describe("styleProfileOf · ①句子长度（复用 sentenceRhythmOf 真身）", () => {
  it("等长句报出平均值，波动为 0（句句 20 字）", () => {
    const profile = styleProfileOf([ACTION.repeat(26)]);
    expect(profile?.rhythm?.mean).toBe(20);
    expect(profile?.rhythm?.spread).toBe(0);
  });

  it("句数不足 10 句不编数（该维不报，不是报 0）", () => {
    // 540 字写成**一个**句子（全篇无句读）：样本够，句数不够 —— 句长维如实不报。
    const oneLongSentence = "他把碗放下手在桌沿停了停她又没有抬头他把碗端起来又放下".repeat(20);
    const profile = styleProfileOf([oneLongSentence]);
    expect(profile).not.toBeNull();
    expect(profile?.rhythm).toBeNull();
  });
});

describe("styleProfileOf · ②标点脾气（每千字密度）", () => {
  it("破折号：520 字里 26 处 ⇒ 50/千字；另两样为 0（不虚报）", () => {
    const profile = styleProfileOf([ACTION.repeat(26)]);
    expect(profile?.charCount).toBe(520);
    expect(profile?.punctuation.dash).toBe(50);
    expect(profile?.punctuation.semicolon).toBe(0);
    expect(profile?.punctuation.ellipsis).toBe(0);
  });

  it("分号：540 字里 60 处 ⇒ 111.1/千字", () => {
    expect(styleProfileOf([SEMI.repeat(60)])?.punctuation.semicolon).toBe(111.1);
  });

  it("省略号：520 字里 52 处 ⇒ 100/千字（…… 按一处计，不按两个码点计）", () => {
    expect(styleProfileOf([ELLIPSIS.repeat(52)])?.punctuation.ellipsis).toBe(100);
  });
});

describe("styleProfileOf · ④对白与叙述比例（复用 dialogueBalance 真身）", () => {
  it("与 dialogueBalance 同一个数（不抄第二份口径）", () => {
    // 「你到底想说什么，直说就行。」13 字 ＋ 叙述 8 字 = 21 字/段，26 段 = 546 字。
    const text = "「你到底想说什么，直说就行。」她把杯子推过去。".repeat(26);
    const profile = styleProfileOf([text]);
    expect(profile?.dialogueRatio).toBe(dialogueBalance(text).ratio);
    // 338 / 546 = 0.619…，真身不四舍五入（说的那一段才四舍）。
    expect(profile?.dialogueRatio).toBeCloseTo(0.619, 3);
  });
});

describe("styleProfileOf · ⑤每段的收法（段末是否仍在引号内）", () => {
  /** 半角未闭合（出厂主笔就用半角引号）：段末仍在台词里。 */
  const ENDS_ON_QUOTE = '"他把碗放下，手在桌沿停了停，省了这许多话。';
  /** 半角已闭合：段末落在叙述上。 */
  const ENDS_ON_ACTION = '"喝吧。"他把杯子推过去。';

  it("全部收在台词上 ⇒ 60/60", () => {
    const text = Array.from({ length: 60 }, () => ENDS_ON_QUOTE).join("\n");
    expect(styleProfileOf([text])?.endsOnQuote).toEqual({ count: 60, total: 60 });
  });

  it("全部收在叙述上 ⇒ 0/60（不是恒报满）", () => {
    const text = Array.from({ length: 60 }, () => ENDS_ON_ACTION).join("\n");
    expect(styleProfileOf([text])?.endsOnQuote).toEqual({ count: 0, total: 60 });
  });

  it("混排 ⇒ 只数收在台词上的那些（20 条台词收尾 ＋ 40 条叙述收尾 ⇒ 20/60）", () => {
    const text = [
      Array.from({ length: 20 }, () => ENDS_ON_QUOTE).join("\n"),
      Array.from({ length: 40 }, () => ENDS_ON_ACTION).join("\n")
    ].join("\n");
    expect(styleProfileOf([text])?.endsOnQuote).toEqual({ count: 20, total: 60 });
  });
});

/**
 * 段落节奏（2026-11-15）：平均段长与段长波动。
 * 用例钉的是**口径**：按非空行的 `line.length` 算、波动是变异系数、不足 10 段不报。
 */
describe("styleProfileOf · ⑥段落节奏（段长均值与波动）", () => {
  /** 6 字的短段。 */
  const SHORT = "他把碗放下。";
  /** 20 字的长段（与上面 ACTION 同一句）。 */
  const LONG = ACTION;

  it("段长全一样 ⇒ 波动 0（句句 20 字的 26 段）", () => {
    const text = Array.from({ length: 26 }, () => LONG).join("\n");
    expect(styleProfileOf([text])?.paragraph).toEqual({ mean: 20, spread: 0 });
  });

  it("长短参差 ⇒ 均值 13、波动 0.54（手算：25×6 ＋ 25×20，sd 7 ÷ mean 13）", () => {
    const text = [
      ...Array.from({ length: 25 }, () => SHORT),
      ...Array.from({ length: 25 }, () => LONG)
    ].join("\n");
    const paragraph = styleProfileOf([text])?.paragraph;
    expect(paragraph?.mean).toBe(13);
    expect(paragraph?.spread).toBe(0.54);
  });

  it("段落不足 10 段 ⇒ 不报（样本门槛，不是报 0）", () => {
    // 9 段 × 60 字 = 540 字：总字数够立手册，段数不够 —— 这一维如实不报。
    const nine = Array.from({ length: 9 }, () => LONG.repeat(3)).join("\n");
    expect(styleProfileOf([nine])?.paragraph).toBeNull();
    // 第 10 段一到线就报。
    const ten = Array.from({ length: 10 }, () => LONG.repeat(3)).join("\n");
    expect(styleProfileOf([ten])?.paragraph).not.toBeNull();
  });
});

/**
 * 段末标点分布（2026-11-16）：每段按最后一个句末标点归一类，只报占比、不判好坏。
 */
describe("styleProfileOf · ⑦段末标点分布", () => {
  it("四类各占多少：50 句号 / 25 问号 / 20 感叹号 / 5 省略号 ⇒ 0.5 / 0.25 / 0.2 / 0.05", () => {
    const period = ACTION; // 20 字，收在句号
    const question = `${ACTION.slice(0, -1)}？`;
    const exclamation = `${ACTION.slice(0, -1)}！`;
    const ellipsis = `${ACTION.slice(0, -1)}……`;
    const text = [
      ...Array.from({ length: 50 }, () => period),
      ...Array.from({ length: 25 }, () => question),
      ...Array.from({ length: 20 }, () => exclamation),
      ...Array.from({ length: 5 }, () => ellipsis)
    ].join("\n");
    expect(styleProfileOf([text])?.endMarkShare).toEqual({
      period: 0.5,
      question: 0.25,
      exclamation: 0.2,
      ellipsis: 0.05,
      other: 0
    });
  });

  it("收引号不把台词段算进 other：`。」` 归句号、`？」` 归问号", () => {
    const quotedPeriod = `「${ACTION}」`; // 22 字，段末是 。」
    const quotedQuestion = `「${ACTION.slice(0, -1)}？」`;
    const text = [
      ...Array.from({ length: 20 }, () => quotedPeriod),
      ...Array.from({ length: 10 }, () => quotedQuestion)
    ].join("\n");
    const share = styleProfileOf([text])?.endMarkShare;
    expect(share?.period).toBe(0.667);
    expect(share?.question).toBe(0.333);
    expect(share?.other).toBe(0);
  });
});

/**
 * 「本书腔调摘要」的**测量真身**（2026-10-19 · P0-③ 作者风格档案下沉）。
 *
 * 技能库《给这本书立一本文风手册》（`skill-catalog-style.ts`，`dirName: style-handbook`）给的是
 * 六维拆法：① 句子长度 ② 标点脾气 ③ 叙述距离 ④ 对白与叙述比例 ⑤ 每段的收法
 * ⑥ 硬碰硬处怎么写。它治的是长篇最常见的退化——「每一章都在写好，于是每一章都不像前面那些章」。
 * 但它此前只是「用户手动挂进技能栏才生效」的技能：默认那一轮模型看不见它。
 * 这里把其中**量得出来的四维**下沉成常驻读数，由 prompt-assembly 说成人话喂给这一轮
 * （与 dialogue.ts / dialogueBalanceSentence 同一分工：数字住这里，措辞住那边）。
 *
 * ③⑥ 两维**不硬凑**：叙述距离、冲突戏写情绪还是动作，要读整章的语义与信息落差才判得准，
 * 按 §一百零五 取舍只写进生成端（摘要里如实说「本段不报」），不上正则。
 *
 * 数字只住真身：句长复用 `sentenceRhythmOf`、对白占比复用 `dialogueBalance`（都不重算一遍）。
 */
import { sentenceRhythmOf, type SentenceRhythm } from "./ai-flavor.js";
import { dialogueBalance, endsInsideQuote } from "./dialogue.js";

/**
 * 样本门槛：参与统计的正文**非空白字数**不足这个数就不立手册。
 * 技能原文的纪律——**不要在开书之前立手册**，没有样本可拆，立出来的只能是别人的东西。
 */
export const STYLE_PROFILE_MIN_CHARS = 500;

/**
 * 标点脾气的三样（技能原文点名的）：每千字密度。
 * 单个 `—` / `…` 不单列——本仓产出用的都是成对写法，多列一档只会让口径变糊。
 */
export const STYLE_PROFILE_PUNCTUATION = [
  { key: "dash", mark: "——", label: "破折号" },
  { key: "semicolon", mark: "；", label: "分号" },
  { key: "ellipsis", mark: "……", label: "省略号" }
] as const;

export type StylePunctuationKey = (typeof STYLE_PROFILE_PUNCTUATION)[number]["key"];

export interface StyleProfile {
  /** 参与统计的非空白字数（与 dialogueBalance 同一口径）。 */
  charCount: number;
  /** 句长与波动；句数不足 10 句为 null——该维**不报**，不是报 0。 */
  rhythm: SentenceRhythm | null;
  /** 标点脾气：每千字几处（1 位小数）。 */
  punctuation: Record<StylePunctuationKey, number>;
  /** 对白占比（引号内字数 ÷ 非空白字数）。 */
  dialogueRatio: number;
  /** 段末收法：收在台词上的段数 ÷ 总段数（段按非空行切）。 */
  endsOnQuote: { count: number; total: number };
}

/**
 * 从已完稿正文量一份腔调档案。contents 是各章正文（按文档顺序）。
 *
 * 样本不足返回 `null`——「样本不够」不是「这本书没有腔调」，两者必须分开：
 * 返回一份全 0 的档案会让模型以为这本书没有对白、没有起伏。
 */
export function styleProfileOf(contents: readonly string[]): StyleProfile | null {
  const text = contents.join("\n");
  const balance = dialogueBalance(text);
  if (balance.total < STYLE_PROFILE_MIN_CHARS) return null;

  const paragraphs = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const punctuation = {} as Record<StylePunctuationKey, number>;
  for (const { key, mark } of STYLE_PROFILE_PUNCTUATION) {
    const count = text.split(mark).length - 1;
    punctuation[key] = Math.round((count / balance.total) * 1000 * 10) / 10;
  }

  return {
    charCount: balance.total,
    rhythm: sentenceRhythmOf(text),
    punctuation,
    dialogueRatio: balance.ratio,
    endsOnQuote: {
      count: paragraphs.filter((line) => endsInsideQuote(line)).length,
      total: paragraphs.length
    }
  };
}

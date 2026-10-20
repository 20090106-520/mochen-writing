/**
 * 文本活性的三枚**代理读数**（P1-⑥，2026-10-20）。
 *
 * 【这一份是干什么的】外部报告的 P1-⑥：本仓没有模型概率，就用**零依赖的代理指标**衡量
 * 「哪版更活」。三枚读数——字串熵（困惑度的代理）、句长突发度、字多样性——**都越大越像人写的**，
 * 只服务于一种用途：**同一次改稿前后 / 同一轮 N 稿之间的相对比较**。
 *
 * 【为什么它们是代理】真正的困惑度要一个语言模型；这里用字符 n-gram 频率的**香农熵**顶替
 * （困惑度 = 2^H，同一份信息——报 H 是因为它是线性量，不制造指数级数字）。突发度与多样性是
 * 文本统计里的成法读数，不需要任何语料。
 *
 * 【不做绝对判据】三枚读数**不进任何闸**：不进 `aiFlavorGate`（`AI_FLAVOR_GATE` 的四条判线一个不碰）、
 * 不进体检起报、不进 `rankDrafts` 的排序键。它们之间也不加权聚合——三枚是不同的探针，
 * 捏成一个「活跃总分」就得先编一套权重，那是编出来的数。所以本文件**只出读数**：
 * 判定、择优仍然由用户看着数自己拍板（同多稿面板「只给序不给总分」那条取舍）。
 * 同理**不导出**长度可比性阈值：本刀没有机器消费者，导出即死代码。
 *
 * 【已知偏差，不掩盖】熵与多样性都**随文本变长而偏高**（样本越多，罕见的 n-gram / 字越容易被采到），
 * 这是代理指标的固有偏差，不是 bug；突发度是尺度无关量、与长度无关。所以两稿字数差得多时，
 * 熵与多样性要当心读——这条偏差写成话告诉用户，**不用机器阈值去「修正」它**（修正量本身就是编数）。
 *
 * 【切句只此一份】突发度**不另切一遍句**：它由 `sentenceRhythmOf` 的读数反推
 * （`spread = σ/μ` ⇒ `B = (spread − 1) / (spread + 1)`），切句与句长统计只住 `ai-flavor.js`
 * 一处（铁律 6）；门槛也因此与句长节奏同源（不足 `SENTENCE_SPREAD_MIN_SENTENCES` 句即 null）。
 */

import { sentenceRhythmOf } from "./ai-flavor.js";

/** 字串熵的默认 n：2-gram。中文正文的字符二元组已能看出「字串可不可预测」。 */
export const VITALITY_NGRAM_N = 2;

export interface VitalityReading {
  /** 与 `aiFlavorGate(t).charCount` 同一口径的字数（UTF-16 长度）。 */
  charCount: number;
  /** 字符 n-gram 熵（bits/gram，2 位小数）；短于 n 字为 null。 */
  ngramEntropy: number | null;
  /** 句长突发度 (σ − μ) / (σ + μ)（2 位小数，越大越错落）；不足 10 句为 null。 */
  burstiness: number | null;
  /** 字多样性 = 不同字数 ÷ 总字数（3 位小数，按码点、空白不计）；无字符为 null。 */
  diversity: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 字符 n-gram 频率的香农熵（bits/gram，2 位小数）——困惑度的代理，越大越不可预测。
 * 换行、标点等字符**原样参与**（不做任何清洗）：两版正文的清洗口径必须一样才谈得上相对比较，
 * 与其各洗一套不如都不洗。
 * 短于 n 字、或 n < 1（取不出任何 gram）⇒ null：算不出就说算不出，不在边界上编数。
 */
export function charNgramEntropy(text: string, n: number = VITALITY_NGRAM_N): number | null {
  if (n < 1 || text.length < n) return null;
  const counts = new Map<string, number>();
  for (let at = 0; at + n <= text.length; at += 1) {
    const gram = text.slice(at, at + n);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  const total = text.length - n + 1;
  let entropy = 0;
  for (const count of counts.values()) {
    const chance = count / total;
    entropy -= chance * Math.log2(chance);
  }
  return round2(entropy);
}

/**
 * 句长突发度 (σ − μ) / (σ + μ)，2 位小数。
 * 值域 [−1, 1]：−1 = 句句等长（σ = 0，最像机器），越接近 1 = 长短越错落。
 * **反推自 `sentenceRhythmOf`**，不另切一遍句——`spread = σ/μ` 时上式恰好等于 `(spread − 1) / (spread + 1)`。
 * 门槛随真身（不足 `SENTENCE_SPREAD_MIN_SENTENCES` 句）⇒ null。
 */
export function sentenceBurstiness(text: string): number | null {
  const rhythm = sentenceRhythmOf(text);
  if (rhythm === null) return null;
  return round2((rhythm.spread - 1) / (rhythm.spread + 1));
}

/**
 * 字多样性 = 不同字数 ÷ 总字数（3 位小数）。
 * token = **非空白字符**（`\s` 全算空白：空格、换行、制表符都不进 token）；中文不切词，
 * 以**码点**为 token（emoji 不算两个 token）。无字符 ⇒ null。
 */
export function typeTokenRatio(text: string): number | null {
  const tokens = [...text].filter((char) => !/\s/u.test(char));
  if (tokens.length === 0) return null;
  return round3(new Set(tokens).size / tokens.length);
}

/** 三枚读数一次算齐（面板每稿一行，逐枚调用不如装在一起）。 */
export function vitalityOf(text: string): VitalityReading {
  return {
    charCount: text.length,
    ngramEntropy: charNgramEntropy(text),
    burstiness: sentenceBurstiness(text),
    diversity: typeTokenRatio(text)
  };
}

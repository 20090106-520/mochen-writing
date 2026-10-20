/**
 * 文本退化的三枚**代理读数**（P1-⑦，2026-10-20）。
 *
 * 【这一份是干什么的】外部报告的 P1-⑦「退化专项：电报体／短碎句／虚词扫光」。
 * 本仓此前只有「复读」一条退化判据——它抓的是「打转」；这一份抓的是**反面**：
 * **删过头**（改稿把虚词削平、句子全砍短）也会写出另一种机器味。
 *
 * 【与 text-vitality 的分工】`text-vitality.ts`（P1-⑥）量的是**活性**：熵／突发度／多样性
 * ——**越大越像人写的**。本文件量的是**塌平**：虚词密度／短句占比／平均句长
 * ——**虚词越少、句子越短越像被削平**。两者方向相反、维度不同，不是同一件事的两份实现。
 *
 * 【零阈值，只摆数】同 §一百三十五 的范式：三枚读数**不进任何闸**——
 * 不进 `aiFlavorGate`（`AI_FLAVOR_GATE` 的四条判线一个不碰）、不进体检起报、
 * 不进 `rankDrafts` 的排序键。它们之间也不加权聚合（三枚方向不同，捏成一个「退化总分」要先编权重）。
 * 所以本文件**只出读数**：判定仍由用户看着数自己拍板。本刀**不导出**长度可比性阈值——没有机器消费者，导出即死代码。
 *
 * 【切句只此一份】短句占比不另切一遍句：它走 `sentencesOf`（与 `sentenceRhythmOf`、
 * 重复句、退稿闸同一条 lookbehind 口径）；平均句长直接**取** `sentenceRhythmOf` 的 mean，不重算。
 */

import { SENTENCE_SPREAD_MIN_SENTENCES, sentenceRhythmOf, sentencesOf } from "./ai-flavor.js";

/**
 * 虚词单字清单（**一份真身**·启发式）。
 *
 * 「虚词」在汉语里跨副词、介词、连词、助词、语气词五类；全收会把读数搅浑——程度副词（很／太／更）、
 * 系词（是）、存在动词（有）在删改中**不会被系统性扫掉**，掺进来只会让读数飘。
 * 所以只收**结构性最强、最容易被削平**的那一批：结构助词与体貌助词 ＋ 常用介词 ＋ 常用连词，
 * 共 26 枚单字。清单是**定义**、不是判据：写死在这里，不许下游各抄一份。
 */
export const DEGENERATION_PARTICLE_CHARS: readonly string[] = [
  // 结构助词 / 体貌助词（7）
  "的",
  "地",
  "得",
  "了",
  "着",
  "过",
  "所",
  // 常用介词（11）
  "在",
  "把",
  "被",
  "给",
  "跟",
  "对",
  "向",
  "从",
  "为",
  "于",
  "由",
  // 常用连词（8）
  "与",
  "和",
  "及",
  "并",
  "或",
  "而",
  "但",
  "却"
];

/**
 * 「短句」的**刻度**：含句末标点不超过 4 字（`sentencesOf` 把句末标点留在句尾 ⇒ 内容 ≤3 字）。
 * 这是量尺的刻度，**不是判退线**——换个刻度读数就变，所以刻度写死在这里、不许下游各抄一份
 * （同 `VITALITY_NGRAM_N = 2` 那条取舍）。
 */
export const DEGENERATION_SHORT_SENTENCE_MAX_CHARS = 4;

export interface DegenerationReading {
  /** 与 `aiFlavorGate(t).charCount` 同一口径的字数（UTF-16 长度）。 */
  charCount: number;
  /** 虚词密度 = 虚词单字命中数 ÷ 字数 × 1000（2 位小数，越低越像被削平）；无字为 null。 */
  particlePerThousand: number | null;
  /** 短句占比 = 短句数 ÷ 句数（3 位小数，越高越像电报体）；不足 10 句为 null。 */
  shortSentenceRatio: number | null;
  /** 平均句长（字，1 位小数）——**取自 `sentenceRhythmOf` 的真身**，不重算；不足 10 句为 null。 */
  meanSentenceLength: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 虚词密度（每千字，2 位小数）。无字 ⇒ null：算不出就说算不出，不在边界上编数。 */
export function particlePerThousand(text: string): number | null {
  if (text.length === 0) return null;
  let hits = 0;
  for (const char of DEGENERATION_PARTICLE_CHARS) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(char, from);
      if (at === -1) break;
      hits += 1;
      from = at + char.length;
    }
  }
  return round2((hits / text.length) * 1000);
}

/**
 * 短句占比（3 位小数）。切句走 `sentencesOf`，**不另切一遍**；
 * 门槛随真身——不足 `SENTENCE_SPREAD_MIN_SENTENCES` 句 ⇒ null（短样本上的比例没有意义）。
 */
export function shortSentenceRatio(text: string): number | null {
  const sentences = sentencesOf(text);
  if (sentences.length < SENTENCE_SPREAD_MIN_SENTENCES) return null;
  const short = sentences.filter(
    (sentence) => sentence.length <= DEGENERATION_SHORT_SENTENCE_MAX_CHARS
  ).length;
  return round3(short / sentences.length);
}

/** 三枚读数一次算齐（面板每稿一行，逐枚调用不如装在一起）。 */
export function degenerationOf(text: string): DegenerationReading {
  return {
    charCount: text.length,
    particlePerThousand: particlePerThousand(text),
    shortSentenceRatio: shortSentenceRatio(text),
    meanSentenceLength: sentenceRhythmOf(text)?.mean ?? null
  };
}

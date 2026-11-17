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
import { dialogueBalance, endsInsideQuote, type DialogueBalance } from "./dialogue.js";

/**
 * 样本门槛：参与统计的正文**非空白字数**不足这个数就不立手册。
 * 技能原文的纪律——**不要在开书之前立手册**，没有样本可拆，立出来的只能是别人的东西。
 */
export const STYLE_PROFILE_MIN_CHARS = 500;

/**
 * 段落读数的**样本门槛**：非空段落不足 10 段就不报段长。
 *
 * 这不是「10 段才算好」，只是「样本够不够拆出一种习惯」——三段话算出的平均段长与波动，
 * 换一章就变，报出来只会让模型照着一个小样本把队伍站齐。与 `STYLE_PROFILE_MIN_CHARS`
 * 同一条纪律：**样本不够就不报**，不报 0、不猜。
 */
export const PARAGRAPH_SPREAD_MIN_PARAGRAPHS = 10;

/** 段落读数：平均段长与段长波动（变异系数）。段落全一样长时 spread 接近 0。 */
export interface ParagraphRhythm {
  /** 非空段落的平均字数（1 位小数，按 `line.length` 算）。 */
  mean: number;
  /** 段长标准差 ÷ 均值（2 位小数）：越大越参差；0 表示每段一样长。 */
  spread: number;
}

/**
 * 段末落在什么标点上（2026-11-16）：AI 文另一种显眼的骨架味是「每段都在喊」——
 * 段段收在感叹号上。这里只分类计数，不判定好坏；「多少算多」没有任何真人语料可依。
 * `other` 含没有句末标点的段落（以动作、物件、半句话收尾的常见写法）。
 */
export type ParagraphEndMark = "period" | "question" | "exclamation" | "ellipsis" | "other";

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
  /**
   * 段长读数（2026-11-15）：平均段长与段长波动。段落不足
   * `PARAGRAPH_SPREAD_MIN_PARAGRAPHS` 段为 null——该维**不报**，不是报 0。
   */
  paragraph: ParagraphRhythm | null;
  /**
   * 段末标点分布（2026-11-16）：各类占总段数的比例（0–1，3 位小数）。
   * 与 `endsOnQuote` 同分母（非空行切出的段）。全为 0 只在没有段落时出现（档案为 null 时不存在）。
   */
  endMarkShare: Record<ParagraphEndMark, number>;
}

/**
 * 从已完稿正文量一份腔调档案。contents 是各章正文（按文档顺序）。
 *
 * `precomputedBalance` 是给生成端省一趟扫描用的：同一份正文已经在对白占比那边扫过时，
 * 把那份结果递进来，不再逐字符重扫一遍（口径仍是 `dialogueBalance` 那一份）。
 *
 * 样本不足返回 `null`——「样本不够」不是「这本书没有腔调」，两者必须分开：
 * 返回一份全 0 的档案会让模型以为这本书没有对白、没有起伏。
 */
export function styleProfileOf(
  contents: readonly string[],
  precomputedBalance?: DialogueBalance
): StyleProfile | null {
  const text = contents.join("\n");
  const balance = precomputedBalance ?? dialogueBalance(text);
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
    },
    paragraph: paragraphRhythmOf(paragraphs),
    endMarkShare: endMarkShareOf(paragraphs)
  };
}

/**
 * 段末标点分布：每段只归一类，按「最后一个句末标点，忽略其后的收引号」判。
 * `。」` 归句号、`？」` 归问号——竖排对白的收尾不该把整段算进 `other`。
 */
function endMarkShareOf(paragraphs: readonly string[]): Record<ParagraphEndMark, number> {
  const counts: Record<ParagraphEndMark, number> = {
    period: 0,
    question: 0,
    exclamation: 0,
    ellipsis: 0,
    other: 0
  };
  for (const paragraph of paragraphs) counts[endMarkOf(paragraph)] += 1;
  const share = {} as Record<ParagraphEndMark, number>;
  for (const key of Object.keys(counts) as ParagraphEndMark[])
    share[key] = Math.round((counts[key] / paragraphs.length) * 1000) / 1000;
  return share;
}

/** 段末标志：只看末尾那串句末标点（可跟收引号），取其中第一个字符判类。 */
function endMarkOf(paragraph: string): ParagraphEndMark {
  const mark = paragraph.match(/([。！？!?…]+)[」』"”]*$/)?.[1]?.[0];
  if (mark === "。") return "period";
  if (mark === "？" || mark === "?") return "question";
  if (mark === "！" || mark === "!") return "exclamation";
  if (mark === "…") return "ellipsis";
  return "other";
}

/**
 * 段落节奏：平均段长与「变异系数」（标准差 ÷ 均值）。
 *
 * 【为什么用变异系数而不是标准差】段长天然随章变长变短，标准差是带尺度的量，跨书跨章没法横着读；
 * 除以均值之后是尺度无关量（与「每千字」同一路数），一本书自己跟自己比才有意义。
 *
 * 【为什么按 `line.length`】本仓章节正文是行式纯段落，与 `endsOnQuote` 的段落口径同源；
 * 不另剥 markdown 记号——那会切出第二套段落定义（铁律 6）。缩进与记号带来的偏差如实认下。
 */
function paragraphRhythmOf(paragraphs: readonly string[]): ParagraphRhythm | null {
  if (paragraphs.length < PARAGRAPH_SPREAD_MIN_PARAGRAPHS) return null;
  const lengths = paragraphs.map((line) => line.length);
  const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  if (mean === 0) return null;
  const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length;
  return {
    mean: Math.round(mean * 10) / 10,
    spread: Math.round((Math.sqrt(variance) / mean) * 100) / 100
  };
}

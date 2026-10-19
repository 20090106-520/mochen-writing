import { z } from "zod";
import { aiFlavorGate, type SentenceRhythm, type SentenceStartRepeat } from "./ai-flavor.js";

/**
 * 每轮多稿采样与「本仓判据」打分（P0-②，2026-10-19）。
 *
 * 【这一份是干什么的】开关打开时，一轮里静默跑 N 次生成（N ∈ {1,2,3}），
 * 每次跑出来的正文各自过一遍**本仓已有的** AI 味判据（`aiFlavorGate`），
 * 再把 N 稿按读数排一个推荐次序摆给用户挑。**不自动择优落盘**——落哪一稿是用户的事。
 *
 * 【为什么判据不另写一套】四条读数（词命中/千字、句首复读、句长波动、复读句）
 * 就是 `aiFlavorGate` 那四条拦稿理由的字段，一个字都不新造：
 * 闸在写盘那一刻拦的是同一批病，这里只是把同一份读数提前摆出来给用户看。
 * 另起一套「稿子打分器」就意味着两处口径，将来一处改了另一处不跟着（铁律 6）。
 *
 * 【为什么只给序、不给总分】四条读数是四种**不同**的病：词用得多、起手一个样、
 * 句句等长、同一句打转——它们之间没有可换算的汇率。捏成一个「总分」就得先编一套权重，
 * 那是编出来的数；这里只给一个**确定的序**，并把「推荐」标在第一位，
 * 选哪一稿仍然由用户拍板。
 */

/** 多稿档位：1 = 关，2 / 3 = 一轮跑几稿。上限 3 是成本上的硬顶（N 倍 token）。 */
export const DRAFT_SAMPLE_COUNTS = [1, 2, 3] as const;
export type DraftSampleCount = (typeof DRAFT_SAMPLE_COUNTS)[number];

/** 档位拒绝句（唯一一份）：边界上炸的就是它。 */
export const DRAFT_SAMPLE_COUNT_REJECT = "多稿档只能是 1（关）、2 或 3（上限 3）";

/**
 * 每轮字段 `sampleCount` 的形状。**必填、无默认值**——与 `thinkingLevel`、`webSearchEnabled`
 * 同一条理由：缺字段就是渲染层忘了传，要在边界上炸中文，而不是悄悄按「关」发出去。
 */
export const draftSampleCountSchema = z.union([z.literal(1), z.literal(2), z.literal(3)], {
  error: DRAFT_SAMPLE_COUNT_REJECT
});

/**
 * 一稿的读数。字段全部**直接取自** `aiFlavorGate(text)`，只有 `index` 是外加的位次
 * （这一稿是第几次生成，0 起算）——`DraftCandidate.index` 与它同一个数。
 *
 * `repeatOverCount` 是「同一句原样摊了三遍以上」的句子**条数**（不是摊的总次数）：
 * 排的是「有几处在打转」，不是「打转得多厉害」——后者会把一句摊十遍的稿子
 * 排得比两处各摊三遍的更靠后，那已经不是同一件事了。
 */
export interface DraftReading {
  index: number;
  charCount: number;
  /** 过没过退稿闸（短文本一律 true，见 `aiFlavorGate`）。 */
  pass: boolean;
  /** 重罪词命中数（副词不计）。 */
  hits: number;
  /** 每千字命中数。 */
  perThousand: number;
  /** 命中最多的前 5 个写法。 */
  topTerms: string[];
  /** 句首复读；null = 没触发。 */
  startRepeat: SentenceStartRepeat | null;
  /** 句长过匀；null = 没触发（或样本太少、压根没截断）。 */
  flatRhythm: SentenceRhythm | null;
  /** 撞了结构上限的条目名目。 */
  structureOver: string[];
  /** 复读句条数（同一句原样 ≥3 次的那几句）。 */
  repeatOverCount: number;
}

/** 跑一遍判据，把那一稿的读数装出来。 */
export function readDraft(index: number, text: string): DraftReading {
  const verdict = aiFlavorGate(text);
  return {
    index,
    charCount: verdict.charCount,
    pass: verdict.pass,
    hits: verdict.hits,
    perThousand: verdict.perThousand,
    topTerms: [...verdict.topTerms],
    startRepeat: verdict.startRepeat,
    flatRhythm: verdict.flatRhythm,
    structureOver: [...verdict.structureOver],
    repeatOverCount: verdict.repeatOver.length
  };
}

/**
 * 一稿的「新增正文」：该轮 `message` 正文与该轮提案的 `replace` 文本，`\n\n` 相接。
 * 空段不参与拼接（只有正文没有提案时就是正文本身），免得前后多出一截空行。
 */
export function draftTextOf(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

/**
 * 按推荐度**降序**返回读数（推荐的那一稿在最前）。排序键全确定性，逐级比较：
 *
 * 1. `repeatOverCount` 少者在前——同一句摊三遍以上是最刺眼的一种，先排掉；
 * 2. `hits` 少者在前——重罪词命中越少越干净；
 * 3. `pass` 为真者在前——退稿闸判过了的，优先级高于闸虽没过但词更少的；
 * 4. `startRepeat` 为 null 者在前——句首复读一旦触发就是「十句九句他开头」级别的节奏病；
 * 5. `flatRhythm`：null（算不出或没触发）视为**不可比**，排在同分的**有值者之后**；
 *    有值时 `spread` **大者在前**（spread 越大＝长短越错落，越不像机器）；
 * 6. `index` 升序兜底——两条键完全一样时保持原序（稳定）。
 *
 * 同分**保持原序**而不是再比别的：这里是「推荐次序」不是排名，同分就该按生成顺序摆。
 * `flatRhythm === null` 与「spread 很小」是两件事（前者是样本不够、或压根没触发，后者是句句等长），
 * 所以第 5 级先把 null 摘出去再比 spread——不许把「算不出」当成「最匀」。
 *
 * 【第 5 级的升降序口径（2026-10-19）】spec 原文写的是「spread 升序」，同一句的括注写的用意是
 * 「波动越大越不像机器」——两者指的是相反的方向。按**用意**取降序：这里排的是「推荐度」，
 * 两条都因为句长过匀被判退（`flatRhythm` 非 null ⇒ `pass === false`）的稿子之间，
 * 波动大的那条更接近人写的，就该排在前面；真按升序走会变成「推荐最像机器的先看」，与推荐二字相反。
 */
export function rankDrafts(texts: readonly string[]): DraftReading[] {
  const readings = texts.map((text, index) => readDraft(index, text));
  return readings.sort(compareReadings);
}

function compareReadings(left: DraftReading, right: DraftReading): number {
  if (left.repeatOverCount !== right.repeatOverCount)
    return left.repeatOverCount - right.repeatOverCount;
  if (left.hits !== right.hits) return left.hits - right.hits;
  if (left.pass !== right.pass) return left.pass ? -1 : 1;
  const leftStart = left.startRepeat !== null;
  const rightStart = right.startRepeat !== null;
  if (leftStart !== rightStart) return leftStart ? 1 : -1;
  const leftSpread = left.flatRhythm?.spread ?? null;
  const rightSpread = right.flatRhythm?.spread ?? null;
  if (leftSpread !== rightSpread) {
    if (leftSpread === null) return 1;
    if (rightSpread === null) return -1;
    return rightSpread - leftSpread;
  }
  return left.index - right.index;
}

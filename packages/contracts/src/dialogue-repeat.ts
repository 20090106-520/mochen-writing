/**
 * 对白复读的**测量真身**（2026-11-16）。
 *
 * 【为什么单开一格】已有三段管「重复」：`bookFlavorSentence` 数的是词库里的通用词、`openingsSentence`
 * 数章首、`sentenceOpeningSentence` 数句子开头——全在**叙述**这一侧。人物说过的话里反复出现同一句
 * （「『知道了。』」「『随你。』」当万能反应），是 AI 连写对白最省事的写法，也是读者最先听出来的假。
 * 这一格把这本书**自己的台词原话**数一遍，点名复读的那几句。
 *
 * 【口径】按非空行切段（与 `styleProfileOf` 同源），每段只取**引号内**的文字（`quotedOf`，
 * 引号配对仍只有 `scanQuotes` 一处实现），再按 `sentencesOf` 切句。同一句原话出现
 * `DIALOGUE_REPEAT_MIN_COUNT` 次才算复读（与句首「≥2 次才叫重复」同一条结构性定义）。
 *
 * 少于 `DIALOGUE_REPEAT_MIN_CHARS` 个**非标点字**的短句不数：一两个字（嗯／好／行）是正常的应答，
 * 数它们只会让清单被语气词占满——这是「够不够构成一句可复读的话」的下限，不是质量判据。
 *
 * 【只摆不判】复读不一定坏（口头禅、回声、伏笔都可能是作者有意为之）；这里只报数，
 * 由生成端说清「有意的保持间隔、无意的换一句」，不进体检、不进闸。
 */
import { sentencesOf } from "./ai-flavor.js";
import { quotedOf } from "./dialogue.js";

/** 一句台词至少几个非标点字才参与复读统计（1–2 字应答不算「一句可复读的话」）。 */
export const DIALOGUE_REPEAT_MIN_CHARS = 3;

/** 复读的结构性定义：同一句原话出现 ≥2 次（同 `SENTENCE_OPENING_MIN_COUNT`）。 */
export const DIALOGUE_REPEAT_MIN_COUNT = 2;

export interface DialogueRepeat {
  /** 台词原话（引号内，按句切好，保留句末标点）。 */
  line: string;
  /** 在这本书已完稿正文里出现的次数。 */
  count: number;
}

/** 非标点字计数：句长门槛只数实字，不让标点把短句抬过线。 */
const NON_TEXT = /[\p{P}\p{S}\s]/gu;

/**
 * 量一份对白复读。`contents` 是各章正文（按文档顺序）。
 * 按段切再取引号内文字：引号在本仓产出里是行内开合的，逐段扫能保住台词边界。
 */
export function dialogueRepeatsOf(contents: readonly string[]): DialogueRepeat[] {
  const counts = new Map<string, number>();
  for (const paragraph of contents.join("\n").split("\n")) {
    if (paragraph.trim() === "") continue;
    for (const sentence of sentencesOf(quotedOf(paragraph))) {
      const line = sentence.trim();
      if ([...line.replace(NON_TEXT, "")].length < DIALOGUE_REPEAT_MIN_CHARS) continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= DIALOGUE_REPEAT_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .map(([line, count]) => ({ line, count }));
}

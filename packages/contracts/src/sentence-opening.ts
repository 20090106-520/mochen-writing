/**
 * 句首趋同的**测量真身**（2026-11-17 从 `apps/desktop/src/main/prompt-assembly.ts` 下沉）。
 *
 * 【为什么下沉】这条读数原本只活在生成端（`sentenceOpeningSentence`），用来点名
 * 「每句都从同一个主语或同一个副词起头」。界面上的「本书腔调档案」也要看见同一份数，
 * 但渲染进程不能 import main。按本仓分工（数字住 contracts、措辞住 main）把量法与三个刻度搬下来，
 * 生成端的措辞与判读一个字不改，界面拿到的是同一份口径，而不是第二套正则。
 *
 * 【口径】切句走 `sentencesOf`（不另切一遍）；句首＝剥掉前置标点／引号后的前
 * `SENTENCE_OPENING_CHARS` 个实字（`sentencesOf` 把「」留在句子里，不剥就会数出「「你」这类带引号的串）；
 * ≥`SENTENCE_OPENING_MIN_COUNT` 次才算「用滥」（结构性定义，不是质量阈值）；
 * 按次数降序、同数按字符序，最多 `SENTENCE_OPENING_TOP` 条。
 *
 * 【只摆不判】没有「重复率多少算病」的判据（那要语料分位），生成端与界面都只报数。
 */
import { sentencesOf } from "./ai-flavor.js";

/**
 * 「句首」的**定义**：剥掉前置标点／引号后的前 2 个实字（2026-10-21 句首趋同自查）。
 * 2 字是因为中文句首两字已能看出主语／副词起头（「他没」「她站」「忽然」）；换刻度读数会变，
 * 所以刻度写死在这里、不许下游各抄一份——它不是判据。
 */
export const SENTENCE_OPENING_CHARS = 2;

/** 「用滥」的**结构性定义**：出现 ≥2 次才叫重复（同 `openingsSentence`「两章起」、体检术语「≥2 次才报」）。 */
export const SENTENCE_OPENING_MIN_COUNT = 2;

/** 展示额度（与 `bookFlavorSentence` 的 top 5 同数，只为不刷屏；不是判据）。 */
export const SENTENCE_OPENING_TOP = 5;

export interface SentenceOpening {
  /** 句首两字（已剥掉前置标点／引号）。 */
  opening: string;
  /** 在样本里出现的次数。 */
  count: number;
}

/** 从各段正文量一份句首榜。`contents` 按文档顺序传入（main 侧一次传一整片正文即可）。 */
export function sentenceOpeningsOf(contents: readonly string[]): SentenceOpening[] {
  const counts = new Map<string, number>();
  for (const sentence of sentencesOf(contents.join("\n"))) {
    const opening = sentenceOpeningOf(sentence);
    if (opening === "") continue;
    counts.set(opening, (counts.get(opening) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= SENTENCE_OPENING_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .slice(0, SENTENCE_OPENING_TOP)
    .map(([opening, count]) => ({ opening, count }));
}

function sentenceOpeningOf(sentence: string): string {
  const content = sentence.replace(/^[\p{P}\p{S}\s]+/u, "");
  return [...content].slice(0, SENTENCE_OPENING_CHARS).join("");
}

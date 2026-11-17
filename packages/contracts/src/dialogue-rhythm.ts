/**
 * 对白段落形态的**测量真身**（2026-11-16）。
 *
 * 【为什么单开一格】已有读数各管一层：`dialogueRatio` 量对白**字数**占多少、`endsOnQuote` 量段末收在
 * 台词上的段数、`paragraph` 量段长波动——但没有一处量「台词和动作怎么摆在一段里」。
 * 而这正是 AI 正文最显眼的骨架味之一：整场戏写成一行一句的剧本（每段只有台词），
 * 或者反过来，每句台词后面都硬贴一条动作。两种都是同一段文字的排列问题，字数占比看不出来。
 *
 * 【口径】按非空行切段（与 `styleProfileOf` 的段口径同源），只数**含对白**的段落（引号内有字）。
 * 段内引号外剥掉标点／符号／空白后为空 → **纯对白段**；还有字 → **台词与动作/神态同段**。
 * 引号配对仍走 `dialogue.ts` 的 `scanQuotes`（经 `dialogueBalance` / `narrationOf`），不另写一套。
 *
 * 【只摆不判】没有「纯对白段超过多少算病」的判据（那要真人语料分位）。这里只数出这本书自己的比例，
 * 由生成端照它叮嘱保持，不进体检、不进闸。
 */
import { dialogueBalance, narrationOf } from "./dialogue.js";
import { PARAGRAPH_SPREAD_MIN_PARAGRAPHS } from "./style-profile.js";

/** 对白段落形态：含对白的段落里，纯台词段与「台词＋节拍」段各多少。 */
export interface DialogueParagraphShape {
  /** 含对白的段落数（引号内至少一个字）——下面两数之和。 */
  withDialogue: number;
  /** 纯对白段：引号外只有标点／符号／空白。 */
  pure: number;
  /** 台词与动作、神态或叙述长在同一段里。 */
  mixed: number;
}

/** 引号外只算标点／符号／空白：有任何一个字就是「同段还有叙述」。 */
const NON_TEXT = /[\p{P}\p{S}\s]/gu;

/**
 * 量一份对白段落形态。`contents` 是各章正文（按文档顺序）。
 *
 * 样本门槛与段长读数同一枚（`PARAGRAPH_SPREAD_MIN_PARAGRAPHS`）：段太少时比例换个章就翻，
 * 报出来只会让模型照着一个小样本把队站齐。没有对白段同样返回 null——「没有样本」不是「比例是 0」。
 */
export function dialogueParagraphShapeOf(
  contents: readonly string[]
): DialogueParagraphShape | null {
  const paragraphs = contents
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (paragraphs.length < PARAGRAPH_SPREAD_MIN_PARAGRAPHS) return null;

  let withDialogue = 0;
  let pure = 0;
  for (const paragraph of paragraphs) {
    if (dialogueBalance(paragraph).quoted === 0) continue;
    withDialogue += 1;
    if (narrationOf(paragraph).replace(NON_TEXT, "") === "") pure += 1;
  }
  if (withDialogue === 0) return null;
  return { withDialogue, pure, mixed: withDialogue - pure };
}

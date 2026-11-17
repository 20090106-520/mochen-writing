/**
 * 对白复读那一句（2026-11-16，从 prompt-assembly.ts 拆出：那边贴着 800 行预算）。
 *
 * 【为什么值得一段】`bookFlavorSentence` 数词库、`openingsSentence` 数章首、`sentenceOpeningSentence`
 * 数句首——全在叙述侧。同一句台词被反复当万能反应（「知道了。」「随你。」），是 AI 写对白最省事、
 * 读者最先听出来的假；而这本书自己已经复读了哪几句，此前没有任何一段报过。
 *
 * 【口径】数字住 contracts 的 `dialogueRepeatsOf`（只取引号内、按句切、≥2 次）；
 * 这里只把清单说成人话，最多摆 5 句（与另两段同数，只为不刷屏，不是判据）。
 */

import { dialogueRepeatsOf } from "@mochen/contracts";

/** 展示额度：最多点 5 句（与 `bookFlavorSentence` / `sentenceOpeningSentence` 同数）。 */
const DIALOGUE_REPEAT_TOP = 5;

export function dialogueRepeatSentence(text: string): string {
  const repeats = dialogueRepeatsOf([text]).slice(0, DIALOGUE_REPEAT_TOP);
  if (repeats.length === 0) return "";
  return (
    "本书对白复读（扫描自这本书已完稿的正文，括号内是出现次数）：下面这些台词原话在书里出现过不止一次——" +
    repeats.map(({ line, count }) => `「${line}」（${count} 次）`).join("、") +
    "。如果它们是有意的口头禅或回声，保持原来的间隔、别用得更密；" +
    "如果不是有意的，新写的对白换一种说法——同一句话反复当反应，人物就像只有一句台词的机器。"
  );
}

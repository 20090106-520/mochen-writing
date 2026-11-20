/**
 * 本章腔调偏离那一句（2026-11-17，单开文件：`prompt-assembly.ts` 仍贴着 800 行预算）。
 *
 * 【为什么值得一段】`styleProfileSentence` 把本书的常态读数摆给模型，却没告诉它
 * **这一章写到这儿，已经偏离了哪一条**。`styleDriftOf` 此前只在交稿回执里用——写完之后
 * 才告诉用户「这一稿不太像这本书」；续写时模型手上没有「正在跑偏」的信号，只能靠那几句叮嘱。
 *
 * 【口径】数字与判线全部住 contracts（`styleProfileOf` / `styleDriftOf` 及其早已校准的档位），
 * 本文件一条都不新编；这里只把偏离项说成人话，最多摆 2 条（展示额度，不是判据）。
 *
 * 【只摆不判】参照物是**这本书自己的常态**，不是「优秀小说该有的样子」。题材本来就会带来偏离
 * （打斗章句子短、独白章对白少），所以文案里明说「这一章本来就要换节奏，就把偏离当例外」。
 *
 * 【样本】这一章不足 `STYLE_DRIFT_MIN_CHARS`（300 字）不说——短样本上的偏离几乎全是噪声；
 * 本书常态不足 500 字时 `styleDriftOf` 自己给 `checked=false`，同样不说。
 */

import { styleDriftOf, styleProfileOf } from "@mochen/contracts";

/** 展示额度：最多摆 2 条（与其余动态段同类，只为不刷屏）。 */
const CHAPTER_DRIFT_TOP = 2;

export function chapterDriftSentence(finishedText: string, draftText: string): string {
  const drift = styleDriftOf(styleProfileOf([finishedText]), draftText);
  if (!drift.checked || drift.worst === null) return "";
  const shown = drift.items
    .slice(0, CHAPTER_DRIFT_TOP)
    .map((item) => `${item.label} 本章 ${item.draft}（本书常态 ${item.base}）`);
  return (
    "本章腔调偏离（拿这一章已写的部分，与这次上下文里已完稿正文的常态比）：" +
    shown.join("；") +
    `。最该调的是「${drift.worst.label}」——${drift.worst.advice}` +
    "如果这一章本来就要换节奏（打斗、独白、收束），把这个偏离当成这一次的例外；" +
    "否则照上面的改法收回来，别让这一章读起来像另一个人写的。"
  );
}

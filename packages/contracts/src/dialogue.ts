/**
 * 对话占比（2026-10-11）：引号内字数占正文字数的比例——「这一章是不是在开会」的量。
 *
 * 两端同吃这一份（单一真身）：
 * - 生成端：prompt-assembly 的 dialogueBalanceSentence——对话过密/过闷给模型一句找补提醒；
 * - 检测端：书稿体检第六类「对话占比」——逐章报数，作者一眼看出哪章话太密、哪章没戏。
 *
 * 口径（从 prompt-assembly 内联抽出来，语义一字不动）：
 * - 「」『』里的字算对话字（配对深度计数，防嵌套串味）；
 * - 空白字符不计入总量（缩进与换行不稀释占比）；
 * - 总字数 < 500 不判定（样本太少）；
 * - 占比 > 0.65 话太密（一章全是你一句我一句，动作与环境全缺席）；
 * - 占比 < 0.03 全叙述（没有戏，人物不开口）。
 */

export const DIALOGUE_BALANCE = {
  /** 低于这个总字数不判定：三五句话的段落算不出可信的占比。 */
  minChars: 500,
  /** 超过这个占比算「话太密」。 */
  denseRatio: 0.65,
  /** 低于这个占比算「全叙述」。 */
  silentRatio: 0.03
} as const;

export interface DialogueBalance {
  /** 引号内的字数（不含引号本身）。 */
  quoted: number;
  /** 非空白总字数（含对话字）。 */
  total: number;
  /** 占比 = quoted / total（total 为 0 时是 0）。 */
  ratio: number;
}

/** 引号内计数：depth 防嵌套——「他说『走』时没回头」外层内层各算各的，不串不漏。 */
export function dialogueBalance(text: string): DialogueBalance {
  let quoted = 0;
  let total = 0;
  let depth = 0;
  for (const ch of text) {
    if (ch === "「" || ch === "『") {
      depth += 1;
      continue;
    }
    if (ch === "」" || ch === "』") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (/\s/.test(ch)) continue;
    total += 1;
    if (depth > 0) quoted += 1;
  }
  return { quoted, total, ratio: total === 0 ? 0 : quoted / total };
}

export type DialogueVerdict = "thin-sample" | "dense" | "silent" | "normal";

/** 占比 → 判读。thin-sample（样本不足）不算病，体检里单独一个说法，不混进「正常」。 */
export function dialogueVerdict(balance: DialogueBalance): DialogueVerdict {
  if (balance.total < DIALOGUE_BALANCE.minChars) return "thin-sample";
  if (balance.ratio > DIALOGUE_BALANCE.denseRatio) return "dense";
  if (balance.ratio < DIALOGUE_BALANCE.silentRatio) return "silent";
  return "normal";
}

/** 判读的中文展示名（真身住 contracts，界面不另抄一份）。 */
export const DIALOGUE_VERDICT_LABELS: Record<DialogueVerdict, string> = {
  dense: "话太密",
  silent: "全叙述",
  normal: "常态",
  "thin-sample": "篇幅太短"
};

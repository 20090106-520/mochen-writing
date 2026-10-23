/**
 * 本章目标与已写字数的对照（2026-10-22）。
 *
 * 为什么要在编辑器页脚给这一句：`rhythm_check` 与 `book_outline` 都是**事后量**——
 * 写完一章再去问哪里节奏散了。但作者在正文里写的时候，脑子里的「字数感」是没有刻度的，
 * 等回头量出来已经超了一千多字。页脚这一格把「目标多少 / 现在多少 / 差多少」摆在同一行，
 * 写的时候就在眼前，不用等一轮检查。
 *
 * 这里只推算，不存任何东西：目标住在 `useWritingGoalStore`（逐章键），字数就是当前草稿的正文数。
 */
export interface ChapterQuota {
  /** 目标字数；0 = 没设——此时 label 是空串，界面不该渲染这一句。 */
  target: number;
  chars: number;
  /** 已写 − 目标：正数超出，负数还差，0 刚好。 */
  delta: number;
  over: boolean;
  label: string;
}

function num(value: number): string {
  return value.toLocaleString("zh-CN");
}

export function chapterQuota(chars: number, target: number): ChapterQuota {
  // 草稿在切换的那一瞬可能是空串/旧值；负数与 NaN 一律按 0 字算，不把 NaN 摆到屏上。
  const wholeChars = Number.isFinite(chars) ? Math.max(0, Math.floor(chars)) : 0;
  if (!Number.isFinite(target) || target <= 0) {
    return { target: 0, chars: wholeChars, delta: 0, over: false, label: "" };
  }
  const wholeTarget = Math.floor(target);
  const delta = wholeChars - wholeTarget;
  if (delta === 0)
    return { target: wholeTarget, chars: wholeChars, delta, over: false, label: "刚好到目标" };
  if (delta > 0) {
    return {
      target: wholeTarget,
      chars: wholeChars,
      delta,
      over: true,
      label: `超 ${num(delta)} 字`
    };
  }
  return {
    target: wholeTarget,
    chars: wholeChars,
    delta,
    over: false,
    label: `还差 ${num(-delta)} 字`
  };
}

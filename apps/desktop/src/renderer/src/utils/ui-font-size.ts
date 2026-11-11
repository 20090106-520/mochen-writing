/**
 * 界面字号档（2026-11-11）。
 *
 * 【为什么要有这一份】这七档原先只长在 `AppearancePanel.vue` 里，而键盘缩放
 * （Ctrl+= / Ctrl+- / Ctrl+0）也需要同一张表——大厂桌面应用的通用键位，用户按下去
 * 期待的就是「界面整体变大变小」。若键位再抄一份数组，两处一改一漏，就会出现
 * 「设置页只有 12~20，快捷键却能跳到 22」这种自相矛盾。
 *
 * 判据是**档位数组**而不是加减像素：字号在这些档上都是整数值、且与 `:root` 的
 * `font-size` 一一对应（rem 因此整体缩放）。跨档步进而不是连续缩放，
 * 是为了让每一次按键都落在「设计给定的一档」上，屏幕上的每个尺寸仍是干净的整数。
 */

export const UI_FONT_SIZE_STEPS = [12, 13, 14, 15, 16, 18, 20] as const;

/** Ctrl+0 回到的那一档（与 contracts 的 `DEFAULT_APPEARANCE_UI_FONT_SIZE` 同值）。 */
export const UI_FONT_SIZE_RESET = 14;

export type UiFontStepDirection = -1 | 1;

/**
 * 取「当前值所在的那一档」，再往 dir 方向挪一格，两头顶死。
 *
 * 入参可能是历史数据里的任意整数（契约允许 10~24），因此先吸附到最近的档：
 * 13 与 14 之间取近的，平手取较小一档（缩小方向更保守，不会一次跳两级）。
 */
export function stepUiFontSize(current: number, dir: UiFontStepDirection): number {
  const steps = UI_FONT_SIZE_STEPS;
  let index = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < steps.length; i += 1) {
    const distance = Math.abs(steps[i]! - current);
    if (distance < bestDistance) {
      bestDistance = distance;
      index = i;
    }
  }
  const next = index + dir;
  if (next < 0) return steps[0]!;
  if (next >= steps.length) return steps[steps.length - 1]!;
  return steps[next]!;
}

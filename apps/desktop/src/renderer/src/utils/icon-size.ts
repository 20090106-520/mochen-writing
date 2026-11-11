/**
 * 图标尺寸吸附（2026-11-11）。
 *
 * 【病灶】全仓 `<AppIcon :size="...">` 原先有 12 种取值：9 / 10 / 11 / 12 / 13 / 14 /
 * 15 / 16 / 17 / 18 / 22 / 26 / 28 / 32。13 与 14 混排、15 与 16 混排、17 与 18 混排 ——
 * 每一次都是「这次看着差不多」手写出来的，并排就露馅：同一列导航里三枚图标差 1px，
 * 视觉重心不齐，而 24 viewBox 的描边在 13px 下还会跌破一个设备像素。
 *
 * 【裁定】落在八档上：12 / 14 / 16 / 18 / 20 / 24 / 28 / 32。
 * 吸附只在 11~32 的区间里做：
 *  - 小于 11 的（9 / 10 的角标、极小标记）保持原样：硬抬到 12 会撑破容器；
 *  - 大于 32 的（头像、品牌图）保持原样：那不是图标，是插画。
 * 下界取 11 而不是 12：全仓 16 处 `:size="11"` 是雪佛龙、回形针这类行内小符号，
 * 24 viewBox 配 2 描边在 11px 下只有 0.92 CSS px（1.5 倍屏 1.37 设备像素），
 * 边缘发灰；抬到 12 后正好 1.0 CSS px，且它们都在 inline-flex 里、宽 1px 不会挤走布局。
 * 平局取**较大**一档：15 距 14/16 各 1，取 16 —— 大厂那套 16 基准的图标语言里，
 * 「稍微大一点」比「稍微小一点」更稳（描边不容易糊）。
 */
export const ICON_SIZE_STEPS = [12, 14, 16, 18, 20, 24, 28, 32] as const;
export const ICON_SIZE_MIN = ICON_SIZE_STEPS[0];
export const ICON_SIZE_MAX = ICON_SIZE_STEPS[ICON_SIZE_STEPS.length - 1]!;
/** 吸附区间下界与阶梯首档分开：11 抬到 12，9 / 10 不碰。 */
export const ICON_SIZE_SNAP_FLOOR = 11;

export function snapIconSize(size: number): number {
  if (!Number.isFinite(size) || size < ICON_SIZE_SNAP_FLOOR || size > ICON_SIZE_MAX) return size;
  let best: number = ICON_SIZE_MIN;
  let bestDistance = Math.abs(best - size);
  for (const step of ICON_SIZE_STEPS) {
    const distance = Math.abs(step - size);
    if (distance < bestDistance || (distance === bestDistance && step > best)) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

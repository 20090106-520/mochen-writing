/**
 * 颜色换算的**唯一一份实现**（2026-10-07 批次 5-㊵ 拆出）。
 *
 * 【为什么拆】
 * 拆之前这些函数住在 `appearanceThemeRuntime.ts`，而 `appearanceSkinVisual.ts`
 * 也要用它们（拼上游的渐变、要算玻璃那两块半透底色）。两边互相 import
 * 就是一个环：`tsc` 报 `Cannot find name 'skinStyleVariables'`——
 * 那不是笔误，是**环上的 re-export 解析不到**。
 *
 * ⇒ 依赖方向定成一条直线：
 *      appearanceColor  ←  appearanceThemeRuntime（主题上色 + 对外 re-export）
 *                        ←  appearanceSkinVisual（上游视觉真值）
 *
 * 【为什么还需要 re-export】
 * 守卫与别处一直从 `appearanceThemeRuntime` 拿 `__testingMixRgba` 那些。
 * 拆文件不该顺手改一堆调用点——**既有调用方一行都不用改**是这里的目标。
 */

/** `#RRGGBB` → 三通道。**不做校验**：调用方在更早的一层（zod 的 HexColorSchema）已经拒过非法值。 */
export function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ];
}

/** 两色按比例混，返回三通道。 */
export function mixChannels(
  background: string,
  foreground: string,
  foregroundRatio: number
): [number, number, number] {
  const bg = hexToRgb(background);
  const fg = hexToRgb(foreground);
  return bg.map((channel, index) =>
    Math.round(channel * (1 - foregroundRatio) + fg[index]! * foregroundRatio)
  ) as [number, number, number];
}

/** 两色按比例混，返回 `rgb(r g b)`。 */
export function mix(background: string, foreground: string, foregroundRatio: number): string {
  return `rgb(${mixChannels(background, foreground, foregroundRatio).join(" ")})`;
}

/**
 * 三通道 → `#RRGGBB`。
 *
 * 【为什么单独有这一条】`mix()` 产的是 `rgb()`，那是**给 CSS 用**的形状；
 * 而对比度那两个函数（`relativeLuminance` / `contrastRatio`）吃的是 hex。
 * 守卫要量「应用真的放上去的那个混合色」，就得把同一份 `mixChannels` 的结果转成 hex——
 * 转法的字面量留在颜色模块，比让每个守卫各自拼一遍 `toString(16)` 好。
 */
export function rgbToHex(rgb: readonly [number, number, number]): string {
  return `#${rgb
    .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** 混完直接给 hex：与 `mix()` 同一份 `mixChannels`，只是换个出口形状。 */
export function mixHex(background: string, foreground: string, foregroundRatio: number): string {
  return rgbToHex(mixChannels(background, foreground, foregroundRatio));
}

/**
 * `rgb(r g b / a)` 的**唯一一份实现**。
 *
 * **为什么永远是 `rgb()` 而不是 `rgba()`**：历史上两边都用过，而本批真机撞出过
 * 一件极难查的事——`rgb(#101110 / 0.06)` 会被浏览器**静默丢掉整条声明**
 * （`rgb()` 要的是三个通道数，不是 hex），表现是「换了皮肤但纹理没变」，
 * 控制台一个字都没有。所以形状统一成「通道 + `/ alpha`」，且由这一处产出。
 */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** 半透明混色：`mix()` 加一个 alpha。玻璃那两块底色走它。 */
export function mixRgba(
  background: string,
  foreground: string,
  foregroundRatio: number,
  alpha: number
): string {
  return `rgb(${mixChannels(background, foreground, foregroundRatio).join(" ")} / ${alpha})`;
}

/**
 * #113c 阶段弹层的落点判定（纯函数版）。
 *
 * 真身：deepwrite `composables/useComposerContextPopover.ts` 的 `position()`（Apache-2.0），五个数值原样搬：
 * margin 8 / gap 7 / 宽 min(320, 视口宽-16) / 上方≥260 或上方更宽才朝上翻 / 封顶 380。
 * 剥成纯函数是为了让它进类型程序与测试——本仓 `.vue` 不进 tsc，判定留在 composable 里就等于没有关卡
 * （同法先例：permission-chips.ts、composer-chips.ts、slash-commands.ts）。
 */

export const POPOVER_MARGIN = 8;
export const POPOVER_GAP = 7;
export const POPOVER_WIDTH = 320;
export const POPOVER_ABOVE_MIN = 260;
export const POPOVER_MAX_HEIGHT = 380;

export interface PopoverAnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export interface PopoverViewport {
  innerWidth: number;
  innerHeight: number;
}

export interface PopoverPlacement {
  widthPx: number;
  leftPx: number;
  /**
   * 面板贴锚点的哪条边：`"bottom"` = 用 CSS 的 bottom 向上长（朝上翻，输入卡住窗口底部时的常态）；
   * `"top"` = 用 CSS 的 top 向下长。字段名就是最终落到 style 上的那个属性名。
   */
  side: "top" | "bottom";
  /** 与 `side` 配套的偏移量（已含 gap）。 */
  offsetPx: number;
  maxHeightPx: number;
  transformOrigin: string;
}

export function composerPopoverPlacement(input: {
  anchor: PopoverAnchorRect;
  viewport: PopoverViewport;
}): PopoverPlacement {
  const { anchor, viewport } = input;
  const width = Math.min(POPOVER_WIDTH, viewport.innerWidth - POPOVER_MARGIN * 2);
  const above = Math.max(0, anchor.top - POPOVER_GAP - POPOVER_MARGIN);
  const below = Math.max(0, viewport.innerHeight - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN);
  const upward = above >= POPOVER_ABOVE_MIN || above > below;
  const space = upward ? above : below;
  return {
    widthPx: width,
    leftPx: Math.max(
      POPOVER_MARGIN,
      Math.min(anchor.left, viewport.innerWidth - width - POPOVER_MARGIN)
    ),
    side: upward ? "bottom" : "top",
    offsetPx: upward
      ? viewport.innerHeight - anchor.top + POPOVER_GAP
      : anchor.bottom + POPOVER_GAP,
    maxHeightPx: Math.min(POPOVER_MAX_HEIGHT, space),
    transformOrigin: upward ? "bottom left" : "top left"
  };
}

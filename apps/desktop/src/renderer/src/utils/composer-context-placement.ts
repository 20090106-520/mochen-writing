/**
 * #113c 阶段弹层的落点判定（纯函数版）。
 *
 * 真身：deepwrite `composables/useComposerContextPopover.ts` 的 `position()`，五个数值原样搬：
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
  right?: number;
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
  /** 封顶后的高度：下拉类浮层就用它（`min(380, spacePx)`）。 */
  maxHeightPx: number;
  /**
   * 挑中的那一侧**实际还剩多少像素**（未封顶）。
   *
   * 为什么单独暴露（2026-10-07 批次 5-㉖）：`maxHeightPx` 已经把 380 这个下拉封顶揉进去了，
   * 于是「我想更高」与「我最多只能到哪儿」这两件事被压成了一个数。
   * 技能库是个浏览面板（页签 + 说明 + 分类 + 若干张卡 + 卡内正文预览），380 装不下——
   * 但它**仍然不许越过可用空间**，否则贴着窗口底部时会有一截跑到屏幕外。
   * 调用方要的是「上限可以更高，底线仍然是 spacePx」这两个数，所以这里把底线单列一份。
   * 不传上限时 `maxHeightPx` 的算法一字未改，既有断言逐条照旧。
   */
  spacePx: number;
  transformOrigin: string;
}

export function composerPopoverPlacement(input: {
  anchor: PopoverAnchorRect;
  viewport: PopoverViewport;
  /**
   * 这一枚浮层想要的宽度（2026-10-23）。不传就用 `POPOVER_WIDTH`（320）——
   * 下拉类浮层的默认观感一个字没变。台账/读数面板要摆下四件东西，320 装不下的那些
   * 由此自报宽度；**底线仍然是 `视口宽 - 2*margin`**，贴边打开时不会有一截跑到屏幕外。
   * 宽度是真身（这里），各面板样式表里的 `width` 让位给它，不再各写一份。
   */
  preferredWidth?: number;
  align?: "start" | "end";
  horizontalOffsetPx?: number;
}): PopoverPlacement {
  const { anchor, viewport, preferredWidth, align = "start", horizontalOffsetPx = 0 } = input;
  const width = Math.min(preferredWidth ?? POPOVER_WIDTH, viewport.innerWidth - POPOVER_MARGIN * 2);
  const above = Math.max(0, anchor.top - POPOVER_GAP - POPOVER_MARGIN);
  const below = Math.max(0, viewport.innerHeight - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN);
  const upward = above >= POPOVER_ABOVE_MIN || above > below;
  const space = upward ? above : below;
  const anchorLeft = align === "end" ? (anchor.right ?? anchor.left) - width : anchor.left;
  return {
    widthPx: width,
    leftPx: Math.max(
      POPOVER_MARGIN,
      Math.min(anchorLeft + horizontalOffsetPx, viewport.innerWidth - width - POPOVER_MARGIN)
    ),
    side: upward ? "bottom" : "top",
    offsetPx: upward
      ? viewport.innerHeight - anchor.top + POPOVER_GAP
      : anchor.bottom + POPOVER_GAP,
    maxHeightPx: Math.min(POPOVER_MAX_HEIGHT, space),
    spacePx: space,
    transformOrigin: `${upward ? "bottom" : "top"} ${align === "end" ? "right" : "left"}`
  };
}

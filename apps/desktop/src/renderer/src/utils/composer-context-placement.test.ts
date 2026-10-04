/**
 * #113c 阶段弹层的落点判定（纯函数）。
 * 数值全部照搬 deepwrite useComposerContextPopover.ts 的 position()：宽 min(320, 视口-16)、
 * 上下留 margin 8 / gap 7、上方够 260 或上方比下方宽才朝上翻、封顶 380。
 * 为什么把这段从 composable 里剥出来：本仓 `.vue` 不进类型程序、也没有组件测试，
 * 只有落在 `.ts` 的判定才咬得住回归（先例：permission-chip.ts、composer-chips.ts、slash-commands.ts）。
 */
import { describe, expect, it } from "vitest";
import {
  POPOVER_ABOVE_MIN,
  POPOVER_GAP,
  POPOVER_MARGIN,
  POPOVER_MAX_HEIGHT,
  POPOVER_WIDTH,
  composerPopoverPlacement,
  type PopoverAnchorRect
} from "./composer-context-placement";

function anchorAt(top: number, bottom: number): PopoverAnchorRect {
  return { left: 120, top, bottom };
}

const viewport = { innerWidth: 1200, innerHeight: 800 };

describe("composerPopoverPlacement · 朝上翻的判定", () => {
  it("输入卡住窗口底部（deepwrite 的真实场景）⇒ 朝上开，bottom 贴锚点上沿再抬 gap", () => {
    const p = composerPopoverPlacement({ anchor: anchorAt(700, 740), viewport });
    expect(p.side).toBe("bottom"); // 弹层锚在**下**边 ⇒ 用 CSS 的 bottom 往上长
    expect(p.offsetPx).toBe(800 - 700 + POPOVER_GAP);
    expect(p.transformOrigin).toBe("bottom left");
  });

  it("上方空间不足 260 且下方更宽 ⇒ 朝下开，top 贴锚点下沿再让出 gap", () => {
    const p = composerPopoverPlacement({ anchor: anchorAt(30, 70), viewport });
    // 上方 only 30-8-7=15 < 260，下方 800-70-8-7=715 更大 ⇒ 向下。
    expect(p.side).toBe("top");
    expect(p.offsetPx).toBe(70 + POPOVER_GAP);
    expect(p.transformOrigin).toBe("top left");
    expect(p.maxHeightPx).toBe(POPOVER_MAX_HEIGHT);
  });

  it("两边都不够 380 时取较宽的一边封顶：maxHeight 是可用高度，不是常量", () => {
    // 上下各剩 ~200 ⇒ 挑更宽的一侧，且高度=该侧可用高度。
    const p = composerPopoverPlacement({
      anchor: anchorAt(300, 340),
      viewport: { ...viewport, innerHeight: 520 }
    });
    expect(p.maxHeightPx).toBeLessThan(POPOVER_MAX_HEIGHT);
    const above = 300 - POPOVER_GAP - POPOVER_MARGIN;
    const below = 520 - 340 - POPOVER_GAP - POPOVER_MARGIN;
    expect(p.maxHeightPx).toBe(Math.min(POPOVER_MAX_HEIGHT, Math.max(above, below)));
  });
});

describe("composerPopoverPlacement · 不越出视口", () => {
  it("宽度封顶 320，但窄窗口收到 视口-2*margin", () => {
    expect(composerPopoverPlacement({ anchor: anchorAt(700, 740), viewport }).widthPx).toBe(
      POPOVER_WIDTH
    );
    const narrow = composerPopoverPlacement({
      anchor: anchorAt(700, 740),
      viewport: { innerWidth: 300, innerHeight: 800 }
    });
    expect(narrow.widthPx).toBe(300 - POPOVER_MARGIN * 2);
  });

  it("锚点贴右边缘 ⇒ left 往回收到视口内；贴左边缘 ⇒ 不早于 margin", () => {
    const right = composerPopoverPlacement({
      anchor: { left: 1190, top: 700, bottom: 740 },
      viewport
    });
    expect(right.leftPx).toBe(1200 - POPOVER_WIDTH - POPOVER_MARGIN);
    const left = composerPopoverPlacement({
      anchor: { left: -40, top: 700, bottom: 740 },
      viewport
    });
    expect(left.leftPx).toBe(POPOVER_MARGIN);
  });

  it("两侧可用高度都被钳到 0：锚点整根跑出视口时不吐负数（负 maxHeight 会让面板直接消失）", () => {
    const p = composerPopoverPlacement({
      anchor: { left: 5, top: 5, bottom: 200 },
      viewport: { innerWidth: 100, innerHeight: 100 }
    });
    // 上方 5-15 与下方 100-200-15 都是负数 ⇒ 钳到 0，且 0>=0 仍判朝下。
    expect(p.side).toBe("top");
    expect(p.maxHeightPx).toBe(0);
  });
});

describe("常量本身（改一个数值就等于改参考稿的形态）", () => {
  it("五个数值与 deepwrite 一致：margin 8 / gap 7 / 宽 320 / 朝上阈值 260 / 封顶 380", () => {
    expect(POPOVER_MARGIN).toBe(8);
    expect(POPOVER_GAP).toBe(7);
    expect(POPOVER_WIDTH).toBe(320);
    expect(POPOVER_ABOVE_MIN).toBe(260);
    expect(POPOVER_MAX_HEIGHT).toBe(380);
  });
});

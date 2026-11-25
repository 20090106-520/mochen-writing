/**
 * #113c 阶段弹层的落点判定（纯函数）。
 * 数值全部对齐 deepwrite useComposerContextPopover.ts 的 position()：宽 min(320, 视口-16)、
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
  it("右对齐与横向偏移用于级联弹层：设置卡保持在锚点右缘，子面板向外展开", () => {
    const p = composerPopoverPlacement({
      anchor: { left: 700, right: 900, top: 700, bottom: 740 },
      viewport,
      preferredWidth: 464,
      align: "end",
      horizontalOffsetPx: 184
    });
    expect(p.leftPx).toBe(900 - 464 + 184);
    expect(p.transformOrigin).toBe("bottom right");
  });

  it("右对齐缺省 right 时回退到 left，不改变旧调用方", () => {
    const p = composerPopoverPlacement({
      anchor: anchorAt(700, 740),
      viewport,
      align: "end"
    });
    expect(p.leftPx).toBe(POPOVER_MARGIN);
  });

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

  it("preferredWidth（面板自报宽度）生效，且仍被 视口-2*margin 钳住、left 按新宽度回收到视口内", () => {
    const wide = composerPopoverPlacement({
      anchor: anchorAt(700, 740),
      viewport,
      preferredWidth: 460
    });
    expect(wide.widthPx).toBe(460);
    const right = composerPopoverPlacement({
      anchor: { left: 1190, top: 700, bottom: 740 },
      viewport,
      preferredWidth: 460
    });
    expect(right.leftPx).toBe(1200 - 460 - POPOVER_MARGIN);
    const narrow = composerPopoverPlacement({
      anchor: anchorAt(700, 740),
      viewport: { innerWidth: 300, innerHeight: 800 },
      preferredWidth: 460
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

describe("spacePx · 给「浏览面板」的那条路（2026-10-07 批次 5-㉖）", () => {
  it("spacePx 是那一侧**未封顶**的可用高度；maxHeightPx 仍然等于 min(380, spacePx)", () => {
    const cases = [
      { anchor: anchorAt(30, 70), vp: viewport },
      { anchor: anchorAt(300, 340), vp: { ...viewport, innerHeight: 520 } },
      { anchor: anchorAt(30, 70), vp: { ...viewport, innerHeight: 200 } },
      { anchor: anchorAt(700, 740), vp: viewport }
    ];
    for (const { anchor, vp } of cases) {
      const p = composerPopoverPlacement({ anchor, viewport: vp });
      // 预期从 side 自己推：朝上开就看 above，朝下开就看 below。
      // 【为什么不写死哪一侧】我第一版就是写死的，结果把 above=285≥260 判成了朝下——
      // 数字看着像那么回事，方向却算反，断言红得莫名其妙。方向是判定的产物，不是前提。
      const expectedSpace =
        p.side === "bottom"
          ? anchor.top - POPOVER_GAP - POPOVER_MARGIN
          : vp.innerHeight - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
      expect(p.spacePx, `side=${p.side} anchor=${JSON.stringify(anchor)}`).toBe(
        Math.max(0, expectedSpace)
      );
      expect(p.maxHeightPx).toBe(Math.min(POPOVER_MAX_HEIGHT, p.spacePx));
    }
  });

  it("确实存在「space < 380」这一档：这时 maxHeightPx = spacePx，而 spacePx 仍是真数", () => {
    // 贴着窗口上沿、下方只剩一百多像素 ⇒ 这一档成立。
    // 它正是「上限可以更高、底线不能更高」要分两样东西的理由：
    // 只给一个数的话，浏览面板要么被 380 压住，要么连这点空间也不剩。
    const p = composerPopoverPlacement({
      anchor: anchorAt(30, 70),
      viewport: { innerWidth: 1200, innerHeight: 200 }
    });
    expect(p.spacePx).toBeLessThan(POPOVER_MAX_HEIGHT);
    expect(p.maxHeightPx).toBe(p.spacePx);
  });

  it("spacePx 也不吐负数：锚点跑出视口时它与 maxHeightPx 一起钳到 0", () => {
    const p = composerPopoverPlacement({
      anchor: { left: 5, top: 5, bottom: 200 },
      viewport: { innerWidth: 100, innerHeight: 100 }
    });
    expect(p.spacePx).toBe(0);
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

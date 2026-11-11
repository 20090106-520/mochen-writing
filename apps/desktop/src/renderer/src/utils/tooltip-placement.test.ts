import { describe, expect, it } from "vitest";
import {
  TOOLTIP_ARROW_INSET,
  TOOLTIP_GAP,
  TOOLTIP_HOVER_DELAY_MS,
  TOOLTIP_VIEWPORT_EDGE,
  adoptTooltipTitle,
  placeTooltip
} from "./tooltip-placement";

const viewport = { width: 1440, height: 900 };
const box = { width: 200, height: 40 };

describe("提示框定位：上方优先、空间不足翻下方、贴边夹持、箭头回指锚点", () => {
  it("上方够宽就落在锚点上方，水平居中", () => {
    const p = placeTooltip({ left: 600, top: 400, width: 40, height: 28 }, box, viewport);
    expect(p.side).toBe("top");
    expect(p.top).toBe(400 - box.height - TOOLTIP_GAP);
    expect(p.left).toBe(600 + 20 - box.width / 2);
    expect(p.arrowLeft).toBe(box.width / 2);
  });

  it("上方不足且下方更宽时翻到下方", () => {
    const p = placeTooltip({ left: 600, top: 18, width: 40, height: 28 }, box, viewport);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(18 + 28 + TOOLTIP_GAP);
  });

  it("两侧都挤时仍选更宽的一侧，并把 top 夹进视口", () => {
    const tiny = { width: 1440, height: 60 };
    const p = placeTooltip({ left: 600, top: 10, width: 40, height: 12 }, box, tiny);
    expect(p.side).toBe("bottom");
    expect(p.top).toBeGreaterThanOrEqual(TOOLTIP_VIEWPORT_EDGE);
    expect(p.top).toBeLessThanOrEqual(tiny.height - TOOLTIP_VIEWPORT_EDGE);
  });

  it("锚点贴左缘：提示框不越出视口，箭头仍夹在框内", () => {
    const p = placeTooltip({ left: 2, top: 400, width: 20, height: 28 }, box, viewport);
    expect(p.left).toBe(TOOLTIP_VIEWPORT_EDGE);
    expect(p.arrowLeft).toBeGreaterThanOrEqual(TOOLTIP_ARROW_INSET);
    expect(p.arrowLeft).toBeLessThanOrEqual(box.width - TOOLTIP_ARROW_INSET);
    expect(p.arrowLeft).toBe(12);
  });

  it("锚点贴右缘：提示框右缘留出边距", () => {
    const p = placeTooltip({ left: 1420, top: 400, width: 20, height: 28 }, box, viewport);
    expect(p.left + box.width).toBe(viewport.width - TOOLTIP_VIEWPORT_EDGE);
    expect(p.arrowLeft).toBeLessThanOrEqual(box.width - TOOLTIP_ARROW_INSET);
  });

  it("延迟与间距是设计档，不许被随手改成系统原生那一秒", () => {
    expect(TOOLTIP_HOVER_DELAY_MS).toBe(320);
    expect(TOOLTIP_GAP).toBe(8);
    expect(TOOLTIP_VIEWPORT_EDGE).toBe(8);
    expect(TOOLTIP_ARROW_INSET).toBe(12);
  });
});

describe("接管 title：空串不接管，纯图标按钮补一条可访问名", () => {
  it("空 / 纯空白的 title 不造一层提示", () => {
    expect(adoptTooltipTitle(null, false, false)).toBeNull();
    expect(adoptTooltipTitle("", false, false)).toBeNull();
    expect(adoptTooltipTitle("   \n  ", false, false)).toBeNull();
  });

  it("纯图标按钮：补 aria-label，且只取第一行不把路径念一遍", () => {
    const decision = adoptTooltipTitle("打开《xxx》\nC:/books/xxx", false, false);
    expect(decision?.text).toBe("打开《xxx》\nC:/books/xxx");
    expect(decision?.ariaLabel).toBe("打开《xxx》");
  });

  it("已有 aria-label 或可见文字的元素：不覆写它的可访问名", () => {
    expect(adoptTooltipTitle("关闭", true, false)?.ariaLabel).toBeNull();
    expect(adoptTooltipTitle("关闭", false, true)?.ariaLabel).toBeNull();
    expect(adoptTooltipTitle("关闭", true, false)?.text).toBe("关闭");
  });
});

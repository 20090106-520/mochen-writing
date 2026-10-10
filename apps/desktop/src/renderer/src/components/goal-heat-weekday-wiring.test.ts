import { describe, expect, it } from "vitest";
import { countNeedle, scriptSource, templateSource } from "../utils/vue-source-reader";

/**
 * 热力图那一格的星期标签必须**由日期算**（2026-10-09 扫描总单 P1-10）。
 *
 * 判定本身住在 `utils/goal-heat-labels.ts`（那边有五例逐档用例，含当场切时区的反向钉），
 * 这份只钉接线：面板不许再自己抄一张星期表、也不许按数组下标贴标签——
 * 「最近 7 天滚动窗口」的下标跟星期没有半点关系，那正是六天标错的成因。
 */
const PANEL = "components/WritingGoalPanel.vue";

describe("WritingGoalPanel · 热力格标签走日期，不走下标", () => {
  it("标签读的是 weekdayLabelOfDateKey(day.date)", () => {
    expect(countNeedle("weekdayLabelOfDateKey(day.date)", templateSource(PANEL))).toBe(1);
  });

  it("按数组下标贴标签那处已经没有了（残留一处就红）", () => {
    expect(countNeedle("weekdayLabels[", templateSource(PANEL))).toBe(0);
    expect(countNeedle("weekdayLabels", scriptSource(PANEL))).toBe(0);
  });

  it("标题里的号数也走同一份解析，面板不再自己 new Date(整串)", () => {
    expect(countNeedle("shortDateLabelOfDateKey(day.date)", templateSource(PANEL))).toBe(1);
    expect(countNeedle("function formatShortDate", scriptSource(PANEL))).toBe(0);
  });

  it("两份标签都从 util 导入（判据只许一份，铁律 6）", () => {
    const script = scriptSource(PANEL);
    expect(countNeedle("weekdayLabelOfDateKey", script)).toBe(1);
    expect(countNeedle("shortDateLabelOfDateKey", script)).toBe(1);
    expect(countNeedle("../utils/goal-heat-labels", script)).toBe(1);
  });

  it("那一格的标题写「近 7 天」：它是滚动窗口，不是日历周——周日一到就整片清零的那种话不许留着", () => {
    expect(countNeedle("本周热力图", templateSource(PANEL))).toBe(0);
    expect(countNeedle("近 7 天", templateSource(PANEL))).toBe(1);
  });
});

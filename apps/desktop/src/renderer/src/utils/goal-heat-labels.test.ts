import { describe, expect, it } from "vitest";
import { shortDateLabelOfDateKey, weekdayLabelOfDateKey } from "./goal-heat-labels";

/**
 * 热力图那七格「星期几 / 几号」的口径（2026-10-09 扫描总单 P1-10）。
 *
 * 【原来错在哪】面板写死 `weekdayLabels = ["一"…"日"]` 并按**数组下标**贴（`:178` `weekdayLabels[idx]`），
 * 而数据是「最近 7 天滚动窗口」（`useWritingGoalStore.ts` 从 `now - i*86_400000` 倒推）。
 * 窗口起点几乎不可能是周一 ⇒ 除今天正好是周日之外，七天里有六天标错。
 * 用户照标签找「昨天写了没」，读到的是错的那一天——错日期比缺功能更伤信任。
 *
 * 【为什么抽成 util 而不是留在面板里】本仓 `.vue` 不进类型程序、也没有 jsdom，
 * 写在 `<script setup>` 里的判定两头都测不到（同一个理由见 `utils/writing-goal-heat.ts`）。
 */
describe("weekdayLabelOfDateKey · 按日期本身取星期", () => {
  it("2026-10-09 是周五 ⇒ 「五」，不是按窗口下标算出来的那一天", () => {
    expect(weekdayLabelOfDateKey("2026-10-09")).toBe("五");
  });

  it("周日排第一档：连续七天逐日对照（含跨月）", () => {
    const week = [
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17"
    ];
    expect(week.map(weekdayLabelOfDateKey)).toEqual(["日", "一", "二", "三", "四", "五", "六"]);
  });

  it("跨年那一周照样对：2027-01-01 是周五", () => {
    expect(weekdayLabelOfDateKey("2027-01-01")).toBe("五");
  });

  it("按**本地**日历解析，不许被 UTC 拉走一天", () => {
    // `new Date("2026-10-09")` 解析的是 UTC 零点：在西侧时区它落到本地 10-08，「周五」就变成「周四」。
    // 本机是 UTC+8，整串丢给 Date 解析器在这一天**看不出错**——所以这里当场把时区切成纽约再断言，
    // 断完立刻还原（Node 运行时改 `process.env.TZ` 对后续 Date 生效，本机实测过）。
    // 日期键本来就是本地键（`useWritingGoalStore.ts` 的 `todayKey()` 用 getFullYear/getMonth/getDate），
    // 两侧必须同一份解析：号数与星期各 parse 一次的话，跨时区就会一个偏一天一个不偏。
    const saved = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(weekdayLabelOfDateKey("2026-10-09")).toBe("五");
      expect(shortDateLabelOfDateKey("2026-10-09")).toBe("10/9");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
    // 还原后同一把尺子：换时区不许改变答案，这正是「只按本地日历拆三段」的效果。
    expect(weekdayLabelOfDateKey("2026-10-09")).toBe("五");
  });

  it("认不得的键给一句稳定占位，绝不出现在屏上是 NaN/NaN 或 undefined", () => {
    for (const bad of ["", "不是日期", "2026-13-45", "2026/10/09", "2026-10"]) {
      expect(weekdayLabelOfDateKey(bad)).toBe("—");
      expect(shortDateLabelOfDateKey(bad)).toBe("—");
    }
  });
});

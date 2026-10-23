import { describe, expect, it } from "vitest";
import { chapterQuota } from "./chapter-quota";

describe("chapterQuota", () => {
  it("没设目标（0）时不造任何文字，也不报「超」", () => {
    expect(chapterQuota(4200, 0)).toEqual({
      target: 0,
      chars: 4200,
      delta: 0,
      over: false,
      label: ""
    });
  });

  it("超出目标给「超 N 字」，并标记 over", () => {
    const quota = chapterQuota(4200, 3000);
    expect(quota).toMatchObject({ target: 3000, chars: 4200, delta: 1200, over: true });
    expect(quota.label).toBe("超 1,200 字");
  });

  it("还没写够给「还差 N 字」，不标 over", () => {
    const quota = chapterQuota(1800, 3000);
    expect(quota).toMatchObject({ delta: -1200, over: false });
    expect(quota.label).toBe("还差 1,200 字");
  });

  it("一字不差时说「刚好到目标」，而不是「超 0 字」", () => {
    expect(chapterQuota(3000, 3000)).toMatchObject({ delta: 0, over: false, label: "刚好到目标" });
  });

  it("负数与 NaN 字数按 0 算，屏上不出现 NaN", () => {
    expect(chapterQuota(Number.NaN, 3000).chars).toBe(0);
    expect(chapterQuota(-5, 3000).chars).toBe(0);
    // 目标是非有限数或负数时视作没设
    expect(chapterQuota(120, Number.POSITIVE_INFINITY).target).toBe(0);
    expect(chapterQuota(120, -10).target).toBe(0);
  });
});

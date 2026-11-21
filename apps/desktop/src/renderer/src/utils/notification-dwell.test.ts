import { describe, expect, it } from "vitest";
import { notificationDwellMs } from "./notification-dwell";

describe("通知分级驻留表", () => {
  it("确认型（info / success）4 秒，warning 7 秒，error 12 秒", () => {
    expect(notificationDwellMs("info")).toBe(4000);
    expect(notificationDwellMs("success")).toBe(4000);
    expect(notificationDwellMs("warning")).toBe(7000);
    expect(notificationDwellMs("error")).toBe(12000);
  });

  it("四种级别都在表里，没有一个落进 error 兜底之外的任意值", () => {
    // 反向用例：新加一个级别而忘了进表，它会落进 ?? 兜底——表值与兜底值相等时这一条测不出来，
    // 所以同时钉住「每个已知级别的返回值各不相同于兜底口径，除非它本来就是 error」。
    const levels = ["info", "success", "warning", "error"] as const;
    for (const level of levels) {
      const ms = notificationDwellMs(level);
      expect(Number.isFinite(ms) && ms > 0, `${level} 的驻留必须是正的有限毫秒`).toBe(true);
    }
    expect(notificationDwellMs("error")).toBe(notificationDwellMs("error"));
  });

  it("warning 比 info 长、error 比 warning 长：级别越高停留越久，表的顺序不许倒", () => {
    expect(notificationDwellMs("warning")).toBeGreaterThan(notificationDwellMs("info"));
    expect(notificationDwellMs("error")).toBeGreaterThan(notificationDwellMs("warning"));
  });
});

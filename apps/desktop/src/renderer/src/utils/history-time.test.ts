import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatHistoryTime } from "./history-time";

/**
 * 历史面板那一格的时间（#113e-4）。判定本体住在 utils/history-time.ts——
 * 他是写在组件方法里的（ConversationHistoryMenu.vue:52-70），本仓 `.vue` 不进类型程序也不进
 * DOM 测试，逻辑留在组件里就等于没有关卡，所以抽成纯函数在这里测，组件只调它。
 * 假时钟把「今天」钉住：不钉的话同一天那条会随真实日期漂移。
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T09:05:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("formatHistoryTime（照 deepwrite 的三段判据）", () => {
  it("今天之内只给时分：列表里同一天几条必须分得开", () => {
    // 不带时区的字面量按本地时区解析 ⇒ 无论这台机器在哪个时区都落在「今天」那一档。
    expect(formatHistoryTime("2026-10-04T09:05:00")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatHistoryTime("2026-10-04T23:59:00")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("今年内的别的日子给月日，不带年份", () => {
    const value = formatHistoryTime("2026-09-28T12:00:00");
    expect(value).toContain("28");
    expect(value).not.toContain("2026");
  });

  /** 他那句注释的实话版：历史会跨年堆积，光一个 9/28 分不出 2025 还是 2026。 */
  it("跨年那条必须带年份", () => {
    expect(formatHistoryTime("2025-09-28T12:00:00")).toContain("2025");
  });

  it("读不懂的时间原样还回，不显示 NaN", () => {
    expect(formatHistoryTime("刚刚")).toBe("刚刚");
    expect(formatHistoryTime("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { READING_MINUTES_PER_WORD, readingMinutes } from "./reading-time";

describe("readingMinutes（附录 F-G：中文 300 字/分钟，向上取整）", () => {
  it("换算常数就是 300，别哪天漂成 200", () => {
    expect(READING_MINUTES_PER_WORD).toBe(300);
  });

  it("整除不多取：900 字是 3 分钟", () => {
    expect(readingMinutes("雾".repeat(900))).toBe(3);
  });

  it("向上取整：901 字进到 4 分钟，绝不四舍五入成 3", () => {
    expect(readingMinutes("雾".repeat(901))).toBe(4);
  });

  it("一个字也是 1 分钟，不许出现 0 分钟", () => {
    expect(readingMinutes("雾")).toBe(1);
  });

  it("空串返回 null 而不是 0：模板据此显示「— 分钟」", () => {
    expect(readingMinutes("")).toBeNull();
  });

  it("只有空白返回 null：全角空格、制表、换行都不算字", () => {
    expect(readingMinutes("   \n\t 　 \r\n")).toBeNull();
  });

  it("空白不计入字数：900 个字夹 900 个空白仍是 3 分钟", () => {
    expect(readingMinutes("雾 雾\n雾\t雾" + "雾".repeat(896))).toBe(3);
  });

  it("按码点数而不是 UTF-16 码元：300 个表情是 1 分钟，按码元会算成 2 分钟", () => {
    expect(readingMinutes("🐋".repeat(300))).toBe(1);
    expect(readingMinutes("雾".repeat(300))).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  READING_MINUTES_PER_WORD,
  codePointLength,
  readingMinutes,
  readingTimeLabel
} from "./reading-time";

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

/**
 * 修复轮 F1：页脚那句文案此前拼在 `DocumentPane.vue` 的 `<script setup>` 里，
 * 而 `.vue` 既不进类型程序也没有运行时覆盖 ⇒ 改名字符串能全绿通过。拼串搬进 `.ts` 才谈得上被钉住。
 */
describe("readingTimeLabel（修复轮 F1：分钟文案的唯一拼身处）", () => {
  it("正常文本给「约 N 分钟阅读」，N 就是 readingMinutes 的返回值", () => {
    expect(readingTimeLabel("雾".repeat(901))).toBe("约 4 分钟阅读");
    expect(readingTimeLabel("雾")).toBe("约 1 分钟阅读");
  });

  it("空串给「— 分钟」：一个字都没有时不许谎报 0 分钟", () => {
    expect(readingTimeLabel("")).toBe("— 分钟");
  });

  it("纯空白也给「— 分钟」：空白不算字（与 readingMinutes 的 null 分支同源）", () => {
    expect(readingTimeLabel("   \n\t")).toBe("— 分钟");
  });
});

/**
 * 修复轮 F4：页脚同一排的「N 字」与「约 M 分钟阅读」必须出自同一计数口径，
 * 否则 300 个 🐋 会显示成「600 字 / 约 1 分钟阅读」，当场自证 300 字/分钟是假话。
 */
describe("codePointLength（修复轮 F4：字数与时长同口径）", () => {
  it("按码点计数：一个表情算一个字", () => {
    expect(codePointLength("🐋海雾")).toBe(3);
  });

  it("同一段文本：字数 300 与时长 1 分钟出自同一口径，不再一个按码元一个按码点", () => {
    const text = "🐋".repeat(300);
    expect(codePointLength(text)).toBe(300);
    expect(readingMinutes(text)).toBe(1);
  });
});

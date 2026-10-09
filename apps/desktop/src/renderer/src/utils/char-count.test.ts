import { describe, expect, it } from "vitest";
import { formatCharCount } from "./char-count";

/**
 * 字数格式化的唯一口径（2026-10-09 扫描总单：`formatChars` 在五处各写了一份）。
 *
 * 五份的差异不是风格问题，是**同一本书在不同面板显示成不同字数**：
 * 大纲那份有「千字」档且不加分位符；字数面板用 `.toFixed(2)`（"1.23 万字"），
 * 另两份用 `.toFixed(1)`（"1.2 万字"）；项目设置里连空格都没有。
 * 作者在同一屏里既能看到大纲的"12.3 千字"又能看到统计面板的"12,345 字"，
 * 他没法判断哪个是真的——所以这里只留一份，规则取覆盖面最广的那一种：
 * 一万以上说"万"，其余带千位分隔符，没有"千字"这一档。
 */

describe("formatCharCount：一份口径", () => {
  it("没有读数与坏读数都说 0 字，不许输出 NaN 或 undefined", () => {
    expect(formatCharCount(undefined)).toBe("0 字");
    expect(formatCharCount(Number.NaN)).toBe("0 字");
    expect(formatCharCount(Number.POSITIVE_INFINITY)).toBe("0 字");
    expect(formatCharCount(-500)).toBe("0 字");
  });

  it("一万以下带千位分隔符，小数按四舍五入到整字", () => {
    expect(formatCharCount(0)).toBe("0 字");
    expect(formatCharCount(87)).toBe("87 字");
    expect(formatCharCount(1234)).toBe("1,234 字");
    expect(formatCharCount(1234.6)).toBe("1,235 字");
    expect(formatCharCount(9999)).toBe("9,999 字");
  });

  it("一万以上说「万」，一律一位小数——旧的五份里有一位也有两位，同一本书两个面板对不上", () => {
    expect(formatCharCount(10_000)).toBe("1.0 万字");
    expect(formatCharCount(12_345)).toBe("1.2 万字");
    expect(formatCharCount(98_765)).toBe("9.9 万字");
    expect(formatCharCount(123_456)).toBe("12.3 万字");
  });

  it("没有「千字」这一档：1500 就是 1,500 字（旧的大纲那份会写成 1.5 千字）", () => {
    expect(formatCharCount(1_500)).toBe("1,500 字");
    expect(formatCharCount(1_500)).not.toContain("千");
  });

  it("临界值只有一档：先四舍五入到整字，再判要不要说「万」", () => {
    // 半字不存在。不先取整就会出现"9,999.5 显示成 9,999 字、而 10,000 显示成 1.0 万字"
    // 这种同一本书差一字的错觉；先取整之后 9,999.5 与 10,000 是同一个读数。
    expect(formatCharCount(9_999.5)).toBe("1.0 万字");
    expect(formatCharCount(10_000)).toContain("万");
    expect(formatCharCount(9_999)).not.toContain("万");
  });
});

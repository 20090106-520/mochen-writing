import { describe, expect, it } from "vitest";
import {
  FUZZY_QUERY_MAX_CHARS,
  fuzzyEligible,
  fuzzyFindInLine,
  isWithinEdits
} from "../src/search-match.js";

/** 检索容错（2026-10-10）：一字之差兜底的判定纯函数。精确匹配永远先行，这里只钉兜底层本身。 */

describe("isWithinEdits：至多差一次编辑", () => {
  it("同串 / 一字替换 / 尾插 / 尾删 都算命中", () => {
    expect(isWithinEdits("林潮升", "林潮生", 1)).toBe(true);
    expect(isWithinEdits("林潮生", "林潮生", 1)).toBe(true);
    expect(isWithinEdits("林潮", "林潮生", 1)).toBe(true);
    expect(isWithinEdits("林潮生刀", "林潮生", 1)).toBe(true);
  });

  it("尾部删两个字是两次编辑，不算命中", () => {
    expect(isWithinEdits("林潮生的刀", "林潮生", 1)).toBe(false);
  });

  it("两处错、长度差超一、空对非空超长 都不命中", () => {
    expect(isWithinEdits("林海升", "林潮生", 1)).toBe(false);
    expect(isWithinEdits("潮生", "林潮生超长", 1)).toBe(false);
    expect(isWithinEdits("", "abc", 1)).toBe(false);
    expect(isWithinEdits("abc", "", 1)).toBe(false);
  });
});

describe("fuzzyFindInLine：行内找窗口", () => {
  it("替换错（升↔生）给出精确窗口", () => {
    const line = "林潮升把刀放下。";
    const hit = fuzzyFindInLine(line, "林潮生");
    expect(hit).toEqual({ start: 0, end: 3 });
    expect(line.slice(hit!.start, hit!.end)).toBe("林潮升");
  });

  it("查询多写一字（「守闸人儿」）命中原文长一字的对齐窗；查询少写一字同理", () => {
    // 降序扫：长窗优先，命中的是「原文多/少一字」里带足上下文的那个窗口，
    // 而不是把窗口切短到纯前缀（那是升序 len-1 档的噪声）。
    expect(fuzzyFindInLine("守闸人立于门前", "守闸人儿")).toEqual({ start: 0, end: 4 });
    expect(fuzzyFindInLine("林潮生立于门前", "林潮生刀")).toEqual({ start: 0, end: 4 });
  });

  it("纯前缀不冒充命中：查询「林潮生」不落在「林潮」两字上", () => {
    // 升序扫的历史坑：len-1 档会让「林潮」抢在「林潮升」前面命中——错字没进窗口，高亮是错的。
    const hit = fuzzyFindInLine("林潮升把刀放下。", "林潮生");
    expect(hit!.end - hit!.start).toBe(3);
  });

  it("精确不中的行回 null；空查询回 null", () => {
    expect(fuzzyFindInLine("今天天气不错", "林潮生")).toBeNull();
    expect(fuzzyFindInLine("任意", "")).toBeNull();
  });
});

describe("fuzzyEligible：查询资格", () => {
  it("空串不启用；超长句不启用；普通词启用", () => {
    expect(fuzzyEligible("")).toBe(false);
    expect(fuzzyEligible("一".repeat(FUZZY_QUERY_MAX_CHARS + 1))).toBe(false);
    expect(fuzzyEligible("林潮升")).toBe(true);
  });
});

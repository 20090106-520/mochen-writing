import { describe, expect, it } from "vitest";
import { narrationPersonOf } from "../src/narration-person.js";
import { STYLE_PROFILE_MIN_CHARS } from "../src/style-profile.js";

/**
 * 叙述人称读数（2026-11-15）：数引号外的第一/第三人称代词。
 *
 * 这是**代理读数**，不是视角判决：只钉口径与边界，不钉「多少算第一人称小说」。
 * 所有夹具的字数都手算在注释里，口径一改就红。
 */
describe("narrationPersonOf · 样本门槛", () => {
  it("叙述非空白字数不足 500 ⇒ null（不报 0/0 冒充「没有人称」）", () => {
    expect(STYLE_PROFILE_MIN_CHARS).toBe(500);
    expect(narrationPersonOf(["他".repeat(499)])).toBeNull();
    expect(narrationPersonOf(["他".repeat(500)])).not.toBeNull();
  });

  it("样本只数引号外的叙述：对白再多也不算", () => {
    // 「我我我」每段 3 字全在引号里；叙述只剩「他没有回头。」6 字 × 100 = 600 字。
    const text = "「我我我」他没有回头。".repeat(100);
    const person = narrationPersonOf([text]);
    expect(person?.first).toBe(0);
    expect(person?.third).toBe(100);
  });
});

describe("narrationPersonOf · 计数口径", () => {
  it("第一人称：「我们」「咱们」各计 1 次（数代词出现，不数人）", () => {
    // 5 字 × 100 = 500 字，其中「我」100 次。
    expect(narrationPersonOf(["我们走吧。".repeat(100)])?.first).toBe(100);
    // 「咱们」同样每段 1 次。
    expect(narrationPersonOf(["咱们走吧。".repeat(100)])?.first).toBe(100);
  });

  it("第三人称：他/她/祂/它都算，人名不计入（这个数是下界）", () => {
    // 「他没有回头。」6 字 × 100 = 600 字，他 100 次。
    const person = narrationPersonOf(["他没有回头。".repeat(100)]);
    expect(person?.third).toBe(100);
    expect(person?.dominant).toBe("third");
  });

  it("「其他」「其它」里的字不算人称代词（负向后顾排除）", () => {
    // 「其他其它。」5 字 × 100 = 500 字；两处「他/它」都被排除 ⇒ 0。
    const person = narrationPersonOf(["其他其它。".repeat(100)]);
    expect(person?.third).toBe(0);
    expect(person?.dominant).toBe("none");
  });

  it("dominant 按两数比较：first / third / tie / none 四档", () => {
    expect(narrationPersonOf(["我往前走。".repeat(100)])?.dominant).toBe("first");
    expect(narrationPersonOf(["他往前走。".repeat(100)])?.dominant).toBe("third");
    // 「我他往前走。」每段各 1 次 ⇒ 两数相等。
    const tie = narrationPersonOf(["我他往前走。".repeat(100)]);
    expect(tie?.first).toBe(100);
    expect(tie?.third).toBe(100);
    expect(tie?.dominant).toBe("tie");
    // 没有人称代词（但样本够 500 字）⇒ none，不是 first/third。
    expect(narrationPersonOf(["天色渐暗，屋里安静。".repeat(60)])?.dominant).toBe("none");
  });
});

import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
import { closingsSentence, defaultPromptFor } from "./prompt-assembly.js";

/**
 * 章尾防套路（2026-11-15）：与 `openingsSentence` 对称，管「怎么出去」。
 * 用例钉边界：少于两章不注入、纯符号过滤、只摆最后 5 条、叮嘱里要有「换一种收法」。
 */
const CHAPTER: DocRef = { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" };

const build = (closings?: string[]) =>
  defaultPromptFor({
    title: "雾港",
    stageName: "正文",
    chapter: CHAPTER,
    permissionLabel: "全开",
    workModeLabel: "直接动手",
    profile: defaultProfile(),
    context: {
      items: [],
      chars: 0,
      approxTokens: 0,
      ...(closings === undefined ? {} : { closings })
    },
    webSearchEnabled: false
  });

describe("closingsSentence · 章尾回声（2026-11-15）", () => {
  it("两章起才摆：一章不谈套路（与章首同一条纪律）", () => {
    expect(closingsSentence(["他把门带上。"])).toBe("");
    expect(build(["他把门带上。"])).not.toContain("前面各章的结尾");
  });

  it("两章以上 ⇒ 把结句原样摆出，并叮嘱换收法", () => {
    const text = build(["他把门带上。", "雨还没停。"]);
    expect(text).toContain("前面各章的结尾分别是：「他把门带上。」、「雨还没停。」");
    expect(text).toContain("换一种收法");
    expect(text).toContain("别每章都收在总结或感叹上");
  });

  it("纯标点/符号的分隔行被过滤，不当成章尾样本", () => {
    // 过滤后只剩两条 ⇒ 仍然注入；`***` 不许出现。
    const text = build(["***", "他把门带上。", "雨还没停。"]);
    expect(text).not.toContain("***");
    expect(text).toContain("他把门带上。");
    // 过滤后不足两条 ⇒ 不注入。
    expect(closingsSentence(["***", "他把门带上。"])).toBe("");
  });

  it("只摆最后 5 条（更早的章尾不刷屏）", () => {
    const text = build(["结尾一", "结尾二", "结尾三", "结尾四", "结尾五", "结尾六"]);
    expect(text).toContain("结尾六");
    expect(text).toContain("结尾二");
    expect(text).not.toContain("结尾一");
  });

  it("没有 closings（老夹具）⇒ 不注入空段", () => {
    expect(build()).not.toContain("前面各章的结尾");
    expect(build([])).not.toContain("前面各章的结尾");
  });
});

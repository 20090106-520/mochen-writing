import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
import { defaultPromptFor } from "./prompt-assembly.js";

/**
 * 叙述人称读数（2026-11-15）：只注入生成端、不进任何闸。
 * 用例钉三条文案分支与边界（当前章不算 / 样本不足不加），不钉「多少算病」。
 */
const CHAPTER: DocRef = { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" };

const build = (context: Parameters<typeof defaultPromptFor>[0]["context"]) =>
  defaultPromptFor({
    title: "雾港",
    stageName: "正文",
    chapter: CHAPTER,
    permissionLabel: "全开",
    workModeLabel: "直接动手",
    profile: defaultProfile(),
    context,
    webSearchEnabled: false
  });

const item = (text: string, active = false) => ({
  kind: "chapter" as const,
  relPath: "chapters/01.md",
  title: "开局",
  text,
  chars: text.length,
  active
});

const withItems = (...items: ReturnType<typeof item>[]) => {
  const chars = items.reduce((sum, one) => sum + one.chars, 0);
  return { items, chars, approxTokens: chars };
};

describe("叙述人称读数（2026-11-15：引号外的代词数，只摆不判）", () => {
  it("叙述里一个「我」都没有 ⇒ 点明第三人称视角", () => {
    // 「他没有回头。」6 字 × 100 = 600 字，第三人称 100 处。
    const text = build(withItems(item("他没有回头。".repeat(100))));
    expect(text).toContain("本书叙述人称");
    expect(text).toContain("一个「我」都没有");
    expect(text).toContain("第三人称代词 100 处");
  });

  it("只有第一人称 ⇒ 说清「只有『我』」，叮嘱别滑成他/她", () => {
    // 「我往前走。」5 字 × 100 = 500 字，第一人称 100 处、第三人称 0。
    const text = build(withItems(item("我往前走。".repeat(100))));
    expect(text).toContain("只有第一人称（「我」100 处）");
    expect(text).toContain("别忽然滑成「他/她」");
  });

  it("两路都有时按多寡给动作：以第一人称为主", () => {
    // 每段「我我没有回头。」（我 2）＋「他没有回头。」（他 1），50 段 ⇒ 100 / 50。
    const unit = "我我没有回头。" + "他没有回头。";
    const text = build(withItems(item(unit.repeat(50))));
    expect(text).toContain("第一人称 100 处、第三人称 50 处");
    expect(text).toContain("以第一人称为主");
  });

  it("以第三人称为主时补一句「这个数只是下界」（人名不计入）", () => {
    // 每段「我没有回头。」1 个我 ＋「他没有回头。他没有回头。」2 个他，30 段 ⇒ 30 / 60。
    const unit = "我没有回头。" + "他没有回头。他没有回头。";
    const text = build(withItems(item(unit.repeat(30))));
    expect(text).toContain("第一人称 30 处、第三人称 60 处");
    expect(text).toContain("以第三人称为主");
    expect(text).toContain("这个数只是下界");
  });

  it("两数相等 ⇒ 说「两路都在用」，不硬判主次", () => {
    // 「我他往前走。」6 字 × 100 = 600 字，各 100 处。
    const text = build(withItems(item("我他往前走。".repeat(100))));
    expect(text).toContain("两路都在用");
    expect(text).not.toContain("以第一人称为主");
    expect(text).not.toContain("以第三人称为主");
  });

  it("当前章（半截草稿）不算：只写当前章时不注入", () => {
    expect(build(withItems(item("他没有回头。".repeat(100), true)))).not.toContain("本书叙述人称");
  });

  it("样本不足或没有代词 ⇒ 不注入空段", () => {
    expect(build(withItems(item("他没有回头。")))).not.toContain("本书叙述人称");
    // 样本够 500 字，但叙述里一个代词都没有 ⇒ dominant = none，同样不加。
    expect(build(withItems(item("天色渐暗，屋里安静。".repeat(60))))).not.toContain("本书叙述人称");
  });

  it("非 chapter 条目（人物卡等）不参与统计", () => {
    const card = {
      kind: "character" as const,
      relPath: "characters/陈砚.md",
      title: "陈砚",
      text: "他没有回头。".repeat(100),
      chars: 600,
      active: false
    };
    expect(build({ items: [card], chars: 600, approxTokens: 600 })).not.toContain("本书叙述人称");
  });
});

/**
 * 本章漂移（2026-11-16）：前面各章是第三人称、这一章已写部分忽然用「我」，比整体读数更该报。
 * 半截草稿也过 500 字门槛——不够就不说，免得开写头几行就下判断。
 */
describe("叙述人称 · 本章漂移", () => {
  const thirdPersonBook = item("他没有回头。".repeat(100));

  it("前面没有「我」、本章草稿里出现了 ⇒ 单独点出这一章", () => {
    const text = build(withItems(thirdPersonBook, item("我往前走。".repeat(100), true)));
    expect(text).toContain("这一章已写的部分里「我」出现了 100 次");
    expect(text).toContain("改回「他/她」");
  });

  it("前面是第一人称、本章草稿一个「我」都没有 ⇒ 提醒别滑成他/她", () => {
    const text = build(
      withItems(item("我往前走。".repeat(100)), item("他往前走。".repeat(100), true))
    );
    expect(text).toContain("前面各章却是第一人称");
  });

  it("本章草稿样本不足 ⇒ 不比（不拿几行字下判断）", () => {
    const text = build(withItems(thirdPersonBook, item("我往前走。", true)));
    expect(text).toContain("本书叙述人称");
    expect(text).not.toContain("这一章已写的部分");
  });

  it("本章与全书人称一致 ⇒ 不另加一句", () => {
    const text = build(withItems(thirdPersonBook, item("他往前走。".repeat(100), true)));
    expect(text).not.toContain("这一章已写的部分");
    expect(text).not.toContain("改回「他/她」");
  });
});

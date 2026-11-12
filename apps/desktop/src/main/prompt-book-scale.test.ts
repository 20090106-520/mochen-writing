import { describe, expect, it } from "vitest";
import { defaultProfile } from "@mochen/contracts";
import { bookCountsOf, defaultPromptFor, type BookCounts } from "./prompt-assembly.js";

/**
 * 「书稿规模」那一句（2026-11-12）。
 *
 * 从 `agent-service-prompt.test.ts` 拆出来是行数预算逼的（那个文件贴着 800 行），
 * 拆法与本仓其它提示词守卫一致：一段一件事、一个文件。
 *
 * 真机会话里翻到的现场：一本完全空的书上，模型连着调了 `book_outline` / `book_cast` /
 * `list_docs` 三枚工具，三个都回「这本书还没有文稿」，它才开口。回复的第一段是
 * 「这本书目前是空的。没有大纲、没有人物、没有世界观、一章正文都没有」——
 * 那一段本质是在向用户汇报自己刚做过哪些检查，而那是对话里最重的那层 AI 腔；
 * 三枚工具的往返也是白烧的，这件事系统提示一句话就能说清。
 *
 * 关键不在「报一句空」，在**把它写成指令**：只说「这本书现在是空的」，模型照样会去确认一遍
 * （它不信任提示词里的现状描述）；点明「别再调工具确认」并给出下一步该问什么，它才会直接开口。
 */
const NO_CONTEXT = { items: [], chars: 0, approxTokens: 0 };

describe("书稿规模 · 空书别让模型去翻三遍", () => {
  function build(bookCounts?: BookCounts): string {
    return defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: null,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: false,
      ...(bookCounts === undefined ? {} : { bookCounts })
    });
  }

  it("空书：说清是空的，并且明写「别再调工具确认」", () => {
    const text = build({ docs: 0, chapters: 0, proseChars: 0 });
    expect(text).toContain("一篇文稿都没有");
    expect(text).toContain("别再调工具去确认");
    // 光说「空」不够，得给下一步——否则模型接着问一句「你想写什么」，等于没说。
    expect(text).toContain("想从哪儿开始");
  });

  it("有文稿：只报数，不拦它看清单", () => {
    const text = build({ docs: 9, chapters: 6, proseChars: 32800 });
    expect(text).toContain("9 篇文稿");
    expect(text).toContain("正文 6 章");
    // 「别再调工具」只属于空书。有稿时 list_docs 是它真要看清单，拦掉就是让模型瞎写。
    expect(text).not.toContain("别再调工具去确认");
  });

  it("有文件但全是空壳：按字数判空，不按篇数——否则模型挨篇读回来的都是空白", () => {
    // 用户点两下「新建章节」文件夹里就有三篇了，内容一个字没有。
    const text = build({ docs: 3, chapters: 3, proseChars: 0 });
    expect(text).toContain("都还没有内容");
    expect(text).toContain("别再挨篇读一遍");
    // 篇数要报，但必须紧跟「没有内容」——只说「有 3 篇文稿」，模型会以为有东西可读。
    expect(text).toContain("有 3 篇文稿，但都还没有内容");
  });

  it("没给这一格（老夹具 / 未知）：整句不加，也不许凭空报 0", () => {
    const text = build();
    expect(text).not.toContain("篇文稿");
    expect(text).not.toContain("一篇文稿都没有");
  });

  it("紧跟在「当前作品」那句之后：模型的第一个疑问是「这本书写到哪了」", () => {
    const text = build({ docs: 9, chapters: 6, proseChars: 32800 });
    expect(text.indexOf("9 篇文稿")).toBeGreaterThan(text.indexOf("当前作品"));
    expect(text.indexOf("9 篇文稿")).toBeLessThan(text.indexOf("权限档"));
  });
});

/**
 * 数字本身也是一类提示词错误：篇数报错、把大纲算成正文、把空壳算成有内容，
 * 屏上都只是「一句没说对」，模型却会照着那句去调工具。守卫逐条钉口径。
 */
describe("bookCountsOf · 数的是整本书，不是装进上下文的那几篇", () => {
  it("空表就是一本空书", () => {
    expect(bookCountsOf([])).toEqual({ docs: 0, chapters: 0, proseChars: 0 });
  });

  it("只把 kind=chapter 算进章数；大纲、人物卡、设定都算进篇数", () => {
    const counts = bookCountsOf([
      { kind: "chapter", chars: 1200 },
      { kind: "outline", chars: 300 },
      { kind: "character", chars: 180 },
      { kind: "chapter", chars: 900 }
    ]);
    expect(counts).toEqual({ docs: 4, chapters: 2, proseChars: 2580 });
  });

  it("chars 缺省一律当 0：老书 / scan 读不到的稿子不许凭空报字数", () => {
    const counts = bookCountsOf([
      { kind: "chapter", chars: 800 },
      { kind: "chapter" },
      { kind: "outline" }
    ]);
    expect(counts).toEqual({ docs: 3, chapters: 2, proseChars: 800 });
  });

  it("三个空壳章节：篇数照报，字数必须是 0——提示词靠这一格判空", () => {
    const counts = bookCountsOf([
      { kind: "chapter", chars: 0 },
      { kind: "chapter", chars: 0 },
      { kind: "chapter" }
    ]);
    expect(counts.docs).toBe(3);
    expect(counts.proseChars).toBe(0);
    expect(bookCountsOf([]).proseChars).toBe(0);
  });
});

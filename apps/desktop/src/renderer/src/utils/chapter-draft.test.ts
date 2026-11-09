import { describe, expect, it } from "vitest";
import { parseVolumeOutline, type ParsedChapter } from "@mochen/contracts";
import {
  chapterDraftPrompt,
  chapterDraftTargetHint,
  type ChapterDraftInput
} from "./chapter-draft";

const RAW = [
  "## 第一章 潮信",
  "- 视角：林晚",
  "- 目标：找到失踪的哥哥",
  "- 冲突：海关不让她下船",
  "- 转折：名单上有哥哥的名字",
  "- 钩子：署名是哥哥的笔迹",
  "- 字数：3200",
  "## 第二章 夜航",
  "- 视角：程野",
  "- 目标：把船靠岸",
  "- 冲突：风浪拍碎了船舷",
  "- 转折：灯塔忽然灭了",
  "- 钩子：岸边有人朝她招手",
  "- 字数：约 2800 字"
].join("\n");

function chapters(): ParsedChapter[] {
  return parseVolumeOutline(RAW).chapters;
}

function input(overrides: Partial<ChapterDraftInput> = {}): ChapterDraftInput {
  return {
    chapter: chapters()[0]!,
    previousTitle: null,
    previousRelPath: null,
    targetRelPath: "chapters/第一章 潮信.md",
    targetExists: true,
    ...overrides
  };
}

describe("按纲起草的指令：六项照原样，缺项不编（2026-11 W-02 第二步）", () => {
  it("六项齐全时，整段指令逐行对得上（这份就是用户会在输入框里看到的东西）", () => {
    expect(chapterDraftPrompt(input())).toBe(
      [
        "请按下面这份章纲起草《第一章 潮信》的正文。",
        "",
        "【目标文稿】",
        "- 写入：chapters/第一章 潮信.md",
        "- 用 write_doc 写进这一篇；卷纲、章纲和其他文稿一个字都不改。",
        "",
        "【本章章纲】",
        "- 视角：林晚",
        "- 目标：找到失踪的哥哥",
        "- 冲突：海关不让她下船",
        "- 转折：名单上有哥哥的名字",
        "- 钩子：署名是哥哥的笔迹",
        "- 字数：3200",
        "",
        "【写作约束】",
        "- 承接上一章：这是这篇卷纲里的第一章。如果书里已有更早的章节，先读最近一章的结尾再接上；读不到就照实说不确定前情，不要凭空补。",
        "- 视角：全章按「林晚」的视角写，不要中途切到别人的内心。",
        "- 目标：正文要让主角朝「找到失踪的哥哥」这个目标推进；每一场戏都问一句「离它近了还是远了」。",
        "- 冲突：把「海关不让她下船」写成具体的阻力、代价和当场的反应，不要一句话带过。",
        "- 转折：转折必须真正改变局面（「名单上有哥哥的名字」），不能只是换句话重复冲突。",
        "- 钩子：正文最后落在「署名是哥哥的笔迹」这件事上；可以埋线，但不要提前揭开。",
        "- 字数：约 3200 字；按这个量写，不硬凑也不注水。",
        "",
        "【未填项】",
        "- 本章章纲六项都填了，没有留白。",
        "",
        "写完以后告诉我：正文落在哪一篇、有哪一处拿不准需要我定。"
      ].join("\n")
    );
  });

  it("缺项只进「未填项」一段，指令里不出现编造的该项约束", () => {
    const chapter = parseVolumeOutline(
      ["## 第一章 潮信", "- 视角：林晚", "- 目标：找到失踪的哥哥"].join("\n")
    ).chapters[0]!;

    const prompt = chapterDraftPrompt(input({ chapter }));

    expect(prompt).toContain("【未填项 · 请勿自行补设定】");
    expect(prompt).toContain("本章章纲没填：冲突、转折、钩子、字数。");
    expect(prompt).toContain("以上未填，请勿自行补设定");
    // 缺的字段不能以「字段：值」的形式混进指令，也不能生成对应的写法约束。
    expect(prompt).not.toContain("- 冲突：");
    expect(prompt).not.toContain("冲突：把");
    expect(prompt).not.toContain("字数：约");
  });

  it("上一章指名道姓，让 AI 读它结尾，而不是假装读过", () => {
    const prompt = chapterDraftPrompt(
      input({
        chapter: chapters()[1]!,
        previousTitle: "第一章 潮信",
        previousRelPath: "chapters/第一章 潮信.md",
        targetRelPath: "chapters/第二章 夜航.md",
        targetExists: false
      })
    );
    expect(prompt).toContain(
      "先读上一章《第一章 潮信》（chapters/第一章 潮信.md）的结尾，从它停下的地方接上"
    );
    expect(prompt).toContain("这一篇还没有正文稿，请用 write_doc 新建到该路径");
  });

  it("字数读不出纯整数时按原话处理，不硬凑成一个数", () => {
    const chapter = parseVolumeOutline(["## 第一章", "- 字数：三千字"].join("\n")).chapters[0]!;
    const prompt = chapterDraftPrompt(input({ chapter }));
    expect(prompt).toContain(
      "章纲写的是「三千字」；读不出确切数字，就按原话处理，不硬凑成某个数。"
    );
  });

  it("分节、可改：目标文稿、章纲、约束、缺项四段各在一行", () => {
    const prompt = chapterDraftPrompt(input());
    for (const heading of ["【目标文稿】", "【本章章纲】", "【写作约束】", "【未填项】"]) {
      expect(prompt.split("\n")).toContain(heading);
    }
  });
});

describe("会写到哪一篇：不是眼前那篇时点名", () => {
  it("目标就是眼前这一篇：不解释不存在的误会", () => {
    expect(
      chapterDraftTargetHint({
        chapterTitle: "第一章 潮信",
        targetRelPath: "chapters/第一章 潮信.md",
        targetExists: true,
        activeRelPath: "chapters/第一章 潮信.md",
        activeTitle: "第一章 潮信"
      })
    ).toBe("");
  });

  it("目标不是眼前那一篇：标题、路径、眼前那篇都说清", () => {
    const hint = chapterDraftTargetHint({
      chapterTitle: "第二章 夜航",
      targetRelPath: "chapters/第二章 夜航.md",
      targetExists: true,
      activeRelPath: "chapters/第一章 潮信.md",
      activeTitle: "第一章 潮信"
    });
    expect(hint).toContain("这一章会写到《第二章 夜航》（chapters/第二章 夜航.md）");
    expect(hint).toContain("指令已经预填在它对应的输入框里");
    expect(hint).toContain("不会改你眼前这篇《第一章 潮信》");
  });

  it("没打开文稿时也交代清楚，并且说明不会误改别的篇", () => {
    const hint = chapterDraftTargetHint({
      chapterTitle: "第一章 潮信",
      targetRelPath: "chapters/第一章 潮信.md",
      targetExists: false,
      activeRelPath: null,
      activeTitle: null
    });
    expect(hint).toContain("这篇还没有正文稿，先在文稿树里新建它");
    expect(hint).toContain("打开那一篇就能改着发，不会误改别的篇");
  });
});

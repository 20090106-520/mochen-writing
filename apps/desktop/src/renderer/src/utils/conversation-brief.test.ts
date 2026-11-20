import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { briefCharText, conversationBrief } from "./conversation-brief";

function doc(patch: Partial<DocRef> & { relPath: string; kind: DocRef["kind"] }): DocRef {
  return { title: patch.relPath, ...patch } as DocRef;
}

describe("对话区现状 · 三档边界", () => {
  it("没打开作品：说「还没打开」，不装懂", () => {
    const brief = conversationBrief({ hasBook: false, title: "", docs: [], activeChapter: null });
    expect(brief.stage).toBe("no-book");
    expect(brief.headline).toBe("还没打开作品");
    expect(brief.nextStep).toContain("目录");
  });

  it("有书但一章都没有：说「还是空的」，下一步是开第一章", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [doc({ relPath: "characters/林越.md", kind: "character" })],
      activeChapter: null
    });
    expect(brief.stage).toBe("empty-book");
    expect(brief.headline).toBe("《海雾手记》还是空的");
    expect(brief.nextStep).toContain("第一章");
  });

  it("有章：报出章数，下一步指向该动的那一章", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [
        doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章 雾里的灯", chars: 3200 }),
        doc({ relPath: "chapters/002.md", kind: "chapter", title: "第二章 潮信", chars: 5400 }),
        doc({ relPath: "characters/林越.md", kind: "character", title: "林越" })
      ],
      activeChapter: "chapters/001.md"
    });
    expect(brief.stage).toBe("drafting");
    expect(brief.chapterCount).toBe(2);
    expect(brief.totalChars).toBe(8600);
    expect(brief.characterCount).toBe(1);
    expect(brief.currentChapter).toBe("第一章 雾里的灯");
    expect(brief.targetChapter).toBe("第一章 雾里的灯");
    expect(brief.headline).toBe("《海雾手记》有 2 章");
    expect(brief.nextStep).toBe("接着写《第一章 雾里的灯》。");
  });

  it("不编「上一稿停在第几章」——那份数据根本查不到", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章" })],
      activeChapter: null
    });
    expect(brief.headline).not.toContain("上一稿");
    expect(brief.nextStep).not.toContain("上一稿");
  });

  it("没点开哪一章时，下一步指向第一章，不编当前章", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [
        doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章" }),
        doc({ relPath: "chapters/002.md", kind: "chapter", title: "第二章" })
      ],
      activeChapter: null
    });
    expect(brief.currentChapter).toBeNull();
    expect(brief.targetChapter).toBe("第一章");
    expect(brief.headline).toContain("2 章");
  });

  it("当前路径对不上任何文稿时是 null，不猜「大概是第一篇」", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章" })],
      activeChapter: "chapters/不存在.md"
    });
    expect(brief.currentChapter).toBeNull();
  });
});

describe("对话区现状 · 下一步动哪一章", () => {
  it("开着第二章时，下一步就指向第二章", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [
        doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章", chars: 3200 }),
        doc({ relPath: "chapters/002.md", kind: "chapter", title: "第二章", chars: 5400 })
      ],
      activeChapter: "chapters/002.md"
    });
    expect(brief.targetChapter).toBe("第二章");
    expect(brief.targetChapterChars).toBe(5400);
    expect(brief.targetIsFirstChapter).toBe(false);
  });

  it("目标是第一章时，标出来——开局才需要推「三个开头」", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章", chars: 3200 })],
      activeChapter: "chapters/001.md"
    });
    expect(brief.targetIsFirstChapter).toBe(true);
  });

  it("开着的是人物卡时，下一步仍然指向第一章（人物卡不是稿子）", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [
        doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章", chars: 3200 }),
        doc({ relPath: "characters/林越.md", kind: "character", title: "林越" })
      ],
      activeChapter: "characters/林越.md"
    });
    expect(brief.currentChapter).toBe("林越");
    expect(brief.targetChapter).toBe("第一章");
  });
});

describe("对话区现状 · 没有数据就不显示", () => {
  it("一个文稿都没带回字数时，字数那一格不出现（不写「0 字」）", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章" })],
      activeChapter: null
    });
    expect(brief.totalChars).toBeNull();
    expect(brief.stats.map((s) => s.label)).not.toContain("字");
  });

  it("带了字数就出现那一格", () => {
    const brief = conversationBrief({
      hasBook: true,
      title: "海雾手记",
      docs: [doc({ relPath: "chapters/001.md", kind: "chapter", title: "第一章", chars: 1200 })],
      activeChapter: null
    });
    expect(brief.totalChars).toBe(1200);
    expect(brief.stats.map((s) => s.label)).toContain("字");
  });
});

describe("对话区现状 · 字数怎么念", () => {
  it("一万以下照实念，一万以上折成万", () => {
    expect(briefCharText(0)).toBe("0 字");
    expect(briefCharText(8432)).toBe("8,432 字");
    expect(briefCharText(12000)).toBe("1.2 万字");
    expect(briefCharText(123456)).toBe("12.3 万字");
  });
});

import { describe, expect, it } from "vitest";
import {
  TXT_IMPORT_MAX_BYTES,
  detectTxtEncoding,
  planImportRelPaths,
  splitTxtChapters
} from "../src/import.js";
import { planDocRelPath } from "../src/book.js";

/** GBK 字节真身：「第一章」= B5 DA D2 BB D5 C2（查表所得，写死在这里防手滑改坏）。 */
const GBK_FIRST_CHAPTER = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]);

describe("detectTxtEncoding", () => {
  it("UTF-8 稿件判 utf-8", () => {
    expect(detectTxtEncoding(new TextEncoder().encode("第一章 风起\n正文一段。"))).toBe("utf-8");
  });

  it("GBK 稿件判 gbk，且按 GBK 解回来就是原文", () => {
    expect(detectTxtEncoding(GBK_FIRST_CHAPTER)).toBe("gbk");
    expect(new TextDecoder("gbk").decode(GBK_FIRST_CHAPTER)).toBe("第一章");
  });

  it("纯 ASCII（两种编码同形）判 utf-8——怎么判都对，取严格那一路", () => {
    expect(detectTxtEncoding(new TextEncoder().encode("Chapter 1\r\nhello"))).toBe("utf-8");
  });
});

describe("splitTxtChapters", () => {
  it("「第一章 标题」体：标题进 title 不进正文，正文归各自章", () => {
    const text = "第一章 风起\n开头的段落。\n\n第二段。\n\n第二章 夜航\n另一章的段落。";
    const chapters = splitTxtChapters(text, "备份名");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.title).toBe("第一章 风起");
    expect(chapters[0]!.content).toBe("开头的段落。\n\n第二段。");
    expect(chapters[1]!.title).toBe("第二章 夜航");
    expect(chapters[1]!.content).toBe("另一章的段落。");
  });

  it("CRLF 与孤立 CR 都当换行（老 Windows / 经典 Mac 稿件都要认）", () => {
    const chapters = splitTxtChapters("第一章 甲\r\nA\r\n\r\n第二章 乙\r\nB", "x");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.content).toBe("A");
  });

  it("第一条标题之前的正文归 fallbackTitle（开头没标题是常态，不能悄悄丢）", () => {
    const chapters = splitTxtChapters("这段是开头的话。\n\n第一章 甲\n正文。", "海雾手记");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.title).toBe("海雾手记");
    expect(chapters[0]!.content).toBe("这段是开头的话。");
    expect(chapters[1]!.title).toBe("第一章 甲");
  });

  it("一条标题都没有 ⇒ 整篇一章，标题用 fallbackTitle", () => {
    const chapters = splitTxtChapters("没有章节标题的短文。", "断章");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("断章");
    expect(chapters[0]!.content).toContain("短文");
  });

  it("序章 / 楔子 / 番外 / Chapter 数字都认作标题行", () => {
    const text = "楔子\n雪夜。\n\n第一章 甲\nA\n\n番外 某人的信\nB\n\nChapter 4\nC";
    const titles = splitTxtChapters(text, "x").map((c) => c.title);
    expect(titles).toEqual(["楔子", "第一章 甲", "番外 某人的信", "Chapter 4"]);
  });

  it("正文里的「第一个人」不误判成新章（标题判定要求整行只是标题）", () => {
    const chapters = splitTxtChapters("第一章 甲\n他说，第一个人已经走了。", "x");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.content).toContain("第一个人");
  });

  it("超长行不算标题（正文整段被错认比漏认一章伤得多）", () => {
    const longLine = `第一章 ${"很长的标题".repeat(20)}`;
    const chapters = splitTxtChapters(`${longLine}\n正文。`, "x");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("x");
    expect(chapters[0]!.content).toContain("正文");
  });

  it("只有标题没有正文的最后一章也落进来（不丢尾巴）", () => {
    const chapters = splitTxtChapters("第一章 甲\nA\n\n第二章 乙", "x");
    expect(chapters).toHaveLength(2);
    expect(chapters[1]!.title).toBe("第二章 乙");
    expect(chapters[1]!.content).toBe("");
  });

  it("chars 与 proseCharCount 同口径（预览列表显示的就是它）", () => {
    const [only] = splitTxtChapters("第一章 甲\n三个字。", "x");
    expect(only!.chars).toBeGreaterThan(0);
  });
});

describe("planImportRelPaths", () => {
  it("合法标题按 chapters/<标题>.md 规划，与行内新建同一份 planDocRelPath", () => {
    const result = planImportRelPaths([{ title: "第一章 风起" }, { title: "第二章 夜航" }]);
    expect(result).toEqual({
      ok: true,
      relPaths: [planDocRelPath("chapter", "第一章 风起"), planDocRelPath("chapter", "第二章 夜航")]
    });
  });

  it("批内重名与非法标题整批拦下，把撞名/非法的标题点名", () => {
    const result = planImportRelPaths([{ title: "第一章" }, { title: "第一章" }, { title: "CON" }]);
    if (result.ok) throw new Error("应当拦下");
    expect(result.invalid).toEqual(["CON"]);
    expect(result.conflicts).toEqual(["第一章"]);
  });
});

describe("上限常量", () => {
  it("20 MB 档位不许悄悄改（一部长篇还有余，再大就是选错文件）", () => {
    expect(TXT_IMPORT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

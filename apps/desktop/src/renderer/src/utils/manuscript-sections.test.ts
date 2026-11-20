/// <reference types="node" />
/**
 * 文稿树「哪些分组该露出来」的判定（2026-11-20 · 批次①：清引导的死链）。
 *
 * 【为什么这是判定，不是组件里的一行 filter】引导第 3 步教作者「在左栏『章节』分组里
 * 点『+ 新建』」。这句话要成立，前提是**章节分组在空书时也在树上**。原先的过滤只放行
 * 「有文档的分组」与「正在行内新建的分组」，于是空书时树里什么都没有：引导指的那枚「+」
 * 不存在，第一篇正文建不出来（要绕到中栏工作台空卡才碰得到）。
 * 判定住 utils（本仓 .vue 不进类型程序），组件只调它，不自己再写一份。
 */
import { describe, expect, it } from "vitest";
import type { BookKind, DocRef } from "@mochen/contracts";
import { manuscriptSections } from "./manuscript-sections";

function doc(relPath: string, kind: BookKind): DocRef {
  return { relPath, kind, title: relPath };
}

describe("文稿树分组的露出判定", () => {
  it("开着书时章节分组常驻：空书也得有一枚「+ 新建」给第一篇正文", () => {
    const sections = manuscriptSections([], null, true);
    expect(sections.map((section) => section.id)).toContain("chapter");
    expect(sections.find((section) => section.id === "chapter")?.nodes).toEqual([]);
  });

  it("没开书时树里什么都不露：没有书就没有分组", () => {
    expect(manuscriptSections([], null, false)).toEqual([]);
  });

  it("空着的资料分组仍然不露（世界观 / 人物…）：常驻的只有章节一组", () => {
    const ids = manuscriptSections([], null, true).map((section) => section.id);
    expect(ids).not.toContain("worldview");
    expect(ids).not.toContain("character");
    expect(ids).toEqual(["chapter"]);
  });

  it("有文档的分组照旧全露，顺序仍按 BOOK_KIND_ORDER", () => {
    const ids = manuscriptSections(
      [doc("characters/b.md", "character"), doc("chapters/a.md", "chapter")],
      null,
      true
    ).map((section) => section.id);
    expect(ids).toEqual(["chapter", "character"]);
  });

  it("正在行内新建的那一组即便空着也露：放行判定不因这本书空而失效", () => {
    const ids = manuscriptSections([], "worldview", true).map((section) => section.id);
    expect(ids).toContain("worldview");
  });

  it("分组自带标签与图标：树上那行字与那颗图标不另抄一份", () => {
    const chapter = manuscriptSections([], null, true).find((section) => section.id === "chapter");
    expect(chapter?.label).toBe("章节");
    expect(chapter?.icon).toBe("book");
  });
});

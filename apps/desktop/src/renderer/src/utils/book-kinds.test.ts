import { describe, expect, it } from "vitest";
import { BOOK_KINDS, type BookKind } from "@mochen/contracts";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "./book-kinds";

describe("book-kinds · 唯一一份 kind 顺序与中文标签", () => {
  it("标签键与 BOOK_KINDS 完全一致（铁律 6：穷尽键，加一类不写标签就编译/测试双红）", () => {
    expect(Object.keys(BOOK_KIND_LABELS).sort()).toEqual([...BOOK_KINDS].sort());
  });

  it("顺序与中文标签逐字钉死自左栏现状", () => {
    expect(BOOK_KIND_ORDER).toEqual(["chapter", "outline", "character", "plot", "material"]);
    expect(BOOK_KIND_LABELS).toEqual({
      chapter: "章节",
      outline: "大纲",
      character: "人物",
      plot: "剧情",
      material: "素材库"
    });
  });

  it("每个顺序项都在标签表里有对应中文（不留空标签）", () => {
    for (const kind of BOOK_KIND_ORDER) expect(BOOK_KIND_LABELS[kind as BookKind]).toBeTruthy();
  });
});

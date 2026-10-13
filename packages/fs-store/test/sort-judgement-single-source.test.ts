// P1-4 后半（2026-10-10）：章节次序的判据必须只有一份真身，否则「渲染层本地拼一根新 DocRef」
// 与「整本重扫」永远对不出同一个侧栏——那正是这一刀要拆掉的那次整本重扫的前提。
// 真身在 `contracts/src/book.ts` 的 `sortDocs`（`test/sort-docs.test.ts` 钉它自己的语义）。
// 本文件只钉一件事：fs-store 这份 `sortChapters` **不是第二份实现**，而是同一个函数的别名。
//
// 为什么敢用引用相等（`toBe`）这么硬的断言：这里要证的正是「没有第二段逻辑存在」。
// 行为比对证不出这一点——把真身照抄一遍也能过行为比对，而那份抄本从此就开始独立漂移，
// 这正是过去两份判据走偏的成因。引用相等过不了「抄一份」，只过得去「就是它」。
import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { sortDocs } from "@mochen/contracts";
import { sortChapters } from "../src/scan.js";

const doc = (relPath: string): DocRef => ({ relPath, kind: "chapter", title: relPath });

/** 一套三面都踩到的稿件：已登记的、未登记的（拼音序与码点序相反的一对）、次序表里盘上没有的条目。 */
const 稿件 = [
  doc("chapters/01-开局.md"),
  doc("chapters/99-终章.md"),
  doc("characters/李深.md"),
  doc("characters/阿雾.md")
];
const 次序 = ["chapters/99-终章.md", "chapters/不存在的一篇.md"];

describe("sortChapters 只是 contracts 那份判据的别名（判据只有一份，铁律 6）", () => {
  it("引用相等：fs-store 里没有第二段排序逻辑", () => {
    expect(sortChapters).toBe(sortDocs);
  });

  it("同一批稿件、同一份次序表，两边给出的顺序逐字相同", () => {
    expect(sortChapters(稿件, 次序).map((item) => item.relPath)).toEqual(
      sortDocs(稿件, 次序).map((item) => item.relPath)
    );
  });
});

import { describe, expect, it } from "vitest";
import { diffLines, unifiedDiff } from "../src/diff.js";

const src = ["第一段", "雾从海面涌上来。", "闸门在响。", "第三段", "第四段", "第五段"].join("\n");

// 一个 hunk 头是 `@@ -a,b +c,d @@`，串里有两个 `@@`：数 `@@` 会把 hunk 数翻倍，故按行首数头。
const hunkCount = (text: string) =>
  text.split("\n").filter((line) => line.startsWith("@@ ")).length;

describe("diffLines", () => {
  it("按整行比对，中文不拆字", () => {
    expect(diffLines("雾", "霜")).toEqual([
      { kind: "del", lines: ["雾"] },
      { kind: "add", lines: ["霜"] }
    ]);
  });

  it("无变化时只有一串 eq", () => {
    expect(diffLines(src, src).every((op) => op.kind === "eq")).toBe(true);
  });
});

describe("unifiedDiff", () => {
  it("单行改动给一个 hunk，行号与上下文都对", () => {
    const after = src.replace("闸门在响。", "闸门在响，像有人从里面敲。");
    const text = unifiedDiff(src, after, "chapters/01-开局.md");
    expect(text.split("\n")[0]).toBe("--- a/chapters/01-开局.md");
    expect(text.split("\n")[1]).toBe("+++ b/chapters/01-开局.md");
    // 默认上下文 3 行：改动的是第 3 行，前后各 3 行已被文件首尾截断，整篇 6 行都进同一个 hunk
    expect(text).toContain("@@ -1,6 +1,6 @@");
    expect(text).toContain("+闸门在响，像有人从里面敲。");
    expect(text).toContain("-闸门在响。");
    // 上下文：改动行前后各 3 行，这里有第 2 行与第 4、5 行
    expect(text).toContain(" 雾从海面涌上来。");
    expect(text).toContain(" 第三段");
  });

  it("context 参数被真实消费：显式 1 行上下文时只带改动行前后各 1 行", () => {
    const after = src.replace("闸门在响。", "闸门在响，像有人从里面敲。");
    const text = unifiedDiff(src, after, "chapters/01-开局.md", 1);
    expect(text).toContain("@@ -2,3 +2,3 @@");
    expect(text).toContain(" 雾从海面涌上来。");
    expect(text).toContain(" 第三段");
    expect(text).not.toContain(" 第一段");
    expect(text).not.toContain(" 第四段");
  });

  it("默认上下文正好 3 行：更远的未改动行不进 hunk", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `段${String(i + 1).padStart(2, "0")}`);
    const before = lines.join("\n");
    const after = lines.map((line) => (line === "段05" ? "段05·改" : line)).join("\n");
    const text = unifiedDiff(before, after, "chapters/01.md");
    expect(hunkCount(text)).toBe(1);
    expect(text).toContain("@@ -2,7 +2,7 @@");
    expect(text).toContain(" 段02");
    expect(text).toContain(" 段08");
    expect(text).not.toContain("段01");
    expect(text).not.toContain("段09");
    expect(text).not.toContain("段10");
    // 2 行文件头 + 1 行 hunk 头 + （前 3 上下文 + 删 1 + 加 1 + 后 3 上下文）
    expect(text.split("\n")).toHaveLength(11);
  });

  it("完全没改时返回空串", () => {
    expect(unifiedDiff(src, src, "a.md")).toBe("");
  });

  it("两处远距改动产生两个 hunk", () => {
    const lines = [
      "第一段",
      "雾从海面涌上来。",
      "闸门在响。",
      "第三段",
      "第四段",
      "第五段",
      "第六段",
      "第七段",
      "第八段",
      "第九段",
      "第十段",
      "尾段"
    ];
    const before = lines.join("\n");
    const after = lines
      .map((line) => (line === "第一段" ? "第一段·改" : line === "尾段" ? "尾段·改" : line))
      .join("\n");
    const text = unifiedDiff(before, after, "a.md");
    expect(hunkCount(text)).toBe(2);
    expect(text).toContain("@@ -1,4 +1,4 @@");
    expect(text).toContain("@@ -9,4 +9,4 @@");
  });

  it("两处改动相隔不足 2×context 时合并成一个 hunk", () => {
    const after = src.replace("第一段", "第一段·改").replace("第五段", "第五段·改");
    const text = unifiedDiff(src, after, "a.md");
    expect(hunkCount(text)).toBe(1);
    expect(text).toContain("+第一段·改");
    expect(text).toContain("+第五段·改");
  });

  it("纯新增在末尾时只有 + 行", () => {
    const text = unifiedDiff("一\n二", "一\n二\n三", "a.md");
    expect(text).toContain("+三");
    expect(text).toContain("@@ -1,2 +1,3 @@");
    // 没有任何删除标记行（`--- a/…` 是文件头，不是删除行）
    const removed = text
      .split("\n")
      .filter((line) => line.startsWith("-") && !line.startsWith("---"));
    expect(removed).toEqual([]);
  });

  it("整篇重写退化为单 hunk 而不是逐字比对", () => {
    const before = Array.from({ length: 500 }, (_, i) => `旧${i}`).join("\n");
    const after = Array.from({ length: 500 }, (_, i) => `新${i}`).join("\n");
    const text = unifiedDiff(before, after, "outline/三幕.md");
    expect(hunkCount(text)).toBe(1);
    expect(text).toContain("@@ -1,500 +1,500 @@");
  });

  it("长文稿只改一句时首尾修剪生效，hunk 仍是小段而不是整篇替换", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `段${i}`);
    const before = lines.join("\n");
    const after = lines.map((line) => (line === "段1000" ? "段1000·改" : line)).join("\n");
    const text = unifiedDiff(before, after, "chapters/01.md");
    expect(hunkCount(text)).toBe(1);
    expect(text).toContain("@@ -998,7 +998,7 @@");
    expect(text).toContain(" 段997");
    expect(text).toContain(" 段1003");
    expect(text).not.toContain("-段0");
    // 2 行文件头 + 1 行 hunk 头 + （前 3 上下文 + 删 1 + 加 1 + 后 3 上下文）
    expect(text.split("\n")).toHaveLength(11);
  });

  it("改动规模超过 LCS 上限时退化为整段删加，不跑平方级比对", () => {
    const before = Array.from({ length: 2000 }, (_, i) => `旧${i}`).join("\n");
    // 每 500 行留一条与 before 逐字相同的行：真跑 LCS 会把它当成 eq 行，触上限则整段删加
    const after = Array.from({ length: 2000 }, (_, i) =>
      i % 500 === 0 ? `旧${i}` : `新${i}`
    ).join("\n");
    const text = unifiedDiff(before, after, "outline/三幕.md");
    expect(hunkCount(text)).toBe(1);
    expect(text).toContain("@@ -1,2000 +1,2000 @@");
    expect(text).not.toContain(" 旧500");
    expect(text).toContain("-旧500");
  });
});

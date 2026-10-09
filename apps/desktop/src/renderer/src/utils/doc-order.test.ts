import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { moveOrderItem, nextTabInCycle, sortDocsByOrder, tabAtIndex } from "./doc-order";

/**
 * 章节次序的两个纯动作（2026-10-09 从 `useBookStore.moveChapterByRelPath` 搬出来）。
 * 用例钉的是搬动前后**行为一致**，尤其那条「不在次序里的排在后面」。
 */
const doc = (relPath: string): DocRef => ({ relPath, kind: "chapter", title: relPath });

describe("moveOrderItem", () => {
  it("把这一篇挪到目标下标，返回新数组且不动原数组", () => {
    const order = ["a.md", "b.md", "c.md"];
    expect(moveOrderItem(order, "a.md", 2)).toEqual(["b.md", "c.md", "a.md"]);
    expect(order).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("名单里没这一篇＝返回 null，调用方什么都不改", () => {
    expect(moveOrderItem(["a.md"], "外来的.md", 0)).toBeNull();
  });
});

describe("sortDocsByOrder", () => {
  it("按 chapterOrder 重排；不在次序里的（新扫出来的其它文稿）排在后面且保持原相对次序", () => {
    const docs = [doc("characters/李深.md"), doc("chapters/02.md"), doc("chapters/01.md")];
    expect(
      sortDocsByOrder(docs, ["chapters/02.md", "chapters/01.md"]).map((d) => d.relPath)
    ).toEqual(["chapters/02.md", "chapters/01.md", "characters/李深.md"]);
  });

  it("空次序：docs 一字不动（新开的书就是这一档）", () => {
    const docs = [doc("chapters/01.md"), doc("chapters/02.md")];
    expect(sortDocsByOrder(docs, []).map((d) => d.relPath)).toEqual([
      "chapters/01.md",
      "chapters/02.md"
    ]);
  });

  it("不许把传入的数组改掉：state.docs 是被响应式包着的，就地排序会绕过 Vue 的变更追踪", () => {
    const docs = [doc("b.md"), doc("a.md")];
    const sorted = sortDocsByOrder(docs, ["a.md", "b.md"]);
    expect(sorted.map((d) => d.relPath)).toEqual(["a.md", "b.md"]);
    expect(docs.map((d) => d.relPath)).toEqual(["b.md", "a.md"]);
  });
});

/**
 * 标签条的位置动作（Ctrl+1..9 与 Ctrl+PageUp/Down）——同样是从 `useBookStore` 搬出来的纯计算，
 * 与章节次序同属「次序」这一件事，所以住在同一个文件里。
 */
describe("tabAtIndex", () => {
  it("范围内给那一篇；越界（含负数与正好等于长度）一律 null，调用方据此一个字都不改", () => {
    const tabs = ["a.md", "b.md", "c.md"];
    expect(tabAtIndex(tabs, 0)).toBe("a.md");
    expect(tabAtIndex(tabs, 2)).toBe("c.md");
    expect(tabAtIndex(tabs, 3)).toBeNull();
    expect(tabAtIndex(tabs, -1)).toBeNull();
    expect(tabAtIndex([], 0)).toBeNull();
  });
});

describe("nextTabInCycle", () => {
  it("往后走到头绕回第一枚，往前走到头绕回最后一枚", () => {
    const tabs = ["a.md", "b.md", "c.md"];
    expect(nextTabInCycle(tabs, "c.md", 1)).toBe("a.md");
    expect(nextTabInCycle(tabs, "a.md", -1)).toBe("c.md");
    expect(nextTabInCycle(tabs, "b.md", 1)).toBe("c.md");
  });

  it("只有一枚：往后、往前都还是它（环形不许越界成 undefined）", () => {
    expect(nextTabInCycle(["only.md"], "only.md", 1)).toBe("only.md");
    expect(nextTabInCycle(["only.md"], "only.md", -1)).toBe("only.md");
  });

  it("没有标签＝null；当前指针认不出（刚关掉/还没选）按 -1 起步，与 store 旧算法一字不差", () => {
    expect(nextTabInCycle([], null, 1)).toBeNull();
    expect(nextTabInCycle(["a.md", "b.md"], null, 1)).toBe("a.md");
    expect(nextTabInCycle(["a.md", "b.md"], null, -1)).toBe("a.md");
    expect(nextTabInCycle(["a.md", "b.md"], "没了这一篇.md", -1)).toBe("a.md");
  });
});

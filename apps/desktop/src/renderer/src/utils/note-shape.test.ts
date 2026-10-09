import { describe, expect, it } from "vitest";
import { normalizeNotes } from "./note-shape";

/**
 * 笔记文件形状校验（2026-10-09 扫描总单 P0-7）。
 *
 * 这份判定只有一条主线：**「读不懂」与「没有笔记」必须是两个答案**。
 * 判错了的后果是二次丢数据——把一份读不懂的文件当成空库，用户随手加一条笔记就把整份盖掉。
 * 所以对认不得的形状一律返回 null（由通路按「停止写入」处理），
 * 而对只是缺了后加字段的**老版本数据**则补全后放行（那些不是坏数据，是上一辈子的正常存档）。
 */

const BASE = { id: "n1", kind: "quick", content: "一条", createdAt: 5, updatedAt: 7 };

describe("normalizeNotes", () => {
  it("不是数组就不是笔记库：判读不懂，而不是判空库", () => {
    expect(normalizeNotes({ notes: [] })).toBeNull();
    expect(normalizeNotes(null)).toBeNull();
    expect(normalizeNotes("[]")).toBeNull();
  });

  it("空数组是合法的空库（与读不懂分得开）", () => {
    expect(normalizeNotes([])).toEqual([]);
  });

  it("完整的一条原样认下来", () => {
    const note = { ...BASE, tags: ["开篇"], archived: false };
    expect(normalizeNotes([note])).toEqual([note]);
  });

  it("后加的字段缺失就补默认值：老数据不是坏数据", () => {
    const [note] = normalizeNotes([{ id: "old", kind: "quick", content: "老版笔记" }]) ?? [];
    expect(note).toEqual({
      id: "old",
      kind: "quick",
      content: "老版笔记",
      createdAt: 0,
      updatedAt: 0,
      tags: [],
      archived: false
    });
  });

  it("没有 id 或内容不是字符串：整份判读不懂（悄悄丢掉就是替用户删笔记）", () => {
    expect(normalizeNotes([{ kind: "quick", content: "没有 id" }])).toBeNull();
    expect(normalizeNotes([{ ...BASE, content: 3 }])).toBeNull();
    expect(normalizeNotes([null])).toBeNull();
  });

  it("kind 认不得也判读不懂：批注与速记筛错档比空列表更糟", () => {
    expect(normalizeNotes([{ ...BASE, kind: "todo" }])).toBeNull();
  });

  it("批注那条的绑定字段原样保留，非法的形状整份判读不懂", () => {
    const annotation = {
      ...BASE,
      kind: "annotation",
      docRelPath: "chapters/01.md",
      lineNumber: 12
    };
    expect(normalizeNotes([annotation])).toEqual([{ ...annotation, tags: [], archived: false }]);
    expect(normalizeNotes([{ ...BASE, kind: "annotation", docRelPath: 7 }])).toBeNull();
  });

  it("tags 只收非空字符串，threadKey 只在是字符串时保留", () => {
    const [note] =
      normalizeNotes([{ ...BASE, tags: ["甲", "", 7, "乙"], threadKey: "t1", lineNumber: "3" }]) ??
      [];
    expect(note?.tags).toEqual(["甲", "乙"]);
    expect(note?.threadKey).toBe("t1");
    expect(note).not.toHaveProperty("lineNumber");
  });

  it("archived 认严格 true：缺省与 0 都算未归档", () => {
    expect(normalizeNotes([{ ...BASE, archived: true }])?.[0]?.archived).toBe(true);
    expect(normalizeNotes([{ ...BASE, archived: 0 }])?.[0]?.archived).toBe(false);
    expect(normalizeNotes([{ ...BASE }])?.[0]?.archived).toBe(false);
  });

  it("createdAt / updatedAt 不是有限数字就当 0，而不是判读不懂", () => {
    const [note] = normalizeNotes([{ ...BASE, createdAt: "x", updatedAt: null }]) ?? [];
    expect(note).toMatchObject({ createdAt: 0, updatedAt: 0 });
  });
});

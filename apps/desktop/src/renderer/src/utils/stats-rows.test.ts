import { describe, expect, it } from "vitest";
import { statsRowsOf } from "./stats-rows";
import type { DocRef } from "@mochen/contracts";

/** 数据统计行的聚合口径（2026-10-10 从 LeftSidebar 下沉后的钉子）。 */
function doc(kind: DocRef["kind"], chars: number | null): DocRef {
  return {
    relPath: `${kind}-${chars}.md`,
    kind,
    title: String(chars),
    chars
  } as DocRef;
}

describe("statsRowsOf", () => {
  it("按 kind 聚合篇数与字数；没文稿的 kind 也要有一行（0/0），不许静默消失", () => {
    const rows = statsRowsOf([doc("chapter", 100), doc("chapter", 50), doc("character", 7)]);
    const chapter = rows.find((row) => row.label === "章节");
    expect(chapter).toMatchObject({ count: 2, chars: 150 });
    const character = rows.find((row) => row.label === "人物");
    expect(character).toMatchObject({ count: 1, chars: 7 });
    // 空分组：行在，数字是 0——界面上「这一类还没有」是事实，不能把行吞掉。
    for (const row of rows) {
      expect(row.count).toBeGreaterThanOrEqual(0);
    }
  });

  it("空书回全 kind 的 0/0 行；chars 缺失按 0 计", () => {
    const rows = statsRowsOf([]);
    expect(rows.every((row) => row.count === 0 && row.chars === 0)).toBe(true);
    const mixed = statsRowsOf([doc("outline", null)]);
    expect(mixed.find((row) => row.label === "大纲")).toMatchObject({ count: 1, chars: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { mergeBibleEntries, type BibleEntry, type BibleEntryType } from "../src/index.js";

function entry(id: string, title: string, type: BibleEntryType = "character"): BibleEntry {
  return {
    id,
    type,
    title,
    content: `${title}的内容`,
    createdAt: 1,
    updatedAt: 2,
    tags: []
  };
}

describe("mergeBibleEntries · 跨书导入", () => {
  it("新增按来源原序追加，当前书与来源对象都不被改写", () => {
    const current = [entry("a1", "甲")];
    const incoming = [entry("b1", "乙"), entry("b2", "丙", "location")];
    const report = mergeBibleEntries(current, incoming);
    expect(report.merged.map((item) => item.id)).toEqual(["a1", "b1", "b2"]);
    expect(report).toMatchObject({ added: 2, skipped: 0 });
    expect(current).toHaveLength(1);
    expect(incoming[0]).toEqual(entry("b1", "乙"));
  });

  it("类型加去空白后的名称是幂等键：已有条目不覆盖，重复导入不重复加", () => {
    const current = [{ ...entry("a1", "林夜"), content: "新书里改过的版本" }];
    const incoming = [entry("b1", " 林夜 "), entry("b2", "旧城", "location")];
    const first = mergeBibleEntries(current, incoming);
    expect(first).toMatchObject({ added: 1, skipped: 1 });
    expect(first.merged[0]).toMatchObject({ id: "a1", content: "新书里改过的版本" });
    const second = mergeBibleEntries(first.merged, incoming);
    expect(second).toMatchObject({ added: 0, skipped: 2 });
    expect(second.merged).toHaveLength(2);
  });

  it("来源清单内部重名也只收第一条，跳过数如实报出来", () => {
    const report = mergeBibleEntries([], [entry("b1", "林夜"), entry("b2", "林夜")]);
    expect(report).toMatchObject({ added: 1, skipped: 1 });
    expect(report.merged.map((item) => item.id)).toEqual(["b1"]);
  });

  it("同 id 不同名不是重复条目：换成本表唯一 id，避免列表与编辑串人", () => {
    const current = [entry("same", "改名后的林夜")];
    const incoming = [entry("same", "林夜"), entry("same", "灯塔", "location")];
    const first = mergeBibleEntries(current, incoming);
    expect(first).toMatchObject({ added: 2, skipped: 0 });
    expect(first.merged.map((item) => item.id)).toEqual([
      "same",
      "same_imported",
      "same_imported_2"
    ]);
    expect(new Set(first.merged.map((item) => item.id)).size).toBe(3);
    expect(incoming[0]?.id).toBe("same");
    const second = mergeBibleEntries(first.merged, incoming);
    expect(second).toMatchObject({ added: 0, skipped: 2 });
    expect(second.merged).toHaveLength(3);
  });
});

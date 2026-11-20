import { describe, expect, it } from "vitest";
import type { BibleEntry } from "@mochen/contracts";
import { voiceBriefs } from "./voice-brief";

/** W-09：本章点到名、又写了嗓音三格的人物，才配进这一行摘要。 */
function entry(over: Partial<BibleEntry> = {}): BibleEntry {
  return {
    id: "e1",
    type: "character",
    title: "林夜",
    content: "",
    createdAt: 1,
    updatedAt: 1,
    tags: [],
    ...over
  };
}

describe("voiceBriefs", () => {
  it("点到名的人物，把说话/不做/本卷拼成一行", () => {
    const briefs = voiceBriefs(
      [entry({ voice: "寡言，短句", taboo: "求人", arc: "学会托付后背" })],
      "林夜推门进来，雨水顺着袖口滴。"
    );
    expect(briefs).toEqual([
      { name: "林夜", line: "说话：寡言，短句；不做：求人；本卷：学会托付后背" }
    ]);
  });

  it("只写一格也能成立；一格都没写的人物不占位", () => {
    expect(voiceBriefs([entry({ voice: "只说是" })], "林夜来了")[0]?.line).toBe("说话：只说是");
    expect(voiceBriefs([entry()], "林夜来了")).toEqual([]);
  });

  it("本章没提到、已归档、非人物类型一律不列", () => {
    const entries = [
      entry({ id: "a", title: "林夜", voice: "寡言" }),
      entry({ id: "b", title: "沈砚", voice: "爱笑", archived: true }),
      entry({ id: "c", type: "location", title: "港城", voice: "不算数", tags: [] })
    ];
    expect(voiceBriefs(entries, "林夜走进港城")).toEqual([{ name: "林夜", line: "说话：寡言" }]);
  });

  it("别名命中同样算点到名；单字名不判（与装配层同一条纪律）", () => {
    const entries = [
      entry({ id: "a", title: "林夜", aliases: ["夜哥"], voice: "寡言" }),
      entry({ id: "b", title: "叶", voice: "别报我" })
    ];
    expect(voiceBriefs(entries, "夜哥把伞收好")).toHaveLength(1);
    expect(voiceBriefs(entries, "叶把伞收好")).toEqual([]);
  });

  it("默认最多三条，空文本直接不出", () => {
    const entries = ["林夜", "沈砚", "顾清", "白露"].map((title, index) =>
      entry({ id: String(index), title, voice: "说话" })
    );
    const text = "林夜、沈砚、顾清、白露都在。";
    expect(voiceBriefs(entries, text)).toHaveLength(3);
    expect(voiceBriefs(entries, "   ")).toEqual([]);
  });
});

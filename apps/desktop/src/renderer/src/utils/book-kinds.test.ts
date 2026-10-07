import { describe, expect, it } from "vitest";
import { BOOK_KINDS, type BookKind } from "@mochen/contracts";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "./book-kinds";

describe("book-kinds · 唯一一份 kind 顺序与中文标签", () => {
  it("标签键与 BOOK_KINDS 完全一致（铁律 6：穷尽键，加一类不写标签就编译/测试双红）", () => {
    expect(Object.keys(BOOK_KIND_LABELS).sort()).toEqual([...BOOK_KINDS].sort());
  });

  it("顺序与中文标签逐字钉死自左栏现状", () => {
    // 2026-10-04 深夜裁定：演示图全部功能落地——新增 6 类文稿（分卷/世界观/势力/地图/时间线/专有名词）；
    // 次日追加技能库（skill）：智能体可把联网搜到的资料整理成技能文档写进 skills/。
    // 2026-10-05 再加伏笔（foreshadow）：一条伏笔一篇文稿，状态在 frontmatter，
    // 排在专有名词之后、技能库之前（它是资料类，不是技能）。
    expect(BOOK_KIND_ORDER).toEqual([
      "chapter",
      "volume",
      "outline",
      "worldview",
      "character",
      "faction",
      "location",
      "timeline",
      "plot",
      "material",
      "glossary",
      "foreshadow",
      "skill"
    ]);
    expect(BOOK_KIND_LABELS).toEqual({
      chapter: "章节",
      outline: "大纲",
      character: "人物",
      plot: "剧情",
      material: "素材库",
      worldview: "世界观",
      faction: "势力/组织",
      location: "地图",
      timeline: "时间线",
      glossary: "专有名词",
      volume: "分卷",
      foreshadow: "伏笔",
      skill: "技能库"
    });
  });

  it("每个顺序项都在标签表里有对应中文（不留空标签）", () => {
    for (const kind of BOOK_KIND_ORDER) expect(BOOK_KIND_LABELS[kind as BookKind]).toBeTruthy();
  });
});

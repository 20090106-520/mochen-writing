/**
 * W-01 补完守卫：读数只从主进程预览里已装进去的条目来，不许在渲染层再判一次。
 */
import { describe, expect, it } from "vitest";
import type { ContextPreview, ContextPreviewItem } from "@mochen/contracts";
import {
  BIBLE_DIVISION_NOTE,
  EMPTY_BIBLE_BRIEF,
  bibleBriefOf,
  type BibleBriefRow
} from "./bible-brief";

function item(
  relPath: string,
  title: string,
  kind: string = "world",
  chars = 120
): ContextPreviewItem {
  return { relPath, title, kind, chars, active: false } as unknown as ContextPreviewItem;
}

function preview(items: ContextPreviewItem[]): ContextPreview {
  return {
    profileId: "p1",
    profileName: "主笔",
    items,
    chars: 0,
    approxTokens: 0,
    empty: false
  } as ContextPreview;
}

describe("bibleBriefOf：只读预览里的故事圣经条目", () => {
  it("没预览 / 没有设定条目就给空读数，界面不该占位", () => {
    expect(bibleBriefOf(null)).toEqual(EMPTY_BIBLE_BRIEF);
    expect(bibleBriefOf(preview([]))).toEqual(EMPTY_BIBLE_BRIEF);
    expect(bibleBriefOf(preview([item("world/设定.md", "世界观长文")]))).toEqual(EMPTY_BIBLE_BRIEF);
  });

  it("只认 bible: 前缀且 kind=world 的条目，世界观文稿与其它族都不混进来", () => {
    const result = bibleBriefOf(
      preview([
        item("bible:character:c1", "林夜", "world", 210),
        item("world/设定.md", "长文稿", "world", 900),
        item("chapters/01.md", "第一章", "chapter", 3000),
        item("bible:location:l1", "码头", "pinned", 80)
      ])
    );
    expect(result.count).toBe(1);
    expect(result.rows.map((row: BibleBriefRow) => row.title)).toEqual(["林夜"]);
    expect(result.rows[0]?.chars).toBe(210);
  });

  it("类型标签从 BIBLE_TYPE_LABEL 那一份来，认不出的类型不猜", () => {
    const rows = bibleBriefOf(
      preview([
        item("bible:character:c1", "甲"),
        item("bible:location:l1", "乙"),
        item("bible:timeline:t1", "丙"),
        item("bible:unknown:x1", "丁")
      ])
    ).rows;
    expect(rows.map((row) => row.typeLabel)).toEqual(["人物", "地点", "时间线", "设定"]);
  });

  it("三条以内 chip 与完整名单同字；超过三条收成「等 N 条」，title 仍给全名", () => {
    const three = bibleBriefOf(
      preview([
        item("bible:character:c1", "林夜"),
        item("bible:location:l1", "码头"),
        item("bible:timeline:t1", "旧账")
      ])
    );
    expect(three.chipText).toBe("本章带入：林夜、码头、旧账（3 条）");
    expect(three.fullText).toBe(three.chipText);

    const five = bibleBriefOf(
      preview([
        item("bible:character:c1", "林夜"),
        item("bible:character:c2", "阿岚"),
        item("bible:location:l1", "码头"),
        item("bible:location:l2", "灯塔"),
        item("bible:timeline:t1", "旧账")
      ])
    );
    expect(five.chipText).toBe("本章带入：林夜、阿岚、码头 等 5 条");
    expect(five.fullText).toContain("灯塔、旧账（5 条）");
  });

  it("两套设定的分工只有一句，写在输入卡与设定面板同读的常量里", () => {
    expect(BIBLE_DIVISION_NOTE).toContain("短卡给 AI 看");
    expect(BIBLE_DIVISION_NOTE).toContain("长文稿");
  });
});

import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import {
  WORKBENCH_CARD_LABELS,
  WORKBENCH_EMPTY_HINTS,
  WORKBENCH_PREFILL,
  workbenchCards,
  workbenchTarget,
  workbenchVisible
} from "./workbench-state";

const chapters: DocRef[] = [{ relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" }];
const fullDocs: DocRef[] = [
  ...chapters,
  { relPath: "characters/林晚.md", kind: "character", title: "林晚" },
  { relPath: "materials/海洋.md", kind: "material", title: "海洋" },
  { relPath: "outline/第一幕.md", kind: "outline", title: "第一幕" }
];

describe("workbench-state · 无书不显示死卡（F-A）", () => {
  it("workbenchVisible：无书 false、有书 true", () => {
    expect(workbenchVisible(false)).toBe(false);
    expect(workbenchVisible(true)).toBe(true);
  });

  it("无书 ⇒ workbenchCards 一张卡都不出（W7 变异目标：不看 hasBook 就红）", () => {
    expect(workbenchCards({ hasBook: false, docs: fullDocs, activeChapter: null })).toEqual([]);
  });
});

describe("workbench-state · 四张卡是真动作", () => {
  it("有书 ⇒ 恰好四张，顺序与中文标签逐字钉死", () => {
    const cards = workbenchCards({
      hasBook: true,
      docs: fullDocs,
      activeChapter: "chapters/01-开局.md"
    });
    expect(cards.map((card) => card.id)).toEqual(["chief-write", "character", "world", "outline"]);
    expect(cards.map((card) => card.label)).toEqual([
      "主笔创作",
      "角色塑造",
      "世界构建",
      "大纲规划"
    ]);
    expect(cards.every((card) => card.enabled)).toBe(true);
  });

  it("world 卡取 materials/（material kind）第一篇，而不是 character/outline", () => {
    expect(workbenchTarget({ id: "world", docs: fullDocs, activeChapter: null })).toBe(
      "materials/海洋.md"
    );
  });

  it("character/outline 卡分别取 characters/、outline/ 分组第一篇", () => {
    expect(workbenchTarget({ id: "character", docs: fullDocs, activeChapter: null })).toBe(
      "characters/林晚.md"
    );
    expect(workbenchTarget({ id: "outline", docs: fullDocs, activeChapter: null })).toBe(
      "outline/第一幕.md"
    );
  });

  it("chief-write：有活动章用活动章，否则回落第一篇 chapter", () => {
    expect(workbenchTarget({ id: "chief-write", docs: fullDocs, activeChapter: null })).toBe(
      "chapters/01-开局.md"
    );
    expect(
      workbenchTarget({ id: "chief-write", docs: fullDocs, activeChapter: "chapters/09-结尾.md" })
    ).toBe("chapters/09-结尾.md");
  });

  it("缺对应分组 ⇒ 目标 null 且该卡 disabled（反向鉴别：不是恒 enabled）", () => {
    const cards = workbenchCards({ hasBook: true, docs: chapters, activeChapter: null });
    expect(workbenchTarget({ id: "character", docs: chapters, activeChapter: null })).toBeNull();
    expect(cards.find((card) => card.id === "character")?.enabled).toBe(false);
    expect(cards.filter((card) => !card.enabled).map((card) => card.id)).toEqual([
      "character",
      "world",
      "outline"
    ]);
    // F1：disabled ⇒ 说实话，不承诺此刻不存在的「浏览…」动作
    const disabledHint = cards.find((card) => card.id === "character")?.hint;
    expect(disabledHint).toBe(WORKBENCH_EMPTY_HINTS.character);
    expect(disabledHint).not.toBe("浏览人物分组第一篇，落到右栏浏览态。");
    // F1：enabled ⇒ 动作说明（chief-write 在 chapters 里有真目标）
    expect(cards.find((card) => card.id === "chief-write")?.hint).toBe(
      "打开当前章，预填一句改稿指令，再交给你逐条审批。"
    );
  });

  it("WORKBENCH_PREFILL 与 WORKBENCH_CARD_LABELS 逐字（Task 4 预填通路消费同一串）", () => {
    expect(WORKBENCH_PREFILL).toBe("我想改这一章：先读它，再给我三处可以动的地方。");
    expect(WORKBENCH_CARD_LABELS).toEqual({
      "chief-write": "主笔创作",
      character: "角色塑造",
      world: "世界构建",
      outline: "大纲规划"
    });
  });
});

import { describe, expect, it } from "vitest";
import { USER_TEXT_MAX_LEN } from "@mochen/contracts";
import type { DocRef } from "@mochen/contracts";
import {
  WORKBENCH_CAPABILITIES,
  WORKBENCH_CARD_HINTS,
  WORKBENCH_CARD_ICONS,
  WORKBENCH_CARD_LABELS,
  WORKBENCH_CARD_PREFILL,
  WORKBENCH_EMPTY_HINTS,
  WORKBENCH_GUIDE_SUFFIX,
  WORKBENCH_HERO_QUOTE,
  workbenchCardTitle,
  workbenchCards,
  workbenchSuggestions,
  workbenchTarget
} from "./workbench-state";

const chapters: DocRef[] = [{ relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" }];
const fullDocs: DocRef[] = [
  ...chapters,
  { relPath: "characters/林晚.md", kind: "character", title: "林晚" },
  { relPath: "materials/海洋.md", kind: "material", title: "海洋" },
  { relPath: "outline/第一幕.md", kind: "outline", title: "第一幕" }
];

describe("workbench-state · 无书不显示死卡（F-A）", () => {
  it("无书 ⇒ workbenchCards 一张卡都不出（W7 变异目标：不看 hasBook 就红）", () => {
    expect(workbenchCards({ hasBook: false, docs: fullDocs, activeChapter: null })).toEqual([]);
  });

  it("无书 ⇒ 建议 pill 一枚都不出（点了没反应的按钮就是摆设）", () => {
    expect(workbenchSuggestions({ hasBook: false, docs: fullDocs, activeChapter: null })).toEqual(
      []
    );
  });
});

describe("workbench-state · 五张能力卡是真动作（示意稿 A）", () => {
  it("有书 ⇒ 恰好五张，顺序与中文标签逐字钉死", () => {
    const cards = workbenchCards({
      hasBook: true,
      docs: fullDocs,
      activeChapter: "chapters/01-开局.md"
    });
    expect(cards.map((card) => card.id)).toEqual([
      "chief-write",
      "character",
      "world",
      "outline",
      "inspire"
    ]);
    expect(cards.map((card) => card.label)).toEqual([
      "主笔创作",
      "角色塑造",
      "世界构建",
      "大纲规划",
      "灵感激发"
    ]);
    expect(cards.every((card) => card.target !== null)).toBe(true);
    // 卡的归属类型与 workbenchTarget 同源：world 是 material（素材库），不是它自己编的第二种口径。
    expect(cards.map((card) => card.kind)).toEqual([
      "chapter",
      "character",
      "material",
      "outline",
      "chapter"
    ]);
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

  it("chief-write 与 inspire 都落在章节上：有活动章用活动章，否则回落第一篇 chapter", () => {
    for (const id of ["chief-write", "inspire"] as const) {
      expect(workbenchTarget({ id, docs: fullDocs, activeChapter: null })).toBe(
        "chapters/01-开局.md"
      );
      expect(workbenchTarget({ id, docs: fullDocs, activeChapter: "chapters/09-结尾.md" })).toBe(
        "chapters/09-结尾.md"
      );
    }
  });

  it("缺对应分组 ⇒ target 为 null，但卡照样可点（2026-10-05：引导而非死卡）", () => {
    const cards = workbenchCards({ hasBook: true, docs: [], activeChapter: null });
    expect(cards).toHaveLength(5); // 一张都不许消失：灰着点不动比没有更糟
    expect(cards.every((card) => card.target === null)).toBe(true);
    const emptyHint = workbenchCards({
      hasBook: true,
      docs: chapters,
      activeChapter: null
    }).find((card) => card.id === "character")?.hint;
    // F1：没有目标 ⇒ 说实话，不承诺此刻不存在的「在右栏读它」动作
    expect(emptyHint).toBe(WORKBENCH_EMPTY_HINTS.character);
    expect(emptyHint).not.toBe(WORKBENCH_CARD_HINTS.character);
    // 2026-10-23 文案走查：「浏览态」是内部叫法，用户看不懂；「落到」也是实现口吻。
    for (const hint of Object.values(WORKBENCH_CARD_HINTS)) {
      expect(hint).not.toContain("浏览态");
      expect(hint).not.toContain("落到");
    }
    // F1：有目标 ⇒ 动作说明（chief-write 在 chapters 里有真目标）
    expect(
      workbenchCards({ hasBook: true, docs: chapters, activeChapter: null }).find(
        (card) => card.id === "chief-write"
      )?.hint
    ).toBe("打开当前章，预填一句改稿指令；改稿提案逐条等你批准。");
  });

  it("悬停文案：空卡在实话后面补「点一下去左栏新建一篇」，有目标的不许画蛇添足", () => {
    const empty = workbenchCards({ hasBook: true, docs: [], activeChapter: null })[0];
    if (empty === undefined) throw new Error("空书也该有卡");
    expect(workbenchCardTitle(empty)).toBe(
      `${WORKBENCH_EMPTY_HINTS["chief-write"]}${WORKBENCH_GUIDE_SUFFIX}`
    );
    const ready = workbenchCards({ hasBook: true, docs: fullDocs, activeChapter: null }).find(
      (card) => card.id === "character"
    );
    if (ready === undefined) throw new Error("有目标卡必须在");
    expect(workbenchCardTitle(ready)).toBe(WORKBENCH_CARD_HINTS.character);
    expect(workbenchCardTitle(ready)).not.toContain(WORKBENCH_GUIDE_SUFFIX);
  });

  it("只有两张卡往输入区填字，其余三张是浏览；填的那句是人话且报得出发出去的原话", () => {
    expect(WORKBENCH_CARD_PREFILL).toEqual({
      "chief-write": "我想改这一章：先读它，再给我三处可以动的地方。",
      character: null,
      world: null,
      outline: null,
      inspire: "给我三个能接着往下写的点子，各写一句代价；先别动我的稿子。"
    });
  });

  it("五张卡各有一枚图标名，且都不为空（表在 .ts：漏一枚裸 tsc 报 TS2741）", () => {
    const ids = Object.keys(WORKBENCH_CARD_LABELS);
    expect(Object.keys(WORKBENCH_CARD_ICONS)).toEqual(ids);
    expect(Object.values(WORKBENCH_CARD_ICONS).every((name) => name.trim() !== "")).toBe(true);
  });
});

describe("workbench-state · 建议 pill 与能力清单（示意稿 A）", () => {
  it("有章节 ⇒ 恰好五枚，前四枚填字、最后一枚开 / 面板", () => {
    const list = workbenchSuggestions({
      hasBook: true,
      docs: fullDocs,
      activeChapter: "chapters/01-开局.md"
    });
    expect(list).toHaveLength(5);
    expect(list.map((item) => item.kind)).toEqual([
      "prefill",
      "prefill",
      "prefill",
      "prefill",
      "palette"
    ]);
    expect(new Set(list.map((item) => item.id)).size).toBe(5);
    for (const item of list) {
      expect(item.text.trim()).not.toBe("");
      if (item.kind === "prefill")
        expect(item.prefill.length).toBeLessThanOrEqual(USER_TEXT_MAX_LEN);
    }
  });

  it("有书但一本书都还没有 ⇒ 建议 pill 为空（没有线程可填字，就不摆填字的按钮）", () => {
    expect(workbenchSuggestions({ hasBook: true, docs: [], activeChapter: null })).toEqual([]);
  });

  it("能力清单六条、条条非空且不重复；文案不许承诺「自动写盘」", () => {
    expect(WORKBENCH_CAPABILITIES).toHaveLength(6);
    expect(WORKBENCH_CAPABILITIES.every((line) => line.trim() !== "")).toBe(true);
    expect(new Set(WORKBENCH_CAPABILITIES).size).toBe(6);
    expect(WORKBENCH_CAPABILITIES.some((line) => line.includes("批准"))).toBe(true);
    expect(WORKBENCH_CAPABILITIES.join("\n")).not.toMatch(/自动写入|自动保存草稿/);
  });

  it("hero 引言是一句带书名号式引语的中文，不是空壳", () => {
    expect(WORKBENCH_HERO_QUOTE).toBe("以文字为舟，载你抵达想象的彼岸。");
  });
});

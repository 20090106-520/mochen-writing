/**
 * 读数呈现层的用例（2026-11-16）。
 *
 * 这里不断言 contracts 的测量公式（那边各有自己的用例），只钉三件事：
 * ① 四份读数一次取齐；② 样本不足时**说「不报」而不是报 0**；③ 胶囊与偏离标的排版/门槛。
 */
import { describe, expect, it } from "vitest";
import { styleProfileOf, type StyleProfile } from "@mochen/contracts";
import {
  bookStyleReadoutOf,
  chapterChipsOf,
  chapterDriftMarksOf,
  readoutNoteOf,
  readoutRowsOf
} from "./style-readout";

/** 20 轮 × 4 段：含对白 60 段（纯台词 20、台词＋动作 40），台词原话各复读 20 次。 */
function bookSample(): string[] {
  const lines: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    lines.push("他推开门，屋里没有人，风从窗缝里挤进来。");
    lines.push("「你又来晚了。」她把茶碗推过来，杯底磕在桌上响了一声。");
    lines.push("「路上雪大。」——他抖了抖斗篷，雪落了一地。");
    lines.push("「知道了。」");
  }
  return [lines.join("\n")];
}

const LABELS = [
  "句长",
  "句首",
  "段长",
  "对白",
  "段末收在台词",
  "段末标点",
  "标点脾气",
  "对白段落形态",
  "台词复读",
  "叙述人称"
];

/** 手工档案：句长 10 字、落差 0（不判长短句落差）、对白 30%、三枚标点密度都在判线之下。 */
const PROFILE: StyleProfile = {
  charCount: 2000,
  rhythm: { mean: 10, spread: 0 },
  punctuation: { dash: 0, semicolon: 0, ellipsis: 0 },
  dialogueRatio: 0,
  endsOnQuote: { count: 5, total: 20 },
  paragraph: { mean: 20, spread: 0.4 },
  endMarkShare: { period: 0.5, question: 0.1, exclamation: 0.1, ellipsis: 0.1, other: 0.2 }
};

describe("bookStyleReadoutOf", () => {
  it("五份读数一次取齐", () => {
    const readout = bookStyleReadoutOf(bookSample());
    expect(readout.profile).not.toBeNull();
    expect(readout.shape).toEqual({ withDialogue: 60, pure: 20, mixed: 40 });
    expect(readout.repeats).toHaveLength(3);
    expect(readout.person?.dominant).toBe("third");
    expect(readout.sentenceOpenings.length).toBeGreaterThan(0);
  });
});

describe("readoutRowsOf", () => {
  it("固定十行，句首与复读都点名并保留次数", () => {
    const rows = readoutRowsOf(bookStyleReadoutOf(bookSample()));
    expect(rows.map((row) => row.label)).toEqual(LABELS);
    expect(rows[1]?.value).toContain("「他推」×20");
    expect(rows[8]?.value).toContain("「知道了。」×20");
    expect(rows[7]?.value).toBe("纯台词 20 段 · 台词＋动作 40 段");
    expect(rows[5]?.value).toBe("句号 100%");
  });

  it("样本不足时说「不报」，不报 0", () => {
    const rows = readoutRowsOf(bookStyleReadoutOf(["雪".repeat(499)]));
    expect(rows).toHaveLength(10);
    expect(rows[0]?.value).toBe("样本不足，不报");
    expect(rows[1]?.value).toBe("没有出现 2 次以上的同一句首");
    expect(rows[3]?.value).toBe("样本不足，不报");
    expect(rows[7]?.value).toBe("含对白段落不足 10 段，不报");
    expect(rows[9]?.value).toBe("叙述样本不足 500 字，不报");
    expect(rows.every((row) => !row.value.includes("0%"))).toBe(true);
  });

  it("500 字是档案的样本门槛（与 contracts 同值）", () => {
    expect(styleProfileOf(["雪".repeat(499)])).toBeNull();
    expect(styleProfileOf(["雪".repeat(500)])).not.toBeNull();
  });

  it("说明句在样本不足与正常两态下都说清口径", () => {
    expect(readoutNoteOf(bookStyleReadoutOf(["雪".repeat(499)]))).toContain("立不起");
    expect(readoutNoteOf(bookStyleReadoutOf(bookSample()))).toContain("不设阈值");
  });
});

describe("chapterChipsOf", () => {
  it("样本不足只给一枚胶囊", () => {
    const chips = chapterChipsOf("雪".repeat(499));
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe("腔调");
    expect(chips[0]?.value).toBe("样本不足 500 字");
  });

  it("样本够时给句长、对白、纯台词段三枚", () => {
    const chips = chapterChipsOf(bookSample()[0]!);
    expect(chips.map((chip) => chip.label)).toEqual(["句长", "对白", "纯台词段"]);
    expect(chips[0]?.value).toMatch(/^\d+(\.\d)? 字$/);
    expect(chips[1]?.value).toMatch(/^\d+(\.\d)?%$/);
    expect(chips[2]?.value).toBe("20/60 段");
  });
});

describe("chapterDriftMarksOf", () => {
  const longChapter = {
    relPath: "chapters/long.md",
    title: "拉长的一章",
    content: `${"他".repeat(60)}。`.repeat(20)
  };
  const steadyChapter = {
    relPath: "chapters/steady.md",
    title: "照旧的一章",
    content: `${"他".repeat(10)}。`.repeat(40)
  };
  const shortChapter = { relPath: "chapters/short.md", title: "太短的一章", content: "太短。" };

  it("只给偏离的章挂标，档位与改法来自 styleDriftOf", () => {
    const marks = chapterDriftMarksOf(PROFILE, [longChapter, steadyChapter, shortChapter]);
    expect(Object.keys(marks)).toEqual([longChapter.relPath]);
    expect(marks[longChapter.relPath]?.severity).toBe("off");
    expect(marks[longChapter.relPath]?.title).toContain("句长均值");
    expect(marks[longChapter.relPath]?.title).toContain("句子被你拉长了");
  });

  it("没有常态档案时一个标都不挂", () => {
    expect(chapterDriftMarksOf(null, [longChapter])).toEqual({});
  });
});

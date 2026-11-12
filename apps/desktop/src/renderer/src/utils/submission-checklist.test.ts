import { describe, expect, it } from "vitest";
import type { CastFinding, TimelineIssue } from "@mochen/contracts";
import { findAiSlop } from "./ai-slop";
import { reviewReport, scoreBandOf } from "./review-score";
import type { ForeshadowRow, KeywordMiss } from "./foreshadow";
import {
  buildSubmissionChecklist,
  castItems,
  CLEAN_TEXT,
  groupChecklist,
  LOADING_TEXT,
  NO_CHAPTER_TEXT,
  reviewItems,
  slopItems,
  SOURCE_LABELS,
  SOURCE_ORDER,
  statusKeyOf,
  STATUS_HINT_TEXT,
  timelineItems,
  foreshadowItems
} from "./submission-checklist";

const A = "chapters/01-开局.md";
const B = "chapters/02-潮信.md";

function castFinding(partial: Partial<CastFinding> = {}): CastFinding {
  return {
    level: "suspect",
    code: "C2",
    card: "阿岚",
    cardPath: "characters/阿岚.md",
    message: "阿岚的口头禅出现在别人嘴里",
    chapter: A,
    line: 0,
    quote: "",
    ...partial
  };
}

function foreshadowRow(partial: Partial<ForeshadowRow> = {}): ForeshadowRow {
  return {
    relPath: "foreshadows/玉佩.md",
    title: "玉佩",
    status: "planted",
    statusLabel: "待回收",
    plantedIn: "",
    paidIn: "",
    rawStatus: "planted",
    keywords: [],
    tone: "pending",
    ...partial
  };
}

function miss(partial: Partial<KeywordMiss> = {}): KeywordMiss {
  return { relPath: "foreshadows/玉佩.md", title: "玉佩", chapter: A, keyword: "玉佩", ...partial };
}

function timelineIssue(partial: Partial<TimelineIssue> = {}): TimelineIssue {
  return {
    kind: "unsorted",
    text: "两章日期先后写反了",
    relPaths: [A],
    reading: "3 月 5 日 → 3 月 2 日",
    ...partial
  };
}

describe("去 AI 味条目", () => {
  it("每条命中都带行号，位置说明与命中行一致", () => {
    const draft = "第一行。\n值得注意的是，他走了。\n";
    const hits = findAiSlop(draft);
    const items = slopItems(draft, A);
    expect(items.length).toBe(hits.length);
    expect(items[0]?.source).toBe("slop");
    expect(items[0]?.locate).toBe("line");
    expect(items[0]?.line).toBe(2);
    expect(items[0]?.locateLabel).toBe("第 2 行");
    expect(items[0]?.relPath).toBe(A);
    expect(items[0]?.detail).toContain("AI");
  });

  it("同一行同一命中的第二条有自己的指纹，不会共用状态", () => {
    const draft = "值得注意的是，值得注意的是。\n";
    const items = slopItems(draft, A);
    expect(items.length).toBe(2);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("空稿或空标题不出条目", () => {
    expect(slopItems("   \n", A)).toEqual([]);
    expect(slopItems("有字。\n", "")).toEqual([]);
  });
});

describe("审稿打分条目", () => {
  it("只收既有「明显偏出」档，且如实标「无法定位」", () => {
    const draft = "他走了，风很大，天也黑了。\n";
    const report = reviewReport(draft);
    const expected = report.scores.filter((score) => scoreBandOf(score.score) === "low");
    const items = reviewItems(draft, A);
    expect(items.length).toBe(expected.length);
    for (const item of items) {
      expect(item.source).toBe("review");
      expect(item.locate).toBe("none");
      expect(item.line).toBe(0);
      expect(item.relPath).toBe("");
      expect(item.locateLabel).toContain("有结果但无法定位");
    }
  });

  it("空稿不出条目", () => {
    expect(reviewItems("  \n", A)).toEqual([]);
  });
});

describe("人物核对条目", () => {
  it("只收点名到本章的；行号按正文换算回带 frontmatter 的编辑框行号", () => {
    const draft = "---\ntitle: 开局\n---\n\n他走了。\n";
    const items = castItems(
      [
        castFinding({ line: 2, chapter: A }),
        castFinding({ line: 1, chapter: B, message: "第二章的问题" })
      ],
      A,
      draft
    );
    expect(items.length).toBe(1);
    expect(items[0]?.line).toBe(5);
    expect(items[0]?.locate).toBe("line");
    expect(items[0]?.locateLabel).toBe("第 5 行");
  });

  it("没有行号时只给文稿级定位，不伪造行", () => {
    const items = castItems([castFinding({ line: 0, level: "gap" })], A, "他走了。\n");
    expect(items[0]?.locate).toBe("doc");
    expect(items[0]?.line).toBe(0);
    expect(items[0]?.locateLabel).toContain("定位不到行");
  });

  it("defect 标成强信号，suspect/gap 标成待核", () => {
    const items = castItems(
      [castFinding({ level: "defect" }), castFinding({ level: "suspect" })],
      A,
      "他走了。\n"
    );
    expect(items.map((item) => item.tone)).toEqual(["strong", "suspect"]);
  });
});

describe("伏笔条目", () => {
  it("只收埋在本章 / 登记在本章回收且仍待回收的行", () => {
    const rows = [
      foreshadowRow({ plantedIn: A }),
      foreshadowRow({ relPath: "foreshadows/铜镜.md", title: "铜镜", paidIn: A }),
      foreshadowRow({ relPath: "foreshadows/远方.md", title: "远方", plantedIn: B }),
      foreshadowRow({ relPath: "foreshadows/旧账.md", title: "旧账", tone: "paid" })
    ];
    const items = foreshadowItems(rows, [], A);
    expect(items.map((item) => item.id)).toEqual([
      "foreshadow|row|foreshadows/玉佩.md",
      "foreshadow|row|foreshadows/铜镜.md"
    ]);
    expect(items[1]?.title).toContain("登记在本章回收");
    expect(items.every((item) => item.locate === "doc")).toBe(true);
  });

  it("状态字段写坏的那条也收，并说清下一步", () => {
    const items = foreshadowItems(
      [foreshadowRow({ plantedIn: A, tone: "broken", rawStatus: "plantd" })],
      [],
      A
    );
    expect(items[0]?.tone).toBe("strong");
    expect(items[0]?.title).toContain("plantd");
    expect(items[0]?.detail).toContain("planted / paid / dropped");
  });

  it("本章没找到的作者关键词也进清单，位置只到章", () => {
    const items = foreshadowItems([], [miss(), miss({ chapter: B })], A);
    expect(items.length).toBe(1);
    expect(items[0]?.locate).toBe("doc");
    expect(items[0]?.locateLabel).toContain("定位不到具体行");
  });

  it("读不到原文（unknown）的条目不冒充埋在本章", () => {
    const items = foreshadowItems(
      [foreshadowRow({ plantedIn: A, tone: "unknown", statusLabel: "状态未知" })],
      [],
      A
    );
    expect(items).toEqual([]);
  });
});

describe("时间线条目", () => {
  it("只有牵涉本章的才收，且只能定位到章", () => {
    const items = timelineItems([timelineIssue(), timelineIssue({ relPaths: [B] })], A);
    expect(items.length).toBe(1);
    expect(items[0]?.locate).toBe("doc");
    expect(items[0]?.line).toBe(0);
    expect(items[0]?.locateLabel).toContain("定位不到行");
  });
});

describe("整张清单", () => {
  it("没有本章路径时回空表", () => {
    expect(
      buildSubmissionChecklist({
        chapterRelPath: "",
        draft: "值得注意的是。\n",
        castFindings: [castFinding()],
        foreshadowRows: [foreshadowRow({ plantedIn: A })],
        keywordMisses: [miss()],
        timelineIssues: [timelineIssue()]
      })
    ).toEqual([]);
  });

  it("五套来源按固定顺序分组，空组不摆", () => {
    const items = buildSubmissionChecklist({
      chapterRelPath: A,
      draft: "值得注意的是，他走了。\n",
      castFindings: [castFinding({ line: 1 })],
      foreshadowRows: [foreshadowRow({ plantedIn: A })],
      keywordMisses: [miss()],
      timelineIssues: [timelineIssue()]
    });
    const groups = groupChecklist(items);
    const expectedSources = SOURCE_ORDER.filter((source) =>
      items.some((item) => item.source === source)
    );
    expect(groups.map((group) => group.source)).toEqual(expectedSources);
    expect(groups.map((group) => group.label)).toEqual(
      expectedSources.map((source) => SOURCE_LABELS[source])
    );
  });

  it("状态键把书/章/条目分开，不同章的同名条目互不串", () => {
    const one = statusKeyOf("b1\u0000" + A, "slop|1|值得注意的是|strong|0");
    const two = statusKeyOf("b1\u0000" + B, "slop|1|值得注意的是|strong|0");
    expect(one).not.toBe(two);
  });
});

describe("空态与说明文案", () => {
  it("空态文案写明范围，不需要伪造数据", () => {
    expect(NO_CHAPTER_TEXT).toContain("只对章节生效");
    expect(LOADING_TEXT).toContain("正在汇总");
    expect(CLEAN_TEXT).toContain("没有待收拾");
    expect(STATUS_HINT_TEXT).toContain("关掉软件就清空");
    expect(STATUS_HINT_TEXT).toContain("book.json");
  });
});

/** 落盘清单要接住状态，指纹就不能跟着行号漂（2026-11-12）。 */
describe("去 AI 味条目的身份", () => {
  it("前面插一段，id 不变、行号跟着刷新", () => {
    const before = slopItems("值得注意的是，他走了。\n", A);
    const after = slopItems("新加的一段。\n值得注意的是，他走了。\n", A);
    expect(before[0]?.id).toBe(after[0]?.id);
    expect(before[0]?.line).toBe(1);
    expect(after[0]?.line).toBe(2);
  });

  it("带上原始命中词：落盘清单交给 AI 改时不用从屏显标题里抠字", () => {
    expect(slopItems("值得注意的是，他走了。\n", A)[0]?.matched).toBe("值得注意的是");
    expect(slopItems("人物卡缺字段。\n", A)[0]).toBeUndefined();
  });
});

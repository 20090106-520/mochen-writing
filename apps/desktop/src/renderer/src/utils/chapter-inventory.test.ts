import { describe, expect, it } from "vitest";
import type { ChangeEntry, DocRef } from "@mochen/contracts";
import {
  chapterInventoryRows,
  chapterInventorySummary,
  chapterStatusOf,
  CHAPTER_STATUS_LABELS,
  CHAPTER_STATUSES,
  CHAPTER_STATUS_TONES,
  INVENTORY_CHANGE_NOTE,
  INVENTORY_EMPTY_TEXT,
  INVENTORY_GOAL_NOTE,
  INVENTORY_NOTE,
  latestChangeByDoc
} from "./chapter-inventory";

const A = "chapters/01-开局.md";
const B = "chapters/02-潮信.md";
const C = "chapters/03-归途.md";

function chapter(partial: Partial<DocRef> = {}): DocRef {
  return { relPath: A, kind: "chapter", title: "开局", ...partial };
}

function change(partial: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    stamp: "2026-10-05T12-34-31-168Z",
    docRelPath: A,
    backupRelPath: `.mochen/changes/${A}/x`,
    bytes: 10,
    ...partial
  };
}

function rowsOf(
  overrides: Partial<Parameters<typeof chapterInventoryRows>[0]> & {
    targets?: Record<string, number>;
  } = {}
) {
  const targets = overrides.targets ?? {};
  return chapterInventoryRows({
    docs: overrides.docs ?? [chapter()],
    chapterOrder: overrides.chapterOrder ?? [A],
    targetOf: (relPath) => targets[relPath] ?? 0,
    changes: overrides.changes ?? [],
    activeDocTab: overrides.activeDocTab ?? null,
    dirty: overrides.dirty ?? false
  });
}

describe("档位判据：只用扫描字数与既有逐章目标", () => {
  it("空稿优先：没正文时有没有目标都不算达标", () => {
    expect(chapterStatusOf(0, 0)).toBe("empty");
    expect(chapterStatusOf(0, 5000)).toBe("empty");
    expect(chapterStatusOf(1200, 0)).toBe("untargeted");
    expect(chapterStatusOf(1200, 5000)).toBe("writing");
    expect(chapterStatusOf(5000, 5000)).toBe("done");
  });

  it("四个档位各有文案与样式类，且没有「已交稿」这一档", () => {
    expect(CHAPTER_STATUSES).toEqual(["empty", "untargeted", "writing", "done"]);
    expect(CHAPTER_STATUSES).not.toContain("submitted");
    expect(CHAPTER_STATUS_LABELS).toEqual({
      empty: "空稿",
      untargeted: "有正文",
      writing: "未达标",
      done: "已达章目标"
    });
    expect(Object.values(CHAPTER_STATUS_TONES)).toEqual([
      "is-empty",
      "is-plain",
      "is-writing",
      "is-done"
    ]);
  });
});

describe("按既有章节次序列出", () => {
  it("chapterOrder 决定先后；非章节文稿不进表", () => {
    const rows = rowsOf({
      docs: [
        chapter({ relPath: C, title: "归途" }),
        chapter({ relPath: "characters/阿岚.md", kind: "character", title: "阿岚" }),
        chapter({ relPath: A, title: "开局" }),
        chapter({ relPath: B, title: "潮信" })
      ],
      chapterOrder: [C, A, B]
    });
    expect(rows.map((row) => row.relPath)).toEqual([C, A, B]);
  });

  it("未登记进次序的章节按既有兜底次序落在后面，不丢", () => {
    const rows = rowsOf({
      docs: [chapter({ relPath: B, title: "潮信" }), chapter({ relPath: A, title: "开局" })],
      chapterOrder: [A]
    });
    expect(rows.map((row) => row.relPath)).toEqual([A, B]);
  });
});

describe("最近一次改动取既有改稿历史的最新一条", () => {
  it("同一篇取最大时间戳；不同篇互不串", () => {
    const map = latestChangeByDoc([
      change({ stamp: "2026-10-05T12-34-31-168Z", docRelPath: A }),
      change({ stamp: "2026-10-06T08-00-00-001Z", docRelPath: A }),
      change({ stamp: "2026-10-04T09-00-00-000Z", docRelPath: B })
    ]);
    expect(map.get(A)).toBe("2026-10-06T08-00-00-001Z");
    expect(map.get(B)).toBe("2026-10-04T09-00-00-000Z");
  });

  it("没有备份记录就显示「—」，不拿别的什么凑时间", () => {
    const rows = rowsOf({ docs: [chapter()], changes: [] });
    expect(rows[0]?.lastChange).toBe("");
    expect(rows[0]?.lastChangeLabel).toBe("—");
  });

  it("有记录时用人话时间，且当前这一篇的未保存改动单独标出", () => {
    const rows = rowsOf({
      docs: [chapter()],
      changes: [change()],
      activeDocTab: A,
      dirty: true
    });
    expect(rows[0]?.lastChangeLabel).toContain("10-05");
    expect(rows[0]?.current).toBe(true);
    expect(rows[0]?.unsaved).toBe(true);
  });
});

describe("每章读数", () => {
  it("字数、目标、差额都由既有数据直出", () => {
    const rows = rowsOf({
      docs: [chapter({ chars: 1200 }), chapter({ relPath: B, title: "潮信", chars: 8000 })],
      chapterOrder: [A, B],
      targets: { [A]: 5000, [B]: 5000 }
    });
    expect(rows[0]?.chars).toBe(1200);
    expect(rows[0]?.target).toBe(5000);
    expect(rows[0]?.status).toBe("writing");
    expect(rows[0]?.gap).toBe(3800);
    expect(rows[1]?.status).toBe("done");
    expect(rows[1]?.gap).toBe(0);
  });
});

describe("全书汇总", () => {
  const rows = rowsOf({
    docs: [
      chapter({ chars: 1000 }),
      chapter({ relPath: B, title: "潮信", chars: 0 }),
      chapter({ relPath: C, title: "归途", chars: 3000 })
    ],
    chapterOrder: [A, B, C],
    targets: { [A]: 1000, [C]: 6000 }
  });

  it("总字数、空稿数、已写章数、平均都是既有读数", () => {
    const summary = chapterInventorySummary(rows, 0);
    expect(summary.chapterCount).toBe(3);
    expect(summary.totalChars).toBe(4000);
    expect(summary.emptyCount).toBe(1);
    expect(summary.writtenCount).toBe(2);
    expect(summary.avgChars).toBe(1333);
    expect(summary.targetCount).toBe(2);
    expect(summary.reachedCount).toBe(1);
  });

  it("没设全书目标：remaining 为 null，不编默认值", () => {
    const summary = chapterInventorySummary(rows, 0);
    expect(summary.totalTarget).toBe(0);
    expect(summary.remaining).toBeNull();
    expect(summary.percent).toBe(0);
  });

  it("设了全书目标：差额与进度按既有数值算，超了不出现负数", () => {
    const summary = chapterInventorySummary(rows, 10000);
    expect(summary.remaining).toBe(6000);
    expect(summary.percent).toBe(40);
    expect(chapterInventorySummary(rows, 2000).remaining).toBe(0);
  });
});

describe("说明文案把来源与跳过项写在明处", () => {
  it("档位只说既有事实，并讲明为什么不设「已交稿」", () => {
    expect(INVENTORY_NOTE).toContain("已交稿");
    expect(INVENTORY_NOTE).toContain("不设这一档");
    expect(INVENTORY_NOTE).toContain("逐章目标");
  });

  it("目标未设与无记录都如实说明", () => {
    expect(INVENTORY_GOAL_NOTE).toContain("未设");
    expect(INVENTORY_GOAL_NOTE).toContain("不编默认值");
    expect(INVENTORY_CHANGE_NOTE).toContain("—");
    expect(INVENTORY_EMPTY_TEXT).toContain("还没有章节文稿");
  });
});

import { describe, expect, it } from "vitest";
import type { ChangeEntry } from "@mochen/contracts";
import {
  CHANGE_HISTORY_VISIBLE,
  changeCountLabel,
  changeHeadline,
  changeListView,
  changeTimeLabel,
  formatBytes
} from "./change-history";

function entry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    stamp: "2026-10-05T12-34-31-168Z",
    docRelPath: "chapters/01-开局.md",
    backupRelPath: ".mochen/changes/2026-10-05T12-34-31-168Z/chapters/01-开局.md.bak",
    bytes: 2048,
    ...overrides
  };
}

describe("changeTimeLabel", () => {
  it("把定长时间戳翻成人看得懂的时分秒", () => {
    expect(changeTimeLabel("2026-10-05T12-34-31-168Z")).toBe("10-05 12:34:31");
    expect(changeTimeLabel("2026-01-09T00-05-00-007Z")).toBe("01-09 00:05:00");
  });

  it("形状不对就原样还回去：不替它编一个时间（编出来的比空更坏）", () => {
    for (const bad of ["", "昨天", "2026-10-05", "2026-10-05T12:34:31Z", "x-10-05T12-34-31-168Z"]) {
      expect(changeTimeLabel(bad)).toBe(bad);
    }
  });
});

describe("formatBytes", () => {
  it("三档：字节 / KB / MB", () => {
    expect(formatBytes(512)).toBe("512 字节");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("空与非法值说人话，不返回 NaN", () => {
    expect(formatBytes(0)).toBe("空文件");
    expect(formatBytes(-1)).toBe("空文件");
    expect(formatBytes(Number.NaN)).toBe("空文件");
  });
});

describe("changeHeadline", () => {
  it("文稿 + 时间 + 体积，一句话说清这条是什么", () => {
    expect(changeHeadline(entry())).toBe(
      "chapters/01-开局.md · 10-05 12:34:31 的改前版本（2.0 KB）"
    );
  });

  it("换一条就换掉那一句（不是固定文案）", () => {
    const other = changeHeadline(entry({ docRelPath: "chapters/02-潮信.md", bytes: 100 }));
    expect(other).toContain("chapters/02-潮信.md");
    expect(other).toContain("100 字节");
  });
});

describe("changeCountLabel", () => {
  // 头部那个计数不是装饰：列表是滚动区，滚出视野的几条全靠它告诉用户「一共这么多」。
  it("1 条 / 多条 / 0 条各有说法，不出现「1 次改动」这种别扭单数", () => {
    expect(changeCountLabel(0)).toBe("还没有记录");
    expect(changeCountLabel(1)).toBe("1 次改动");
    expect(changeCountLabel(5)).toBe("5 次改动");
    expect(changeCountLabel(120)).toBe("120 次改动");
  });

  it("负数与小数不摆出「-3 次改动」这种鬼话", () => {
    expect(changeCountLabel(-3)).toBe("还没有记录");
    expect(changeCountLabel(2.4)).toBe("2 次改动");
  });
});

/** 造 n 条：序号直接编进 docRelPath，好断言顺序没被重排。 */
function manyEntries(n: number): ChangeEntry[] {
  return Array.from({ length: n }, (_, i) =>
    entry({ docRelPath: `chapters/${String(i).padStart(3, "0")}.md` })
  );
}

describe("changeListView · 显示上限（不删盘上的备份）", () => {
  it("空的与不满上限的：全列，不出折叠说明", () => {
    for (const n of [0, 1, 17, CHANGE_HISTORY_VISIBLE]) {
      const v = changeListView(manyEntries(n));
      expect(v.rows).toHaveLength(n);
      expect(v.total).toBe(n);
      expect(v.hidden).toBe(0);
      expect(v.notice, `${n} 条不该出折叠说明`).toBeNull();
    }
  });

  it("超上限：只列最近的那些，折叠数算得准", () => {
    const v = changeListView(manyEntries(CHANGE_HISTORY_VISIBLE + 15));
    expect(v.rows).toHaveLength(CHANGE_HISTORY_VISIBLE);
    expect(v.total).toBe(CHANGE_HISTORY_VISIBLE + 15);
    expect(v.hidden).toBe(15);
    expect(v.notice).toContain("15");
  });

  it("total 报的是总数——头部计数靠它，说成 rows.length 就是在数字上撒谎", () => {
    const v = changeListView(manyEntries(200));
    expect(v.total).toBe(200);
    expect(v.rows).toHaveLength(CHANGE_HISTORY_VISIBLE);
    expect(changeCountLabel(v.total)).toBe("200 次改动");
  });

  it("截的是列不是序：最新那批一条不少、一条不乱", () => {
    const list = manyEntries(80);
    const v = changeListView(list);
    expect(v.rows.map((e) => e.docRelPath)).toEqual(
      list.slice(0, CHANGE_HISTORY_VISIBLE).map((e) => e.docRelPath)
    );
  });

  // 这条是这个功能最容易出的错：折叠说明一旦写成「已清理」，用户就以为老备份没了，
  // 哪天真要回滚到半年前那版时才发现，才是真的回不去。
  it("折叠说明不许承诺任何删除：只说「没删」和「还在哪儿」", () => {
    const v = changeListView(manyEntries(200));
    expect(v.notice).toContain("没删");
    expect(v.notice).toContain(".mochen/changes");
    expect(v.notice).not.toMatch(/已删|已清理|已丢弃|已移除|永久/);
  });

  it("返回的 rows 是副本：改它不改原表（store 里的 changeList 还要继续用）", () => {
    const list = manyEntries(3);
    const v = changeListView(list);
    v.rows.length = 0;
    expect(list).toHaveLength(3);
  });

  it("非数组输入说人话，不炸", () => {
    const v = changeListView(undefined as unknown as ChangeEntry[]);
    expect(v.total).toBe(0);
    expect(v.rows).toEqual([]);
  });
});

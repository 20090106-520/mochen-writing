import { describe, expect, it } from "vitest";
import {
  TIMELINE_BLIND_NOTE,
  TIMELINE_BLIND_SPOT,
  checkTimeline,
  dayOfYear,
  daysBetween,
  frontmatterField,
  isLeapYear,
  parseElapsed,
  parseStoryDate,
  parseTimelineMeta,
  timelineVerdict,
  type TimelineEntry
} from "../src/index.js";

/** 造一条时间线条目的最短路径（测试里不必把 text 填满）。 */
function entry(over: Partial<TimelineEntry> & { relPath: string }): TimelineEntry {
  return {
    title: over.relPath,
    date: null,
    dateProblem: "",
    text: "",
    ...over
  };
}

describe("故事日期解析", () => {
  it("认 ISO 的 YYYY-MM-DD", () => {
    expect(parseStoryDate("2026-03-05")).toBe("2026-03-05");
  });

  it("2 月 30 日是坏日期，不许就近取 28 或 29", () => {
    expect(parseStoryDate("2026-02-30")).toBeNull();
  });

  it("平年 2 月 29 日也是坏的，闰年才认", () => {
    expect(parseStoryDate("2026-02-29")).toBeNull();
    expect(parseStoryDate("2028-02-29")).toBe("2028-02-29");
  });

  it("月份越界与非法形状都回 null，不返回半个日期", () => {
    expect(parseStoryDate("2026-13-01")).toBeNull();
    expect(parseStoryDate("2026-00-10")).toBeNull();
    expect(parseStoryDate("三月五日")).toBeNull();
    expect(parseStoryDate("")).toBeNull();
  });

  it("闰年规则：四年一闰、百年不闰、四百年再闰", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("带引号的值能剥掉引号", () => {
    expect(parseStoryDate('"2026-03-05"'.replace(/"/g, ""))).toBe("2026-03-05");
  });
});

describe("frontmatter 取值（真身已提到 frontmatter.ts）", () => {
  it("取得到标量键", () => {
    expect(frontmatterField("---\ndate: 2026-03-05\n---\n正文", "date")).toBe("2026-03-05");
  });

  it("缺键 / 没围栏都回空串", () => {
    expect(frontmatterField("---\nx: 1\n---", "date")).toBe("");
    expect(frontmatterField(null, "date")).toBe("");
  });

  it("剥掉首尾引号", () => {
    expect(frontmatterField('---\ndate: "2026-03-05"\n---', "date")).toBe("2026-03-05");
  });
});

describe("时间线文稿的元数据", () => {
  it("有 date 就是有", () => {
    const meta = parseTimelineMeta("---\ndate: 2026-03-05\n---\n那天下了雨。");
    expect(meta.date).toBe("2026-03-05");
    expect(meta.dateProblem).toBe("");
  });

  it("没写 date 是「没写」，不是「写坏了」", () => {
    const meta = parseTimelineMeta("---\ntitle: 某日\n---\n正文");
    expect(meta.date).toBeNull();
    expect(meta.dateProblem).toBe("");
  });

  it("写坏了要显式说，并回显原值——不悄悄跳过", () => {
    const meta = parseTimelineMeta("---\ndate: 某年某月\n---\n正文");
    expect(meta.date).toBeNull();
    expect(meta.dateProblem).toContain("某年某月");
  });
});

describe("日期算术", () => {
  it("年内差天数", () => {
    expect(daysBetween("2026-03-01", "2026-03-05")).toBe(4);
  });

  it("跨年也算得出来", () => {
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
  });

  it("跨闰年那一年也对", () => {
    expect(daysBetween("2023-12-30", "2024-01-02")).toBe(3);
  });

  it("任一认不出就回 null——绝不给 0（0 会被当成「同一天」去判矛盾）", () => {
    expect(daysBetween("2026-02-30", "2026-03-05")).toBeNull();
    expect(daysBetween("2026-03-05", "某天")).toBeNull();
  });

  it("跨两年以上不给结论（那已经不像一个连续故事了）", () => {
    expect(daysBetween("2020-01-01", "2026-01-01")).toBeNull();
  });

  it("dayOfYear 认不出的回 null", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-13-01")).toBeNull();
  });
});

describe("正文里的「N 天后」", () => {
  it("认得中文与阿拉伯数字", () => {
    expect(parseElapsed("三天后他们再见")).toEqual({
      amount: 3,
      unit: "天",
      later: true,
      raw: "三天后"
    });
    expect(parseElapsed("5 天前的事")).toEqual({
      amount: 5,
      unit: "天",
      later: false,
      raw: "5 天前"
    });
  });

  it("分清「后」与「前」", () => {
    expect(parseElapsed("一周后")?.later).toBe(true);
    expect(parseElapsed("一周前")?.later).toBe(false);
  });

  it("「之后 / 以前」也算", () => {
    expect(parseElapsed("三天之后")?.amount).toBe(3);
    expect(parseElapsed("三天以前")?.later).toBe(false);
  });

  it("认不出的量词回 null，不当成 0 天", () => {
    expect(parseElapsed("若干天后")).toBeNull();
    expect(parseElapsed("半个时辰后")).toBeNull();
    expect(parseElapsed("正文里没有时间词")).toBeNull();
  });

  it("**连着调两次结果相同**（带 /g 的正则带 lastIndex 状态，复用会隔一次漏一次）", () => {
    const a = parseElapsed("三天后");
    const b = parseElapsed("三天后");
    expect(a).toEqual(b);
  });
});

describe("一致性检查", () => {
  it("日期都一致时不报任何问题，且结论要说「没查出」而不是空白", () => {
    // 3/1 出发、3/4 到达 = 隔 3 天，正文写「三天后」——对得上。
    const issues = checkTimeline([
      entry({ relPath: "timeline/a.md", date: "2026-03-01", text: "他出发了。" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-04", text: "三天后他到了。" })
    ]);
    expect(issues).toEqual([]);
    expect(timelineVerdict(issues)).toContain("没查出矛盾");
  });

  // 容差是 0：作者写「三天后」而日期只隔两天，就是要核一核的，不是"约等于"。
  // （曾留过 1 天容差，理由是"作者不必精确"——但那会让真矛盾整条漏掉。）
  it("差一天就该报——容差是 0，不给「约等于」留后门", () => {
    const issues = checkTimeline([
      entry({ relPath: "timeline/a.md", date: "2026-03-01" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-03", text: "三天后他到了。" })
    ]);
    expect(issues.filter((i) => i.kind === "gap")).toHaveLength(1);
  });

  it("完全对上时不报（不误报的正向钉）", () => {
    const exact = checkTimeline([
      entry({ relPath: "timeline/a.md", date: "2026-03-01" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-04", text: "3 天后" })
    ]);
    expect(exact.filter((i) => i.kind === "gap")).toEqual([]);
  });

  it("「三天后」配隔了四天的日期要报出来（出发到到达是含头不含尾的差）", () => {
    const issues = checkTimeline([
      entry({ relPath: "timeline/a.md", date: "2026-03-01" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-05", text: "三天后他到了。" })
    ]);
    expect(issues.filter((i) => i.kind === "gap")).toHaveLength(1);
  });

  // 2026-10-05 真机撞出来的：中间那篇既当下篇被比、又当下一篇的 from 再被比一次，
  // 于是「抵达」的「三天后」被拿去和「安居」比，硬报出一条不存在的矛盾。
  it("中间篇只跟紧邻的上一篇比，不被复用两次（真机 bug 的回归钉）", () => {
    const issues = checkTimeline([
      entry({ relPath: "timeline/a.md", date: "2026-03-01", text: "他出发了。" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-03", text: "三天后他到了。" }),
      entry({ relPath: "timeline/c.md", date: "2026-03-20", text: "他在城里租了间屋子。" })
    ]);
    const gaps = issues.filter((i) => i.kind === "gap");
    // 只该有一条：a→b 那对（说三天、隔两天）。b 那句「三天后」不许再拿去和 c 比。
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.relPaths).toEqual(["timeline/a.md", "timeline/b.md"]);
  });

  it("同一篇不会在一条问题里被列两次", () => {
    const issues = checkTimeline([
      entry({ relPath: "timeline/a.md", date: "2026-03-01" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-03", text: "三天后" }),
      entry({ relPath: "timeline/c.md", date: "2026-03-20" })
    ]);
    for (const issue of issues) {
      expect(new Set(issue.relPaths).size).toBe(issue.relPaths.length);
    }
  });

  it("日期写坏的那条要列出来，不许凭空从台账上消失", () => {
    const issues = checkTimeline([
      entry({
        relPath: "timeline/bad.md",
        dateProblem: "日期字段不是 YYYY-MM-DD 的真日期（写的是「某年某月」）"
      })
    ]);
    expect(issues.map((i) => i.kind)).toEqual(["unreadable"]);
    expect(issues[0]?.relPaths).toEqual(["timeline/bad.md"]);
  });

  it("没写日期的条目不算「写坏」——作者可能还没排期", () => {
    const issues = checkTimeline([
      entry({ relPath: "timeline/a.md", date: null, dateProblem: "" })
    ]);
    expect(issues).toEqual([]);
  });

  it("日期与篇幅无关，牵涉到的文稿能点回去", () => {
    const issues = checkTimeline([
      entry({ relPath: "timeline/a.md", date: "2026-03-01" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-03", text: "三天后" })
    ]);
    for (const issue of issues) {
      expect(issue.relPaths.length).toBeGreaterThan(0);
      expect(issue.text).not.toBe("");
    }
  });

  it("空表不报错，结论仍是一句人话", () => {
    expect(checkTimeline([])).toEqual([]);
    expect(timelineVerdict([])).not.toBe("");
  });

  it("结论把三类分开报数，不含糊成「有几个问题」", () => {
    const issues = checkTimeline([
      entry({ relPath: "timeline/bad.md", dateProblem: "日期字段坏了" }),
      entry({ relPath: "timeline/a.md", date: "2026-03-01" }),
      entry({ relPath: "timeline/b.md", date: "2026-03-03", text: "三天后" })
    ]);
    const verdict = timelineVerdict(issues);
    expect(verdict).toContain("日期读不出来");
    expect(verdict).toContain("正文与日期对不上");
  });
});

describe("诚实边界：查不出的那部分明写", () => {
  it("在场与剧情两项不在判定里，只在 BLIND_SPOT 里", () => {
    expect(TIMELINE_BLIND_SPOT).toHaveLength(2);
    for (const m of TIMELINE_BLIND_SPOT) {
      expect(m.label).not.toBe("");
      expect(m.hint).not.toBe("");
    }
  });

  it("说明文案只有一份", () => {
    expect(TIMELINE_BLIND_NOTE).toContain("查不出来");
  });
});

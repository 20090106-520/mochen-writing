import { describe, expect, it } from "vitest";
import {
  chapterIssuesOf,
  emptyReviewIssueBook,
  issueIdOf,
  issuesFromSlop,
  markIssue,
  mergeChapterIssues,
  normalizeReviewIssueBook,
  openCount,
  openSlopHitsOf,
  withChapterIssues,
  type ReviewIssue,
  type SlopLike
} from "./review-issues.js";

/** 一枚词表命中。上下文片段就是身份的一部分，所以夹具里刻意让它像真话。 */
function hit(over: Partial<SlopLike> = {}): SlopLike {
  return {
    line: 7,
    matched: "值得注意的是",
    strength: "strong",
    why: "总结式开场",
    excerpt: "…值得注意的是，他没回头…",
    ...over
  };
}

const REL = "chapters/03-雨夜.md";

describe("交稿问题清单 · 身份与按章存放", () => {
  it("身份不含行号：前面插一段，行号漂了还是同一条", () => {
    const a = issueIdOf(hit({ line: 7 }));
    const b = issueIdOf(hit({ line: 19 }));
    expect(a).toBe(b);
  });

  it("上下文或命中词变了就是另一处——身份靠内容，不靠位置", () => {
    expect(issueIdOf(hit({ excerpt: "…值得注意的是，雨停了…" }))).not.toBe(issueIdOf(hit()));
    expect(issueIdOf(hit({ matched: "总而言之" }))).not.toBe(issueIdOf(hit()));
  });

  it("同一行两处相同词合成一条：作者本来也是一起改", () => {
    const found = issuesFromSlop([hit(), hit()]);
    expect(found).toHaveLength(1);
    expect(found[0]?.status).toBe("open");
  });

  it("按章取数：没体检过的章是空清单，不是 undefined", () => {
    expect(chapterIssuesOf(emptyReviewIssueBook(), REL)).toEqual([]);
    const book = withChapterIssues(emptyReviewIssueBook(), REL, issuesFromSlop([hit()]));
    expect(chapterIssuesOf(book, REL)).toHaveLength(1);
    expect(chapterIssuesOf(book, "chapters/04-另一章.md")).toEqual([]);
  });

  it("写回不改动原对象；空清单把章键删掉，不留空壳", () => {
    const before = emptyReviewIssueBook();
    const withOne = withChapterIssues(before, REL, issuesFromSlop([hit()]));
    expect(before.chapters).toEqual({});
    expect(Object.keys(withOne.chapters)).toEqual([REL]);
    const cleared = withChapterIssues(withOne, REL, []);
    expect(cleared.chapters).toEqual({});
    expect(Object.keys(withOne.chapters)).toEqual([REL]);
  });
});

describe("交稿问题清单 · 复检合并", () => {
  it("上一次待修、这次没扫到 ⇒ 自动落已修，但条目留痕", () => {
    const old = issuesFromSlop([hit()]);
    const merged = mergeChapterIssues(old, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("fixed");
    expect(openCount(merged)).toBe(0);
  });

  it("上一次已修、这次又扫到了 ⇒ 回到待修，复发要看得见", () => {
    const old = markIssue(issuesFromSlop([hit()]), issueIdOf(hit()), "fixed");
    const merged = mergeChapterIssues(old, issuesFromSlop([hit()]));
    expect(merged[0]?.status).toBe("open");
    expect(openCount(merged)).toBe(1);
  });

  it("用户标过忽略的永远保留忽略，复检不把拍过板的决定弹回来", () => {
    const old = markIssue(issuesFromSlop([hit()]), issueIdOf(hit()), "ignored");
    expect(mergeChapterIssues(old, issuesFromSlop([hit()]))[0]?.status).toBe("ignored");
    expect(mergeChapterIssues(old, [])[0]?.status).toBe("ignored");
  });

  it("还在的问题刷新显示字段（行号会漂），新命中追加在后面", () => {
    const old = issuesFromSlop([hit()]);
    const moved = hit({ line: 42 });
    const fresh = issuesFromSlop([
      moved,
      hit({ matched: "总而言之", excerpt: "…总而言之，走吧…" })
    ]);
    const merged = mergeChapterIssues(old, fresh);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.line).toBe(42);
    expect(merged[1]?.matched).toBe("总而言之");
    expect(merged.every((item) => item.status === "open")).toBe(true);
  });

  it("手工标记找不到 id 就原样返回，不凭空造一条", () => {
    const items = issuesFromSlop([hit()]);
    const after = markIssue(items, "不存在的 id", "ignored");
    expect(after).toEqual(items);
  });
});

describe("交稿问题清单 · 盘上那份读不读得懂", () => {
  it("正常档能原样往返（含状态与行号）", () => {
    const issues: ReviewIssue[] = markIssue(issuesFromSlop([hit()]), issueIdOf(hit()), "ignored");
    const book = withChapterIssues(emptyReviewIssueBook(), REL, issues);
    const parsed = normalizeReviewIssueBook(JSON.parse(JSON.stringify(book)));
    expect(parsed).toEqual(book);
    expect(chapterIssuesOf(parsed!, REL)[0]?.status).toBe("ignored");
  });

  it("空档（一本书还没体检过）认得出来", () => {
    expect(normalizeReviewIssueBook(emptyReviewIssueBook())).toEqual(emptyReviewIssueBook());
  });

  it.each([
    ["version 不是 1", { version: 2, chapters: {} }],
    ["chapters 不是对象", { version: 1, chapters: [] }],
    ["某一章不是数组", { version: 1, chapters: { [REL]: {} } }],
    ["章路径是空串", { version: 1, chapters: { "": [] } }],
    ["条目缺字段", { version: 1, chapters: { [REL]: [{ id: "x", status: "open" }] } }],
    [
      "状态不在三档里",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, status: "deleted" })) }
      }
    ],
    [
      "行号不是正整数",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, line: 0 })) }
      }
    ],
    [
      "同一章两条同 id",
      { version: 1, chapters: { [REL]: [...issuesFromSlop([hit()]), ...issuesFromSlop([hit()])] } }
    ],
    ["整个不是对象", "坏档"],
    ["null", null]
  ])("%s ⇒ 判读不懂，绝不将错就错当空库", (_name, value) => {
    expect(normalizeReviewIssueBook(value)).toBeNull();
  });
});

/**
 * 交给 AI 改的那份清单（W-04 第二刀）。
 *
 * 预填原先喂「这一秒的扫描」，作者标过的忽略、上轮留下的待修全被绕过去；
 * 现在有留存清单时只交待修。这一层要钉住的是**别把内部字段递出去**：
 * id 里带 \u001f 分隔符，status 是本地状态，模型读到只会把它们当正文的一部分学。
 */
describe("交稿问题清单 · 交给 AI 改的那几条", () => {
  it("只留待修：已修与已忽略都不进", () => {
    const items: ReviewIssue[] = [
      { ...issuesFromSlop([hit()])[0]!, status: "open" },
      { ...issuesFromSlop([hit({ matched: "总而言之" })])[0]!, status: "fixed" },
      { ...issuesFromSlop([hit({ matched: "值得一提的是" })])[0]!, status: "ignored" }
    ];
    const out = openSlopHitsOf(items);
    expect(out).toHaveLength(1);
    expect(out[0]?.matched).toBe("值得注意的是");
  });

  it("投影成命中形状：字段一个不多，一个不少", () => {
    const out = openSlopHitsOf(issuesFromSlop([hit()]));
    expect(out).toEqual([
      {
        line: 7,
        matched: "值得注意的是",
        strength: "strong",
        why: "总结式开场",
        excerpt: "…值得注意的是，他没回头…"
      }
    ]);
    // 内部指纹与本地状态不许出现在递给模型的文本里。
    expect(JSON.stringify(out)).not.toContain("id");
    expect(JSON.stringify(out)).not.toContain("status");
  });

  it("顺序照清单原来的来（复检追加的新条目排在后面）", () => {
    const items = issuesFromSlop([hit({ matched: "甲" }), hit({ matched: "乙" })]);
    expect(openSlopHitsOf(items).map((h) => h.matched)).toEqual(["甲", "乙"]);
  });

  it("空清单 / 全处理完都回空数组，由面板决定回退到实时命中", () => {
    expect(openSlopHitsOf([])).toEqual([]);
    const done = issuesFromSlop([hit()]).map((item) => ({ ...item, status: "ignored" as const }));
    expect(openSlopHitsOf(done)).toEqual([]);
  });
});

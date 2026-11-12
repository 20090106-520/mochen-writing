import { describe, expect, it } from "vitest";
import { SOURCE_LABELS, type ChecklistItem } from "./submission-checklist.js";
import {
  CHECKLIST_TO_ISSUE,
  ISSUE_SOURCE_LABELS,
  ISSUE_TO_CHECKLIST,
  chapterIssuesOf,
  emptyReviewIssueBook,
  issueIdOf,
  issuesFromChecklist,
  issuesFromSlop,
  markIssue,
  mergeChapterIssues,
  normalizeReviewIssueBook,
  openCount,
  openSlopHitsOf,
  slopOpenCount,
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
      "行号是负数",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, line: -1 })) }
      }
    ],
    [
      "行号是小数",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, line: 1.5 })) }
      }
    ],
    [
      "来源不在五套里",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, source: "unknown" })) }
      }
    ],
    [
      "可选 title 形状不对",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, title: 42 })) }
      }
    ],
    [
      "可选 locate 不是三档之一",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, locate: "page" })) }
      }
    ],
    [
      "可选 relPath 不是字符串",
      {
        version: 1,
        chapters: { [REL]: issuesFromSlop([hit()]).map((item) => ({ ...item, relPath: 7 })) }
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

/**
 * 五套来源接进落盘清单（W-04 第二刀）。
 *
 * 要钉的不是「又写了一套判据」——恰恰相反，这里一条判据都不该有：所有条目都是
 * `buildSubmissionChecklist` 的现成结论搬过来的。要钉的是搬运时最容易丢的两样：
 * ① 有些判据**给不出行号**（篇级读数 / 只能跳到文稿），不许为了存得下伪造一个第 1 行；
 * ② 「交给 AI 改」只管去 AI 味，别把人物卡、伏笔当成套话递给模型。
 */
function checklistItem(over: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: "cast|缺字段|人物卡/甲.md|chapters/03-雨夜.md|0|defect|人物卡缺字段",
    source: "cast",
    tone: "strong",
    title: "人物卡缺字段",
    detail: "人物卡：甲（缺字段） · 原文：他没回头",
    locate: "doc",
    relPath: REL,
    line: 0,
    locateLabel: "只能跳到这一章，定位不到行",
    ...over
  };
}

describe("交稿问题清单 · 五套来源", () => {
  it("五种来源都映射得上，来源是唯一事实：标签从体检层取，不另抄一份", () => {
    expect(ISSUE_SOURCE_LABELS["ai-slop"]).toBe(SOURCE_LABELS.slop);
    expect(ISSUE_SOURCE_LABELS.review).toBe(SOURCE_LABELS.review);
    expect(ISSUE_SOURCE_LABELS.cast).toBe(SOURCE_LABELS.cast);
    expect(ISSUE_SOURCE_LABELS.foreshadow).toBe(SOURCE_LABELS.foreshadow);
    expect(ISSUE_SOURCE_LABELS.timeline).toBe(SOURCE_LABELS.timeline);
    expect(Object.keys(ISSUE_SOURCE_LABELS)).toHaveLength(5);
  });

  it("搬运不新造结论：id / 标题 / 定位形状 / 目标文稿原样带来", () => {
    const [item] = issuesFromChecklist([checklistItem()]);
    expect(item?.id).toBe(checklistItem().id);
    expect(item?.source).toBe("cast");
    expect(item?.title).toBe("人物卡缺字段");
    expect(item?.locate).toBe("doc");
    expect(item?.relPath).toBe(REL);
    expect(item?.status).toBe("open");
  });

  it("给不出行号就老实存 0，不伪造第 1 行；能跳行的照样存行号", () => {
    const items = issuesFromChecklist([
      checklistItem({ line: 0, locate: "doc" }),
      checklistItem({ id: "slop|x|0", source: "slop", line: 12, locate: "line" })
    ]);
    expect(items.map((item) => item.line)).toEqual([0, 12]);
    const parsed = normalizeReviewIssueBook({
      version: 1,
      chapters: { [REL]: items }
    });
    expect(parsed).not.toBeNull();
    expect(chapterIssuesOf(parsed!, REL)[0]?.line).toBe(0);
  });

  it("去 AI 味的 matched 是原始命中词，不是「套话「X」」那种屏显标题", () => {
    const [item] = issuesFromChecklist([
      checklistItem({
        id: "slop|值得注意的是|0",
        source: "slop",
        matched: "值得注意的是",
        title: "套话「值得注意的是」",
        line: 7,
        locate: "line"
      })
    ]);
    expect(item?.source).toBe("ai-slop");
    expect(item?.matched).toBe("值得注意的是");
  });

  it("v1 档（没有那三格可选字段）照样读得回来，旧书清单不丢", () => {
    const legacy: ReviewIssue[] = issuesFromSlop([hit()]);
    const parsed = normalizeReviewIssueBook({
      version: 1,
      chapters: { [REL]: JSON.parse(JSON.stringify(legacy)) }
    });
    expect(parsed).not.toBeNull();
    expect(chapterIssuesOf(parsed!, REL)[0]?.title).toBeUndefined();
  });

  it("五套档能整份往返（含定位形状与目标文稿）", () => {
    const items = issuesFromChecklist([checklistItem()]);
    const book = withChapterIssues(emptyReviewIssueBook(), REL, items);
    expect(normalizeReviewIssueBook(JSON.parse(JSON.stringify(book)))).toEqual(book);
  });

  it("openSlopHitsOf 只交去 AI 味：人物卡 / 伏笔不许当套话递给模型", () => {
    const items: ReviewIssue[] = [
      ...issuesFromSlop([hit()]),
      ...issuesFromChecklist([checklistItem()]),
      ...issuesFromChecklist([
        checklistItem({ id: "foreshadow|row|x", source: "foreshadow", title: "「铜镜」待回收" })
      ])
    ];
    expect(items).toHaveLength(3);
    expect(openSlopHitsOf(items).map((h) => h.matched)).toEqual(["值得注意的是"]);
  });

  it("slopOpenCount 只数「去 AI 味 · 待修 · 有行号」，忽略与篇级读数都不算", () => {
    const items: ReviewIssue[] = [
      ...issuesFromSlop([hit()]),
      { ...issuesFromSlop([hit()])[0]!, id: "ignored", status: "ignored" },
      ...issuesFromChecklist([checklistItem()])
    ];
    expect(slopOpenCount(items)).toBe(1);
    expect(openCount(items)).toBe(2);
  });

  it("词表条目但 line 0（不该出现）也不进改写指令，免得让 AI 改第 0 行", () => {
    const item = { ...issuesFromSlop([hit()])[0]!, line: 0 };
    expect(openSlopHitsOf([item])).toEqual([]);
    expect(slopOpenCount([item])).toBe(0);
  });
});

/**
 * 两套状态名的翻译（W-04 收尾）。
 *
 * 交稿体检的「待修」和落盘清单的 open 是同一件事，只差一个字面量。以前两个面板各存各的，
 * 于是体检页标了忽略、去 AI 味页仍把那个词交给 AI 改。这里钉住翻译不丢格、不翻错向。
 */
describe("交稿问题清单 · 状态与交稿体检共用一份", () => {
  it("三格状态双向对得上：todo ↔ open，其余两格同名", () => {
    expect(CHECKLIST_TO_ISSUE).toEqual({ todo: "open", fixed: "fixed", ignored: "ignored" });
    expect(Object.keys(ISSUE_TO_CHECKLIST)).toHaveLength(3);
    for (const status of ["todo", "fixed", "ignored"] as const) {
      expect(ISSUE_TO_CHECKLIST[CHECKLIST_TO_ISSUE[status]]).toBe(status);
    }
  });

  it("体检里标过忽略的词表条目，交给 AI 改时不再被喂回去", () => {
    const item = issuesFromSlop([hit()])[0]!;
    const saved = markIssue([item], item.id, CHECKLIST_TO_ISSUE.ignored);
    expect(ISSUE_TO_CHECKLIST[saved[0]!.status]).toBe("ignored");
    expect(openSlopHitsOf(saved)).toEqual([]);
  });
});

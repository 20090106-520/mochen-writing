import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createBookDataHarness, type BookDataHarness } from "./book-data-test-harness";
import { resetBookDataFlushers } from "../composables/bookDataRegistry";
import { useBookStore } from "./useBookStore";
import { useSubmissionChecklistStore } from "./useSubmissionChecklistStore";
import { useReviewIssuesStore } from "./useReviewIssuesStore";
import type { ChecklistItem } from "../utils/submission-checklist";
import { issueIdOf, type ReviewIssueBook, type SlopLike } from "../utils/review-issues";

/**
 * 交稿问题清单的落盘接线（W-04 第一刀）。
 *
 * 与设定三本同一族要求：读的是**这本书**的文件、写的是**这本书**的文件、读不懂不许盖、
 * 写不下要说人话、换书不串台。差别只有一处：这份数据是全新的，没有旧版全局 localStorage
 * 版本，所以通路的迁移那一路一步都不该走。
 *
 * 复检合并的算法不在这里测（由 utils/review-issues.test.ts 钉），这里只管「哪一本书、哪一章」。
 */
const REL = "chapters/03-雨夜.md";

function hit(): SlopLike {
  return {
    line: 7,
    matched: "值得注意的是",
    strength: "strong",
    why: "总结式开场",
    excerpt: "…值得注意的是，他没回头…"
  };
}

/** 摆一份盘上已有的清单：另一章留了一条「已忽略」，用来验读回与不串台。 */
function bookJson(): string {
  const book: ReviewIssueBook = {
    version: 1,
    chapters: {
      "chapters/01-开局.md": [
        {
          id: "ai-slop\u001f总而言之\u001f…总而言之，走吧…",
          source: "ai-slop",
          line: 3,
          matched: "总而言之",
          strength: "strong",
          why: "公文腔",
          excerpt: "…总而言之，走吧…",
          status: "ignored"
        }
      ]
    }
  };
  return JSON.stringify(book);
}

let fx: BookDataHarness;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  fx = createBookDataHarness();
});

afterEach(() => {
  resetBookDataFlushers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("① 结论按章留在当前这本书里", () => {
  it("记一次体检：debounce 后写进 /book-a 的 review-issues，条目按章归位", async () => {
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    store.check(REL, [hit()]);
    expect(fx.writeBookData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:review-issues"]);
    const written = JSON.parse(fx.writes[0]!.json) as ReviewIssueBook;
    expect(Object.keys(written.chapters)).toEqual([REL]);
    expect(written.chapters[REL]?.[0]?.status).toBe("open");
    expect(store.openCountFor(REL)).toBe(1);
  });

  it("盘上已有的结论读得回来，再体检一次不会把别章的「已忽略」弄丢", async () => {
    fx.diskOf("/book-a").set("review-issues", bookJson());
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    expect(store.issuesFor("chapters/01-开局.md")[0]?.status).toBe("ignored");
    store.check(REL, [hit()]);
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    const written = JSON.parse(fx.writes.at(-1)!.json) as ReviewIssueBook;
    expect(Object.keys(written.chapters).sort()).toEqual(["chapters/01-开局.md", REL].sort());
    expect(store.issuesFor("chapters/01-开局.md")[0]?.status).toBe("ignored");
  });

  it("换书后是另一份：A 章的待修不带到 B", async () => {
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    store.check(REL, [hit()]);
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    await fx.switchBook("/book-b");
    expect(store.issuesFor(REL)).toEqual([]);
    expect(store.openCountFor(REL)).toBe(0);
    expect(fx.writes.every((w) => w.root === "/book-a")).toBe(true);
  });

  it("没有旧版全局键：localStorage 里摆什么都不会被迁进来", async () => {
    fx.storage.setItem("mochen.review-issues.v0", bookJson());
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    expect(store.data.chapters).toEqual({});
    expect(fx.storage.getItem("mochen.review-issues.v0")).not.toBeNull();
  });
});

describe("② 读不懂 / 写不下都不许假装存好了", () => {
  it("盘上是半截 JSON：停止写入，用户再点「忽略」也不许盖掉原来那份", async () => {
    fx.diskOf("/book-a").set("review-issues", '{"version":1,"chapters":{');
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    expect(store.saveError).toContain("读不懂");
    store.check(REL, [hit()]);
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writeBookData).not.toHaveBeenCalled();
    expect(fx.diskOf("/book-a").get("review-issues")).toBe('{"version":1,"chapters":{');
  });

  it("写盘失败留一句人话", async () => {
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    fx.failNextWrite("磁盘满了");
    store.check(REL, [hit()]);
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(store.saveError).toContain("磁盘满了");
  });

  it("标「忽略」之后落盘的是 ignored，下一次复检不会再弹回来", async () => {
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    store.check(REL, [hit()]);
    store.setStatus(REL, issueIdOf(hit()), "ignored");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    const written = JSON.parse(fx.writes.at(-1)!.json) as ReviewIssueBook;
    expect(written.chapters[REL]?.[0]?.status).toBe("ignored");
    store.check(REL, [hit()]);
    expect(store.openCountFor(REL)).toBe(0);
    expect(store.issuesFor(REL)[0]?.status).toBe("ignored");
  });
});

/**
 * 收齐本章五套检查（W-04 第二刀）。
 *
 * 这里不测 `buildSubmissionChecklist`（那是体检层的用例），只钉住 store 这一层的三件事：
 * 五套来源都落得进来、复检合并口径没被绕过、异步汇总期间换章不许把新章条目写到旧章名下。
 * 所以把 `load` 换成一份摆好的五套结论，不碰真盘。
 */
function fiveSources(): ChecklistItem[] {
  const base = {
    tone: "strong" as const,
    detail: "判据给出的说明",
    locate: "none" as const,
    relPath: "",
    line: 0,
    locateLabel: "有结果但无法定位"
  };
  return [
    {
      ...base,
      id: "slop|值得注意的是|0",
      source: "slop",
      title: "套话「值得注意的是」",
      matched: "值得注意的是",
      locate: "line",
      relPath: REL,
      line: 7,
      locateLabel: "第 7 行"
    },
    { ...base, id: "review|节奏|30", source: "review", title: "节奏读数 30" },
    {
      ...base,
      id: "cast|缺字段",
      source: "cast",
      title: "人物卡缺字段",
      locate: "doc",
      relPath: REL,
      locateLabel: "只能跳到这一章"
    },
    {
      ...base,
      id: "foreshadow|row|铜镜",
      source: "foreshadow",
      title: "「铜镜」待回收",
      locate: "doc",
      relPath: REL,
      locateLabel: "跳到伏笔文稿"
    },
    {
      ...base,
      id: "timeline|gap",
      source: "timeline",
      title: "时间线断档",
      locate: "doc",
      relPath: REL,
      locateLabel: "只能跳到这一章"
    }
  ];
}

describe("③ 收齐五套检查", () => {
  function stubLoad(items: ChecklistItem[], ownerKey?: string): void {
    const checklist = useSubmissionChecklistStore();
    const book = useBookStore();
    const owner = ownerKey ?? `${book.meta?.id ?? ""}\u0000${REL}`;
    vi.spyOn(checklist, "load").mockImplementation(async () => {
      checklist.items = items;
      checklist.ownerKey = owner;
    });
  }

  it("五套条目都按章落盘，来源各归各、篇级读数不伪造行号", async () => {
    await fx.switchBook("/book-a");
    stubLoad(fiveSources());
    const store = useReviewIssuesStore();
    await store.collect(REL, "值得注意的是，他走了。\n");
    expect(store.issuesFor(REL).map((item) => item.source)).toEqual([
      "ai-slop",
      "review",
      "cast",
      "foreshadow",
      "timeline"
    ]);
    expect(store.issuesFor(REL)[1]?.line).toBe(0);
    expect(store.openCountFor(REL)).toBe(5);
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => w.key)).toEqual(["review-issues"]);
  });

  it("复检合并口径不变：标过忽略的不弹回，改掉的自动落已修", async () => {
    await fx.switchBook("/book-a");
    stubLoad(fiveSources());
    const store = useReviewIssuesStore();
    await store.collect(REL, "稿子");
    store.setStatus(REL, "review|节奏|30", "ignored");
    stubLoad(fiveSources().filter((item) => item.id !== "cast|缺字段"));
    await store.collect(REL, "稿子");
    expect(store.issuesFor(REL).find((item) => item.id === "review|节奏|30")?.status).toBe(
      "ignored"
    );
    expect(store.issuesFor(REL).find((item) => item.id === "cast|缺字段")?.status).toBe("fixed");
    expect(store.openCountFor(REL)).toBe(3);
  });

  it("汇总期间换章：迟到的结果整批作废，不许写到旧章名下", async () => {
    await fx.switchBook("/book-a");
    stubLoad(fiveSources(), "别的书\u0000别的章");
    const store = useReviewIssuesStore();
    await store.collect(REL, "稿子");
    expect(store.issuesFor(REL)).toEqual([]);
  });
});

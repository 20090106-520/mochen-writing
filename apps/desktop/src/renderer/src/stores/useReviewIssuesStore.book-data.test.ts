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

function stubLoad(items: ChecklistItem[], ownerKey?: string): void {
  const checklist = useSubmissionChecklistStore();
  const book = useBookStore();
  const owner = ownerKey ?? `${book.meta?.id ?? ""}\u0000${REL}`;
  vi.spyOn(checklist, "load").mockImplementation(async () => {
    checklist.items = items;
    checklist.ownerKey = owner;
  });
}

describe("③ 收齐五套检查", () => {
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

/**
 * 交稿体检里直接标状态（W-04 收尾）。
 *
 * 体检面板打开时清单可能还是空的（作者没点过「收齐本章检查」）。这一组钉住：
 * ① 空清单点「忽略」也要在盘上留一条，不能点了等于没点；
 * ② 只标一条，不顺手把其余待修判成已修（那是 collect 的合并语义，别混进来）；
 * ③ 已收过的条目再标不追加第二条。
 */
describe("④ 交稿体检直接标状态", () => {
  it("清单还没收过：补一条并落定状态，换书再回来还是忽略", async () => {
    const store = useReviewIssuesStore();
    await fx.switchBook("/book-a");
    // 开书的读盘是异步的；等 canWrite 那道闸开了再改，否则 watcher 会跳过这次改动。
    await fx.settle();
    const item = fiveSources()[0]!;
    expect(store.issuesFor(REL)).toEqual([]);
    store.setStatusOfItem(REL, item, "ignored");

    const saved = store.issuesFor(REL);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.id).toBe(item.id);
    expect(saved[0]?.source).toBe("ai-slop");
    expect(saved[0]?.status).toBe("ignored");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:review-issues"]);
    expect((JSON.parse(fx.writes[0]!.json) as ReviewIssueBook).chapters[REL]?.[0]?.status).toBe(
      "ignored"
    );

    // 切到另一本书再切回来＝重开一次软件，状态由盘上读回，不该弹成待修。
    await fx.switchBook("/book-b");
    await fx.switchBook("/book-a");
    expect(store.issuesFor(REL)[0]?.status).toBe("ignored");
  });

  it("清单里已有别的待修：只改这一条，不替作者把其余判成已修", async () => {
    await fx.switchBook("/book-a");
    stubLoad(fiveSources());
    const store = useReviewIssuesStore();
    await store.collect(REL, "稿子");
    const before = store.openCountFor(REL);
    const item = fiveSources()[2]!;
    store.setStatusOfItem(REL, item, "fixed");
    expect(store.issuesFor(REL)).toHaveLength(5);
    expect(store.issuesFor(REL).find((entry) => entry.id === item.id)?.status).toBe("fixed");
    expect(store.openCountFor(REL)).toBe(before - 1);
  });

  it("已收过的条目再标：只改状态，不重复追加一条", async () => {
    await fx.switchBook("/book-a");
    stubLoad(fiveSources());
    const store = useReviewIssuesStore();
    await store.collect(REL, "稿子");
    const item = fiveSources()[0]!;
    store.setStatusOfItem(REL, item, "ignored");
    expect(store.issuesFor(REL)).toHaveLength(5);
    expect(store.issuesFor(REL).filter((entry) => entry.id === item.id)).toHaveLength(1);
    expect(store.issuesFor(REL)[0]?.status).toBe("ignored");
  });

  it("清单里那条带着旧行号：标状态时按当前结论刷新，别处一条不动", async () => {
    await fx.switchBook("/book-a");
    stubLoad(fiveSources());
    const store = useReviewIssuesStore();
    await store.collect(REL, "稿子");
    const shifted = {
      ...fiveSources()[0]!,
      line: 19,
      title: "套话「值得注意的是」（第 19 行）"
    };
    store.setStatusOfItem(REL, shifted, "fixed");
    const saved = store.issuesFor(REL)[0]!;
    expect(saved.line).toBe(19);
    expect(saved.title).toBe(shifted.title);
    expect(saved.status).toBe("fixed");
    expect(store.issuesFor(REL)).toHaveLength(5);
    expect(store.openCountFor(REL)).toBe(4);
  });
});

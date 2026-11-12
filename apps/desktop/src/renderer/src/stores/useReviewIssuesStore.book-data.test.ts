import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createBookDataHarness, type BookDataHarness } from "./book-data-test-harness";
import { resetBookDataFlushers } from "../composables/bookDataRegistry";
import { useReviewIssuesStore } from "./useReviewIssuesStore";
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DEFAULT_PERMISSION_MODE, type DocRef } from "@mochen/contracts";
import { createBookDataHarness, type BookDataHarness } from "./book-data-test-harness";
import { resetBookDataFlushers } from "../composables/bookDataRegistry";
import { useBookStore } from "./useBookStore";
import { useReviewIssuesStore } from "./useReviewIssuesStore";
import { useSubmissionChecklistStore } from "./useSubmissionChecklistStore";
import {
  ISSUE_TO_CHECKLIST,
  normalizeReviewIssueBook,
  openSlopHitsOf,
  type ReviewIssueBook
} from "../utils/review-issues";

/**
 * 「收齐本章检查」的真链路（2026-11-12）。
 *
 * 此前所有 collect 用例都把 `useSubmissionChecklistStore.load` spy 掉、直接摆一份五套结论。
 * 于是「三套台账异步读盘 → buildSubmissionChecklist → issuesFromChecklist → 落盘」这条
 * W-04 唯一新增的等待路径，一次都没被**连起来**跑过：判据各自有用例，接线各自有用例，
 * 中间那段没人验。这里一份 load 都不 mock——假盘里摆四类真实形状的文稿（都带 frontmatter），
 * 让窗口的 readDoc 真读一遍。
 *
 * 顺带把一个容易被「五套全接」四个字盖住的事实钉成断言：时间线核对比的是时间线文稿之间、
 * 人物卡的多数结论是全书级（chapter 为空），按章落盘的清单**只收点名到本章的条目**。
 * 这不是遗漏——体检面板页脚的 timelineNoteText / castNoteText 早就这么写了，落盘那栏的
 * 说明文案也跟着改成了同一口径。
 */
const A = "chapters/01-开局.md";
const CARD = "characters/阿岚.md";
const TIME = "timeline/年表.md";
const SEED = "foreshadows/铜镜.md";

/** 带 frontmatter 的稿子：词表命中在第 5 行（原始草稿口径，与编辑框一致）。 */
const DRAFT = "---\ntitle: 开局\n---\n\n值得注意的是，他走了。\n";
const DRAFT_SHIFTED = "---\ntitle: 开局\n---\n\n新加的一段。\n值得注意的是，他走了。\n";

const DOCS: DocRef[] = [
  { relPath: A, kind: "chapter", title: "开局" },
  { relPath: CARD, kind: "character", title: "阿岚" },
  { relPath: TIME, kind: "timeline", title: "年表" },
  { relPath: SEED, kind: "foreshadow", title: "铜镜" }
];

/** 四类文稿的真形状：frontmatter 里的字段就是各套判据实际读的那几个。 */
function seededTexts(): Map<string, string> {
  return new Map<string, string>([
    [A, DRAFT],
    [
      CARD,
      "---\ntitle: 阿岚\nvoice: [我向来如此]\nexit: chapters/99-不存在.md\n---\n\n阿岚的设定。\n"
    ],
    [TIME, "---\ntitle: 年表\ndate: 2026-02-30\n---\n\n三日后，潮信来。\n"],
    [
      SEED,
      `---\ntitle: 铜镜\nstatus: planted\nplanted: ${A}\nkeywords: [铜镜]\n---\n\n一面旧镜子。\n`
    ]
  ]);
}

let fx: BookDataHarness;
let texts: Map<string, string>;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  fx = createBookDataHarness();
  texts = seededTexts();
  // harness 只给了落盘那两枚 IPC；这里补上 readDoc，保留原两枚以免落盘用例失真。
  vi.stubGlobal("window", {
    mochen: {
      readBookData: fx.readBookData,
      writeBookData: fx.writeBookData,
      readDoc: async (relPath: string) => ({
        relPath,
        content: texts.get(relPath) ?? "",
        fingerprint: ""
      })
    }
  });
  const book = useBookStore();
  book.meta = {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: [A]
  };
  book.docs = [...DOCS];
  book.activeDocTab = A;
  book.draft = DRAFT;
});

afterEach(() => {
  resetBookDataFlushers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("收齐本章检查 · 不 mock 的三套台账", () => {
  it("一次 collect 走完真链路，结论按章落盘且盘上 JSON 读得回来", async () => {
    await fx.switchBook("/book-a");
    const store = useReviewIssuesStore();
    await store.collect(A, DRAFT);

    const items = store.issuesFor(A);
    expect(items.length).toBeGreaterThan(0);
    const sources = new Set(items.map((item) => item.source));
    expect(sources.has("ai-slop")).toBe(true);
    expect(sources.has("foreshadow")).toBe(true);
    // 去 AI 味按原始草稿逐行数（frontmatter 四行 + 空行 = 第 5 行），编辑框就是这个行号。
    expect(items.find((item) => item.source === "ai-slop")?.line).toBe(5);

    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:review-issues"]);
    const parsed = normalizeReviewIssueBook(
      JSON.parse(fx.writes[0]!.json) as unknown as ReviewIssueBook
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.chapters[A]).toEqual(items);
  });

  it("时间线 / 人物核对的全书级结论不进本章清单，但没被静默丢掉", async () => {
    await fx.switchBook("/book-a");
    const store = useReviewIssuesStore();
    await store.collect(A, DRAFT);
    const checklist = useSubmissionChecklistStore();

    // 时间线比的是时间线文稿之间（relPaths 指向年表，不指向章节）；人物卡的 C4 指空是 chapter=""。
    expect(checklist.items.some((item) => item.source === "timeline")).toBe(false);
    expect(checklist.items.some((item) => item.source === "cast")).toBe(false);
    expect(store.issuesFor(A).some((item) => item.source === "timeline")).toBe(false);
    // 页脚的两个计数仍在：全书级结论去各自面板看，不是查了不报。
    expect(checklist.timelineOther).toBeGreaterThan(0);
    expect(checklist.cardCount).toBe(1);
  });

  it("前面插一段再复检：词表条目身份不漂、行号刷新、忽略是终态", async () => {
    await fx.switchBook("/book-a");
    const store = useReviewIssuesStore();
    await store.collect(A, DRAFT);
    const before = store.issuesFor(A).find((item) => item.source === "ai-slop");
    expect(before).toBeDefined();
    store.setStatus(A, before!.id, "ignored");

    const book = useBookStore();
    book.draft = DRAFT_SHIFTED;
    texts.set(A, DRAFT_SHIFTED);
    await store.collect(A, DRAFT_SHIFTED);

    const after = store.issuesFor(A).find((item) => item.id === before!.id);
    expect(after?.status).toBe("ignored");
    expect(after?.line).toBe(6);
    expect(store.issuesFor(A).filter((item) => item.source === "ai-slop")).toHaveLength(1);
  });

  /**
   * 两套状态并存的旧毛病在这里真跑一遍：以前体检页标了「忽略」只改内存，
   * 「交给 AI 改」仍把那个词喂回模型。现在标一次，两条通路都得认。
   */
  it("体检页标「忽略」→ 交给 AI 改的词表不再含它，体检页也读回同一状态", async () => {
    await fx.switchBook("/book-a");
    const store = useReviewIssuesStore();
    await store.collect(A, DRAFT);
    const checklist = useSubmissionChecklistStore();
    const slopItem = checklist.items.find((item) => item.source === "slop");
    expect(slopItem).toBeDefined();
    expect(openSlopHitsOf(store.issuesFor(A)).some((h) => h.matched === "值得注意的是")).toBe(true);

    store.setStatusOfItem(A, slopItem!, "ignored");

    const saved = store.issuesFor(A).find((item) => item.id === slopItem!.id);
    expect(saved).toBeDefined();
    expect(ISSUE_TO_CHECKLIST[saved!.status]).toBe("ignored");
    expect(openSlopHitsOf(store.issuesFor(A)).some((h) => h.matched === "值得注意的是")).toBe(
      false
    );
    // 再收齐一次也不该把作者拍过的板弹回待修。
    await store.collect(A, DRAFT);
    expect(store.issuesFor(A).find((item) => item.id === slopItem!.id)?.status).toBe("ignored");
  });
});

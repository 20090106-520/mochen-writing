import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBookStore } from "./useBookStore";
import { useAutoCheckupStore } from "./useAutoCheckupStore";

/**
 * 写后自动体检的状态机（2026-11-17 spec 阶段 B6）。
 *
 * 判据本身由 utils/auto-checkup.test.ts 钉；这里只钉三件事：
 * ① 只读被点名的那几篇（去重、篇名取自 book.docs）；
 * ② 同一线程在跑就跳过，不让两轮体检互相覆盖；
 * ③ 「先不管」只关这一轮，换轮 clear 之后照常显示。
 */
const DOCS = [
  { relPath: "chapters/01-雨夜.md", kind: "chapter" as const, title: "第一章 雨夜" },
  { relPath: "chapters/02-晴.md", kind: "chapter" as const, title: "第二章 晴" }
];

let readDoc: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setActivePinia(createPinia());
  readDoc = vi.fn(async (relPath: string) => ({
    content: relPath.includes("雨夜") ? "他走了。。屋里静下来。" : "他推门进来，，把伞靠在墙边。",
    fingerprint: "fp"
  }));
  vi.stubGlobal("window", { mochen: { readDoc } });
  useBookStore().docs = [...DOCS];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("只读这一轮写过的篇", () => {
  it("去重后逐篇读，结果按本线程归类，篇名取自 book.docs", async () => {
    const store = useAutoCheckupStore();
    await store.run("chapters/01-雨夜.md", ["chapters/01-雨夜.md", "chapters/01-雨夜.md"]);

    expect(readDoc).toHaveBeenCalledTimes(1);
    const findings = store.findingsOf("chapters/01-雨夜.md");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe("第一章 雨夜");
    expect(findings[0]?.punctuation).toHaveLength(1);
  });

  it("读不到的篇跳过，别的篇照常出结论", async () => {
    readDoc.mockImplementationOnce(async () => {
      throw new Error("磁盘忙");
    });
    const store = useAutoCheckupStore();
    await store.run("t", ["chapters/01-雨夜.md", "chapters/02-晴.md"]);

    expect(store.findingsOf("t")).toHaveLength(1);
    expect(store.findingsOf("t")[0]?.docRelPath).toBe("chapters/02-晴.md");
  });

  it("跑着的时候又写一篇：不丢，跑完接着验，结果按篇合并", async () => {
    let release: (() => void) | undefined;
    readDoc.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ content: "他走了。。屋里静下来。", fingerprint: "fp" });
      })
    );
    const store = useAutoCheckupStore();
    const first = store.run("t", ["chapters/01-雨夜.md"]);
    await store.run("t", ["chapters/02-晴.md"]);
    expect(readDoc).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    // 排队的那一篇在 finally 里接力，等它跑完。
    for (let attempt = 0; attempt < 40 && readDoc.mock.calls.length < 2; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readDoc).toHaveBeenCalledTimes(2);
    expect(
      store
        .findingsOf("t")
        .map((one) => one.docRelPath)
        .sort()
    ).toEqual(["chapters/01-雨夜.md", "chapters/02-晴.md"]);
  });
});

describe("关掉与换轮", () => {
  it("「先不管」只关这一轮；clear 之后连结果一起清空", async () => {
    const store = useAutoCheckupStore();
    await store.run("t", ["chapters/01-雨夜.md"]);
    expect(store.findingsOf("t")).toHaveLength(1);

    store.dismiss("t");
    expect(store.findingsOf("t")).toEqual([]);

    store.clear("t");
    await store.run("t", ["chapters/01-雨夜.md"]);
    expect(store.findingsOf("t")).toHaveLength(1);
  });
});

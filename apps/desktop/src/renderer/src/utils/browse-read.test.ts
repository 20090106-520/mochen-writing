import { beforeEach, describe, expect, it } from "vitest";
import type { DocContent } from "@mochen/contracts";
import {
  browseFailureNotice,
  readBrowseBody,
  resetBrowseReadGates,
  type BrowseReadIO
} from "./browse-read";

/**
 * 右栏「浏览」读盘这条路的**三道闸**（2026-10-09 扫描总单 P1-9），判定抽在 utils/browse-read。
 *
 * store 那边（`useBookStore.browse.test.ts`）钉的是「接线」：三张表与 notice 有没有真的被摆好。
 * 这一份钉的是「判定本身」，而且钉的是那几条**只能在时序上复现**的规矩：
 * ① 世代号作废在途回包；② 在途集合挡住连点；③ 抛错时理由上屏、且「在途」在知道结果那一刻就摘。
 * 三条全都在这里逐条对着假 IO 验，起 store 反而看不见——那些是状态代理的事。
 */
type Calls = {
  read: string[];
  clearFailure: string[];
  result: { relPath: string; content: string }[];
  failure: { relPath: string; reason: string }[];
};

/** 一枚可编程的读盘假身：默认挂住不回来，由用例点火；四张表只记「被叫过几次、叫什么」。 */
function harness() {
  const calls: Calls = { read: [], clearFailure: [], result: [], failure: [] };
  let release!: (value: DocContent) => void;
  let reject!: (error: unknown) => void;
  let promise = new Promise<DocContent>((resolve, deny) => {
    release = resolve;
    reject = deny;
  });
  // 假身按 `BrowseReadIO` 声明（不是 `vi.fn`）：调用记录全在 `calls` 里，
  // 用例要改某个闸的答案时（`io.hasCached = ...`）拿到的就是接口本身那个签名。
  const io: BrowseReadIO = {
    hasCached: () => false,
    isOpen: () => true,
    read: (relPath: string) => {
      calls.read.push(relPath);
      promise = new Promise<DocContent>((resolve, deny) => {
        release = resolve;
        reject = deny;
      });
      return promise;
    },
    clearFailure: (relPath: string) => void calls.clearFailure.push(relPath),
    onResult: (relPath: string, content: string) => void calls.result.push({ relPath, content }),
    onFailure: (relPath: string, reason: string) => void calls.failure.push({ relPath, reason })
  };
  return { io, calls, settle: () => ({ release, reject, promise }) };
}

/** 每条用例都从干净的闸门开始：世代号与在途集合是模块级记账，不能串到下一例。 */
beforeEach(() => resetBrowseReadGates());

describe("browse-read · 闸② 在途集合", () => {
  it("缓存里已有正文：一个字都不读", () => {
    const { io, calls } = harness();
    io.hasCached = () => true;
    readBrowseBody(io, "chapters/01.md");
    expect(calls.read).toEqual([]);
    expect(calls.clearFailure).toEqual([]);
  });

  it("在途时连点同一格：只发一次读盘", () => {
    const { io, calls } = harness();
    readBrowseBody(io, "chapters/01.md");
    readBrowseBody(io, "chapters/01.md");
    readBrowseBody(io, "chapters/01.md");
    expect(calls.read).toEqual(["chapters/01.md"]);
  });

  it("换书把在途记账清干净：同一 relPath 在下一本书能重新读", () => {
    const { io, calls } = harness();
    readBrowseBody(io, "chapters/01.md");
    resetBrowseReadGates();
    readBrowseBody(io, "chapters/01.md");
    expect(calls.read).toEqual(["chapters/01.md", "chapters/01.md"]);
  });
});

describe("browse-read · 闸③ 失败可见与重试", () => {
  it("读不动：理由上屏、且这一格不留「假正文」", async () => {
    const { io, calls, settle } = harness();
    readBrowseBody(io, "chapters/01.md");
    const { reject, promise } = settle();
    reject(new Error("EBUSY: resource busy or locked, read '01.md'"));
    await promise.catch(() => undefined);
    expect(calls.result).toEqual([]);
    expect(calls.failure).toHaveLength(1);
    expect(calls.failure[0]?.reason).toContain("EBUSY");
  });

  it("新一轮尝试先把上一轮的失败理由抹掉（否则两句混在一起）", () => {
    const { io, calls } = harness();
    readBrowseBody(io, "chapters/01.md");
    expect(calls.clearFailure).toEqual(["chapters/01.md"]);
  });

  it("失败之后**立刻**再点能真的重读：在途标记在知道结果那一刻就摘，不等 .finally", async () => {
    const { io, calls, settle } = harness();
    readBrowseBody(io, "chapters/01.md");
    const first = settle();
    first.reject(new Error("读不动"));
    await first.promise.catch(() => undefined);
    readBrowseBody(io, "chapters/01.md");
    expect(calls.read).toHaveLength(2);
  });

  it("成功之后同样摘标记：这一格之后仍可再走一次读盘", async () => {
    const { io, calls, settle } = harness();
    readBrowseBody(io, "chapters/01.md");
    const first = settle();
    first.release({ relPath: "chapters/01.md", content: "正文\n", fingerprint: "fp" });
    await first.promise;
    // 这里**不**换书：这一例要钉的就是「成功那一刻有没有把在途标记摘掉」，
    // 摘不干净的话第二点会被自己上一次成功挡住。
    readBrowseBody(io, "chapters/01.md");
    expect(calls.read).toHaveLength(2);
    expect(calls.result).toEqual([{ relPath: "chapters/01.md", content: "正文\n" }]);
  });

  it("回包处理自己抛错：在途标记不许漏，那句拒绝也不许甩到进程上", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => void rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const { io, calls, settle } = harness();
      io.onResult = () => {
        throw new Error("状态代理层炸了");
      };
      readBrowseBody(io, "chapters/01.md");
      const first = settle();
      first.release({ relPath: "chapters/01.md", content: "正文\n", fingerprint: "fp" });
      await first.promise.catch(() => undefined);
      // unhandledRejection 在微任务队列排空后的下一个宏任务才发出去：等一拍才验得准。
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
      readBrowseBody(io, "chapters/01.md");
      expect(calls.read).toHaveLength(2);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

describe("browse-read · 闸① 世代号", () => {
  it("换书之后，上一本书那次迟到的回包一个字都不许落地", async () => {
    const { io, calls, settle } = harness();
    readBrowseBody(io, "chapters/01.md");
    const pending = settle();
    resetBrowseReadGates();
    pending.release({ relPath: "chapters/01.md", content: "A 书的正文\n", fingerprint: "fp-a" });
    await pending.promise;
    expect(calls.result).toEqual([]);
  });

  it("回包时那一格已经关掉：不留缓存条目", async () => {
    const { io, calls, settle } = harness();
    readBrowseBody(io, "chapters/01.md");
    io.isOpen = () => false;
    const pending = settle();
    pending.release({ relPath: "chapters/01.md", content: "正文\n", fingerprint: "fp" });
    await pending.promise;
    expect(calls.result).toEqual([]);
  });

  it("换书之后迟到的**失败**回包也不许把理由写进新书", async () => {
    const { io, calls, settle } = harness();
    readBrowseBody(io, "chapters/01.md");
    const pending = settle();
    resetBrowseReadGates();
    pending.reject(new Error("上一本书的错"));
    await pending.promise.catch(() => undefined);
    expect(calls.failure).toEqual([]);
  });
});

describe("browse-read · 屏上那句话", () => {
  it("点名是哪一格、为什么读不动", () => {
    expect(browseFailureNotice("chapters/01.md", "EBUSY")).toBe(
      "没能读到正文：chapters/01.md（EBUSY）"
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BookOpenResult } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";
import {
  createBookApi,
  DRAFT_A,
  draftBook,
  stubBookWindow,
  type BookApiFixture
} from "./book-draft-fixture";

/**
 * 右栏「浏览」那一格的读盘（2026-10-09 全仓扫描 P1-9）。
 *
 * 旧写法是 `void window.mochen.readDoc(relPath).then(...)` 一句话，三处塌：
 * ① 没有 catch：IPC 抛错时这一格**永久空着**，而且屏幕上一个字都不说；
 * ② 没有世代令牌：书 A 那次慢回包会在换到书 B 之后按同一个 relPath 写进 B 的缓存
 *    （两本书同名文稿太常见了，`chapters/01.md` 这种键根本不带书标识）；
 * ③ 没有在途标记：连点同一格会为同一篇发好几次读盘。
 *
 * 对照已核的现成写法：`openDocTab` 那一路有 `docLoadToken`（中栏不会停在错的那一篇），
 * 失败理由一律走 `failureReasonOf` 上屏——模式在仓里已建立，只是 browse 这条路没接。
 */
let fx: BookApiFixture;
let store: ReturnType<typeof useBookStore>;

/** 一枚能由用例点火的读盘：默认挂住不回来，点火才落。 */
function deferredRead(content: string) {
  let release!: (value: { relPath: string; content: string; fingerprint: string }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ relPath: string; content: string; fingerprint: string }>(
    (resolve, deny) => {
      release = resolve;
      reject = deny;
    }
  );
  return { promise, release, reject, content };
}

const refA = { relPath: DRAFT_A, kind: "chapter" as const, title: "开局" };

beforeEach(() => {
  setActivePinia(createPinia());
  fx = createBookApi();
  stubBookWindow(fx);
  store = useBookStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBookStore · 浏览读盘", () => {
  it("读盘失败：理由上屏，且缓存里不许留一格空的「假正文」", async () => {
    const pending = deferredRead("不该被用到");
    fx.readDoc.mockReturnValueOnce(pending.promise);
    store.applyOpened(draftBook);
    store.notice = "";

    store.browse(refA);
    pending.reject(new Error("EBUSY: resource busy or locked, read '01-a.md'"));
    await pending.promise.catch(() => undefined);

    expect(store.notice).toContain("没能读到正文");
    expect(store.notice).toContain("EBUSY");
    expect(store.browseContents[DRAFT_A]).toBeUndefined();
  });

  it("失败之后重新浏览同一格会真的再读一次（不是永久空格）", async () => {
    const first = deferredRead("x");
    fx.readDoc.mockReturnValueOnce(first.promise);
    store.applyOpened(draftBook);

    store.browse(refA);
    first.reject(new Error("EBUSY: 读不动"));
    await first.promise.catch(() => undefined);
    expect(fx.readDoc).toHaveBeenCalledTimes(1);

    const second = deferredRead("回来的正文\n");
    fx.readDoc.mockReturnValueOnce(second.promise);
    store.browse(refA);
    second.release({ relPath: DRAFT_A, content: "回来的正文\n", fingerprint: "fp" });
    await second.promise;

    expect(fx.readDoc).toHaveBeenCalledTimes(2);
    expect(store.browseContents[DRAFT_A]).toBe("回来的正文\n");
  });

  it("换书之后，上一本书的在途回包一个字都不许落进新书的缓存", async () => {
    const pending = deferredRead("A 书的正文\n");
    fx.readDoc.mockReturnValueOnce(pending.promise);
    store.applyOpened(draftBook);
    store.browse(refA);

    // 换到另一本书：relPath 完全相同，只有 rootPath 与内容不同。
    const other: BookOpenResult = { ...draftBook, rootPath: "/other-book" };
    store.applyOpened(other);
    pending.release({ relPath: DRAFT_A, content: "A 书的正文\n", fingerprint: "fp-a" });
    await pending.promise;

    expect(store.browseContents[DRAFT_A]).toBeUndefined();
    expect(store.rootPath).toBe("/other-book");
  });

  it("两本书同名文稿都在浏览中：旧书那次慢回包不许盖掉新书已经落地的正文", async () => {
    // 上一例只证明「新书没开那一格时不写」；这一例才是 P1-9 的原形——
    // 新书里**同样打开了**这一格（`chapters/01.md` 这种 relPath 两本书都有），
    // 此时标签检查放行，只有世代号能挡住 A 书那次迟到的回包。
    const readA = deferredRead("A 书的正文\n");
    const readB = deferredRead("B 书的正文\n");
    fx.readDoc.mockReturnValueOnce(readA.promise);
    store.applyOpened(draftBook);
    store.browse(refA);

    fx.readDoc.mockReturnValueOnce(readB.promise);
    store.applyOpened({ ...draftBook, rootPath: "/other-book" });
    store.browse(refA);
    expect(fx.readDoc).toHaveBeenCalledTimes(2);

    readB.release({ relPath: DRAFT_A, content: "B 书的正文\n", fingerprint: "fp-b" });
    await readB.promise;
    expect(store.browseContents[DRAFT_A]).toBe("B 书的正文\n");

    readA.release({ relPath: DRAFT_A, content: "A 书的正文\n", fingerprint: "fp-a" });
    await readA.promise;
    expect(store.browseContents[DRAFT_A]).toBe("B 书的正文\n");
  });

  it("同一格在途时连点浏览，不再为同一篇发第二次读盘", async () => {
    const pending = deferredRead("正文\n");
    fx.readDoc.mockReturnValueOnce(pending.promise);
    store.applyOpened(draftBook);

    store.browse(refA);
    store.browse(refA);
    store.browse(refA);

    expect(fx.readDoc).toHaveBeenCalledTimes(1);
    pending.release({ relPath: DRAFT_A, content: "正文\n", fingerprint: "fp" });
    await pending.promise;
  });

  it("浏览中途关掉那一格：回包落地后不许留下缓存条目", async () => {
    const pending = deferredRead("正文\n");
    fx.readDoc.mockReturnValueOnce(pending.promise);
    store.applyOpened(draftBook);

    store.browse(refA);
    store.closeBrowse(DRAFT_A);
    pending.release({ relPath: DRAFT_A, content: "正文\n", fingerprint: "fp" });
    await pending.promise;

    expect(store.browseContents[DRAFT_A]).toBeUndefined();
  });

  it("读失败的那一格自己带着理由：界面才换得出「读不动」而不是「正在读取…」", async () => {
    const pending = deferredRead("不该被用到");
    fx.readDoc.mockReturnValueOnce(pending.promise);
    store.applyOpened(draftBook);

    store.browse(refA);
    pending.reject(new Error("EBUSY: resource busy or locked, read '01-a.md'"));
    await pending.promise.catch(() => undefined);

    expect(store.browseErrors[DRAFT_A]).toContain("EBUSY");
  });

  it("读成功之后那一格不留失败理由（否则好结果底下还压着一句谎）", async () => {
    const pending = deferredRead("正文\n");
    fx.readDoc.mockReturnValueOnce(pending.promise);
    store.applyOpened(draftBook);

    store.browse(refA);
    pending.release({ relPath: DRAFT_A, content: "正文\n", fingerprint: "fp" });
    await pending.promise;

    expect(store.browseContents[DRAFT_A]).toBe("正文\n");
    expect(store.browseErrors[DRAFT_A]).toBeUndefined();
  });

  it("换书把上一本书那一格的失败理由一起清掉", async () => {
    const pending = deferredRead("x");
    fx.readDoc.mockReturnValueOnce(pending.promise);
    store.applyOpened(draftBook);
    store.browse(refA);
    pending.reject(new Error("EBUSY: 读不动"));
    await pending.promise.catch(() => undefined);
    expect(store.browseErrors[DRAFT_A]).toContain("EBUSY");

    store.applyOpened({ ...draftBook, rootPath: "/other-book" });

    expect(store.browseErrors[DRAFT_A]).toBeUndefined();
  });
});

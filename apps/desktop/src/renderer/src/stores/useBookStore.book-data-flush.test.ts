import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BookCreateResult } from "@mochen/contracts";
import {
  createBookApi,
  draftBook,
  stubBookWindow,
  type BookApiFixture
} from "./book-draft-fixture";
import { resetBookDataFlushers, registerBookDataFlusher } from "../composables/bookDataRegistry";
import { useBookStore } from "./useBookStore";

/**
 * 换书那道闸门的**接线**（2026-10-09 扫描总单 P0-7）。
 *
 * 闸门本体（`bookDataRegistry`）与通路本体（`useBookFileData`）各自有用例钉着；
 * 这里只管一件事：`useBookStore` 那三条会换书的通路（openBook / createBook / 退出兜底）
 * 有没有**真的**在跑那次 IPC 之前把设定交回上一本。顺序错了，测试就会看到 `["open", "flush"]`——
 * 而那时那一笔已经落进新书的文件里了，这正是这一波要治的串台。
 */

let fx: BookApiFixture;
let order: string[];

beforeEach(() => {
  setActivePinia(createPinia());
  fx = createBookApi();
  stubBookWindow(fx);
  order = [];
  vi.mocked(fx.api.openBook).mockImplementation(async () => {
    order.push("open");
    return draftBook;
  });
});

afterEach(() => {
  resetBookDataFlushers();
  vi.unstubAllGlobals();
});

function failingFlusher(label: string) {
  registerBookDataFlusher("notes", async () => {
    order.push(label);
    return false;
  });
}

describe("换书前的设定闸门", () => {
  it("openBook：先 flush 再发那一次 IPC，且书照样打开（闸门不拦人）", async () => {
    failingFlusher("flush");
    const store = useBookStore();
    await store.openBook("/book");
    expect(order).toEqual(["flush", "open"]);
    expect(store.rootPath).toBe("/book");
    expect(store.meta?.title).toBe("深渊之下");
  });

  it("openBook：没落成时提示点名是哪份设定，落成了就一句正常话", async () => {
    failingFlusher("flush");
    const store = useBookStore();
    await store.openBook("/book");
    expect(store.notice).toContain("深渊之下");
    expect(store.notice).toContain("笔记");

    resetBookDataFlushers();
    registerBookDataFlusher("notes", async () => true);
    await store.openBook("/book");
    expect(store.notice).toBe("已打开《深渊之下》");
  });

  it("createBook：新书落地前同样先 flush 上一本", async () => {
    failingFlusher("flush");
    const created: BookCreateResult = { ok: true, book: draftBook };
    fx.createBook.mockImplementation(async () => {
      order.push("create");
      return created;
    });
    const store = useBookStore();
    expect(await store.createBook("/dir", "新书")).toBe(true);
    expect(order).toEqual(["flush", "create"]);
    expect(store.notice).toContain("笔记");
  });

  it("退出兜底也把设定跑一遍（正文落了盘而笔记还挂着，等于白兜）", async () => {
    failingFlusher("flush");
    const store = useBookStore();
    await store.openBook("/book");
    order = [];
    expect(await store.flushAllForQuit()).toEqual({ ok: true });
    expect(order).toContain("flush");
  });
});

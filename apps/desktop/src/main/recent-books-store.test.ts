import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@mochen/contracts";
import {
  MAX_RECENT_BOOKS,
  createRecentBooksStore,
  registerRecentBooksIpc
} from "./recent-books-store.js";
import { atomicFsBrokenAt } from "./atomic-write-fs-fixture.js";
import { trustedRendererEvent } from "./ipc-trust-fixture.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-recent-books-"));
});
afterEach(async () => {
  vi.useRealTimers();
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
});

describe("recentBooksStore", () => {
  it("没有落盘文件时给空清单", async () => {
    await expect(createRecentBooksStore({ dir }).list()).resolves.toEqual({ books: [] });
  });

  it("touch 落成 recent-books.json，按最近打开倒序读回", async () => {
    vi.useFakeTimers();
    const store = createRecentBooksStore({ dir });
    vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
    await store.touch("/books/a", "旧书");
    vi.setSystemTime(new Date("2026-10-21T11:00:00.000Z"));
    await store.touch("/books/b", "新书");

    const snapshot = await store.list();
    expect(snapshot.books.map((book) => book.title)).toEqual(["新书", "旧书"]);

    const raw = JSON.parse(await readFile(path.join(dir, "recent-books.json"), "utf8"));
    expect(raw.books[0].rootPath).toBe("/books/b");
  });

  it("同一本书重复打开只留一条：时间刷新并置顶（Windows 上大小写/斜杠不同也算同一本）", async () => {
    vi.useFakeTimers();
    const store = createRecentBooksStore({ dir });
    vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
    await store.touch("C:\\Books\\Abyss", "深渊");
    vi.setSystemTime(new Date("2026-10-21T11:00:00.000Z"));
    await store.touch("C:\\Books\\Other", "别的");
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    await store.touch("c:/books/abyss/", "深渊");

    const snapshot = await store.list();
    expect(snapshot.books).toHaveLength(2);
    expect(snapshot.books[0]?.title).toBe("深渊");
    expect(snapshot.books[1]?.title).toBe("别的");
  });

  it("书名空白时退回目录名，不记一条没有名字的作品", async () => {
    const store = createRecentBooksStore({ dir });
    await store.touch(path.join(dir, "无名之书"), "   ");
    const snapshot = await store.list();
    expect(snapshot.books[0]?.title).toBe("无名之书");
  });

  it("forget 只划掉清单条目，绝不删盘上的书目录", async () => {
    const bookDir = path.join(dir, "still-here");
    await mkdir(bookDir, { recursive: true });
    const store = createRecentBooksStore({ dir });
    await store.touch(bookDir, "还在");

    const snapshot = await store.forget(bookDir);
    expect(snapshot.books).toEqual([]);
    // 目录仍在：作品库移除是「不看了」，不是「删了」。
    await expect(stat(bookDir)).resolves.toBeTruthy();
  });

  it("盘上 JSON 损坏时退空清单，不挡开书", async () => {
    await writeFile(path.join(dir, "recent-books.json"), "{ 不是 JSON", "utf8");
    await expect(createRecentBooksStore({ dir }).list()).resolves.toEqual({ books: [] });
  });

  it("清单超过上限时按最久未打开淘汰，只影响清单", async () => {
    const books = Array.from({ length: MAX_RECENT_BOOKS + 3 }, (_, index) => ({
      rootPath: `/books/${index}`,
      title: `书${index}`,
      lastOpenedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString()
    }));
    await writeFile(path.join(dir, "recent-books.json"), JSON.stringify({ books }), "utf8");

    const snapshot = await createRecentBooksStore({ dir }).list();
    expect(snapshot.books).toHaveLength(MAX_RECENT_BOOKS);
    expect(snapshot.books[0]?.title).toBe(`书${MAX_RECENT_BOOKS + 2}`);
  });

  it("写盘失败不抛：记不住「最近打开」不能把开书那条链拖失败", async () => {
    const broken = atomicFsBrokenAt("writeFile", "盘满");
    const store = createRecentBooksStore({ dir, fs: broken.fs });
    await expect(store.touch("/books/a", "甲")).resolves.toBeUndefined();
  });

  it("注册的两条通道：recent 无参返回清单，forget 递书根并回移除后的清单", async () => {
    const store = createRecentBooksStore({ dir });
    await store.touch("/books/a", "甲");
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerRecentBooksIpc((channel, fn) => handlers.set(channel, fn), store);

    const recent = await handlers.get(IPC_CHANNELS.bookRecent)?.(trustedRendererEvent());
    expect(recent).toEqual({ books: [expect.objectContaining({ title: "甲" })] });

    const after = await handlers.get(IPC_CHANNELS.bookForget)?.(trustedRendererEvent(), "/books/a");
    expect(after).toEqual({ books: [] });
  });
});

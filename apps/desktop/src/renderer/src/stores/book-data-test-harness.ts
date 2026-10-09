import { vi, type Mock } from "vitest";
import { nextTick } from "vue";
import type { BookDataKey, BookDataReadResult, BookDataWriteResult } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";
import type { BibleEntry } from "./useStoryBibleStore";

/**
 * 设定落盘（P0-7）在 store 层的共用夹具。
 *
 * 三本 store（笔记 / 故事圣经 / 写作目标）要钉的是同一族事实：读的是**这本书**的文件、
 * 写的是**这本书**的文件、写失败要说话、旧的全局 localStorage 键只在盘上没东西时才迁一次。
 * 每本各抄一份假盘就是第四份实现（铁律 6），所以假盘、假 localStorage 与「换书」都收在这里。
 *
 * `switchBook` 刻意同时改两处：假主进程视角的当前书（`currentRoot`）与渲染层的 `rootPath`。
 * 只改后者就测不出「换书前没 flush 会把上一本的改动写进新书」这一族串台。
 */

export class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.values.set(k, v);
  }
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

export type WriteRecord = { root: string; key: BookDataKey; json: string };

export type BookDataHarness = {
  storage: MemoryStorage;
  writes: WriteRecord[];
  /** 假盘：`root -> 键 -> 内容`。用例直接摆它，等价于「这本书的目录里已有那份文件」。 */
  diskOf(root: string): Map<BookDataKey, string>;
  readBookData: Mock<(key: BookDataKey) => Promise<BookDataReadResult>>;
  writeBookData: Mock<(key: BookDataKey, json: string) => Promise<BookDataWriteResult>>;
  /** 下一次写盘失败（返回主进程那档 `write-failed`）。 */
  failNextWrite(message: string): void;
  /** 换书：假主进程与渲染层一起改；传 null 等于没开书。 */
  switchBook(root: string | null): Promise<void>;
  /** 等一串微任务（通路里全是 await，光 nextTick 不够）。 */
  settle(): Promise<void>;
  reset(): void;
};

/** 摆 story-bible 那份盘：只写要改的格子，其余补齐必填字段，写了的格子原样带上。 */
export function bibleEntriesJson(items: Partial<BibleEntry>[]): string {
  return JSON.stringify(
    items.map((e, i) => ({
      id: e.id ?? `b${i}`,
      type: e.type ?? "character",
      title: e.title ?? "条目",
      content: e.content ?? "",
      createdAt: e.createdAt ?? 1,
      updatedAt: e.updatedAt ?? 1,
      tags: e.tags ?? [],
      ...e
    }))
  );
}

/** 从写盘记录里读回最后一次写的条目（两份 bible 用例共用，避免各写一份解析）。 */
export function writtenBibleEntries(writes: WriteRecord[]): BibleEntry[] {
  const last = writes.at(-1);
  return last === undefined ? [] : (JSON.parse(last.json) as BibleEntry[]);
}

export function createBookDataHarness(
  initialStorage: Record<string, string> = {}
): BookDataHarness {
  const storage = new MemoryStorage(initialStorage);
  const disk = new Map<string, Map<BookDataKey, string>>();
  const writes: WriteRecord[] = [];
  let currentRoot: string | null = null;
  let failNext: string | null = null;

  function diskOf(root: string): Map<BookDataKey, string> {
    let box = disk.get(root);
    if (box === undefined) {
      box = new Map<BookDataKey, string>();
      disk.set(root, box);
    }
    return box;
  }

  const readBookData = vi.fn(async (key: BookDataKey): Promise<BookDataReadResult> => {
    if (currentRoot === null)
      return { ok: false, reason: "no-book", message: "还没打开作品目录。" };
    return { ok: true, json: diskOf(currentRoot).get(key) ?? null };
  });

  const writeBookData = vi.fn(
    async (key: BookDataKey, json: string): Promise<BookDataWriteResult> => {
      if (failNext !== null) {
        const message = failNext;
        failNext = null;
        return { ok: false, reason: "write-failed", message };
      }
      if (currentRoot === null) {
        return { ok: false, reason: "no-book", message: "还没打开作品目录。" };
      }
      diskOf(currentRoot).set(key, json);
      writes.push({ root: currentRoot, key, json });
      return { ok: true };
    }
  );

  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { mochen: { readBookData, writeBookData } });

  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await nextTick();
  }

  return {
    storage,
    writes,
    diskOf,
    readBookData,
    writeBookData,
    failNextWrite(message: string): void {
      failNext = message;
    },
    async switchBook(root: string | null): Promise<void> {
      currentRoot = root;
      useBookStore().rootPath = root;
      await settle();
    },
    settle,
    reset(): void {
      writes.length = 0;
      disk.clear();
      storage.clear();
      readBookData.mockClear();
      writeBookData.mockClear();
    }
  };
}

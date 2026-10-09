import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import type { BookDataReadResult, BookDataWriteResult } from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";
import {
  flushAllBookData,
  registerBookDataFlusher,
  resetBookDataFlushers
} from "./bookDataRegistry";
import { useBookFileData } from "./useBookFileData";

/**
 * 设定数据的落盘通路（2026-10-09 扫描总单 P0-7·渲染层这一层）。
 *
 * 这一层要钉的全是「不许把坏消息读成好消息」：
 * - 没开书时一条 IPC 都不许发，更不许把 localStorage 里上一本书的设定迁进当前这本
 *   （串台就是这一波的病名）；
 * - 盘上读不懂 ≠ 盘上是空的：前者必须停止写盘，否则用户一改就用空数据盖掉了那份读不懂的；
 * - 迁移只在**新文件真的写成功之后**才清旧键：写失败还清，等于亲手把唯一一份数据删了；
 * - 换书前必须先把未落盘那一笔交回**旧的那本**（`flushAllBookData`），因为主进程的当前书
 *   在 `openBook` 那一刻就换了，等渲染层看到 rootPath 变化再写，笔就落到新书的文件里了；
 * - 写失败必须留下一句人话（`saveError`）：原先三个 store 的 `save*()` 是 `catch {}`。
 */

interface Item {
  id: string;
}

const LEGACY_KEY = "mochen.notes.v1";

class MemoryStorage implements Storage {
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

let storage: MemoryStorage;
let readBookData: ReturnType<typeof vi.fn>;
let writeBookData: ReturnType<typeof vi.fn>;
/** 假盘：`root` 记的是**主进程当前打开的那一本**，于是「笔落到哪本书」变成可断言的事实。 */
let disk: Map<string, Map<string, string>>;
let writes: Array<{ root: string; key: string; json: string }>;
/** 当前主进程视角下的书根；用例改它就等于换书。 */
let currentRoot: string | null = null;

function okRead(json: string | null): BookDataReadResult {
  return { ok: true, json };
}
function failRead(reason: "unreadable" | "no-book" | "invalid-key"): BookDataReadResult {
  return { ok: false, reason, message: `读不到（${reason}）` };
}
const okWrite: BookDataWriteResult = { ok: true };

function diskOf(root: string): Map<string, string> {
  let box = disk.get(root);
  if (box === undefined) {
    box = new Map<string, string>();
    disk.set(root, box);
  }
  return box;
}

function useHarness(): void {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  disk = new Map<string, Map<string, string>>();
  writes = [];
  currentRoot = null;
  readBookData = vi.fn(async (key: string) => {
    if (currentRoot === null) return failRead("no-book");
    const json = diskOf(currentRoot).get(key) ?? null;
    return okRead(json);
  });
  writeBookData = vi.fn(async (key: string, json: string) => {
    if (currentRoot === null) {
      return { ok: false, reason: "no-book", message: "还没打开作品目录。" } as BookDataWriteResult;
    }
    diskOf(currentRoot).set(key, json);
    writes.push({ root: currentRoot, key, json });
    return okWrite;
  });
  vi.stubGlobal("window", { mochen: { readBookData, writeBookData } });
}

/** 等一串微任务跑完（通路里全是 await，光 nextTick 不够）。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await nextTick();
}

/** 换书：先把主进程视角的当前书改掉（等价于 openBook 那一次 IPC 落地），再改渲染层的 rootPath。 */
async function switchBook(rootPath: string): Promise<void> {
  currentRoot = rootPath;
  useBookStore().rootPath = rootPath;
  await settle();
}

function makeStore(initial: Item[] = [], debounceMs = 40) {
  const data = ref<Item[]>(initial);
  return useBookFileData<Item[]>({
    key: "notes",
    legacyStorageKey: LEGACY_KEY,
    data,
    empty: () => [],
    normalize: (parsed) => (Array.isArray(parsed) ? (parsed as Item[]) : null),
    debounceMs
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

afterEach(() => {
  // 通路实例是模块级登记表里的：不清的话，前一条"读不懂 ⇒ 停止写盘"留下的实例
  // 会让后面那条 flushAllBookData() 为 true 的断言假红（它确实抛不了错，但会返回 false）。
  resetBookDataFlushers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useBookFileData：读与迁移", () => {
  it("开书后把盘上那份读进 data", async () => {
    useHarness();
    diskOf("/book-a").set("notes", JSON.stringify([{ id: "a1" }]));
    const made = makeStore();
    await switchBook("/book-a");
    expect(made.data.value).toEqual([{ id: "a1" }]);
    expect(made.saveError.value).toBe("");
  });

  it("还没开书时一条 IPC 都不发：不读、不写、也不迁", async () => {
    useHarness();
    storage.setItem(LEGACY_KEY, JSON.stringify([{ id: "老内容" }]));
    const made = makeStore();
    await settle();
    expect(readBookData).not.toHaveBeenCalled();
    expect(writeBookData).not.toHaveBeenCalled();
    expect(made.data.value).toEqual([]);
    // 旧键还在——没书的时候清它，等于把唯一一份数据交给了一次不存在的迁移。
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("盘上没有、旧键里有：把旧内容写进这本书，成功后才清旧键", async () => {
    useHarness();
    storage.setItem(LEGACY_KEY, JSON.stringify([{ id: "旧笔记" }]));
    const made = makeStore();
    await switchBook("/book-a");
    expect(made.data.value).toEqual([{ id: "旧笔记" }]);
    expect(writes).toEqual([
      { root: "/book-a", key: "notes", json: JSON.stringify([{ id: "旧笔记" }]) }
    ]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("迁移写盘失败时旧键一个字不清（清了就等于亲手删掉唯一一份数据）", async () => {
    useHarness();
    storage.setItem(LEGACY_KEY, JSON.stringify([{ id: "旧笔记" }]));
    writeBookData.mockImplementationOnce(
      async () =>
        ({
          ok: false,
          reason: "write-failed",
          message: "磁盘满"
        }) as unknown as BookDataWriteResult
    );
    const made = makeStore();
    await switchBook("/book-a");
    await settle();
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(made.data.value).toEqual([{ id: "旧笔记" }]);
    expect(made.saveError.value).toContain("磁盘满");
  });

  it("旧键那份是坏 JSON 就当没有：不迁、不写、也不报成落盘失败", async () => {
    useHarness();
    storage.setItem(LEGACY_KEY, "{半截");
    const made = makeStore();
    await switchBook("/book-a");
    expect(writeBookData).not.toHaveBeenCalled();
    expect(made.data.value).toEqual([]);
    expect(made.saveError.value).toBe("");
  });

  it("旧键是空数组也算「没有东西可迁」：不写盘，但旧键照样清掉", async () => {
    useHarness();
    storage.setItem(LEGACY_KEY, "[]");
    const made = makeStore();
    await switchBook("/book-a");
    expect(writeBookData).not.toHaveBeenCalled();
    expect(made.data.value).toEqual([]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe("useBookFileData：坏消息不许读成好消息", () => {
  it("盘上读不懂 ≠ 盘上是空的：data 停在空值，并且停止写盘", async () => {
    useHarness();
    readBookData.mockResolvedValueOnce(failRead("unreadable"));
    const made = makeStore();
    await switchBook("/book-a");
    expect(made.data.value).toEqual([]);
    expect(made.saveError.value).not.toBe("");
    // 用户接着改：这一次一个字都不许往盘上写——那等于用空数据盖掉读不懂的那一份。
    made.data.value = [{ id: "用户新写的" }];
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(writeBookData).not.toHaveBeenCalled();
  });

  it("读不懂之后连 flush() 都拦得住（换书与退出走的是这条，不经过 debounce）", async () => {
    useHarness();
    readBookData.mockResolvedValueOnce(failRead("unreadable"));
    const made = makeStore([], 5_000);
    await switchBook("/book-a");
    made.data.value = [{ id: "用户新写的" }];
    // 上面那三条用例走的是 watch 那一路；这里走 flush() 那一路——两条路各有各的闸，
    // 少一道就等于"退出时把读不懂的那一份盖掉了"。
    expect(await made.flush()).toBe(false);
    expect(writeBookData).not.toHaveBeenCalled();
    expect(await flushAllBookData()).toBe(false);
  });

  it("盘上是坏 JSON：同样停止写盘，并留一句人话", async () => {
    useHarness();
    diskOf("/book-a").set("notes", "{半截");
    const made = makeStore();
    await switchBook("/book-a");
    expect(made.data.value).toEqual([]);
    expect(made.saveError.value).not.toBe("");
    made.data.value = [{ id: "x" }];
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(writeBookData).not.toHaveBeenCalled();
  });

  it("读回来的形状不对（对象不是数组）也当读不懂：不写、报错", async () => {
    useHarness();
    diskOf("/book-a").set("notes", JSON.stringify({ not: "array" }));
    const made = makeStore();
    await switchBook("/book-a");
    expect(made.data.value).toEqual([]);
    expect(made.saveError.value).not.toBe("");
    made.data.value = [{ id: "y" }];
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(writeBookData).not.toHaveBeenCalled();
  });
});

describe("useBookFileData：写、flush 与换书", () => {
  it("连改三次只在 debounce 之后写最后一次", async () => {
    useHarness();
    const made = makeStore([], 40);
    await switchBook("/book-a");
    made.data.value = [{ id: "1" }];
    made.data.value = [{ id: "1" }, { id: "2" }];
    made.data.value = [{ id: "1" }, { id: "2" }, { id: "3" }];
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(writeBookData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(writes.length).toBe(1);
    expect(writes[0]?.json).toBe(JSON.stringify([{ id: "1" }, { id: "2" }, { id: "3" }]));
  });

  it("flush 立刻落盘，不等 debounce（退出与换书兜底走这条）", async () => {
    useHarness();
    const made = makeStore([], 5_000);
    await switchBook("/book-a");
    made.data.value = [{ id: "z" }];
    expect(await made.flush()).toBe(true);
    expect(writes.length).toBe(1);
    expect(writes[0]?.json).toBe(JSON.stringify([{ id: "z" }]));
  });

  it("换书前先 flushAll：那一笔落在旧那本书里，之后读到的才是新书的", async () => {
    useHarness();
    const made = makeStore([], 5_000);
    await switchBook("/book-a");
    made.data.value = [{ id: "只在 a 本改过" }];
    diskOf("/book-b").set("notes", JSON.stringify([{ id: "b 本的" }]));
    // 这就是 useBookStore.openBook 的顺序：先 flushAll（此刻主进程还在 a 本），再换书。
    expect(await flushAllBookData()).toBe(true);
    expect(writes).toEqual([
      { root: "/book-a", key: "notes", json: JSON.stringify([{ id: "只在 a 本改过" }]) }
    ]);
    await switchBook("/book-b");
    expect(made.data.value).toEqual([{ id: "b 本的" }]);
  });

  it("flushAll 覆盖每一枚登记中的通路（漏一枚就是那一本的改动跟着进新书）", async () => {
    useHarness();
    const a = makeStore([], 5_000);
    const dataB = ref([{ id: "b" }]);
    const b = useBookFileData<{ id: string }[]>({
      key: "story-bible",
      legacyStorageKey: "mochen.story-bible.v1",
      data: dataB,
      empty: () => [],
      normalize: (p) => (Array.isArray(p) ? (p as { id: string }[]) : null),
      debounceMs: 5_000
    });
    await switchBook("/book-a");
    a.data.value = [{ id: "notes 改动" }];
    b.data.value = [{ id: "bible 改动" }];
    expect(await flushAllBookData()).toBe(true);
    expect(writes.map((w) => w.key).sort()).toEqual(["notes", "story-bible"]);
  });

  it("写失败留一句人话；之后写成功就把这句收掉", async () => {
    useHarness();
    const made = makeStore([], 20);
    await switchBook("/book-a");
    writeBookData.mockImplementationOnce(
      async () =>
        ({
          ok: false,
          reason: "write-failed",
          message: "被别的程序占着"
        }) as unknown as BookDataWriteResult
    );
    made.data.value = [{ id: "1" }];
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(made.saveError.value).toContain("被别的程序占着");
    made.data.value = [{ id: "1" }, { id: "2" }];
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(made.saveError.value).toBe("");
  });

  it("在途还没回来时又改一笔：等在途落地再写一次，不并发两个同名写", async () => {
    useHarness();
    const made = makeStore([], 10);
    await switchBook("/book-a");
    let release!: (v: BookDataWriteResult) => void;
    writeBookData.mockImplementationOnce(
      () => new Promise<BookDataWriteResult>((resolve) => (release = resolve))
    );
    made.data.value = [{ id: "第一笔" }];
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(writeBookData).toHaveBeenCalledTimes(1);
    // 在途期间又改：此刻绝不能并发发第二次（同一枚键两个写会互相盖，谁后落地没人知道）。
    made.data.value = [{ id: "第一笔" }, { id: "第二笔" }];
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(writeBookData).toHaveBeenCalledTimes(1);
    release(okWrite);
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(writeBookData).toHaveBeenCalledTimes(2);
    expect(writes.at(-1)?.json).toBe(JSON.stringify([{ id: "第一笔" }, { id: "第二笔" }]));
  });
});

describe("bookDataRegistry：换书前的那道闸门本身", () => {
  it("某一枚通路抛错不拦其余：剩下的照样落盘，总口径回 false", async () => {
    useHarness();
    const order: string[] = [];
    registerBookDataFlusher("notes", async () => {
      order.push("坏");
      throw new Error("这一枚自己炸了");
    });
    registerBookDataFlusher("story-bible", async () => {
      order.push("好");
      return true;
    });
    expect(await flushAllBookData()).toBe(false);
    expect(order).toEqual(["坏", "好"]);
  });

  it("注销函数把这一枚从闸门里摘掉（store 销毁与热重载不走漏）", async () => {
    useHarness();
    let runs = 0;
    const off = registerBookDataFlusher("notes", async () => {
      runs += 1;
      return true;
    });
    expect(await flushAllBookData()).toBe(true);
    off();
    expect(await flushAllBookData()).toBe(true);
    expect(runs).toBe(1);
  });
});

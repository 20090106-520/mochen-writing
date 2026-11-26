import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useStoryBibleStore, type BibleEntry } from "./useStoryBibleStore";
import { flushAllBookData, resetBookDataFlushers } from "../composables/bookDataRegistry";
import {
  bibleEntriesJson,
  createBookDataHarness,
  writtenBibleEntries,
  type BookDataHarness
} from "./book-data-test-harness";

/**
 * 故事圣经的落盘接线（2026-10-09 扫描总单 P0-7）。
 *
 * 与笔记同一族病：`loadEntries` / `saveEntries` 直接摸那个不带书标识的全局键，
 * 失败还 `catch {}`。于是 A 本的人物卡出现在 B 本里，而"存不下"这件事屏上一个字都没有。
 * 这里钉的是改成书目录文件之后的四条：读这本书、写这本书、换书前交回旧书、坏消息要说话。
 */

const LEGACY = "mochen.story-bible.v1";

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

describe("故事圣经随书落盘", () => {
  it("开书后读的是这本书的 story-bible 文件，不是那个全局键", async () => {
    fx.storage.setItem(LEGACY, bibleEntriesJson([{ id: "全局人物", title: "上一本的沈砚" }]));
    fx.diskOf("/book-a").set("story-bible", bibleEntriesJson([{ id: "a1", title: "甲本人物" }]));
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    expect(bible.entries.map((e) => e.id)).toEqual(["a1"]);
    expect(fx.storage.getItem(LEGACY)).not.toBeNull();
  });

  it("新建一条：debounce 之后写进这本书的 story-bible", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    bible.addEntry("character", "苏黎", "档案馆员", { tags: ["主线"] });
    expect(fx.writeBookData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:story-bible"]);
    expect(writtenBibleEntries(fx.writes).map((e) => [e.title, e.tags])).toEqual([
      ["苏黎", ["主线"]]
    ]);
  });

  it("归档与取回都落盘（视图改了、盘上也得改）", async () => {
    fx.diskOf("/book-a").set("story-bible", bibleEntriesJson([{ id: "a1", title: "退休的角色" }]));
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    bible.archiveEntry("a1");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(writtenBibleEntries(fx.writes).map((e) => e.archived)).toEqual([true]);
    bible.restoreEntry("a1");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(writtenBibleEntries(fx.writes).map((e) => e.archived)).toEqual([false]);
  });

  it("写盘失败留一句人话，下一次写成功就收掉", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    fx.failNextWrite("磁盘只读");
    bible.addEntry("location", "旧灯塔", "港东侧");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(bible.saveError).toContain("磁盘只读");
    bible.addEntry("timeline", "第二次涨潮", "退潮后发现的门");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(bible.saveError).toBe("");
  });

  it("换书前那一笔落在旧那本书里，之后读回来的是新书的条目", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    bible.addEntry("character", "只在甲本建过", "…");
    expect(await flushAllBookData()).toBe(true);
    expect(fx.writes.at(-1)?.root).toBe("/book-a");
    fx.diskOf("/book-b").set("story-bible", bibleEntriesJson([{ id: "b1", title: "乙本人物" }]));
    await fx.switchBook("/book-b");
    expect(bible.entries.map((e) => e.id)).toEqual(["b1"]);
  });

  it("跨书导入只写当前书，重复导入不再写第二遍", async () => {
    fx.diskOf("/book-a").set("story-bible", bibleEntriesJson([{ id: "a1", title: "甲本人物" }]));
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    const incoming = JSON.parse(
      bibleEntriesJson([
        { id: "b1", title: "甲本人物", content: "来源书旧版，不该覆盖" },
        { id: "b2", title: "乙本新人物" }
      ])
    ) as BibleEntry[];
    expect(bible.importEntries(incoming)).toEqual({ added: 1, skipped: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((write) => write.root)).toEqual(["/book-a"]);
    expect(writtenBibleEntries(fx.writes).map((item) => [item.id, item.content])).toEqual([
      ["a1", ""],
      ["b2", ""]
    ]);
    expect(bible.importEntries(incoming)).toEqual({ added: 0, skipped: 2 });
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes).toHaveLength(1);
  });

  it("盘上没有、旧全局键有：迁进这本书，成功后才清旧键", async () => {
    fx.storage.setItem(LEGACY, bibleEntriesJson([{ id: "老条目", title: "只有一份" }]));
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(bible.entries.map((e) => e.id)).toEqual(["老条目"]);
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:story-bible"]);
    expect(fx.storage.getItem(LEGACY)).toBeNull();
  });

  it("迁移那一次写失败时旧键留着（清了就等于把唯一一份设定删了）", async () => {
    fx.storage.setItem(LEGACY, bibleEntriesJson([{ id: "老条目", title: "只有一份" }]));
    fx.failNextWrite("磁盘满");
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(fx.storage.getItem(LEGACY)).not.toBeNull();
    expect(bible.saveError).toContain("磁盘满");
  });

  it("盘上那份读不懂（不是数组）：停在空表并且不开写闸", async () => {
    fx.diskOf("/book-a").set("story-bible", JSON.stringify({ entries: [] }));
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    expect(bible.entries).toEqual([]);
    expect(bible.saveError).not.toBe("");
    bible.addEntry("character", "新人物", "…");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writeBookData).not.toHaveBeenCalled();
  });
});

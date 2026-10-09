import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Note } from "./useNotesStore";
import { useNotesStore } from "./useNotesStore";
import { flushAllBookData, resetBookDataFlushers } from "../composables/bookDataRegistry";
import { createBookDataHarness, type BookDataHarness } from "./book-data-test-harness";

/**
 * 笔记 store 的落盘接线（2026-10-09 扫描总单 P0-7）。
 *
 * 原先 `useNotesStore` 自己 `localStorage.getItem("mochen.notes.v1")` + `saveNotes` 里 `catch {}`，
 * 于是：① 两本书共用一份笔记（A 本的批注出现在 B 本里）；② 存不下时屏上一个字都不说。
 * 这里钉的就是这两条改成什么样——包括「老那份全局数据怎么迁进当前这本、迁失败时旧键不许清」。
 */

const LEGACY = "mochen.notes.v1";

let fx: BookDataHarness;

function noteJson(items: Partial<Note>[]): string {
  return JSON.stringify(
    items.map((n, i) => ({
      id: n.id ?? `n${i}`,
      kind: n.kind ?? "quick",
      content: n.content ?? "",
      createdAt: n.createdAt ?? 1,
      updatedAt: n.updatedAt ?? 1,
      tags: n.tags ?? [],
      archived: n.archived ?? false,
      ...(n.docRelPath ? { docRelPath: n.docRelPath } : {}),
      ...(n.lineNumber !== undefined ? { lineNumber: n.lineNumber } : {})
    }))
  );
}

function writtenNotes(): Note[] {
  const last = fx.writes.at(-1);
  return last === undefined ? [] : (JSON.parse(last.json) as Note[]);
}

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

describe("笔记随书落盘", () => {
  it("开书后读的是这本书的 notes 文件，不是那个全局 localStorage 键", async () => {
    fx.storage.setItem(LEGACY, noteJson([{ id: "全局那份", content: "上一本书的笔记" }]));
    fx.diskOf("/book-a").set("notes", noteJson([{ id: "a1", content: "甲本笔记" }]));
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    expect(notes.notes.map((n) => n.id)).toEqual(["a1"]);
    // 盘上已有这一类数据时，全局键一个字都不许动——那是另一本书留下的历史，不是这本的起点。
    expect(fx.storage.getItem(LEGACY)).not.toBeNull();
  });

  it("新建一条笔记：debounce 之后写进这本书的 notes", async () => {
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    notes.createQuickNote("灵感一条", ["开篇"]);
    expect(fx.writeBookData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:notes"]);
    expect(writtenNotes().map((n) => [n.content, n.tags])).toEqual([["灵感一条", ["开篇"]]]);
  });

  it("归档与改内容照样落盘（deep watch 覆盖每一处改动，不只是新增）", async () => {
    fx.diskOf("/book-a").set("notes", noteJson([{ id: "a1", content: "旧内容" }]));
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    notes.updateNote("a1", "新内容");
    notes.archiveNote("a1");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(writtenNotes().map((n) => [n.content, n.archived])).toEqual([["新内容", true]]);
  });

  it("写盘失败时留一句人话，下一次写成功就收掉", async () => {
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    fx.failNextWrite("磁盘只读");
    notes.createQuickNote("一条");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(notes.saveError).toContain("磁盘只读");
    notes.createQuickNote("又一条");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(notes.saveError).toBe("");
  });

  it("两本书各读各的：换书前那一笔落在旧那本里，读回来的是新书的", async () => {
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    notes.createQuickNote("只在甲本改过");
    expect(await flushAllBookData()).toBe(true);
    expect(fx.writes.at(-1)?.root).toBe("/book-a");
    fx.diskOf("/book-b").set("notes", noteJson([{ id: "b1", content: "乙本笔记" }]));
    await fx.switchBook("/book-b");
    expect(notes.notes.map((n) => n.id)).toEqual(["b1"]);
    expect(fx.writes.filter((w) => w.root === "/book-b").length).toBe(0);
  });

  it("盘上没有、旧全局键有：把那份迁进这本书，成功后才清旧键", async () => {
    fx.storage.setItem(LEGACY, noteJson([{ id: "老笔记", content: "只有一份" }]));
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(notes.notes.map((n) => n.id)).toEqual(["老笔记"]);
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:notes"]);
    expect(fx.storage.getItem(LEGACY)).toBeNull();
  });

  it("迁移那一次写盘失败时旧键留着（清了就等于把唯一一份笔记删了）", async () => {
    fx.storage.setItem(LEGACY, noteJson([{ id: "老笔记", content: "只有一份" }]));
    fx.failNextWrite("磁盘满");
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(fx.storage.getItem(LEGACY)).not.toBeNull();
    expect(notes.saveError).toContain("磁盘满");
  });

  it("老数据缺 tags / archived 这些后加的字段：补全后照样能用，不当成读不懂", async () => {
    fx.diskOf("/book-a").set(
      "notes",
      JSON.stringify([{ id: "旧版", kind: "quick", content: "老笔记", createdAt: 1, updatedAt: 1 }])
    );
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    expect(notes.notes.map((n) => n.id)).toEqual(["旧版"]);
    expect(notes.notes[0]?.tags).toEqual([]);
    expect(notes.notes[0]?.archived).toBe(false);
    expect(notes.saveError).toBe("");
    expect(notes.activeNotes.map((n) => n.id)).toEqual(["旧版"]);
  });

  it("盘上那份读不懂（不是数组）：停在空表并且不开写闸", async () => {
    fx.diskOf("/book-a").set("notes", JSON.stringify({ notes: [] }));
    const notes = useNotesStore();
    await fx.switchBook("/book-a");
    expect(notes.notes).toEqual([]);
    expect(notes.saveError).not.toBe("");
    notes.createQuickNote("用户新写的");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writeBookData).not.toHaveBeenCalled();
  });
});

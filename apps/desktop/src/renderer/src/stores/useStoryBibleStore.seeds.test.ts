import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useStoryBibleStore } from "./useStoryBibleStore";
import { resetBookDataFlushers } from "../composables/bookDataRegistry";
import {
  bibleEntriesJson,
  createBookDataHarness,
  writtenBibleEntries,
  type BookDataHarness
} from "./book-data-test-harness";

/**
 * 故事圣经的「空库就是空库」与两份视图（2026-10-09 扫描总单：`defaultEntries` 往用户数据里种三条示例）。
 *
 * 与 `useStoryBibleStore.book-data.test.ts` 的分工：那一份钉**通路**（读这本书、写这本书、换书交回、
 * 迁移、写失败要说话）；这一份钉**内容口径**：
 * ① 首次打开不许往作者的书里塞"示例人物·林夜"——那是脏数据，删掉还会复活；
 * ② 盘上是空数组、或那一份读不懂时，也不许回灌 seeds：作者删光就是删光；
 * ③ 归档件要从 `activeEntries` 出去、从 `archivedEntries` 出来，并且能真的取回；
 * ④ 两份视图是完整二分——每条要么在未归档要么在归档，不许同时出现在两处（那才是"删不掉"）。
 *
 * 搜索与档位过滤的口径不在这里测：它们住在 `utils/bible-scope.ts`，由那边 15 条纯函数用例覆盖；
 * store 里原来那份 `searchEntries` 字段链已摘掉，避免同一件事两套实现。
 *
 * 假盘与假 localStorage 都不在本文件里另写一份：P0-7 之后设定落在书目录，
 * 存储那一层由 `book-data-test-harness` 统一给（第四份实现就是扫描总单要点名的重复实现）。
 */

let fx: BookDataHarness;

/** 等过 debounce 窗口并把在途的 await 全跑完，等价于「这一笔已经落盘」。 */
async function flushed(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1_000);
  await fx.settle();
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

describe("① 首次打开：不给作者塞示例", () => {
  it("盘上与旧全局键都没东西时，entries 是空表而不是三条示例条目", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    expect(bible.entries).toEqual([]);
  });

  it("建一条再删光：落进这本书的是空表，不是那三条示例（删光就是删光）", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    const entry = bible.addEntry("character", "临时占位", "删掉它");
    await flushed();
    bible.removeEntry(entry.id);
    await flushed();
    expect(writtenBibleEntries(fx.writes)).toEqual([]);
    expect(fx.diskOf("/book-a").get("story-bible")).toBe("[]");
  });

  it("坏档不崩、也不回灌示例——读不懂就当空库，让作者从头建", async () => {
    fx.diskOf("/book-a").set("story-bible", "{不是 JSON");
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    expect(bible.entries).toEqual([]);
  });

  it("正常存过的数据原样读回，字段一个不丢", async () => {
    fx.diskOf("/book-a").set(
      "story-bible",
      bibleEntriesJson([
        {
          id: "bible_x",
          title: "沈砚",
          content: "旧书店老板",
          updatedAt: 2,
          tags: ["引路人"],
          aliases: ["夜老板"],
          role: "配角"
        }
      ])
    );
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    expect(bible.entries).toHaveLength(1);
    expect(bible.entries[0]?.title).toBe("沈砚");
    expect(bible.entries[0]?.aliases).toEqual(["夜老板"]);
  });
});

describe("③ 归档双向：出去的那一条要看得见、也回得来", () => {
  it("archiveEntry 后 activeEntries 不含它、archivedEntries 只含它", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    const entry = bible.addEntry("character", "苏黎", "档案馆员");
    bible.archiveEntry(entry.id);
    expect(bible.activeEntries.map((e) => e.id)).toEqual([]);
    expect(bible.archivedEntries.map((e) => e.id)).toEqual([entry.id]);
  });

  it("restoreEntry 把它放回未归档视图——旧实现里这个动作全仓零调用，归档等于删", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    const entry = bible.addEntry("location", "旧灯塔", "港东侧");
    bible.archiveEntry(entry.id);
    bible.restoreEntry(entry.id);
    expect(bible.activeEntries.map((e) => e.id)).toEqual([entry.id]);
    expect(bible.archivedEntries).toEqual([]);
  });

  it("归档与取回都会写进这本书的 story-bible（面板重开还是那个状态）", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    const entry = bible.addEntry("timeline", "第二次涨潮", "退潮后发现的门");
    bible.archiveEntry(entry.id);
    await flushed();
    expect(fx.writes.at(-1)?.key).toBe("story-bible");
    expect(writtenBibleEntries(fx.writes).map((e) => [e.id, e.archived])).toEqual([
      [entry.id, true]
    ]);
  });
});

describe("④ 两份视图是完整二分", () => {
  it("每条要么在未归档、要么在归档，且不会同时出现在两处", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    const a = bible.addEntry("character", "沈砚", "旧书店老板");
    const b = bible.addEntry("location", "旧港图书馆", "不存于任何地图");
    const c = bible.addEntry("timeline", "第二次涨潮", "退潮后发现的门");
    bible.archiveEntry(b.id);
    const activeIds = bible.activeEntries.map((e) => e.id);
    const archivedIds = bible.archivedEntries.map((e) => e.id);
    expect([...activeIds, ...archivedIds].sort()).toEqual([a.id, b.id, c.id].sort());
    expect(activeIds.filter((id) => archivedIds.includes(id))).toEqual([]);
  });

  it("取回之后二分仍然成立（不会两处都留一份）", async () => {
    const bible = useStoryBibleStore();
    await fx.switchBook("/book-a");
    const entry = bible.addEntry("character", "退休的角色", "已经不上场了");
    bible.archiveEntry(entry.id);
    bible.restoreEntry(entry.id);
    expect(bible.activeEntries.map((e) => e.id)).toEqual([entry.id]);
    expect(bible.archivedEntries).toEqual([]);
  });
});

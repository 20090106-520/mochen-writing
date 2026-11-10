import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { ChangeEntry } from "@mochen/contracts";
import { useChapterInventoryStore } from "./useChapterInventoryStore";

const A = "chapters/01-开局.md";

function change(partial: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    stamp: "2026-10-05T12-34-31-168Z",
    docRelPath: A,
    backupRelPath: `.mochen/changes/${A}/x`,
    bytes: 10,
    ...partial
  };
}

/** 让微任务跑几轮，但**不**放行挂起的那次。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => vi.unstubAllGlobals());

describe("最近改动只走既有 changes:list", () => {
  it("读回来的是既有改稿历史，不是另造的一套时间", async () => {
    vi.stubGlobal("window", {
      mochen: { listChanges: async () => [change()] }
    });
    const store = useChapterInventoryStore();
    await store.loadChanges();
    expect(store.changes).toHaveLength(1);
    expect(store.changes[0]?.docRelPath).toBe(A);
    expect(store.loading).toBe(false);
    expect(store.notice).toBe("");
  });

  it("读失败不静默吞掉，也不留半截旧数据", async () => {
    vi.stubGlobal("window", {
      mochen: {
        listChanges: async () => {
          throw new Error("盘没开");
        }
      }
    });
    const store = useChapterInventoryStore();
    store.changes = [change()];
    await store.loadChanges();
    expect(store.changes).toEqual([]);
    expect(store.notice).toContain("最近改动没读回来");
    expect(store.notice).toContain("盘没开");
    expect(store.loading).toBe(false);
  });

  it("reset 作废在途回包并清空", async () => {
    vi.stubGlobal("window", {
      mochen: {
        listChanges: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          return [change()];
        }
      }
    });
    const store = useChapterInventoryStore();
    const pending = store.loadChanges();
    store.reset();
    await pending;
    expect(store.changes).toEqual([]);
    expect(store.loading).toBe(false);
  });
});

describe("换书竞态", () => {
  it("先发的那次迟到回包不许覆盖后一次的结果", async () => {
    let releaseFirst = (): void => {};
    let calls = 0;
    vi.stubGlobal("window", {
      mochen: {
        listChanges: async () => {
          calls += 1;
          if (calls === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
          return [change({ stamp: `2026-10-0${calls}T00-00-00-000Z` })];
        }
      }
    });
    const store = useChapterInventoryStore();
    const first = store.loadChanges();
    await settle();
    const second = store.loadChanges();
    await second;
    expect(store.changes[0]?.stamp).toBe("2026-10-02T00-00-00-000Z");
    releaseFirst();
    await first;
    expect(store.changes[0]?.stamp).toBe("2026-10-02T00-00-00-000Z");
    expect(store.loading).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { WritingGoalData } from "../utils/goal-shape";
import type { WritingGoal, WritingSession, WritingStreak } from "./useWritingGoalStore";
import { useWritingGoalStore } from "./useWritingGoalStore";
import { flushAllBookData, resetBookDataFlushers } from "../composables/bookDataRegistry";
import { createBookDataHarness, type BookDataHarness } from "./book-data-test-harness";

/**
 * 写作目标的落盘接线（2026-10-09 扫描总单 P0-7 的第三本）。
 *
 * 病灶与前两本同族，但这一本的后果更直接：原先它自己 `localStorage.getItem("mochen.writing-goals.v1")`
 * + `saveState` 里 `catch {}`，于是 ① 两本书共用一份目标与"今日已写字数"（换本书打开，热力图还是上一本的），
 * ② 存不下时一个字都不说——用户看到的是进度环在涨，盘上什么都没涨。
 * 这里钉的就是这两条改成什么样，含「老那份全局数据怎么迁进当前这本、迁失败时旧键不许清」。
 *
 * 时长/字数的**算法**不在这里测（那由 `useWritingGoalStore.timer.test.ts` 钉），
 * 这里只管"读的是这本书、写的是这本书、写不下要说话"。
 */

const LEGACY = "mochen.writing-goals.v1";

let fx: BookDataHarness;

/** 摆盘用的简写：只写要改的那几格，其余按盘上该有的默认补齐。 */
type GoalJsonInput = {
  goal?: Partial<WritingGoal>;
  sessions?: WritingSession[];
  streak?: Partial<WritingStreak>;
};

function goalJson(data: GoalJsonInput): string {
  return JSON.stringify({
    goal: {
      dailyWordTarget: 1000,
      dailyTimeTarget: 30,
      enabled: true,
      totalWordTarget: 0,
      ...(data.goal ?? {})
    },
    sessions: data.sessions ?? [],
    streak: { currentStreak: 0, longestStreak: 0, lastReachDate: null, ...(data.streak ?? {}) }
  });
}

function written(): WritingGoalData | null {
  const last = fx.writes.at(-1);
  return last === undefined ? null : (JSON.parse(last.json) as WritingGoalData);
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

describe("① 读写都认这本书", () => {
  it("开书后读的是这本书的 writing-goal 文件，不是那个全局键", async () => {
    fx.storage.setItem(LEGACY, goalJson({ goal: { dailyWordTarget: 500 } }));
    fx.diskOf("/book-a").set(
      "writing-goal",
      goalJson({ goal: { dailyWordTarget: 2000, totalWordTarget: 80000 } })
    );
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    expect(store.goal.dailyWordTarget).toBe(2000);
    expect(store.goal.totalWordTarget).toBe(80000);
    // 盘上已有这一类数据时，全局键一个字都不许动——那是另一本书留下的历史。
    expect(fx.storage.getItem(LEGACY)).not.toBeNull();
  });

  it("记一次字数：debounce 之后写进这本书，内容是真累计过的", async () => {
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    store.recordWriting("chapters/01.md", "一二三四五", "");
    expect(fx.writeBookData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:writing-goal"]);
    const got = written();
    expect(got?.sessions.map((s) => [s.date, s.wordsWritten])).toHaveLength(1);
    expect(got?.sessions[0]?.wordsWritten).toBe(5);
  });

  it("改目标值照样落盘（deep watch 覆盖的不只是会话）", async () => {
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    store.updateGoal({ dailyWordTarget: 3000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(written()?.goal.dailyWordTarget).toBe(3000);
  });

  it("没开书时一条 IPC 都不发——更不许把全局那份当成「当前这本书的」迁出去", async () => {
    fx.storage.setItem(LEGACY, goalJson({ goal: { dailyWordTarget: 700 } }));
    const store = useWritingGoalStore();
    await fx.settle();
    store.recordWriting("chapters/01.md", "字", "");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.readBookData).not.toHaveBeenCalled();
    expect(fx.writeBookData).not.toHaveBeenCalled();
    expect(fx.storage.getItem(LEGACY)).not.toBeNull();
  });
});

describe("② 写不下去要说话", () => {
  it("写盘失败留一句人话，下一次写成功就收掉", async () => {
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    fx.failNextWrite("磁盘只读");
    store.updateGoal({ dailyWordTarget: 1500 });
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(store.saveError).toContain("磁盘只读");
    store.updateGoal({ dailyWordTarget: 1600 });
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(store.saveError).toBe("");
  });

  it("盘上那份读不懂：停在默认目标，并且不开写闸（否则用户一改就盖掉原文件）", async () => {
    fx.diskOf("/book-a").set("writing-goal", JSON.stringify({ goal: { dailyWordTarget: "1000" } }));
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    expect(store.goal.dailyWordTarget).toBe(1000);
    expect(store.saveError).not.toBe("");
    store.updateGoal({ dailyWordTarget: 2000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writeBookData).not.toHaveBeenCalled();
  });
});

describe("③ 换书：各读各的，换书前那一笔落进旧那本", () => {
  it("A 本的改动 flush 进 A 本目录，换到 B 本读回来的是 B 本的", async () => {
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    store.recordWriting("chapters/01.md", "一二三", "");
    expect(await flushAllBookData()).toBe(true);
    expect(fx.writes.at(-1)?.root).toBe("/book-a");
    fx.diskOf("/book-b").set("writing-goal", goalJson({ goal: { dailyWordTarget: 500 } }));
    await fx.switchBook("/book-b");
    expect(store.goal.dailyWordTarget).toBe(500);
    expect(store.sessions).toEqual([]);
    expect(fx.writes.filter((w) => w.root === "/book-b")).toEqual([]);
  });

  it("换书后新记的那一笔落进新书，不追回旧书", async () => {
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    await fx.switchBook("/book-b");
    store.recordWriting("chapters/01.md", "一字", "");
    await vi.advanceTimersByTimeAsync(1_000);
    await fx.settle();
    expect(fx.writes.map((w) => w.root)).toEqual(["/book-b"]);
  });
});

describe("④ 迁移：只在盘上没东西时迁一次，成了才清旧键", () => {
  it("盘上没有、旧全局键有：把那份迁进这本书，成功后才清旧键", async () => {
    fx.storage.setItem(
      LEGACY,
      goalJson({
        goal: { dailyWordTarget: 2000 },
        sessions: [{ id: "ws_old", date: "2026-10-01", wordsWritten: 800, durationSeconds: 600 }],
        streak: { currentStreak: 4, longestStreak: 7, lastReachDate: "2026-10-01" }
      })
    );
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(store.goal.dailyWordTarget).toBe(2000);
    expect(store.streak.currentStreak).toBe(4);
    expect(fx.writes.map((w) => `${w.root}:${w.key}`)).toEqual(["/book-a:writing-goal"]);
    expect(fx.storage.getItem(LEGACY)).toBeNull();
  });

  it("迁移那一次写盘失败时旧键留着（清了就等于把用户唯一那份记录删了）", async () => {
    fx.storage.setItem(LEGACY, goalJson({ goal: { dailyWordTarget: 2000 } }));
    fx.failNextWrite("磁盘满");
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(fx.storage.getItem(LEGACY)).not.toBeNull();
    expect(store.saveError).toContain("磁盘满");
  });

  it("旧键里只有默认值：没有可迁的东西，不写盘、把旧键清掉", async () => {
    fx.storage.setItem(LEGACY, goalJson({}));
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(fx.writeBookData).not.toHaveBeenCalled();
    expect(fx.storage.getItem(LEGACY)).toBeNull();
    expect(store.saveError).toBe("");
  });

  it("旧键是坏 JSON：当没有，不报成落盘失败（那是上一辈子的存档，不是这本书的）", async () => {
    fx.storage.setItem(LEGACY, "{不是 JSON");
    const store = useWritingGoalStore();
    await fx.switchBook("/book-a");
    await fx.settle();
    expect(store.goal.dailyWordTarget).toBe(1000);
    expect(store.saveError).toBe("");
    expect(fx.writeBookData).not.toHaveBeenCalled();
  });
});

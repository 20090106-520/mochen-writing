import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOAL,
  DEFAULT_STREAK,
  emptyWritingGoalData,
  isDefaultWritingGoalData,
  normalizeWritingGoalData
} from "./goal-shape";

/**
 * 写作目标文件的形状校验（2026-10-09 扫描总单 P0-7）。
 *
 * 与 `note-shape` / `bible-shape` 同一条主线：**「读不懂」与「这本书还没写过目标」必须是两个答案**。
 * 这一份比前两本多一个坑：它里面全是**数字**。把 `dailyWordTarget` 读成 `undefined` 再兜 0，
 * 面板就会显示「今日 12 / 0 字、达标」；把 `durationSeconds` 兜 0，今天的时长直接蒸发，
 * 连续达标天数（`recomputeStreak` 只看字数，不看形状）跟着一起错。
 * 所以认不得的形状整份判 null（通路随即停止写盘），只允许「缺了整格」这种老版本情况补默认值放行。
 */

describe("normalizeWritingGoalData：整份的形状", () => {
  it("不是对象就不是目标库：判读不懂，而不是判「没设过目标」", () => {
    expect(normalizeWritingGoalData([])).toBeNull();
    expect(normalizeWritingGoalData(null)).toBeNull();
    expect(normalizeWritingGoalData("{}")).toBeNull();
    expect(normalizeWritingGoalData(7)).toBeNull();
  });

  it("完全空对象按老版本存档补全：默认目标 + 空会话 + 零连续", () => {
    expect(normalizeWritingGoalData({})).toEqual({
      goal: DEFAULT_GOAL,
      sessions: [],
      streak: DEFAULT_STREAK
    });
  });

  it("三格都在时原样认下来", () => {
    const input = {
      goal: { dailyWordTarget: 2000, dailyTimeTarget: 45, enabled: false, totalWordTarget: 80000 },
      sessions: [
        { id: "ws_1", date: "2026-10-08", wordsWritten: 1200, durationSeconds: 900 },
        {
          id: "ws_2",
          date: "2026-10-08",
          wordsWritten: 300,
          durationSeconds: 60,
          docRelPath: "chapters/01.md"
        }
      ],
      streak: { currentStreak: 3, longestStreak: 9, lastReachDate: "2026-10-08" }
    };
    expect(normalizeWritingGoalData(input)).toEqual(input);
  });

  it("我们认识的字段之外不往盘上带：多余键丢掉，输出键序稳定", () => {
    const got = normalizeWritingGoalData({
      goal: { ...DEFAULT_GOAL, 草稿: "别跟着落盘" },
      sessions: [],
      streak: DEFAULT_STREAK,
      未知版本: 2
    });
    expect(Object.keys(got ?? {})).toEqual(["goal", "sessions", "streak"]);
    expect(JSON.stringify(got)).not.toContain("别跟着落盘");
  });

  it("不改调用方那份对象：通路拿返回值做快照，原对象留着别家的引用", () => {
    const goal = { dailyWordTarget: 500 };
    const input = { goal, sessions: [], streak: DEFAULT_STREAK };
    normalizeWritingGoalData(input);
    expect(goal).toEqual({ dailyWordTarget: 500 });
    expect(input.goal).toBe(goal);
  });
});

describe("normalizeWritingGoalData：goal 那一格（数字读错会算出假达标）", () => {
  it("整格缺失补默认；格内缺哪格补哪格", () => {
    expect(normalizeWritingGoalData({ goal: { dailyWordTarget: 2000 } })?.goal).toEqual({
      ...DEFAULT_GOAL,
      dailyWordTarget: 2000
    });
  });

  it("目标值不是有限数字、或是负数：整份判读不懂（兜 0 会让面板说「已达标」）", () => {
    expect(normalizeWritingGoalData({ goal: { dailyWordTarget: "1000" } })).toBeNull();
    expect(normalizeWritingGoalData({ goal: { dailyWordTarget: Number.NaN } })).toBeNull();
    expect(normalizeWritingGoalData({ goal: { dailyWordTarget: -5 } })).toBeNull();
    expect(normalizeWritingGoalData({ goal: { totalWordTarget: true } })).toBeNull();
  });

  it('enabled 只认真布尔值：字符串 "false" 判读不懂，而不是当 true', () => {
    expect(normalizeWritingGoalData({ goal: { enabled: false } })?.goal.enabled).toBe(false);
    expect(normalizeWritingGoalData({ goal: { enabled: "false" } })).toBeNull();
    expect(normalizeWritingGoalData({ goal: "on" })).toBeNull();
  });
});

describe("normalizeWritingGoalData：sessions 那一格（数字读错会吞掉今天写过的字）", () => {
  it("空数组是合法的「今天还没写」，与读不懂分得开", () => {
    expect(normalizeWritingGoalData({ sessions: [] })?.sessions).toEqual([]);
  });

  it("不是数组、条目不是对象、id/date 不是字符串：整份判读不懂", () => {
    expect(normalizeWritingGoalData({ sessions: {} })).toBeNull();
    expect(normalizeWritingGoalData({ sessions: [null] })).toBeNull();
    expect(
      normalizeWritingGoalData({
        sessions: [{ date: "2026-10-08", wordsWritten: 1, durationSeconds: 0 }]
      })
    ).toBeNull();
    expect(
      normalizeWritingGoalData({ sessions: [{ id: "ws_1", wordsWritten: 1, durationSeconds: 0 }] })
    ).toBeNull();
    expect(
      normalizeWritingGoalData({
        sessions: [{ id: "ws_1", date: 8, wordsWritten: 1, durationSeconds: 0 }]
      })
    ).toBeNull();
  });

  it("字数或时长读不成「有限非负数字」判读不懂：兜 0 就是今天写过的字凭空消失", () => {
    expect(
      normalizeWritingGoalData({ sessions: [{ id: "a", date: "2026-10-08", wordsWritten: "120" }] })
    ).toBeNull();
    expect(
      normalizeWritingGoalData({ sessions: [{ id: "a", date: "2026-10-08", durationSeconds: -1 }] })
    ).toBeNull();
    expect(
      normalizeWritingGoalData({
        sessions: [{ id: "a", date: "2026-10-08", wordsWritten: Number.POSITIVE_INFINITY }]
      })
    ).toBeNull();
  });

  it("字数与时长都没写补 0（老数据里只有字数那一版是正常存档）", () => {
    expect(
      normalizeWritingGoalData({ sessions: [{ id: "a", date: "2026-10-08" }] })?.sessions
    ).toEqual([{ id: "a", date: "2026-10-08", wordsWritten: 0, durationSeconds: 0 }]);
  });

  it("docRelPath：没写与写了空串都不带这格；写了不是字符串判读不懂", () => {
    expect(
      normalizeWritingGoalData({ sessions: [{ id: "a", date: "2026-10-08", docRelPath: "" }] })
        ?.sessions
    ).toEqual([{ id: "a", date: "2026-10-08", wordsWritten: 0, durationSeconds: 0 }]);
    expect(
      normalizeWritingGoalData({ sessions: [{ id: "a", date: "2026-10-08", docRelPath: 3 }] })
    ).toBeNull();
  });

  it("多余键不进会话行（否则下一次读回来更认不得）", () => {
    const got = normalizeWritingGoalData({
      sessions: [{ id: "a", date: "2026-10-08", wordsWritten: 1, durationSeconds: 2, 手记: "x" }]
    });
    expect(Object.keys(got?.sessions[0] ?? {})).toEqual([
      "id",
      "date",
      "wordsWritten",
      "durationSeconds"
    ]);
  });
});

describe("normalizeWritingGoalData：streak 那一格", () => {
  it("整格缺失补默认；只写了一项也补其余", () => {
    expect(normalizeWritingGoalData({ streak: { currentStreak: 4 } })?.streak).toEqual({
      currentStreak: 4,
      longestStreak: 0,
      lastReachDate: null
    });
  });

  it("天数读不成有限非负数字判读不懂：连续达标是用户看得最重的那一格", () => {
    expect(normalizeWritingGoalData({ streak: { currentStreak: "12" } })).toBeNull();
    expect(normalizeWritingGoalData({ streak: { longestStreak: -3 } })).toBeNull();
    expect(normalizeWritingGoalData({ streak: 5 })).toBeNull();
  });

  it("lastReachDate 认 null 与字符串，其余判读不懂", () => {
    expect(
      normalizeWritingGoalData({ streak: { lastReachDate: "2026-10-08" } })?.streak.lastReachDate
    ).toBe("2026-10-08");
    expect(normalizeWritingGoalData({ streak: { lastReachDate: 20261008 } })).toBeNull();
  });
});

describe("isDefaultWritingGoalData：「这份旧数据没有可迁的东西」那一判", () => {
  it("只有默认值＝没东西可迁（迁移那一路据此不写盘，只把旧键清掉）", () => {
    const got = normalizeWritingGoalData({});
    expect(got).not.toBeNull();
    expect(
      isDefaultWritingGoalData(got ?? { goal: DEFAULT_GOAL, sessions: [], streak: DEFAULT_STREAK })
    ).toBe(true);
  });

  it("改过目标、有过会话、或记过连续天数，都不算默认值：那一份必须迁进这本书", () => {
    const base = normalizeWritingGoalData({}) ?? emptyWritingGoalData();
    expect(
      isDefaultWritingGoalData({ ...base, goal: { ...base.goal, dailyWordTarget: 2000 } })
    ).toBe(false);
    expect(
      isDefaultWritingGoalData({
        ...base,
        sessions: [{ id: "ws_1", date: "2026-10-08", wordsWritten: 1, durationSeconds: 0 }]
      })
    ).toBe(false);
    expect(
      isDefaultWritingGoalData({ ...base, streak: { ...base.streak, currentStreak: 1 } })
    ).toBe(false);
  });
});

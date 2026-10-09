/**
 * 写作时长与「每日时长目标」的行为测试（止血波 4 · 2026-10-09 扫描总单）。
 *
 * 病灶（总单「假控件与死路清单」第 1、2 行）：
 * ① 面板底栏那两枚统计（`平均速度 __ 字/分钟`、`今日 __:__:__`）读的是
 *    `todayDurationSeconds` / `averageSpeed`，两者都只从 `durationSeconds` 来；
 *    而唯一写它的 `startSession`/`endSession` 全仓零调用——2026-10-05 专注模式
 *    （番茄钟）整条下线时把调用方删净了，接口留在原地当死档。于是界面永远显示
 *    「0 字/分钟 / 今日 0 秒」，用户会判定「统计坏了」。
 * ② 「每日时长目标（分钟）」能存能回显，但 `dailyTimeTarget` 在进度计算里一个字都没用。
 *
 * 修法（这一组用例钉的就是它）：时长不再靠"开始/结束"两个按钮，而是由**动笔活动**驱动——
 * 每次活动结算「距上一次活动」的间隔，超过空闲窗口的那段停顿算作"人不在写"、不计入；
 * 跨文稿的那一跨也不计入（归属要落在真正在写的那一篇上）。
 * 这样今日时长、平均速度都是从真实活动里长出来的数，而不是恒 0 的摆设。
 *
 * 用例全部显式传入时刻（`atMs`），因此不需要伪定时器就能判定；
 * 只有 `new Date()` 那条日子归属用假时钟钉住当天正午，避免跨零点机器上飘一天。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWritingGoalStore } from "./useWritingGoalStore";

const P = "chapters/01-开局.md";
const Q = "chapters/02-潮信.md";
const SEC = 1000;
const MIN = 60 * SEC;

/** 把系统时钟钉在「今天正午」：todayKey 走本地日子，正午离日界线最远，跨零点也不会飘。 */
function freezeNoon(): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  vi.setSystemTime(d);
  return d.getTime();
}

describe("useWritingGoalStore · 活动驱动的写作时长（恒 0 的两枚统计接真）", () => {
  let noon = 0;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    noon = freezeNoon();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("连续动笔把时长累进当日会话：60 秒内每 5 秒一次 ⇒ 今日 60 秒", () => {
    const store = useWritingGoalStore();
    for (let i = 0; i <= 12; i += 1) store.activity(P, noon + i * 5 * SEC);
    expect(store.todayDurationSeconds).toBe(60);
  });

  it("停笔超过空闲窗口的那段空档不计入：回来再写只算回来后那一段", () => {
    const store = useWritingGoalStore();
    store.activity(P, noon);
    store.activity(P, noon + 30 * SEC);
    // 中间离席 10 分钟：这 10 分钟不是"在写"，一秒都不许记。
    store.activity(P, noon + 30 * SEC + 10 * MIN);
    store.activity(P, noon + 30 * SEC + 10 * MIN + 20 * SEC);
    expect(store.todayDurationSeconds).toBe(50);
  });

  it("换文稿的那一跨不记时长，归属只落在当前在写的那一篇", () => {
    const store = useWritingGoalStore();
    store.activity(P, noon);
    store.activity(P, noon + 40 * SEC);
    store.activity(Q, noon + 90 * SEC); // 切到另一篇：这一跨不计时
    store.activity(Q, noon + 90 * SEC + 30 * SEC);
    expect(store.todayDurationSeconds).toBe(70);
    expect(store.sessions.map((s) => s.durationSeconds).sort()).toEqual([30, 40]);
  });

  it("不足一秒的零头攒着，不许每次活动都抹成 0", () => {
    const store = useWritingGoalStore();
    // 11 次 × 200 毫秒间隔 = 2000 毫秒：每次单独四舍五入都是 0 秒，攒着才是 2 秒。
    for (let i = 1; i <= 11; i += 1) store.activity(P, noon + i * 200);
    expect(store.todayDurationSeconds).toBe(2);
  });

  it("同一时刻与时光倒流的两次活动都不许记出负数或凭空时长", () => {
    const store = useWritingGoalStore();
    store.activity(P, noon);
    store.activity(P, noon);
    store.activity(P, noon - 5 * SEC);
    expect(store.todayDurationSeconds).toBe(0);
  });

  it("目标关掉时不记时长，也不凭空造出一条当日会话", () => {
    const store = useWritingGoalStore();
    store.updateGoal({ enabled: false });
    store.activity(P, noon);
    store.activity(P, noon + 60 * SEC);
    expect(store.todayDurationSeconds).toBe(0);
    expect(store.sessions).toEqual([]);
  });

  it("字数与时长合起来把平均速度算成真的：100 字 / 1 分钟 ⇒ 100 字/分钟", () => {
    const store = useWritingGoalStore();
    store.recordWriting(P, "一".repeat(100), "");
    store.activity(P, noon);
    store.activity(P, noon + 60 * SEC);
    expect(store.averageSpeed).toBe(100);
  });

  it("每日时长目标进了进度：secondsWritten/targetSeconds/百分比/达标四个字段都是真的", () => {
    const store = useWritingGoalStore();
    store.updateGoal({ dailyTimeTarget: 2 });
    store.activity(P, noon);
    store.activity(P, noon + 60 * SEC);
    const p = store.todayProgress;
    expect(p.secondsWritten).toBe(60);
    expect(p.targetSeconds).toBe(120);
    expect(p.timePercentage).toBe(50);
    expect(p.timeReached).toBe(false);
    store.activity(P, noon + 130 * SEC);
    expect(store.todayProgress.timeReached).toBe(true);
    expect(store.todayProgress.timePercentage).toBe(100);
  });

  it("时长目标为 0（没设）时不许除零：百分比 0、达标 false，而不是 NaN/永真", () => {
    const store = useWritingGoalStore();
    store.updateGoal({ dailyTimeTarget: 0 });
    store.activity(P, noon);
    store.activity(P, noon + 60 * SEC);
    expect(Number.isNaN(store.todayProgress.timePercentage)).toBe(false);
    expect(store.todayProgress.timePercentage).toBe(0);
    expect(store.todayProgress.timeReached).toBe(false);
  });

  it("字数达标仍按字数判（连续天数语义不变），时长达标不掺进去", () => {
    const store = useWritingGoalStore();
    store.updateGoal({ dailyWordTarget: 10, dailyTimeTarget: 60 });
    store.recordWriting(P, "一".repeat(10), "");
    expect(store.todayProgress.reached).toBe(true);
    expect(store.todayProgress.timeReached).toBe(false);
  });

  it("本周热力图与 getRecentDays 走同一份口径：今日那一格带得上面四个时长字段", () => {
    const store = useWritingGoalStore();
    store.updateGoal({ dailyTimeTarget: 5 });
    store.activity(P, noon);
    store.activity(P, noon + 120 * SEC);
    const fromComputed = store.recentProgress[store.recentProgress.length - 1]!;
    const fromFunction = store.getRecentDays(1)[0]!;
    expect(fromComputed.secondsWritten).toBe(120);
    expect(fromFunction.secondsWritten).toBe(120);
    expect(fromFunction.timePercentage).toBe(fromComputed.timePercentage);
  });

  it("活动记出的当日会话与保存记出的字符合并成一条，不再各留一条半截记录", () => {
    const store = useWritingGoalStore();
    store.recordWriting(P, "一".repeat(30), "");
    store.activity(P, noon);
    store.activity(P, noon + 45 * SEC);
    const rows = store.sessions.filter((s) => s.docRelPath === P);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wordsWritten: 30, durationSeconds: 45 });
  });
});

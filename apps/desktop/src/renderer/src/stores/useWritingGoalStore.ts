/**
 * WritingGoalStore —— 写作目标管理
 *
 * 每日字数目标、写作时长统计、连续达标天数、本周热力图。
 *
 * 数据持久化（2026-10-09 扫描总单 P0-7 改的）：落在**当前这本书**的
 * `.mochen/data/writing-goal.json`，通路本体在 `composables/useBookFileData`。
 * 原先它自己读写全局键 `mochen.writing-goals.v1` 并且 `catch {}`，于是两本书共用一份目标
 * 与"今日已写"，存不下时屏上还挂着涨动的进度环。现在：目标、当日会话、连续天数都随书隔离，
 * 写不下去由 `saveError` 说给人看。盘上那份长什么样、认不得时判什么，全在 `utils/goal-shape`。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useBookFileData } from "../composables/useBookFileData";
import {
  emptyWritingGoalData,
  isDefaultWritingGoalData,
  normalizeWritingGoalData,
  type WritingGoalData
} from "../utils/goal-shape";

export interface WritingGoal {
  /** 每日字数目标（默认 1000） */
  dailyWordTarget: number;
  /** 每日时长目标分钟（默认 30） */
  dailyTimeTarget: number;
  enabled: boolean;
  /**
   * 全书总字数目标（0 = 未设定）。
   * 与 dailyWordTarget 是两件事：那是「今天写多少」，这是「这本多少字收尾」。
   * 字数统计面板（WordCountPanel）的进度条只认这里，不再自造一份内存态——
   * 组件内的 ref 活不过一次重启，那样的进度条是假的。
   * 真字数从 useBookStore 的 chapters 现算，本字段只存目标值。
   */
  totalWordTarget: number;
}

export interface WritingSession {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  wordsWritten: number;
  durationSeconds: number;
  docRelPath?: string;
}

export interface GoalProgress {
  date: string;
  wordsWritten: number;
  target: number;
  percentage: number;
  reached: boolean;
  /**
   * 这一日累计的写作时长（秒）。2026-10-09 扫描总单「假控件清单」第 1 行：这一族以前恒 0，
   * 因为唯一写 `durationSeconds` 的 `startSession`/`endSession` 全仓零调用（专注模式 2026-10-05
   * 下线时把调用方删净了，接口留在原地当死档）——现在由 `activity()` 逐次结算，见那里。
   */
  secondsWritten: number;
  /** 每日时长目标（秒），0 = 没设。以前 `dailyTimeTarget` 只存不用（总单第 2 行），进度里现在认它。 */
  targetSeconds: number;
  timePercentage: number;
  /**
   * 时长目标单独判，**不**掺进 `reached`：连续达标天数（`recomputeStreak`）历来只按字数算，
   * 让它忽然多一个条件会把用户已有的 streak 追溯改掉。
   */
  timeReached: boolean;
}

export interface WritingStreak {
  /** 连续达标天数 */
  currentStreak: number;
  longestStreak: number;
  lastReachDate: string | null;
}

/** 迁移来源：P0-7 之前那份不带书标识的全局数据。盘上有东西时绝不碰它。 */
const LEGACY_STORAGE_KEY = "mochen.writing-goals.v1";

/**
 * 空闲窗口：两次动笔之间超过这么久，就把这段停顿归给「人不在写」，一秒都不记进时长。
 * 取 2 分钟而不是 30 秒——写作不同于编码：盯着屏幕想下一句怎么落是最正常的动作，
 * 卡得太紧会把「想」判成「没写」，今日时长就会系统性地低于真实投入。
 */
const IDLE_GAP_MS = 120_000;

function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function genId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 简单中文字数：所有非空白字符都视为字（含标点）。与 @mochen/contracts 的 proseCharCount 视角不同，这里只用于「增量」累计，无需完全对齐。 */
function countWords(text: string): number {
  if (!text) return 0;
  // 去掉空白后计数：兼容中英文混合
  return text.replace(/\s/g, "").length;
}

/** 某一日的字数与时长总数。三个出口（今日 / 本周 / getRecentDays）以前各算各的，收成这一处。 */
function sumDay(rows: WritingSession[]): { wordsWritten: number; durationSeconds: number } {
  return {
    wordsWritten: rows.reduce((sum, s) => sum + s.wordsWritten, 0),
    durationSeconds: rows.reduce((sum, s) => sum + s.durationSeconds, 0)
  };
}

/** 百分比唯一算法：目标 ≤ 0 一律回 0，不许除零除出一个 Infinity 或 NaN 上屏。 */
function toPercentage(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

/** 把「不足一秒的零头」攒起来，攒够一秒才入账；返回入账的整秒数与剩下的零头。 */
function takeWholeSeconds(pendingMs: number): { seconds: number; restMs: number } {
  const seconds = Math.floor(pendingMs / 1000);
  return { seconds, restMs: pendingMs - seconds * 1000 };
}

export const useWritingGoalStore = defineStore("writingGoal", () => {
  /**
   * 这本书的目标数据，唯一真身：`goal` / `sessions` / `streak` 都是它的视图，
   * 改动直接落在这份上，由通路一次写回 `.mochen/data/writing-goal.json`。
   * 分成三枚 ref 是旧写法（那时"存"是三份 watch 各写各的 localStorage）；
   * 现在只有一份要落盘的东西，所以也只有一个 ref——快照比对才有的比。
   */
  const data = ref<WritingGoalData>(emptyWritingGoalData());
  const { saveError } = useBookFileData<WritingGoalData>({
    key: "writing-goal",
    legacyStorageKey: LEGACY_STORAGE_KEY,
    data,
    empty: emptyWritingGoalData,
    normalize: normalizeWritingGoalData,
    isEmpty: isDefaultWritingGoalData
  });

  const goal = computed<WritingGoal>(() => data.value.goal);
  const sessions = computed<WritingSession[]>(() => data.value.sessions);
  const streak = computed<WritingStreak>(() => data.value.streak);

  // 上一次「动笔」的锚点（不进 state、不走响应式代理：它是结算用的时刻，不是要渲染的数）
  let lastActivity: { docRelPath: string | undefined; atMs: number } | null = null;
  /** 不足一秒的零头攒在这里，攒够一秒才入账。每次活动都四舍五入会让快打字的人永远 0 秒。 */
  let pendingMs = 0;

  // ---- Getters ----

  /**
   * 某一日的进度**唯一**算法。
   * 以前 `todayProgress`、`recentProgress`、`getRecentDays` 是三份手抄的同一件事（台账「重复实现」那一族），
   * 加时长字段时必须一次改三处、漏一处就让同一格在不同面板显示成不同数字——所以收成这一处，三个出口都走它。
   */
  function progressForDate(key: string): GoalProgress {
    const { wordsWritten, durationSeconds } = sumDay(sessions.value.filter((s) => s.date === key));
    const target = goal.value.dailyWordTarget;
    const targetSeconds = Math.max(0, Math.round(goal.value.dailyTimeTarget * 60));
    return {
      date: key,
      wordsWritten,
      target,
      percentage: toPercentage(wordsWritten, target),
      // 字数那一支保持旧口径（含「目标 0 也算达标」），因为它驱动连续达标天数；
      // 改判会把用户已有的 streak 追溯改掉，那不是这一波要动的事（时长那一支是新加的，没有历史包袱）。
      reached: wordsWritten >= target,
      secondsWritten: durationSeconds,
      targetSeconds,
      timePercentage: toPercentage(durationSeconds, targetSeconds),
      timeReached: targetSeconds > 0 && durationSeconds >= targetSeconds
    };
  }

  const todayProgress = computed<GoalProgress>(() => progressForDate(todayKey()));

  const recentProgress = computed<GoalProgress[]>(() => {
    const now = Date.now();
    const result: GoalProgress[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      result.push(progressForDate(todayKey(new Date(now - i * 86_400_000))));
    }
    return result;
  });

  const recentSessions = computed<WritingSession[]>(() => {
    return [...sessions.value].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 10);
  });

  const todayDurationSeconds = computed<number>(() => {
    const key = todayKey();
    return sessions.value
      .filter((s) => s.date === key)
      .reduce((sum, s) => sum + s.durationSeconds, 0);
  });

  const averageSpeed = computed<number>(() => {
    const totalWords = sessions.value.reduce((sum, s) => sum + s.wordsWritten, 0);
    const totalMinutes = sessions.value.reduce((sum, s) => sum + s.durationSeconds, 0) / 60;
    if (totalMinutes <= 0) return 0;
    return Math.round(totalWords / totalMinutes);
  });

  // ---- Actions ----

  function updateGoal(partial: Partial<WritingGoal>): void {
    data.value.goal = { ...goal.value, ...partial };
  }

  /**
   * 记录一次写入。每次保存完成时调用，累计今日字数。
   * @param docRelPath 文档路径（可选）
   * @param fullContent 保存后的完整内容
   * @param previousContent 保存前的内容（可选，用于算 delta；不传则按整篇长度兜底）
   */
  function recordWriting(
    docRelPath: string | undefined,
    fullContent: string,
    previousContent?: string
  ): void {
    if (!goal.value.enabled) return;
    const wordsNow = countWords(fullContent);
    const wordsPrev = previousContent !== undefined ? countWords(previousContent) : 0;
    todayRow(docRelPath).wordsWritten += Math.max(0, wordsNow - wordsPrev);

    // 检查是否刚达标（用于连续天数）
    recomputeStreak();
  }

  /**
   * 今日这一篇的会话行，没有就当场建一条。
   * 字数与时长**共用同一行**——以前两条通路各推各的行，会出现「一行只有字数、一行只有时长」的半截记录。
   */
  function todayRow(docRelPath: string | undefined): WritingSession {
    const key = todayKey();
    const existing = sessions.value.find((s) => s.date === key && s.docRelPath === docRelPath);
    if (existing) return existing;
    const row: WritingSession = {
      id: genId(),
      date: key,
      wordsWritten: 0,
      durationSeconds: 0,
      ...(docRelPath !== undefined ? { docRelPath } : {})
    };
    data.value.sessions.push(row);
    return row;
  }

  /**
   * 记一次「动笔」：结算**距上一次活动**的那段间隔，把它记进当前文稿的写作时长。
   *
   * 为什么不是「开始/结束」两个按钮：那两个接口（`startSession`/`endSession`）是番茄钟那一套留下的，
   * 2026-10-05 专注模式整条下线时调用方删净了，接口留在原地没人调——于是面板底栏的
   * 「平均速度」「今日时长」恒显示 0（2026-10-09 扫描总单「假控件与死路清单」第 1 行）。
   * 时长该由**有没有在动笔**推出来，而不是由一个界面上已经不存在的按钮推出来。
   *
   * 三条不计入的空档，都是为了让这个数如实：
   * - 第一次活动只立锚点（没有「上一次」可算）；
   * - 换文稿的那一跨（人在挑稿，不是在这一篇上写；归属要落在真正在写的那一篇）；
   * - 距上一次超过 `IDLE_GAP_MS`（那是离席，不是写作）。
   * 时钟回拨与同一刻的重复事件同样不入账，免得凭空造出负数或 0 秒噪声。
   */
  function activity(docRelPath: string | undefined, atMs: number): void {
    if (!goal.value.enabled) return;
    const prev = lastActivity;
    lastActivity = { docRelPath, atMs };
    if (prev === null || prev.docRelPath !== docRelPath) return;
    const elapsed = atMs - prev.atMs;
    if (elapsed <= 0 || elapsed > IDLE_GAP_MS) return;
    pendingMs += elapsed;
    const { seconds, restMs } = takeWholeSeconds(pendingMs);
    pendingMs = restMs;
    if (seconds > 0) todayRow(docRelPath).durationSeconds += seconds;
  }

  /**
   * 重新计算连续达标天数。
   * 时长字段不进这里：这里的口径历来是「字数达标」，改判会追溯改掉用户已有的 streak。
   */
  function recomputeStreak(): void {
    const dayMap = new Map<string, number>();
    for (const s of sessions.value) {
      dayMap.set(s.date, (dayMap.get(s.date) ?? 0) + s.wordsWritten);
    }

    const reachedDates = [...dayMap.entries()]
      .filter(([, words]) => words >= goal.value.dailyWordTarget)
      .map(([date]) => date)
      .sort((a, b) => b.localeCompare(a)); // 降序

    if (reachedDates.length === 0) {
      data.value.streak = {
        currentStreak: 0,
        longestStreak: streak.value.longestStreak,
        lastReachDate: null
      };
      return;
    }

    // 最长连续
    let longest = 1;
    let run = 1;
    for (let i = 1; i < reachedDates.length; i += 1) {
      const prev = new Date(reachedDates[i - 1]!);
      const curr = new Date(reachedDates[i]!);
      const diff = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
      if (diff <= 1) {
        run += 1;
        if (run > longest) longest = run;
      } else {
        run = 1;
      }
    }

    // 当前连续：从今天/昨天往前数
    const today = todayKey();
    const yesterday = todayKey(new Date(Date.now() - 86_400_000));
    const mostRecent = reachedDates[0]!;
    let current = 0;
    if (mostRecent === today || mostRecent === yesterday) {
      let check = mostRecent === today ? new Date() : new Date(Date.now() - 86_400_000);
      for (let i = 0; i < reachedDates.length; i += 1) {
        const key = todayKey(check);
        if (dayMap.get(key)! >= goal.value.dailyWordTarget) {
          current += 1;
          check = new Date(check.getTime() - 86_400_000);
        } else {
          break;
        }
      }
    }

    data.value.streak = {
      currentStreak: current,
      longestStreak: Math.max(longest, streak.value.longestStreak),
      lastReachDate: mostRecent
    };
  }

  /** 今日进度（替代旧接口，实际走 computed）。 */
  function getTodayProgress(): GoalProgress {
    return todayProgress.value;
  }

  /** 最近 count 天的进度，与热力图同一份算法（`progressForDate`）。 */
  function getRecentDays(count: number): GoalProgress[] {
    const now = Date.now();
    const result: GoalProgress[] = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      result.push(progressForDate(todayKey(new Date(now - i * 86_400_000))));
    }
    return result;
  }

  function getRecentSessions(count: number): WritingSession[] {
    return recentSessions.value.slice(0, count);
  }

  function getWritingSpeed(): number {
    return averageSpeed.value;
  }

  /* ── 逐章目标（2026-10-22）──
   * 键就是「书内相对路径」，与编辑器当前那页同一口径，换章自动换目标。
   * 0 表示没设——删键而不是存 0，盘上不留一堆没意义的零。 */
  function chapterTargetOf(docRelPath: string | undefined): number {
    if (docRelPath === undefined) return 0;
    return data.value.chapterTargets[docRelPath] ?? 0;
  }

  function setChapterTarget(docRelPath: string, target: number): void {
    if (docRelPath === "") return;
    const value = Number.isFinite(target) && target > 0 ? Math.floor(target) : 0;
    const next = { ...data.value.chapterTargets };
    if (value === 0) delete next[docRelPath];
    else next[docRelPath] = value;
    data.value.chapterTargets = next;
  }

  return {
    goal,
    sessions,
    streak,
    /** 落盘失败的原因（空串＝正常）；目标面板据此说一句人话。 */
    saveError,
    todayProgress,
    recentProgress,
    recentSessions,
    todayDurationSeconds,
    averageSpeed,
    updateGoal,
    recordWriting,
    activity,
    recomputeStreak,
    getTodayProgress,
    getRecentDays,
    getRecentSessions,
    getWritingSpeed,
    chapterTargetOf,
    setChapterTarget
  };
});

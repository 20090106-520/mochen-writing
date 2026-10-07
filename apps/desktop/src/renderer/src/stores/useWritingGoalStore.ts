/**
 * WritingGoalStore —— 写作目标管理
 *
 * 每日字数目标、写作会话计时、连续达标天数、本周热力图。
 * 持久化到 localStorage key `mochen.writing-goals.v1`。
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

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
}

export interface WritingStreak {
  /** 连续达标天数 */
  currentStreak: number;
  longestStreak: number;
  lastReachDate: string | null;
}

interface PersistedState {
  goal: WritingGoal;
  sessions: WritingSession[];
  streak: WritingStreak;
}

const STORAGE_KEY = "mochen.writing-goals.v1";

const DEFAULT_GOAL: WritingGoal = {
  dailyWordTarget: 1000,
  dailyTimeTarget: 30,
  enabled: true,
  totalWordTarget: 0
};

const DEFAULT_STREAK: WritingStreak = {
  currentStreak: 0,
  longestStreak: 0,
  lastReachDate: null
};

function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadState(): PersistedState {
  if (typeof localStorage === "undefined") {
    return { goal: { ...DEFAULT_GOAL }, sessions: [], streak: { ...DEFAULT_STREAK } };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { goal: { ...DEFAULT_GOAL }, sessions: [], streak: { ...DEFAULT_STREAK } };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      goal: { ...DEFAULT_GOAL, ...(parsed.goal ?? {}) },
      sessions: parsed.sessions ?? [],
      streak: { ...DEFAULT_STREAK, ...(parsed.streak ?? {}) }
    };
  } catch {
    return { goal: { ...DEFAULT_GOAL }, sessions: [], streak: { ...DEFAULT_STREAK } };
  }
}

function saveState(state: PersistedState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 静默
  }
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

export const useWritingGoalStore = defineStore("writingGoal", () => {
  const persisted = loadState();

  const goal = ref<WritingGoal>({ ...persisted.goal });
  const sessions = ref<WritingSession[]>([...persisted.sessions]);
  const streak = ref<WritingStreak>({ ...persisted.streak });

  // 当前进行中的会话计时（不进 state，不走响应式代理）
  let sessionStartTs: number | null = null;
  let pendingDocRelPath: string | undefined = undefined;

  // 持久化
  watch(
    [goal, sessions, streak],
    ([g, s, st]) => {
      saveState({ goal: g, sessions: s, streak: st });
    },
    { deep: true }
  );

  // ---- Getters ----

  const todayProgress = computed<GoalProgress>(() => {
    const key = todayKey();
    const todayWords = sessions.value
      .filter((s) => s.date === key)
      .reduce((sum, s) => sum + s.wordsWritten, 0);
    const pct =
      goal.value.dailyWordTarget > 0
        ? Math.min(100, Math.round((todayWords / goal.value.dailyWordTarget) * 100))
        : 0;
    return {
      date: key,
      wordsWritten: todayWords,
      target: goal.value.dailyWordTarget,
      percentage: pct,
      reached: todayWords >= goal.value.dailyWordTarget
    };
  });

  const recentProgress = computed<GoalProgress[]>(() => {
    const result: GoalProgress[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const key = todayKey(d);
      const words = sessions.value
        .filter((s) => s.date === key)
        .reduce((sum, s) => sum + s.wordsWritten, 0);
      const pct =
        goal.value.dailyWordTarget > 0
          ? Math.min(100, Math.round((words / goal.value.dailyWordTarget) * 100))
          : 0;
      result.push({
        date: key,
        wordsWritten: words,
        target: goal.value.dailyWordTarget,
        percentage: pct,
        reached: words >= goal.value.dailyWordTarget
      });
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
    goal.value = { ...goal.value, ...partial };
  }

  /**
   * 记录一次写入。每次保存时调用，累计今日字数。
   * @param docRelPath 文档路径（可选）
   * @param fullContent 保存后的完整内容
   * @param previousContent 保存前的内容（可选，用于算 delta；不传则用完整内容长度兜底）
   */
  function recordWriting(
    docRelPath: string | undefined,
    fullContent: string,
    previousContent?: string
  ): void {
    if (!goal.value.enabled) return;
    const key = todayKey();
    const wordsNow = countWords(fullContent);
    const wordsPrev = previousContent !== undefined ? countWords(previousContent) : 0;
    const delta = Math.max(0, wordsNow - wordsPrev);

    const existing = sessions.value.find((s) => s.date === key && s.docRelPath === docRelPath);
    if (existing) {
      existing.wordsWritten += delta;
    } else {
      sessions.value.push({
        id: genId(),
        date: key,
        wordsWritten: delta,
        durationSeconds: 0,
        ...(docRelPath !== undefined ? { docRelPath } : {})
      });
    }

    // 检查是否刚达标（用于连续天数）
    recomputeStreak();
  }

  /** 开始计时会话（番茄钟）。 */
  function startSession(docRelPath?: string): void {
    sessionStartTs = Date.now();
    pendingDocRelPath = docRelPath;
  }

  /** 结束计时会话，回填到当日 session。 */
  function endSession(docRelPath?: string): void {
    if (sessionStartTs === null) return;
    const elapsed = Math.round((Date.now() - sessionStartTs) / 1000);
    sessionStartTs = null;
    const key = todayKey();
    const path = docRelPath ?? pendingDocRelPath;
    pendingDocRelPath = undefined;

    const existing = sessions.value.find((s) => s.date === key && s.docRelPath === path);
    if (existing) {
      existing.durationSeconds += elapsed;
    } else if (elapsed > 0) {
      sessions.value.push({
        id: genId(),
        date: key,
        wordsWritten: 0,
        durationSeconds: elapsed,
        ...(path !== undefined ? { docRelPath: path } : {})
      });
    }
  }

  /** 重新计算连续达标天数。 */
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
      streak.value = {
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

    streak.value = {
      currentStreak: current,
      longestStreak: Math.max(longest, streak.value.longestStreak),
      lastReachDate: mostRecent
    };
  }

  /** 获得今日进度（替代旧接口，实际走 computed）。 */
  function getTodayProgress(): GoalProgress {
    return todayProgress.value;
  }

  function getRecentDays(count: number): GoalProgress[] {
    const result: GoalProgress[] = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const key = todayKey(d);
      const words = sessions.value
        .filter((s) => s.date === key)
        .reduce((sum, s) => sum + s.wordsWritten, 0);
      const pct =
        goal.value.dailyWordTarget > 0
          ? Math.min(100, Math.round((words / goal.value.dailyWordTarget) * 100))
          : 0;
      result.push({
        date: key,
        wordsWritten: words,
        target: goal.value.dailyWordTarget,
        percentage: pct,
        reached: words >= goal.value.dailyWordTarget
      });
    }
    return result;
  }

  function getRecentSessions(count: number): WritingSession[] {
    return recentSessions.value.slice(0, count);
  }

  function getWritingSpeed(): number {
    return averageSpeed.value;
  }

  return {
    goal,
    sessions,
    streak,
    todayProgress,
    recentProgress,
    recentSessions,
    todayDurationSeconds,
    averageSpeed,
    updateGoal,
    recordWriting,
    startSession,
    endSession,
    recomputeStreak,
    getTodayProgress,
    getRecentDays,
    getRecentSessions,
    getWritingSpeed
  };
});

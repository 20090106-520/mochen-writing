import type { WritingGoal, WritingSession, WritingStreak } from "../stores/useWritingGoalStore";

/**
 * 写作目标文件的形状校验与默认值（2026-10-09 扫描总单 P0-7）。
 *
 * 与 `note-shape` / `bible-shape` 同一条标准：**认不得的形状判读不懂（返回 null），
 * 只是缺了整格的老版本存档补默认值放行**。判反的代价在这里比前两本更高：
 * 这一份里全是数字，`dailyWordTarget` 兜成 0 面板就说「已达标」，`durationSeconds` 兜成 0
 * 今天写过的时长凭空消失，`currentStreak` 读歪连续天数当场倒退——所以宁可判读不懂、停止写盘。
 *
 * 默认值也住在这里（不在 store 里另留一份）：盘上那份应该长成什么样，
 * 与「读不懂时补成什么样」必须是同一个真身，否则下一次校验自己就不认自己写的文件。
 * `goal-shape → store` 只引类型（编译期擦除），store 反过来引这里的值，因此没有运行时循环。
 */

/** 落在书里 `.mochen/data/writing-goal.json` 的那一份内容。 */
export interface WritingGoalData {
  goal: WritingGoal;
  sessions: WritingSession[];
  streak: WritingStreak;
}

/**
 * 没设过目标时的起点。`totalWordTarget: 0` 是「未设定」那一档（WordCountPanel 认这个口径），
 * 不是「目标是 0 字」——面板那边 0 会显示成「未设全书目标」。
 */
export const DEFAULT_GOAL: WritingGoal = {
  dailyWordTarget: 1000,
  dailyTimeTarget: 30,
  enabled: true,
  totalWordTarget: 0
};

export const DEFAULT_STREAK: WritingStreak = {
  currentStreak: 0,
  longestStreak: 0,
  lastReachDate: null
};

/** 盘上还没有这份数据时的起点（`useBookFileData` 的 `empty()` 也用它，两处一份）。 */
export function emptyWritingGoalData(): WritingGoalData {
  return { goal: { ...DEFAULT_GOAL }, sessions: [], streak: { ...DEFAULT_STREAK } };
}

/**
 * 「这份旧的全局数据里根本没有可迁的东西」——迁移那一路用它决定要不要真往这本书里写一次。
 * 判据是**整份都停在默认值**：会话一条没有、连续天数没记过、四格目标一格没改。
 * 只要改过任一格（哪怕只把每日目标调成 2000），那就是作者的手笔，必须迁走。
 */
export function isDefaultWritingGoalData(value: WritingGoalData): boolean {
  return (
    value.sessions.length === 0 &&
    value.streak.currentStreak === DEFAULT_STREAK.currentStreak &&
    value.streak.longestStreak === DEFAULT_STREAK.longestStreak &&
    value.streak.lastReachDate === DEFAULT_STREAK.lastReachDate &&
    value.goal.dailyWordTarget === DEFAULT_GOAL.dailyWordTarget &&
    value.goal.dailyTimeTarget === DEFAULT_GOAL.dailyTimeTarget &&
    value.goal.enabled === DEFAULT_GOAL.enabled &&
    value.goal.totalWordTarget === DEFAULT_GOAL.totalWordTarget
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 「这一格认不得」的哨兵。
 * 用 `undefined`/`null` 兼职不行：那两样本身是合法取值（`lastReachDate` 就能是 null），
 * 混用会把「没写过」读成「写坏了」。
 */
const BAD = Symbol("bad-shape");

/** 计数类字段：有限且非负；整格缺失补 `fallback`。 */
function countField(value: unknown, fallback: number): number | typeof BAD {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return BAD;
  return value;
}

/** 开关：只认真布尔值；缺失补 `fallback`。`"false"` 这种字符串必须判读不懂，否则关掉的开关会开着。 */
function boolField(value: unknown, fallback: boolean): boolean | typeof BAD {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") return BAD;
  return value;
}

/** 文本：缺失或空串都当「没写」（返回 undefined，调用方不带这格）；类型不对判读不懂。 */
function textField(value: unknown): string | undefined | typeof BAD {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") return BAD;
  return value;
}

function normalizeGoal(raw: unknown): WritingGoal | typeof BAD {
  // 整格没写 = 老版本存档，补默认；写了但不是对象 = 这份文件不是我们认识的那份。
  if (raw === undefined) return { ...DEFAULT_GOAL };
  if (!isRecord(raw)) return BAD;
  const dailyWordTarget = countField(raw.dailyWordTarget, DEFAULT_GOAL.dailyWordTarget);
  const dailyTimeTarget = countField(raw.dailyTimeTarget, DEFAULT_GOAL.dailyTimeTarget);
  const totalWordTarget = countField(raw.totalWordTarget, DEFAULT_GOAL.totalWordTarget);
  const enabled = boolField(raw.enabled, DEFAULT_GOAL.enabled);
  if (
    dailyWordTarget === BAD ||
    dailyTimeTarget === BAD ||
    totalWordTarget === BAD ||
    enabled === BAD
  ) {
    return BAD;
  }
  return { dailyWordTarget, dailyTimeTarget, enabled, totalWordTarget };
}

function normalizeSession(raw: unknown): WritingSession | typeof BAD {
  if (!isRecord(raw)) return BAD;
  const id = textField(raw.id);
  const date = textField(raw.date);
  if (id === BAD || id === undefined || date === BAD || date === undefined) return BAD;
  const wordsWritten = countField(raw.wordsWritten, 0);
  const durationSeconds = countField(raw.durationSeconds, 0);
  const docRelPath = textField(raw.docRelPath);
  if (wordsWritten === BAD || durationSeconds === BAD || docRelPath === BAD) return BAD;
  return {
    id,
    date,
    wordsWritten,
    durationSeconds,
    ...(docRelPath !== undefined ? { docRelPath } : {})
  };
}

function normalizeStreak(raw: unknown): WritingStreak | typeof BAD {
  if (raw === undefined) return { ...DEFAULT_STREAK };
  if (!isRecord(raw)) return BAD;
  const currentStreak = countField(raw.currentStreak, DEFAULT_STREAK.currentStreak);
  const longestStreak = countField(raw.longestStreak, DEFAULT_STREAK.longestStreak);
  if (currentStreak === BAD || longestStreak === BAD) return BAD;
  // lastReachDate 三档：没写 / 明确 null → 都没有达到过；字符串 → 那一天；其余（数字、对象）判读不懂。
  const last =
    raw.lastReachDate === undefined || raw.lastReachDate === null
      ? null
      : textField(raw.lastReachDate);
  if (last === BAD) return BAD;
  return { currentStreak, longestStreak, lastReachDate: last ?? null };
}

export function normalizeWritingGoalData(parsed: unknown): WritingGoalData | null {
  if (!isRecord(parsed)) return null;
  const goal = normalizeGoal(parsed.goal);
  const streak = normalizeStreak(parsed.streak);
  // 会话那一格：没写 = 这本书还没记过（补空表），写了但不是表 = 读不懂。
  const rawSessions = parsed.sessions === undefined ? [] : parsed.sessions;
  if (goal === BAD || streak === BAD || !Array.isArray(rawSessions)) return null;
  const sessions: WritingSession[] = [];
  for (const raw of rawSessions) {
    const row = normalizeSession(raw);
    // 悄悄丢掉一条 = 替用户删掉他那一天的字数与时长，而屏上什么都不会说：整份判读不懂。
    if (row === BAD) return null;
    sessions.push(row);
  }
  return { goal, sessions, streak };
}

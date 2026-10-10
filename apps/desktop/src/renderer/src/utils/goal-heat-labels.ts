/**
 * 热力图那七格的「星期几 / 几号」标签（2026-10-09 扫描总单 P1-10）。
 *
 * 【病灶】面板写死 `weekdayLabels = ["一"…"日"]` 并按**数组下标**贴，而数据是「最近 7 天滚动窗口」。
 * 窗口起点几乎不可能是周一 ⇒ 除今天正好是周日之外，七天里有六天标错。
 *
 * 【口径】标签一律**从那一格自己的日期算**，下标不参与判定；`shortDateLabelOfDateKey` 与
 * `weekdayLabelOfDateKey` 共用同一个解析函数，号数和星期永远出自同一次 parse
 * （两处各 parse 一次，迟早变成「号数对、星期偏一天」那种查不出根的错）。
 *
 * 【为什么抽到 util】本仓 `.vue` 不进类型程序、也没有 jsdom，写在 `<script setup>` 里的判定两头测不到
 * （同一个理由见 `utils/writing-goal-heat.ts`）。
 *
 * 【时区】键是**本地**键（`useWritingGoalStore.ts` 的 `todayKey()` 用 getFullYear/getMonth/getDate），
 * 所以解析必须拆成三段走本地构造函数：`new Date("2026-10-09")` 走的是 UTC 零点，在西侧时区会落到
 * 本地 10-08，「周五」当场变「周四」。用例里当场切 `process.env.TZ` 钉住这一条。
 */

/** JS `getDay()` 的取值就是一档不差的七天；写成穷尽表而不是数组，加一档不配中文就过不了 tsc（铁律 6）。 */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "日",
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六"
};

/** 认不得的键在屏上的占位。不许是空串（那格会塌），更不许是 `NaN`。 */
const UNKNOWN_LABEL = "—";

function isWeekday(value: number): value is Weekday {
  return (
    value === 0 ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6
  );
}

/** `YYYY-MM-DD` → 本地日历的三段；任何一步对不上就判「认不得」，不做任何猜测式补全。 */
function parseDateKey(key: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (matched === null) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const local = new Date(year, month - 1, day);
  // 回读一次：`new Date(2026, 1, 30)` 会自己滚到 3 月，那种键不能算合法日期。
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
    return null;
  }
  return local;
}

/** 那一格是星期几（中文一字）。 */
export function weekdayLabelOfDateKey(key: string): string {
  const local = parseDateKey(key);
  if (local === null) return UNKNOWN_LABEL;
  const index = local.getDay();
  return isWeekday(index) ? WEEKDAY_LABELS[index] : UNKNOWN_LABEL;
}

/** 那一格是几号，形如 `10/9`（月/日，不补零——沿用面板原来的写法）。 */
export function shortDateLabelOfDateKey(key: string): string {
  const local = parseDateKey(key);
  if (local === null) return UNKNOWN_LABEL;
  return `${local.getMonth() + 1}/${local.getDate()}`;
}

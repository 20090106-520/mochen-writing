/**
 * 时间线一致性检查（2026-10-05，批次 5-①）的判定层。
 *
 * **边界与批次 4-② 的审稿打分同源**：本地只报**能数出来**的矛盾，不报「剧情合不合理」。
 * 「这个角色该不该在这一章出现」是判断不是算术，硬判就是编一个结论骗作者。
 * 算不出的那部分在 `TIMELINE_BLIND_SPOT` 里明写。
 *
 * **一条时间线就是一篇普通文稿**（`timeline/` 目录下的 .md），日期走 frontmatter：
 * ```
 * ---
 * date: 2026-03-05
 * ---
 * ```
 * 刻意不新造存储——复用文稿层就自动有了左栏树、AI 可读写、搜索、备份与改稿历史。
 *
 * **为什么日期解析住 contracts**：主进程要扫盘上的时间线文稿，渲染层要显示，两侧必须同一份，
 * 而渲染层进不了 fs-store（包边界门禁）。
 */
import { frontmatterField, splitFrontmatter } from "./frontmatter.js";

/** 故事内日期。用 ISO 的 `YYYY-MM-DD`——排序靠字典序就对了，不必引入日期库。 */
export type StoryDate = string;

/** 一年里的第几天（1-366），用来算「隔了几天」；闰年按 4 年一闰、百年不闰、四百年再闰。 */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;

export function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

export interface TimelineMeta {
  /** frontmatter 里的 `date:` 原样取值；没写就是空串。 */
  rawDate: string;
  /** 解析出的日期；`rawDate` 写坏了就是 `null`（**不猜、不就近取一个**）。 */
  date: StoryDate | null;
  /**
   * 原样取值里"日期字段写坏了"的说明（没写则是空串）。
   * 认不出的值要显式告诉作者：悄悄跳过等于让这条时间线从台账上消失，
   * 而凭空消失的那条恰恰是最该被看见的（与伏笔台账同一条纪律）。
   */
  dateProblem: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 把 `date:` 的取值验成真日期：形状对 + 那天真的存在（2 月 30 日要报坏）。 */
export function parseStoryDate(value: string): StoryDate | null {
  const m = ISO_DATE.exec(value.trim());
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  const limit = month === 2 && isLeapYear(year) ? 29 : (MONTH_DAYS[month - 1] as number);
  if (day < 1 || day > limit) return null;
  return value.trim();
}

/** 解析一篇时间线文稿的 frontmatter。 */
export function parseTimelineMeta(raw: string): TimelineMeta {
  const { block } = splitFrontmatter(raw);
  const rawDate = frontmatterField(block, "date");
  if (rawDate === "") {
    return { rawDate, date: null, dateProblem: "" };
  }
  const date = parseStoryDate(rawDate);
  if (date !== null) return { rawDate, date, dateProblem: "" };
  return {
    rawDate,
    date: null,
    dateProblem: `日期字段不是 YYYY-MM-DD 的真日期（写的是「${rawDate}」），这一条没有排进顺序`
  };
}

/**
 * `2026-03-05` → 当年第几天（1 起）。认不出的日期回 `null`，绝不返回 0 或 -1 去参与减法。
 *
 * **先过 `parseStoryDate` 再算**：2 月 30 日不是「3 月 2 日的前一天」，它根本不存在。
 * 直接拿 `Number()` 算会得出一个看着能用的天数，然后被拿去判「正文说三天、日期只隔两天」——
 * 凭空造出一条不存在的矛盾比不报更糟。
 */
export function dayOfYear(date: StoryDate): number | null {
  if (parseStoryDate(date) === null) return null;
  const m = ISO_DATE.exec(date);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return (MONTH_STARTS[month - 1] as number) + day + (month > 2 && isLeapYear(year) ? 1 : 0);
}

/**
 * 两个故事日期之间隔了几天（`to - from`）。
 * 跨年也算：2025-12-30 → 2026-01-02 是 3 天。
 * 任一认不出就回 `null`——**不给 0**，0 会被当成"同一天"拿去判「矛盾」。
 */
export function daysBetween(from: StoryDate, to: StoryDate): number | null {
  const a = dayOfYear(from);
  const b = dayOfYear(to);
  if (a === null || b === null) return null;
  const ya = Number(from.slice(0, 4));
  const yb = Number(to.slice(0, 4));
  if (ya === yb) return b - a;
  // 跨年：用中间那一年的天数把两段接上（不假设只跨一年，但跨两年以上不给结论）。
  if (yb - ya !== 1) return null;
  const yearDays = isLeapYear(ya) ? 366 : 365;
  return yearDays - a + b;
}

/* ── 正文里的「N 天后 / N 天前」 ── */

const ELAPSED_RE =
  /([零一二两三四五六七八九十百\d]+)\s*(天|日|周|个月|月|年)(后|之后|以后|前|之前|以前)/g;

const CN_NUM: Record<string, number> = {
  零: 0,
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
};

/**
 * 认不出的量词（「半个时辰后」「若干天后」）回 `null`——那句话就不参与核对，不当成 0 天。
 *
 * **每次调用必须新建一份正则**：模块级带 `/g` 的正则带 `lastIndex` 状态，
 * 复用同一个实例会隔一次漏掉一次匹配——那是一种「跑得越久越准」的鬼故事。
 */
export function parseElapsed(
  text: string
): { amount: number; unit: string; later: boolean; raw: string } | null {
  const m = new RegExp(ELAPSED_RE.source, "g").exec(text);
  if (m === null) return null;
  const amount = /^\d+$/.test(m[1] as string) ? Number(m[1]) : CN_NUM[m[1] as string];
  if (amount === undefined) return null;
  const unitWord = m[2] as string;
  const later = (m[3] as string).startsWith("后");
  return { amount, unit: unitWord, later, raw: m[0] };
}

export interface TimelineEntry {
  /** 文稿相对路径（点行时用它打开那篇）。 */
  relPath: string;
  title: string;
  date: StoryDate | null;
  /** 没写日期 / 日期写坏了的说明；正常时是空串。 */
  dateProblem: string;
  /** 正文原文（用来核「N 天后」这类话）；没有就空串。 */
  text: string;
}

export type TimelineIssueKind = "unsorted" | "gap" | "unreadable";

export interface TimelineIssue {
  kind: TimelineIssueKind;
  /** 中文一句话，直接可读。 */
  text: string;
  /** 牵涉到的文稿（点一下就能跳过去看）。 */
  relPaths: string[];
  /** 给人核对的原始读数；没有就空串。 */
  reading: string;
}

/**
 * 查一遍时间线。
 *
 * **只报三种，且都在算术上确凿的**：
 * ① `unreadable` 日期字段写坏了（显式报，绝不悄悄跳过）；
 * ② `unsorted` 两篇的日期写反了（后发生的排在前面）；
 * ③ `gap` 正文里说「三天后」，而两篇的日期只隔了两天。
 *
 * **不报的**：谁该不该在场、事件该不该发生——那些是判断，见 `TIMELINE_BLIND_SPOT`。
 */
export function checkTimeline(entries: readonly TimelineEntry[]): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const dated = entries.filter((e): e is TimelineEntry & { date: StoryDate } => e.date !== null);

  for (const entry of entries) {
    if (entry.dateProblem === "") continue;
    issues.push({
      kind: "unreadable",
      text: entry.dateProblem,
      relPaths: [entry.relPath],
      reading: entry.title
    });
  }

  // 按日期升序排一遍；只报**相邻两行**写反的那处（不刷屏）
  const sorted = [...dated].sort((a, b) => (a.date as string).localeCompare(b.date as string));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1] as TimelineEntry & { date: StoryDate };
    const cur = sorted[i] as TimelineEntry & { date: StoryDate };
    if ((prev.date as string).localeCompare(cur.date as string) > 0) {
      issues.push({
        kind: "unsorted",
        text: `按日期排下来「${prev.title}」在「${cur.title}」后面，但它的日期更早——这两篇的先后可能写反了。`,
        relPaths: [prev.relPath, cur.relPath],
        reading: `${prev.date} → ${cur.date}`
      });
    }
  }

  // 间隔核对：正文说 N 天后/前，日期却对不上。
  //
  // **只看 `to`（当前篇）自己的话，且只跟紧邻的 `prev` 比**：
  // 「三天后」说的是「从我（上一篇）到这儿过了三天」——它天然是相对**上一篇**说的。
  // 此前这圈里对 `[to, from]` 两边都试，于是中间那篇既当下篇被比（对）、
  // 又当下一篇的 `from` 再被比一次（错）——「抵达」那句「三天后」被拿去和「安居」比，
  // 硬报出一条「只隔 2 天」之外的假矛盾（真机 2026-10-05 撞到）。
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1] as TimelineEntry & { date: StoryDate };
    const cur = sorted[i] as TimelineEntry & { date: StoryDate };
    const span = daysBetween(prev.date as string, cur.date as string);
    if (span === null || span <= 0) continue;
    const said = parseElapsed(cur.text);
    if (said === null) continue;
    const expectDays = toDays(said);
    if (expectDays === null || expectDays === 0) continue;
    // 容差是 **0**：正文说「三天后」而日期只隔两天，就是矛盾。
    // 这里曾留过 1 天的容差（想着"作者不必精确到分毫不差"），
    // 但「隔了 2 天」在故事里就是「隔了 2 天」——作者写「三天后」多半是记错了，不是约等于。
    // 宁可多报一条让作者看一眼（报的是"核一核"，不是"你错了"），也不漏掉真矛盾。
    const drift = Math.abs(expectDays - span);
    if (drift > 0) {
      issues.push({
        kind: "gap",
        text: `「${cur.title}」里写着「${said.raw}」，但按前一篇 ${prev.date} 到这一篇 ${cur.date} 只隔 ${span} 天。`,
        relPaths: [prev.relPath, cur.relPath],
        reading: `正文说 ${expectDays} 天 / 日期差 ${span} 天`
      });
    }
  }

  return issues;
}

/** 把「3 天后」「两周前」「一个月后」折成天数；认不出的单位回 `null`。 */
function toDays(elapsed: { amount: number; unit: string; later: boolean }): number | null {
  const base = elapsed.unit === "天" || elapsed.unit === "日" ? elapsed.amount : null;
  const weeks = elapsed.unit === "周" ? elapsed.amount * 7 : null;
  const months = elapsed.unit === "个月" || elapsed.unit === "月" ? elapsed.amount * 30 : null;
  const years = elapsed.unit === "年" ? elapsed.amount * 365 : null;
  const days = base ?? weeks ?? months ?? years;
  if (days === null || days === undefined) return null;
  return elapsed.later ? days : -days;
}

/**
 * 本地查不出的那部分（明写，不藏）。
 * 留着「不算」比编一个「算了但不准」诚实得多——这也是 4-② 审稿打分立的那条规矩。
 */
export const TIMELINE_BLIND_SPOT = [
  { label: "谁该不该在场", hint: "要读人物设定与在场记录算，本地不查" },
  { label: "事件该不该发生", hint: "那是剧情判断，不是日期算术" }
] as const;

export const TIMELINE_BLIND_NOTE = "下面这几项本地查不出来——要靠 AI 通读，或你自己读一遍。";

/** 结论那句话。零矛盾时也要说话，不许给一片空白让人猜是不是没跑。 */
export function timelineVerdict(issues: readonly TimelineIssue[]): string {
  if (issues.length === 0) return "没查出矛盾。日期写得清楚、对得上。";
  const unreadable = issues.filter((i) => i.kind === "unreadable").length;
  const unsorted = issues.filter((i) => i.kind === "unsorted").length;
  const gap = issues.filter((i) => i.kind === "gap").length;
  const parts: string[] = [];
  if (unreadable > 0) parts.push(`${unreadable} 处日期读不出来`);
  if (unsorted > 0) parts.push(`${unsorted} 处先后可能写反`);
  if (gap > 0) parts.push(`${gap} 处正文与日期对不上`);
  return `查出 ${issues.length} 处要核一核：${parts.join("、")}。`;
}

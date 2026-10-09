/**
 * 字数读数的唯一口径（2026-10-09 扫描总单：`formatChars` 在五个面板各写了一份）。
 *
 * 规则（取覆盖面最广的那一份，并去掉只有大纲在用的「千字」档）：
 * - 坏读数（undefined / NaN / Infinity / 负数）一律说「0 字」，不许把 NaN 送上界面；
 * - 先四舍五入到整字——半字不存在，也让 9,999.5 与 10,000 落在同一个读数上；
 * - ≥1 万说「x.x 万字」（一位小数）；其余带千位分隔符说「n 字」。
 *
 * 为什么值得单独立一份：同一屏里大纲写着"12.3 千字"、统计面板写着"12,345 字"、
 * 另一个面板写着"1.23 万字"，作者无法判断哪个是真的。字数是这本书的核心数字，口径必须只有一处。
 */
export function formatCharCount(chars: number | undefined): string {
  const raw = typeof chars === "number" && Number.isFinite(chars) ? Math.max(0, chars) : 0;
  const n = Math.round(raw);
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万字`;
  return `${n.toLocaleString("zh-CN")} 字`;
}

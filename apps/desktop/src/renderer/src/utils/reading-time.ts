/** 中文阅读速度：300 字/分钟（附录 F-G 定死的口径，改它要有理由，不许模板里另算一遍）。 */
export const READING_MINUTES_PER_WORD = 300;

/**
 * 页脚「N 字」的计数口径：按**码点**而不是 UTF-16 码元，一个表情是一个字（本仓教训见 timeline.ts 的 Array.from 注释）。
 * 这条与 `readingMinutes` 必须同口径：两格并排显示，按码元数会给出「600 字 / 约 1 分钟阅读」这种自相矛盾的数。
 */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * 估算阅读时长，向上取整：读不完一分钟也算一分钟，「约 0 分钟阅读」是句假话。
 * 「字」= 去掉空白之后的**码点**：按 UTF-16 码元数会把一个表情算成两个字。
 * 去空白后一个字都没有 ⇒ null，由 `readingTimeLabel` 显示「— 分钟」。
 * 算术（本函数）与文案（`readingTimeLabel`）仍是两个函数：换算不许被文案夹带，
 * 但两者都不再住 `.vue`——本仓 `.vue` 的 `<script setup>` 既不进类型程序也没有运行时覆盖，
 * 文案漂在那里改名字谁也测不到（修复轮 F1 推翻的正是「字符串由模板拼」这条旧口径）。
 */
export function readingMinutes(text: string): number | null {
  let count = 0;
  for (const ch of Array.from(text)) {
    if (ch.trim() !== "") count += 1;
  }
  if (count === 0) return null;
  return Math.ceil(count / READING_MINUTES_PER_WORD);
}

/** 页脚时长那一格的唯一拼身处：模板只留一句 `{{ readingTimeLabel }}`，不许再在这里之外写第二份文案。 */
export function readingTimeLabel(text: string): string {
  const minutes = readingMinutes(text);
  return minutes === null ? "— 分钟" : `约 ${minutes} 分钟阅读`;
}

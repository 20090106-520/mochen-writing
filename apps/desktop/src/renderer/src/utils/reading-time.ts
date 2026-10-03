import { proseCharCount } from "@mochen/contracts";

/** 中文阅读速度：300 字/分钟（附录 F-G 定死的口径，改它要有理由，不许模板里另算一遍）。 */
export const READING_MINUTES_PER_WORD = 300;

/**
 * 估算阅读时长，向上取整：读不完一分钟也算一分钟，「约 0 分钟阅读」是句假话。
 * 「字」= 非空白码点，算术本身住在 `@mochen/contracts` 的 `proseCharCount`（唯一口径）：
 * 页脚的「N 字」与「约 M 分钟」并排显示，两处若各数一遍就会出现「600 字 / 约 1 分钟」这种自相矛盾的数，
 * 而书卡上的「正文 N 字」走的是扫描侧同一个 `proseCharCount` ⇒ 三格一个口径。
 * 去空白后一个字都没有 ⇒ null，由 `readingTimeLabel` 显示「— 分钟」。
 * 算术（本函数）与文案（`readingTimeLabel`）仍是两个函数：换算不许被文案夹带，
 * 但两者都不再住 `.vue`——本仓 `.vue` 的 `<script setup>` 既不进类型程序也没有运行时覆盖，
 * 文案漂在那里改名字谁也测不到（修复轮 F1 推翻的正是「字符串由模板拼」这条旧口径）。
 */
export function readingMinutes(text: string): number | null {
  const count = proseCharCount(text);
  if (count === 0) return null;
  return Math.ceil(count / READING_MINUTES_PER_WORD);
}

/** 页脚时长那一格的唯一拼身处：模板只留一句 `{{ readingTimeLabel }}`，不许再在这里之外写第二份文案。 */
export function readingTimeLabel(text: string): string {
  const minutes = readingMinutes(text);
  return minutes === null ? "— 分钟" : `约 ${minutes} 分钟阅读`;
}

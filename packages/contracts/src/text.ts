/**
 * 裸码点数（含空白）：「你敲进去多少字符」这一格的口径，也是截断/上限检查用的口径。
 * 一个表情算一个——按 UTF-16 码元会数成 2，用户看到的是一格，报出来是两格（本仓教训见 timeline 的 Array.from 注释）。
 * 别拿它当「字数」：那是下面 `proseCharCount` 的活，两者差的就是空白。
 */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * 「这篇稿子有多少字」的唯一口径：**非空白码点**。
 * 两条理由，缺一都不成立：
 * ① 空白不算字——段首缩进、换行、词间空格都不是作者写的字。页脚「N 字」与「约 M 分钟阅读」必须同口径，
 *    否则并排两格会给出「600 字 / 约 1 分钟」这种自相矛盾的数（旧实现里 `codePointLength` 数空白、
 *    `readingMinutes` 不数，正是这一格对不上那一格）。
 * ② 扫描侧与页脚侧共用它——书卡上的「正文 N 字」与打开同一篇时页脚的数，是同一个数而不是两个口径。
 */
export function proseCharCount(text: string): number {
  let count = 0;
  for (const ch of Array.from(text)) {
    if (ch.trim() !== "") count += 1;
  }
  return count;
}

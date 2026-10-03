/** 中文阅读速度：300 字/分钟（附录 F-G 定死的口径，改它要有理由，不许模板里另算一遍）。 */
export const READING_MINUTES_PER_WORD = 300;

/**
 * 估算阅读时长，向上取整：读不完一分钟也算一分钟，「约 0 分钟阅读」是句假话。
 * 「字」= 去掉空白之后的**码点**：按 UTF-16 码元数会把一个表情算成两个字（本仓教训见 timeline.ts 的 Array.from 注释）。
 * 去空白后一个字都没有 ⇒ null，由模板显示「— 分钟」：这里不返回字符串，
 * 免得换算与文案互相夹带（页脚那一格的口径是「算术不在模板里写」，反过来也一样）。
 */
export function readingMinutes(text: string): number | null {
  let count = 0;
  for (const ch of Array.from(text)) {
    if (ch.trim() !== "") count += 1;
  }
  if (count === 0) return null;
  return Math.ceil(count / READING_MINUTES_PER_WORD);
}

/**
 * 对话区「跟着往下走」的判据（2026-11-10 用户裁定）。
 *
 * **用户原话**：「对话自动往下拉」——模型一个字一个字往外吐的时候，中栏该自己往下滚；
 * 而他往上翻去读上一段时，**不许**把他拽回来。这两件事都得有，只做前一件就是「抢滚动条」。
 *
 * 所以这里没有「一有新内容就滚到底」这种开关，只有两个纯问题：
 * ① 现在离底还有多远（`distanceToBottom` / `isStuckToBottom`）；
 * ② **内容变没变**（`streamKey`）——变了才谈滚不滚，没变就一个像素都不动。
 *
 * 【为什么「内容变没变」要单独给一个 key】真机踩过：`useAgentStore` 收 delta 是
 * `thread.streaming[deltaKind] += text`——**就地改写**，`thread.streaming` 那个对象自始至终是同一个。
 * 于是 `watch(() => tail.value)` 一次都不会触发（引用没变），跟随看起来「写好了但不动」。
 * 能变的是那个**字符串的长度**，所以 key 从长度算，不从对象算。
 *
 * 与 CSS 无关、与 Vue 无关：本仓零 jsdom，能不能滚对只能在真机上看，
 * 但「什么算贴底」「什么算有新内容」这两条判断可以在这里钉死。
 */

/**
 * 还差多少像素以内算「贴着底」。
 *
 * 卡在 32 而不是 0：`scrollHeight` 是**取整**过的（真机上 1.25 倍行高会带出 .5），
 * 要求恰好滚到 0 就永远差 0.5px ⇒ 跟随永远不生效；而输入卡上方还有一层内边距，
 * 留 32px（约一行正文）也符合「我还看着最新那一行」的直觉。
 * 比 32 再大就会把「他确实往上翻了一屏的一半」误判成还在底部。
 */
export const STICK_SLACK = 32;

/** 一个滚动容器的三个读数（`scrollTop` / `scrollHeight` / `clientHeight` 的原样搬运）。 */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * 离底还有多少像素。**下界是 0**：滚到比底更下面（回弹、末条消息收起折叠）时
 * `scrollHeight - scrollTop - clientHeight` 会是负数，负数会让「≤ slack」在整段区间里恒真，
 * 也会让将来要显示的「还剩 N 字未读」变成负数。
 */
export function distanceToBottom(metrics: ScrollMetrics): number {
  const gap = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return gap > 0 ? gap : 0;
}

/** 此刻是不是贴着底（= 该跟随）。用户滚动与内容增长两处读的都是它。 */
export function isStuckToBottom(metrics: ScrollMetrics, slack: number = STICK_SLACK): boolean {
  return distanceToBottom(metrics) <= slack;
}

/**
 * 内容形状：**只装会改变高度的那些量**。
 *
 * 装的是「条数」与「字数」而不是「文本」：一来很长的正文不必每帧拼一遍字符串，
 * 二来滚不滚只跟「有没有新东西」有关，跟新东西是什么无关。
 * 提案卡也算——审稿卡是插在时间线末尾的，它出现时底部同样要跟上。
 */
export interface StreamShape {
  /** 时间线条目数（`items.length`）。 */
  itemCount: number;
  /** 本轮流式正文的**字数**（`tail.message.length`，不是对象）。 */
  messageChars: number;
  /** 本轮思考摘要的字数。 */
  reasoningChars: number;
  /** 待审卡 / 已裁决卡 / 上次会话未处理卡的条数。 */
  openCards: number;
  settledCards: number;
  expiredCards: number;
}

/**
 * 把形状压成一个可比较的 key。相同 ⇒ 什么都不用做（Vue 的 watch 也就不会触发）。
 *
 * 用 `:` 连、不用 JSON：这些量全是非负整数，分隔符不可能出现在值里，
 * 而 JSON.stringify 每帧给每个 delta 都造一次字符串对象。
 */
export function streamKey(shape: StreamShape): string {
  return [
    shape.itemCount,
    shape.messageChars,
    shape.reasoningChars,
    shape.openCards,
    shape.settledCards,
    shape.expiredCards
  ].join(":");
}

/** 从 DOM 滚动容器取三个读数：装配层只搬原值，判据仍走 isStuckToBottom。 */
export function scrollMetricsOf(el: HTMLElement): ScrollMetrics {
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
}

/**
 * 排队路径的回写裁决（评审 X1：数据丢失）。
 *
 * Tab 排队必须「先问后写」：`queueText` 返回 false（队列满 5 条）时，用户那份草稿没进队，
 * 那句中文提示要他「先等这一轮结束」再重发——此刻若把输入框清空，提示要保的字反而被删了。
 * 接线层（useHotkeys.ts）没有 jsdom、测不到 DOM 路径，所以把「尝试排队之后该回写什么」
 * 抽成这个纯函数：accepted ⇒ 清空；rejected ⇒ 原样还回同一段字（一字不 trim、不加工）。
 * 接线处拿到返回值后一律经 setComposerText 通道写回（补发 input 事件），
 * 于是回写与 v-model 的 ref 始终同源，不会漂移。
 */
export function composerTextAfterQueue(text: string, accepted: boolean): string {
  return accepted ? "" : text;
}

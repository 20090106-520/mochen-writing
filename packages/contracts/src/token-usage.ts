/**
 * Token 用量（2026-10-15 那一刀）。
 *
 * 【为什么单开一层类型而不是塞进 agent-event】上游报的用量三枚数是同一批事实，
 * 而它有三个消费方：provider-client 解析（`readUsage`）、tool-loop 累计、渲染层播报。
 * 类型只此一份，三方吃的是同一个形状；谁都不许自己再定义一个 `{input,output}` 之类的别名
 * ——那正是铁律 6 说的第二份实现。
 *
 * 【口径】三枚数都必须是**有限非负整数**才算「上游报了用量」。缺一即视为没报：
 * 宁可不报，也不拿两个数凑第三个（那等于把真数改写成猜的）。
 * 判定不在这里，而在 provider-client 的 `readUsage`（唯一看得见 wire 字段名的地方）；
 * 这里只有形状。
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

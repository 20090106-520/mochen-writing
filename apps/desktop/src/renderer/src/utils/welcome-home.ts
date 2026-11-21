/**
 * 欢迎首页那句问候（2026-11-09 参考图）。
 *
 * 图里是「下午好呀，卡住的代码发来看看」那种一句式招呼；本仓是写作工具，
 * 文案换成写作语境，但**版式照图**：小 logo 在上、一句大标题在下，标题下面紧接输入卡。
 * 按本地小时分三档，判据收成纯函数是为了能钉边界（.vue 不进类型程序）。
 *
 * 【2026-11-20 对话区智能刀：那句话原先在撒谎】
 * 欢迎首页只在「**没打开作品** + 这一格还没有消息」时出现（`welcomeHome` 的判定），
 * 而下午那一档写的是「下午好呀，**接着写那一段**吧」——
 * 没打开作品就没有稿子，「接着写那一段」承诺了一件不存在的事。
 * ⇒ 下午那一档改成说真话：下一步是**开一本**。
 */
export function welcomeGreeting(hour: number): string {
  const normalized = Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : 12;
  if (normalized < 11) return "早上好呀，今天想写点什么？";
  if (normalized < 18) return "下午好呀，先开一本就能开写";
  return "晚上好呀，把今天的故事记下来";
}

/**
 * 欢迎首页（2026-11-09 用户给的参考图）：**只有「没打开作品 + 这一格还没有消息」才是首页**。
 * 有书的空线程仍摆作品工作台（五张能力卡），有消息就是正常对话——首页不接管那两态。
 * 这一格判据只有这一份，中栏的 is-welcome 与输入卡的 welcome 都读它，不各写一遍。
 */
export function isWelcomeHome(messagesEmpty: boolean, hasBook: boolean): boolean {
  return messagesEmpty && !hasBook;
}

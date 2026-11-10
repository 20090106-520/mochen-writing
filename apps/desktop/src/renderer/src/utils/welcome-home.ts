/**
 * 欢迎首页那句问候（2026-11-09 参考图）。
 *
 * 图里是「下午好呀，卡住的代码发来看看」那种一句式招呼；本仓是写作工具，
 * 文案换成写作语境，但**版式照图**：小 logo 在上、一句大标题在下，标题下面紧接输入卡。
 * 按本地小时分三档，判据收成纯函数是为了能钉边界（.vue 不进类型程序）。
 */
export function welcomeGreeting(hour: number): string {
  const normalized = Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : 12;
  if (normalized < 11) return "早上好呀，今天想写点什么？";
  if (normalized < 18) return "下午好呀，接着写那一段吧";
  return "晚上好呀，把今天的故事记下来";
}

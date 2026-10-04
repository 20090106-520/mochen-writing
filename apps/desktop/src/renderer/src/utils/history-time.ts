/**
 * 历史面板那一格的时间（照搬 deepwrite ConversationHistoryMenu.vue:50-68 的 `formatHistoryTime`）。
 * 他的本体写在组件方法里；本仓 `.vue` 不进类型程序、也没有 DOM 测试，逻辑留在组件里等于没有关卡，
 * 所以抽成散装纯函数在这里测（先例：session-row-action.ts、composer-context.ts）。行为一字未改。
 */
export function formatHistoryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  const options: Intl.DateTimeFormatOptions = {
    month: "numeric",
    day: "numeric"
  };
  // 历史会跨年积累，光一个「9/28」分不出是哪一年。
  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  return date.toLocaleDateString("zh-CN", options);
}

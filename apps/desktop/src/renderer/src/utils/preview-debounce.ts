/**
 * 分栏预览的刷新节奏（2026-10-10 巡检）。
 *
 * 【为什么要有这一层】`markdownToSimpleHtml` 是**全篇**重算 + `v-html` 全量重挂：
 * 十万字的稿子开着分栏，每敲一个字都把整篇重新转一遍 HTML、重排一遍预览 DOM，
 * 实测每键 437ms——分栏从「写的时候能看」变成「一动就卡死」。
 *
 * 【口径】分栏开着时预览 **250ms 静默窗**（trailing）后跟上——写作工具的通例
 * （VS Code 的 markdown 预览同款），手感上仍是「边写边看」；不在分栏里（纯编辑 /
 * 纯预览 / 收起）时不排程，草稿一到预览立即跟（反正看不见，不花钱）。
 * 预览内容真身仍是 `markdownToSimpleHtml` 一份，这里只管**什么时候**让它跑。
 */

/** 分栏态预览的静默窗（毫秒）。 */
export const PREVIEW_DEBOUNCE_MS = 250;

/**
 * 这一拍预览该等多久：分栏开着才等（返回静默窗），其余状态立即跟（返回 0）。
 * 纯函数：组件里 `setTimeout(…, previewDelayMs(viewMode))`，判定只有这一份。
 */
export function previewDelayMs(viewMode: string): number {
  return viewMode === "split" ? PREVIEW_DEBOUNCE_MS : 0;
}

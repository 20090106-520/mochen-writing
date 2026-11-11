/**
 * 整屏面板的互斥判定（2026-11-11）。
 *
 * 【病灶】九个整屏/抽屉面板各自持一个 boolean（App.vue 六枚 + layoutStore 三格），
 * 开合入口谁也不关谁；而它们的 z-index 又是写死的 1500 / 1600 / 2000 三档。
 * 于是「先按 Ctrl+Shift+F 开搜索、再按 Ctrl+Shift+N 开笔记」时，
 * 搜索(2000) 永远压在笔记(1500) 上面，焦点栈却以后开的笔记为栈顶——
 * 焦点落进一个看不见的层，Esc 收的也是看不见的那层，看起来像「按了没反应」。
 *
 * 【裁定】整屏面板同时开两枚没有正当用例（都带遮罩、都困焦点），所以修的是**用法**：
 * 任一枚打开时，把其它开着的收掉，只留刚开的那一枚。层级数值随之归一到一档。
 * 判定留在这里做纯函数（能单测），App.vue 只负责把结果应用到各枚状态上——
 * 与各处「判定真身归纯函数、装配层只接线」的规矩同一形状。
 */
export const FULLSCREEN_PANEL_KEYS = [
  "search",
  "notes",
  "templates",
  "bible",
  "outline",
  "goals",
  "wordCount",
  "chapterStatus",
  "export"
] as const;

export type FullscreenPanelKey = (typeof FULLSCREEN_PANEL_KEYS)[number];
export type FullscreenFlags = Record<FullscreenPanelKey, boolean>;

/**
 * 返回本次要**收掉**的键。
 *
 * - 没有任何新开的（含「只关不开」）⇒ 什么都不做，避免 watch 自己触发自己；
 * - 只留一枚时 ⇒ 什么都不做；
 * - 同时有多枚新开 ⇒ 保留登记顺序里最后一枚（保证终态有且仅有一枚活着）；
 * - 初始就多枚、没有新开的异常态 ⇒ 也收敛到最后一枚，不让脏状态卡住。
 */
export function panelsToDismiss(
  prev: FullscreenFlags,
  next: FullscreenFlags
): FullscreenPanelKey[] {
  const live = FULLSCREEN_PANEL_KEYS.filter((key) => next[key]);
  if (live.length <= 1) return [];
  const opened = live.filter((key) => !prev[key]);
  const keep = (opened.length > 0 ? opened : live).at(-1);
  return live.filter((key) => key !== keep);
}

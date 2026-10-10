import { escapeHtml } from "@mochen/fs-store/export-shared";

/**
 * 找/替换高亮层（mirror）的 HTML：把一段文本按匹配位置切成
 * 「普通 / 匹配 / 当前匹配」三段交替的节点序列。
 *
 * **为什么单独一处**（2026-10-10 行数预算尾巴）：这套切分原先长在 `DocumentPane.vue` 的
 * computed 里，和「该不该摆这一层」（面板可见、模式是文稿、查询非空）缠在一起——
 * 前者是纯字符串判定，验它得起整个组件；后者是接线。分开之后两边各测各的（铁律 6）。
 *
 * **为什么每一段都要过 `escapeHtml`**：产出的 HTML 是 `v-html` 进去的，正文来自用户稿子。
 * 转义用的是 `@mochen/fs-store/export-shared` 那一份（同时转 `& < > " '`）——渲染层不许再有
 * 第二套 replace 链，普查与回归线在 `utils/html-escape-single.test.ts`。
 */

/** 一段匹配在**原文**上的位置：与 `useFindReplaceStore` 的 `HighlightPosition` 同构（结构型，不引 store）。 */
export interface MirrorPosition {
  start: number;
  end: number;
}

/**
 * `currentIndex` 是「当前跳到第几条」的下标；-1（还没有当前条）或越界时，
 * 所有匹配段都用普通类名——把越界的那条标成当前，屏幕上就会有两处高亮在抢「这一条」。
 */
export function findMirrorHtml(
  text: string,
  positions: readonly MirrorPosition[],
  currentIndex: number
): string {
  if (positions.length === 0) return escapeHtml(text);

  let html = "";
  let cursor = 0;
  positions.forEach((pos, idx) => {
    if (pos.start > cursor) html += escapeHtml(text.slice(cursor, pos.start));
    const cls = idx === currentIndex ? "find-highlight-current" : "find-highlight";
    html += `<mark class="${cls}">${escapeHtml(text.slice(pos.start, pos.end))}</mark>`;
    cursor = pos.end;
  });
  // 尾巴：最后一段匹配之后的正文还得留在高亮层里，否则它在 textarea 背后凭空消失。
  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
}

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
 * mirror 最多标多少处（2026-10-10 巡检实测）：
 * 十万字的稿子搜一个常用字能出 **三千多处**匹配，mirror 每键全量挂三千个 `<mark>`
 * 节点，实测打一个字要等半秒——高亮层是视觉辅助，不该有能把打字拖垮的权力。
 * 封顶 400 处之后，超过的部分按普通正文渲染（不丢字，只是不再涂黄）；
 * 面板上的「N 处」计数与逐条跳转仍按**全部**匹配算，两边口径互不牵动。
 */
export const FIND_MIRROR_MAX_MARKS = 400;

/**
 * mirror 上屏的静默窗（2026-10-10 巡检实测）：mirror 是整篇转义 + 整段 v-html 重挂，
 * 十万字的稿子开着查找每敲一个字实测 **500ms**（把三千个 mark 封顶到四百之后照样五百——
 * 大头是 v-html 全量重挂本身，不是节点数）。高亮是装饰，落后 250ms 肉眼无感；
 * 逐字跟上却把打字拖死。面板上的「N 处」计数与逐条跳转**不**吃这个窗——
 * 正则扫描本身是毫秒级，那两处要的就是 live。
 *
 * 【DocumentPane 为什么吃 mirrorSource 快照而不是 live 三件套】位置是照着草稿算的，
 * 草稿、positions、currentIndex 三件**必须同拍**：草稿新、位置旧就整体错位——
 * 那正是「把 B 的内容记到 A 头上」的同族错。所以整份快照一起落后一拍上屏
 * （composables/useTrailingValue），而不是只给草稿套静默窗。
 */
export const FIND_MIRROR_DEBOUNCE_MS = 250;

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
    const isCurrent = idx === currentIndex;
    // 「当前这一条」**永远**标注（封顶只管陪衬的黄底）：跳到第 1000 处时屏幕上若一处高亮都没有，
    // 「跳转到下一条」就成了不可感知的动作。
    const cls = isCurrent
      ? "find-highlight-current"
      : idx < FIND_MIRROR_MAX_MARKS
        ? "find-highlight"
        : "";
    const inner = escapeHtml(text.slice(pos.start, pos.end));
    // 超出封顶的匹配不再包 <mark>：节点数不随匹配数涨，打字的手感不因搜了一个常用字而崩。
    html += cls === "" ? inner : `<mark class="${cls}">${inner}</mark>`;
    cursor = pos.end;
  });
  // 尾巴：最后一段匹配之后的正文还得留在高亮层里，否则它在 textarea 背后凭空消失。
  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
}

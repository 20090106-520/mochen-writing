import type { DocRef } from "@mochen/contracts";

/**
 * 章节次序（`book.json` 的 `chapterOrder`）在渲染层这一侧的两个纯动作
 * （2026-10-09 从 `useBookStore` 搬出来：那份 store 已顶在 800 行的行数预算上，
 * 而「挪一位 + 按次序重排」本来就是纯计算，不该占着状态容器的格子）。
 *
 * 主进程那边有一份同名的 `sortChapters`（fs-store），这里这份**不合并**：
 * 渲染层不许 import fs-store（包边界守卫），合并等于把浏览器 bundle 拖上 Node。
 */

/** 把 `fromRelPath` 挪到 `toIndex`，返回**新数组**；名单里没这一篇（拖到不该拖的地方）返回 null。 */
export function moveOrderItem(
  order: string[],
  fromRelPath: string,
  toIndex: number
): string[] | null {
  const currentIndex = order.indexOf(fromRelPath);
  if (currentIndex === -1) return null;
  const next = [...order];
  next.splice(currentIndex, 1);
  next.splice(toIndex, 0, fromRelPath);
  return next;
}

/**
 * 按 `chapterOrder` 重排 docs：名单里没有的那些（刚扫出来、还没进次序的其它文稿）
 * 保持它们本来的相对次序排在后面——把它们提到前面会把「目录里新出现的东西」插到正文头上。
 */
export function sortDocsByOrder(docs: DocRef[], order: string[]): DocRef[] {
  const rank = new Map(order.map((rel, index) => [rel, index]));
  return [...docs].sort((a, b) => {
    const ra = rank.get(a.relPath);
    const rb = rank.get(b.relPath);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0;
  });
}

/**
 * 标签条按位置取一枚（Ctrl+1..9）。越界给 `null` 而不是 `undefined`：
 * 调用方拿它当「这一档没标签，一个字都不许改」的凭据，`undefined` 会被 `??` 与越界混在一起。
 */
export function tabAtIndex(tabs: string[], index: number): string | null {
  return tabs[index] ?? null;
}

/**
 * 标签条环形取下一枚（Ctrl+PageUp/Down）。
 *
 * 「当前指针认不出就按 -1 起步」是从 `useBookStore.cycleTab` 原样搬来的既有行为：
 * 刚关掉活动标签时指针短暂为 null，这时往后按该落在第一枚、往前按该落在 `tabs[len-2]` 那一类位置——
 * 改成别的算法就等于顺手改了快捷键手感，那是另一件事。
 */
export function nextTabInCycle(
  tabs: string[],
  active: string | null,
  delta: 1 | -1
): string | null {
  if (tabs.length === 0) return null;
  const current = active === null ? -1 : tabs.indexOf(active);
  return tabs[(current + delta + tabs.length) % tabs.length] ?? null;
}

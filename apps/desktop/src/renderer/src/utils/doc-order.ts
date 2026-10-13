import { sortDocs } from "@mochen/contracts";

/**
 * 章节次序（`book.json` 的 `chapterOrder`）在渲染层这一侧的两个纯动作
 * （2026-10-09 从 `useBookStore` 搬出来：那份 store 已顶在 800 行的行数预算上，
 * 而「挪一位 + 按次序重排」本来就是纯计算，不该占着状态容器的格子）。
 *
 * 【2026-10-10 P1-4 后半改了这一条】原先这里写的是「主进程那边有一份同名的 `sortChapters`（fs-store），
 * 这里这份**不合并**：渲染层不许 import fs-store，合并等于把浏览器 bundle 拖上 Node」。
 * 那条边界理由到今天仍然成立，被换掉的是它隐含的前提——「判据必须各留一份」并不成立：
 * 排序判据搬进 `contracts`（`book.ts` 的 `sortDocs`，无 Node 依赖）之后，两边引的是同一个函数，
 * 边界照样守得住。于是这个名字也只是**别名**（`doc-order-single-source.test.ts` 用引用相等钉住）。
 *
 * 行为只变了一档，而且是必须变的：未登记进 `chapterOrder` 的稿件现在按 `relPath` 名字序落位，
 * 不再「保持传进来的相对次序」。因为传进来的次序随来路不同（整本重扫 / 建章后本地拼一根），
 * 旧判据下这两条通路会给出两种侧栏——那正是省不掉整本重扫的原因。语义细节写在真身头上，这里不重述。
 */
export const sortDocsByOrder = sortDocs;

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

/**
 * 「从一组选项里挑一个」那一族浮层的**高亮判据**（2026-10-25 抽出来的）。
 *
 * **为什么要单独一份**：墨宸里从一组东西里挑一个的浮层有好几个——模型选择器、权限档、
 * 阶段选择、设置页的模型名单、@ 引用菜单。它们要的是**同一件事**：
 * ↑↓ 走一条高亮、Enter 选中高亮那条、鼠标悬停与高亮同步、高亮行滚进视野。
 * 各写一遍就是同一判定有多份实现（铁律 6），而其中一处走偏（只搬真焦点 / Enter 选的不是高亮那条）
 * 用户立刻能看出不一致——@ 引用菜单那一份（`useReferenceMenuStore`）做得最全：
 * 高亮在**下标**上、悬停同步、滚进视野、底部还有一枚 kbd 提示行。
 *
 * 【这两个函数是从 `utils/inline-reference-menu.ts` 搬过来的】
 * 它们本来就与「引用菜单」无关（只是上下键环绕 + 夹住下标），
 * 放在那个以引用菜单命名的模块里，会诱使下一个浮层「照着引用菜单那份抄」——
 * 于是同一个判据又变成两份。⇒ 收到这里，引用菜单那份改成引这里。
 */

/** ↑↓ 移一位：到边界回绕（列表空时落在 0）。 */
export function moveHighlightIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (index + delta + total) % total;
}

/**
 * 夹住下标：列表变短时高亮不能指着不存在的那一项。
 * （`clampReferenceIndex` 的原名与原样，搬到这里只换了归属。）
 */
export function clampHighlightIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

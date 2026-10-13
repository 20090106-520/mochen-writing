import { imeOwnsKey } from "./slash-commands";

/**
 * 两个行内输入框（改标题 / 新建）共用的键盘裁决（批次 5-㊶，2026-10-10 从 LeftSidebar 下沉）。
 * 合成一个工厂：两者只有 confirm/cancel 不同，闸门与 preventDefault 的顺序完全一样，写两份就是第二份实现。
 * 模板上原来挂的 `.enter.prevent` 必须搬进来——修饰符无条件执行，组合态那一下回车拦不住，
 * 拼音会被当标题落盘（`book.renameDocTitle(relPath, "yu")` 把这一章真名成「yu」）。
 * 下沉的理由：左栏贴着 800 行预算，而这段裁决不碰任何组件状态，本来就该可单测。
 */
export function textRowKeydown(confirm: () => void, cancel: () => void) {
  return (event: KeyboardEvent): void => {
    if (imeOwnsKey(event)) return;
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    if (event.key === "Enter") confirm();
    else cancel();
  };
}

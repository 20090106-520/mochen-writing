import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { clampHighlightIndex, moveHighlightIndex } from "../utils/list-highlight";

/**
 * 「从一组选项里挑一个」那一族浮层的**高亮合成器**（2026-10-25）。
 *
 * 判据（上下键环绕、夹住下标）在 `utils/list-highlight.ts`；这里只把它套成
 * 一个组件能直接用的东西：一份 `activeIndex`、一个「高亮那一项」、
 * 以及「把高亮那一项交出去」这一个动作。
 *
 * **为什么焦点不在这件事里面**：高亮是**下标**，真焦点留在**搜索框**里（能边打字边选）。
 * 这正是 @ 引用菜单那一族已经在用的形状（`useReferenceMenuStore.activeIndex`），
 * 也是 Cursor / Claude Code 那一类切换器的形状。
 * ⇒ 用它的人家得自己决定「焦点在哪儿」；本合成器只管高亮。
 */
export interface ListHighlight<T> {
  /** 高亮落在第几项。 */
  activeIndex: Ref<number>;
  /** 高亮那一项（列表空时是 null）。 */
  activeItem: ComputedRef<T | null>;
  /** ↑↓ 移一位（回绕），并把高亮行滚进视野。 */
  move(delta: 1 | -1): void;
  /** 把高亮落到第 n 项（鼠标悬停 / 外部指定）。 */
  activate(index: number): void;
  /** Enter：把高亮那一项交出去；列表空时什么也不做（不抛、不空跑）。 */
  pickActive(): void;
  /** 把高亮行滚进视野（已经看得见就别动）。 */
  reveal(): void;
}

export function useListHighlight<T>(input: {
  /** 当前可选项（已过滤 / 已排序的那一份）。 */
  items: () => readonly T[];
  /** 交出去：用户按下 Enter 或点中某一项时调用。 */
  onPick: (item: T) => void;
  /** 取某一项对应的 DOM 元素（高亮要能滚进视野）。 */
  elementOf?: (item: T) => HTMLElement | null;
  /**
   * 名单变了以后高亮落到第几项（默认第 0 项）。
   *
   * **同一个值也用作「刚打开时」的落点**（2026-10-25）：权限档与阶段选择的「当前那一档」
   * 就是用户最可能要改的那一档——高亮从它起步，↑↓ 一按就是邻近的另一档，
   * 而不是从第一项一路按过去。
   */
  initialIndex?: () => number;
}): ListHighlight<T> {
  const list = computed<readonly T[]>(() => input.items());
  // 初值与「名单变了以后」用同一口：`initialIndex` 若指向已不存在的项，夹回边界。
  const activeIndex = ref(clampHighlightIndex(input.initialIndex?.() ?? 0, list.value.length));
  const activeItem = computed<T | null>(() => {
    const items = list.value;
    if (items.length === 0) return null;
    return items[clampHighlightIndex(activeIndex.value, items.length)] ?? null;
  });

  function activate(index: number): void {
    activeIndex.value = clampHighlightIndex(index, list.value.length);
  }

  function move(delta: 1 | -1): void {
    activeIndex.value = moveHighlightIndex(activeIndex.value, delta, list.value.length);
    reveal();
  }

  function pickActive(): void {
    const item = activeItem.value;
    if (item !== null) input.onPick(item);
  }

  function reveal(): void {
    const item = activeItem.value;
    if (item === null) return;
    input.elementOf?.(item)?.scrollIntoView({ block: "nearest" });
  }

  /**
   * 名单变了（搜了别的词、上游换了名单、当前模型变了）就把高亮收回落点——
   * 否则高亮会停在一条**已经不存在**的项上，Enter 会切一个看不见的模型。
   *
   * 落点由 `initialIndex` 给（默认第 0 项）。它返回 -1 时（要找的那一档被过滤掉了）
   * 夹回 0：宁可高亮第一项，也不要高亮最后一项——后者看起来像「跳到了末尾」。
   */
  watch(
    () => list.value,
    () => {
      activeIndex.value = clampHighlightIndex(input.initialIndex?.() ?? 0, list.value.length);
    }
  );

  return { activeIndex, activeItem, move, activate, pickActive, reveal };
}

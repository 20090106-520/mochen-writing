/**
 * 「替换 / 全部替换」之后的撤销：全仓唯一一份判定（2026-10-09 扫描总单·不存在表）。
 *
 * 【要解决的问题】
 * `applyReplace` 把整篇新文本一次赋给 textarea（`:value` 重渲染），Chromium 在程序赋值时会
 * **清空原生撤销栈**，而本仓没有自制快照 ⇒ 一次「全部替换」换错了词，30 处一起错，Ctrl+Z 救不回。
 * 界面从未承诺过撤销，所以这不是假控件，是一条真缺失的通路：作者的退路。
 *
 * 【为什么住在这里而不是 `.vue`】
 * `.vue` 的 `<script setup>` 不进类型程序、本仓又没有 jsdom，而"哪份快照能还原到哪一章"
 * 「组合态里那下 Ctrl+Z 归不归我们」恰恰是编译管不住的部分。仓内分工照旧：判定进 `utils/*.ts`
 * 出纯函数用例（`edit-undo.test.ts`），接线进 `edit-undo-wiring.test.ts` 读源文件，DOM 侧真机行为归冒烟矩阵。
 *
 * 【三条安全红线】
 * ① 快照属于哪一章就只还给那一章（`takeUndoFor`）——跨章还原等于把 A 章全文盖进 B 章，那是丢稿；
 * ② 用户在 textarea 里打过字之后栈清空（由 DocumentPane 的 `onContentInput` 调 `clear()`）——
 *    原生撤销从那一刻重新当家，我们再整篇还原就是覆盖他刚打的内容；
 * ③ 输入法组合态里的 Ctrl+Z 不归我们，判据仍用 `slash-commands.ts` 的 `imeOwnsKey` 那一份，
 *    本模块只收它算完之后的布尔值（`undoOwnsKey` 的第二参），不在这里重抄第二份组合态判据。
 */

/** 一次程序改写能撤销到的上限（份）。20 足够覆盖"连点几次替换然后一路退回去"，再多就是无界吃内存。 */
export const UNDO_STACK_LIMIT = 20;

/**
 * 三类程序改写：单处替换、全部替换、插入 md 片段。
 *
 * 片段为什么也在这条通路里：`useSnippetToolbar` 同样是把整篇新文本一次赋给 textarea
 * （加粗那种「点一下就把选区包起来」），Chromium 清空原生撤销栈的行为跟替换**一模一样**。
 * 只把替换接上、把片段漏掉，等于同一颗雷只拆了一半（2026-10-09 扫描总单·不存在表 同族缺口）。
 */
export type EditUndoKind = "replace" | "replace-all" | "snippet";

/** 改前的那一章长什么样——还原就是把这六个字段里的 text 写回草稿、start/end 写回选区。 */
export interface EditUndoSnapshot {
  /** 快照属于哪一章（relPath）。红线①的判据。 */
  readonly docRelPath: string;
  /** 改前全文。 */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly kind: EditUndoKind;
  /** 这次换掉了几处；单处替换与片段插入恒为 1。提示文案用它。 */
  readonly count: number;
}

/** 栈本体。弹出只经 `takeUndoFor` 走（红线①的章校验在那儿），`pop` 是给它用的原语。 */
export interface EditUndoStack {
  push(snapshot: EditUndoSnapshot): void;
  /** 栈顶（不弹出）；空栈给 null。面板提示读它。 */
  top(): EditUndoSnapshot | null;
  /** 弹出栈顶、不做章校验——**不要绕过 `takeUndoFor` 直接用它还原**。 */
  pop(): EditUndoSnapshot | null;
  size(): number;
  clear(): void;
}

export function createEditUndoStack(limit: number = UNDO_STACK_LIMIT): EditUndoStack {
  // 上限至少留一份：`limit` 传 0 或负数时"什么都留不住"是最难查的那种坏（替换永远报"没有可撤销的"）。
  const max = Math.max(1, Math.floor(limit));
  const items: EditUndoSnapshot[] = [];
  return {
    push(snapshot) {
      items.push(snapshot);
      if (items.length > max) items.splice(0, items.length - max);
    },
    top() {
      return items[items.length - 1] ?? null;
    },
    pop() {
      return items.pop() ?? null;
    },
    size() {
      return items.length;
    },
    clear() {
      items.length = 0;
    }
  };
}

/**
 * 取回"现在这一章"最近一次可撤销的快照；顺手把途中不属于本章的快照丢掉。
 *
 * `activeDoc` 为空（没打开任何文档）时整栈作废：那份文本没有落点，留着只会误导下一次调用。
 */
export function takeUndoFor(
  stack: EditUndoStack,
  activeDoc: string | null
): EditUndoSnapshot | null {
  if (activeDoc === null || activeDoc === "") {
    stack.clear();
    return null;
  }
  for (;;) {
    const snapshot = stack.pop();
    if (snapshot === null) return null;
    if (snapshot.docRelPath === activeDoc) return snapshot;
  }
}

/** 只有 Ctrl/Cmd+Z 归我们；Shift（重做语义）与 Alt 一律不接手。 */
export type UndoKeyShape = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

/**
 * 这一下按键是不是"撤销刚才那次替换"。
 *
 * 第二参 `imeOwns` 由调用方拿 `imeOwnsKey(event)` 算好递进来：判据全仓只有那一份（红线③），
 * 这里不接完整 KeyboardEvent、也不再写一遍 `isComposing`。形状收成 `Pick<...>` 而不是
 * `KeyboardEvent`，是因为本仓没有 jsdom——用例拿一个普通对象就能把这把键钉死。
 */
export function undoOwnsKey(event: UndoKeyShape, imeOwns: boolean): boolean {
  if (imeOwns) return false;
  if (event.shiftKey || event.altKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key.toLowerCase() === "z";
}

/**
 * 面板那行提示的唯一来源（空串 = 没有可撤销的东西，模板上的 `v-if` 直接用它）。
 *
 * 文案刻意只报处数不报"怎么退"——退法写在按钮上（撤销（Ctrl+Z）），两处各说一半，
 * 比在同一行里塞两件事短。片段那一支不许说"替换"：界面上报的事必须和真发生的事一致，
 * 点了一下「加粗」却被告知"已替换 1 处"，用户会去找那处被换掉的文字。
 */
export function undoNotice(top: EditUndoSnapshot | null): string {
  if (top === null) return "";
  if (top.kind === "snippet") return "已插入片段";
  if (top.kind === "replace-all") return `已替换 ${top.count} 处`;
  return "已替换 1 处";
}

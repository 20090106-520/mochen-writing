import { computed, nextTick, ref, type Ref } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { imeOwnsKey } from "../utils/slash-commands";
import {
  createEditUndoStack,
  takeUndoFor,
  undoNotice,
  undoOwnsKey,
  type EditUndoKind
} from "../utils/edit-undo";

/**
 * 「替换 / 全部替换」之后的退路（2026-10-09 扫描总单·不存在表：批量替换后 Ctrl+Z 救不回）。
 *
 * 【这段为什么不住 `.vue`】
 * 判定与红线在 `utils/edit-undo.ts`，但那只是字符串层面的事；"撤销到底把哪份文本写回草稿"
 * 要读 store、要 nextTick、要看 textarea 挂没挂——这些行为住在 `<script setup>` 里就永远测不到
 * （本仓 `.vue` 不进类型程序、没有 jsdom）。抽到这里之后 `useEditUndo.test.ts` 拿真 store +
 * 替身 textarea 就能逐条跑出来，DocumentPane 只留"把线接上"那一行。
 * 同款先例：`useSnippetToolbar.ts`（替身形状也照它，见 `UndoEditorLike`）。
 *
 * 【三条红线】① 快照属于哪一章就只还给那一章；② 用户打一个字整栈作废（原生撤销重新当家）；
 * ③ 输入法组合态与 Ctrl+Shift+Z 不接手。判定本体都在 utils，这里只负责把它们接到 DOM 上。
 */

/** 这条通路真正用到的那几样 textarea 能力（没有 jsdom，所以按成员收，真实 textarea 天然满足）。 */
export interface UndoEditorLike {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  focus(): void;
  setSelectionRange(start: number, end: number): void;
}

/** 改写完成后光标该落在哪（片段插入给的是"标记内侧"，替换不给就回原处）。 */
export interface UndoCaret {
  readonly start: number;
  readonly end: number;
}

export function useEditUndo(editorEl: Ref<UndoEditorLike | null>): {
  undoNoticeText: Readonly<Ref<string>>;
  undoDepth: Ref<number>;
  replaceWithUndo: (nextText: string, kind: EditUndoKind, count: number) => void;
  commitWithUndo: (nextText: string, kind: EditUndoKind, count: number, caret?: UndoCaret) => void;
  undoLastEdit: () => void;
  invalidate: () => void;
  onEditorKeydown: (event: KeyboardEvent) => void;
} {
  const book = useBookStore();
  const stack = createEditUndoStack();
  // 栈本体是纯对象，Vue 看不见它的成员；提示与「这一下键归不归我们」都读这份响应式副本。
  // 漏掉同步的后果不是报错，是"代码做了、界面永远不显示"——所以每次栈变动都走 sync()。
  const undoDepth = ref(0);
  const undoNoticeText = computed(() => (undoDepth.value === 0 ? "" : undoNotice(stack.top())));

  function sync(): void {
    undoDepth.value = stack.size();
  }

  /**
   * 程序改写落下来：先记改前那一份，再写草稿，最后把光标放到该放的地方。
   *
   * 顺序不能反：快照里存的必须是**改前**的全文（存成 nextText 就等于"撤销"回去还是那份被换坏的文本）。
   * `el === null || doc === null` 时整件事不做——没有落点的快照比没有快照更危险（红线①）。
   *
   * `caret` 是"改完之后光标落哪"：替换不给，就放回改前那一段（钳到新文本长度）；
   * 片段插入必须给——加粗之后光标要在 `**` 内侧接着写，把它放回改前选区就是帮倒忙。
   */
  function commitWithUndo(
    nextText: string,
    kind: EditUndoKind,
    count: number,
    caret?: UndoCaret
  ): void {
    const el = editorEl.value;
    const doc = book.activeDocTab;
    if (el === null || doc === null) return;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;
    stack.push({
      docRelPath: doc,
      text: book.draft,
      start: selStart,
      end: selEnd,
      kind,
      count
    });
    sync();
    book.onEdit(nextText);
    const after = caret ?? {
      start: Math.min(selStart, nextText.length),
      end: Math.min(selEnd, nextText.length)
    };
    void nextTick(() => {
      el.focus();
      el.setSelectionRange(after.start, after.end);
    });
  }

  /** 替换那两枚按钮的入口：kind 与处数由面板递过来，光标放回原处。 */
  function replaceWithUndo(nextText: string, kind: EditUndoKind, count: number): void {
    commitWithUndo(nextText, kind, count);
  }

  /** 退回最近一次替换；`takeUndoFor` 判定不属于本章（或没有落点）时只作废、不写草稿。 */
  function undoLastEdit(): void {
    const snapshot = takeUndoFor(stack, book.activeDocTab);
    sync();
    if (snapshot === null) return;
    book.onEdit(snapshot.text);
    void nextTick(() => {
      const el = editorEl.value;
      if (!el) return;
      el.focus();
      el.setSelectionRange(snapshot.start, snapshot.end);
    });
  }

  /** 用户自己打了一个字 ⇒ 原生撤销栈从这一刻重新当家，整栈作废（红线②）。 */
  function invalidate(): void {
    if (stack.size() === 0) return;
    stack.clear();
    sync();
  }

  /**
   * 正文键盘闸门：`Ctrl/Cmd+Z` 且不在输入法组合态且栈非空，三件事同时成立才接手。
   *
   * 栈非空 ⇒ 上一次改写是程序做的、textarea 的原生撤销栈已经被整篇赋值清空 ⇒ 吞掉这一键
   * 不会牺牲任何原生撤销；栈空 ⇒ 一个字都不动，那一下归原生（用户正在撤自己刚打的字）。
   */
  function onEditorKeydown(event: KeyboardEvent): void {
    if (!undoOwnsKey(event, imeOwnsKey(event))) return;
    if (undoDepth.value === 0) return;
    event.preventDefault();
    undoLastEdit();
  }

  return {
    undoNoticeText,
    undoDepth,
    replaceWithUndo,
    commitWithUndo,
    undoLastEdit,
    invalidate,
    onEditorKeydown
  };
}

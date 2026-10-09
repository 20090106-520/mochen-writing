import { computed, nextTick, type ComputedRef, type Ref } from "vue";
import { useBookStore } from "../stores/useBookStore";
import {
  applySnippet,
  snippetToolbarState,
  type SnippetKind,
  type SnippetToolbarView
} from "../utils/markdown-snippets";

/**
 * 片段接线真正用到的那几样 textarea 能力（ruling T10-6）。
 * 本仓没有 jsdom，`HTMLTextAreaElement` 在测试里造不出来 ⇒ 依赖收成这五个成员，
 * 单测拿一个带 `vi.fn()` 的替身就能把「点了按钮到底发生了什么」钉死；真实 textarea 天然满足它。
 */
export interface SnippetEditorLike {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  focus(): void;
  setSelectionRange(start: number, end: number): void;
}

/**
 * 「把这段改写落到草稿上」的那一条通路（片段工具栏只负责算出新文本与新光标，不负责怎么写）。
 * 传进来的是 `useEditUndo` 的 `commitWithUndo`：整篇赋值会清空 textarea 的原生撤销栈，
 * 所以这一笔必须进撤销栈（2026-10-09 扫描总单·不存在表：与批量替换同族）。
 * 不给时退回老写法——工具栏自己写、自己回设光标，用例里留一条钉住这个兜底行为。
 */
export type SnippetCommit = (nextText: string, caret: { start: number; end: number }) => void;

/**
 * 右栏「插入 md 片段」的接线（附录 F-F）。
 * 这段为什么不住 `.vue`：本仓的 verify 用裸 `tsc`，`<script setup>` 整体不进类型程序、也没有任何
 * 运行时覆盖 ⇒ 有行为的代码（读选区、写草稿、回设光标）搬进 `.ts` 才真的被 vitest 钉住。
 * 全程只经 `book.onEdit`（手打键盘用的同一个 action），不新增写盘通路。
 */
export function useSnippetToolbar(
  editorEl: Ref<SnippetEditorLike | null>,
  commit?: SnippetCommit
): {
  snippetToolbar: ComputedRef<SnippetToolbarView>;
  applyToSelection: (kind: SnippetKind) => void;
} {
  const book = useBookStore();

  /** 可见/可点的判定本身在 utils/markdown-snippets.ts，这里只把 store 现值喂进去。 */
  const snippetToolbar = computed(() =>
    snippetToolbarState({
      mode: book.rightPaneMode,
      hasActiveDoc: book.activeDocTab !== null
    })
  );

  /** 读 textarea 真实选区 → 纯函数改写 → 交给那一条写草稿的通路；除此之外不做任何事，不写盘、不碰 DOM 结构。 */
  function applyToSelection(kind: SnippetKind): void {
    const el = editorEl.value;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = applySnippet(kind, { value: el.value, start, end });
    if (commit) {
      // 写与回设光标都归 commitWithUndo（它记得改前那一份），这里一次都不能多做。
      commit(next.value, { start: next.start, end: next.end });
      return;
    }
    book.onEdit(next.value);
    void nextTick(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  return { snippetToolbar, applyToSelection };
}

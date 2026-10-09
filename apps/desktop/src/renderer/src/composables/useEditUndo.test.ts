import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useEditUndo, type UndoEditorLike } from "./useEditUndo";
import { useBookStore } from "../stores/useBookStore";

/**
 * 替换之后的退路（2026-10-09 扫描总单·不存在表）。
 *
 * 接线住 `.ts` 而不是 `.vue`：`.vue` 的 `<script setup>` 不进类型程序、本仓又没有 jsdom，
 * 于是"撤销到底把哪份文本写回了草稿"这种最要命的行为在原来那个位置**永远测不到**。
 * 抽到这里之后，下面每一条都是拿真 store + 真 computed 跑出来的，不是读源文件的字符串断言。
 *
 * 三条红线各自一条用例（缺一条就还能再犯）：
 * ① 跨章不许还原（把别的章的全文盖进来是丢稿）；
 * ② 用户打一个字就作废整栈（原生撤销从那一刻重新当家）；
 * ③ 输入法组合态与 Ctrl+Shift+Z 都不接手（判据仍是 imeOwnsKey 那一份）。
 */

function stubEditor(fields: { value: string; start: number; end: number }): UndoEditorLike {
  return {
    value: fields.value,
    selectionStart: fields.start,
    selectionEnd: fields.end,
    focus: vi.fn(),
    setSelectionRange: vi.fn()
  };
}

function keyEvent(
  over: Partial<
    Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing">
  > = {}
) {
  // 用 KeyboardEvent 的真名（ctrlKey 而不是 ctrl）：接线一侧读的就是这些名字，替身换名会静默错配。
  return {
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    preventDefault: vi.fn(),
    ...over
  };
}

const BEFORE = "海雾涌上来。";
const AFTER = "海潮涌上来。";

let book: ReturnType<typeof useBookStore>;
beforeEach(() => {
  setActivePinia(createPinia());
  book = useBookStore();
  book.draft = BEFORE;
  book.activeDocTab = "chapters/01.md";
});

describe("useEditUndo · 记快照与还原", () => {
  it("textarea 还没挂载时不记也不写——不许凭空造一份草稿", () => {
    const onEdit = vi.spyOn(book, "onEdit");
    const { replaceWithUndo, undoNoticeText } = useEditUndo(ref(null));

    replaceWithUndo(AFTER, "replace-all", 12);

    expect(onEdit).not.toHaveBeenCalled();
    expect(undoNoticeText.value).toBe("");
  });

  it("没有打开任何文档时同样不记不写：快照没有落点，留着只会把这份文本盖进下一张开的章", () => {
    book.activeDocTab = null;
    const onEdit = vi.spyOn(book, "onEdit");
    const editor = stubEditor({ value: BEFORE, start: 0, end: 3 });
    const { replaceWithUndo, undoNoticeText } = useEditUndo(ref(editor));

    replaceWithUndo(AFTER, "replace-all", 12);
    expect(onEdit).not.toHaveBeenCalled();
    expect(undoNoticeText.value).toBe("");
  });

  it("替换确实写进草稿，撤销再把它带回改前那一份——这是本缺陷的全部要点", () => {
    const editor = stubEditor({ value: BEFORE, start: 2, end: 4 });
    const { replaceWithUndo, undoLastEdit } = useEditUndo(ref(editor));

    replaceWithUndo(AFTER, "replace-all", 12);
    expect(book.draft).toBe(AFTER);

    undoLastEdit();
    expect(book.draft).toBe(BEFORE);
  });

  it("还原之后焦点回来、选区放回改前那两个下标", async () => {
    const editor = stubEditor({ value: BEFORE, start: 2, end: 4 });
    const { replaceWithUndo, undoLastEdit } = useEditUndo(ref(editor));

    replaceWithUndo(AFTER, "replace-all", 1);
    await nextTick();
    undoLastEdit();
    await nextTick();

    expect(editor.focus).toHaveBeenCalled();
    expect(editor.setSelectionRange).toHaveBeenLastCalledWith(2, 4);
  });

  it("连着两次替换可以一级级退回去，退完之后再按什么都不写", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, undoLastEdit } = useEditUndo(ref(editor));

    replaceWithUndo(AFTER, "replace", 1);
    replaceWithUndo("海潮涌上来！", "replace", 1);
    expect(book.draft).toBe("海潮涌上来！");

    undoLastEdit();
    expect(book.draft).toBe(AFTER);
    undoLastEdit();
    expect(book.draft).toBe(BEFORE);

    const onEdit = vi.spyOn(book, "onEdit");
    undoLastEdit();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("useEditUndo · 片段插入也走这一条通路（同类缺口：整篇赋值清掉原生栈）", () => {
  it("commitWithUndo 把光标放到**调用方给的位置**，而不是改前那一段——插入加粗后光标要留在标记内侧", async () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 6 });
    const { commitWithUndo } = useEditUndo(ref(editor));

    commitWithUndo("**海雾**涌上来。", "snippet", 1, { start: 2, end: 8 });
    await nextTick();

    expect(book.draft).toBe("**海雾**涌上来。");
    expect(editor.setSelectionRange).toHaveBeenCalledWith(2, 8);
  });

  it("片段撤销带回的是改前全文，提示报的是「插入」", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 6 });
    const { commitWithUndo, undoLastEdit, undoNoticeText } = useEditUndo(ref(editor));

    commitWithUndo("**海雾**涌上来。", "snippet", 1, { start: 2, end: 8 });
    expect(undoNoticeText.value).toContain("插入");

    undoLastEdit();
    expect(book.draft).toBe(BEFORE);
  });

  it("textarea 没挂载 / 没打开文档时同样不记不写（片段这条路不例外）", () => {
    const onEdit = vi.spyOn(book, "onEdit");
    const { commitWithUndo, undoNoticeText } = useEditUndo(ref(null));

    commitWithUndo("**海雾**涌上来。", "snippet", 1, { start: 0, end: 0 });

    expect(onEdit).not.toHaveBeenCalled();
    expect(undoNoticeText.value).toBe("");
  });

  it("替换与片段混在同一栈里，也照样一级一级退得回去", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, commitWithUndo, undoLastEdit } = useEditUndo(ref(editor));

    replaceWithUndo(AFTER, "replace", 1);
    commitWithUndo("**海潮**涌上来。", "snippet", 1, { start: 0, end: 6 });
    expect(book.draft).toBe("**海潮**涌上来。");

    undoLastEdit();
    expect(book.draft).toBe(AFTER);
    undoLastEdit();
    expect(book.draft).toBe(BEFORE);
  });
});

describe("useEditUndo · 红线①跨章", () => {
  it("章切走了就不还原：takeUndoFor 给 null，草稿一个字都不动", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, undoLastEdit } = useEditUndo(ref(editor));
    replaceWithUndo(AFTER, "replace-all", 12);

    book.activeDocTab = "chapters/02.md";
    const onEdit = vi.spyOn(book, "onEdit");
    undoLastEdit();

    expect(onEdit).not.toHaveBeenCalled();
    expect(book.draft).toBe(AFTER);
  });
});

describe("useEditUndo · 红线②用户一打字就交回原生", () => {
  it("invalidate 之后没有东西可退，提示也一起消失", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, invalidate, undoLastEdit, undoNoticeText } = useEditUndo(ref(editor));

    replaceWithUndo(AFTER, "replace-all", 12);
    expect(undoNoticeText.value).toContain("12");

    invalidate();
    expect(undoNoticeText.value).toBe("");

    const onEdit = vi.spyOn(book, "onEdit");
    undoLastEdit();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("useEditUndo · 提示文案（跟着栈走，是响应式的）", () => {
  it("批量替换报处数、单处替换报 1 处，退完之后回到空串", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, undoLastEdit, undoNoticeText } = useEditUndo(ref(editor));

    expect(undoNoticeText.value).toBe("");
    replaceWithUndo(AFTER, "replace", 1);
    expect(undoNoticeText.value).toContain("1");
    replaceWithUndo("海潮涌上来。", "replace-all", 30);
    expect(undoNoticeText.value).toContain("30");
    undoLastEdit();
    expect(undoNoticeText.value).toContain("1");
    undoLastEdit();
    expect(undoNoticeText.value).toBe("");
  });
});

describe("useEditUndo · 红线③哪一下键归我们", () => {
  it("栈空时一个字都不吞：那一下 Ctrl+Z 是原生的（用户正在撤自己刚打的字）", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { onEditorKeydown } = useEditUndo(ref(editor));
    const event = keyEvent({ ctrlKey: true });

    onEditorKeydown(event as unknown as KeyboardEvent);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("栈非空时接手并还原", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, onEditorKeydown } = useEditUndo(ref(editor));
    replaceWithUndo(AFTER, "replace-all", 12);
    const event = keyEvent({ ctrlKey: true });

    onEditorKeydown(event as unknown as KeyboardEvent);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(book.draft).toBe(BEFORE);
  });

  it("输入法正在选词时不接手（isComposing 走 imeOwnsKey 那一份真身）", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, onEditorKeydown } = useEditUndo(ref(editor));
    replaceWithUndo(AFTER, "replace-all", 12);
    const event = keyEvent({ ctrlKey: true, isComposing: true });

    onEditorKeydown(event as unknown as KeyboardEvent);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(book.draft).toBe(AFTER);
  });

  it("Ctrl+Shift+Z（重做语义）与 Cmd+Z 之外的组合键都不接手", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, onEditorKeydown } = useEditUndo(ref(editor));
    replaceWithUndo(AFTER, "replace-all", 12);

    const shift = keyEvent({ ctrlKey: true, shiftKey: true });
    onEditorKeydown(shift as unknown as KeyboardEvent);
    expect(shift.preventDefault).not.toHaveBeenCalled();

    const copy = keyEvent({ ctrlKey: true, key: "c" });
    onEditorKeydown(copy as unknown as KeyboardEvent);
    expect(copy.preventDefault).not.toHaveBeenCalled();

    expect(book.draft).toBe(AFTER);
  });

  it("mac 的 Cmd+Z 一样接手", () => {
    const editor = stubEditor({ value: BEFORE, start: 0, end: 0 });
    const { replaceWithUndo, onEditorKeydown } = useEditUndo(ref(editor));
    replaceWithUndo(AFTER, "replace-all", 3);
    const event = keyEvent({ metaKey: true });

    onEditorKeydown(event as unknown as KeyboardEvent);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(book.draft).toBe(BEFORE);
  });
});

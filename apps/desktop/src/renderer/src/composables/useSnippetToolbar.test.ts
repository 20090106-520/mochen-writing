import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useSnippetToolbar, type SnippetEditorLike } from "./useSnippetToolbar";
import { useBookStore } from "../stores/useBookStore";

/**
 * stub textarea（ruling T10-6）：本仓没有 jsdom，`HTMLTextAreaElement` 造不出来，
 * 于是把片段接线依赖的五个成员（value / selectionStart / selectionEnd / focus / setSelectionRange）
 * 做成可断言的替身——focus 与 setSelectionRange 是真被调用还是没被调用，这里读得出来。
 */
function stubEditor(fields: { value: string; start: number; end: number }): SnippetEditorLike {
  return {
    value: fields.value,
    selectionStart: fields.start,
    selectionEnd: fields.end,
    focus: vi.fn(),
    setSelectionRange: vi.fn()
  };
}

let text: string;
beforeEach(() => {
  setActivePinia(createPinia());
  text = "雾从海面涌上来。\n海雾涌上来，铁锈味很冲。";
});

describe("useSnippetToolbar（接线住 .ts：本仓 .vue 零类型检查零运行时覆盖）", () => {
  it("textarea 还没挂载（ref 为 null）：点了不抛，也不许凭空造一份草稿", () => {
    const book = useBookStore();
    const onEdit = vi.spyOn(book, "onEdit");
    const editorEl = ref<SnippetEditorLike | null>(null);
    const { applyToSelection } = useSnippetToolbar(editorEl);

    expect(() => applyToSelection("bold")).not.toThrow();
    expect(onEdit).not.toHaveBeenCalled();
    expect(book.draft).toBe("");
  });

  it("book.onEdit 收到的正是 applySnippet 的返回值——片段与手打走同一条通路，不另开写盘口", () => {
    const book = useBookStore();
    book.draft = text;
    const onEdit = vi.spyOn(book, "onEdit");
    const editor = stubEditor({ value: text, start: 0, end: 9 });
    const { applyToSelection } = useSnippetToolbar(ref(editor));

    applyToSelection("list");

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("- 雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。");
    // 改完的草稿确实进了 store：dirty 是 onEdit 置的，不是这里另写的。
    expect(book.draft).toBe("- 雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。");
    expect(book.dirty).toBe(true);
  });

  it("nextTick 之后光标落在改写后的新下标上，且编辑器重新拿到焦点", async () => {
    const book = useBookStore();
    book.draft = text;
    const editor = stubEditor({ value: text, start: 10, end: 22 });
    const { applyToSelection } = useSnippetToolbar(ref(editor));

    applyToSelection("bold");
    await nextTick();

    expect(editor.focus).toHaveBeenCalledTimes(1);
    // 选中区是第 10–20 个码元（越界的 22 已被钳到文末），加粗后两端各右移两个码元。
    expect(editor.setSelectionRange).toHaveBeenCalledWith(12, 23);
  });

  it("工具栏状态由 store 现值驱动：文稿态可点、没有活动文稿时整排 disabled、浏览与作品资料态隐藏", () => {
    const book = useBookStore();
    const { snippetToolbar } = useSnippetToolbar(ref(stubEditor({ value: "", start: 0, end: 0 })));

    // 文稿态但草稿还没打开：按钮在位却点不动。
    expect(snippetToolbar.value.visible).toBe(true);
    expect(snippetToolbar.value.buttons.map((btn) => btn.disabled)).toEqual([
      true,
      true,
      true,
      true
    ]);

    book.activeDocTab = "chapters/01-a.md";
    expect(snippetToolbar.value.visible).toBe(true);
    expect(snippetToolbar.value.buttons.map((btn) => btn.disabled)).toEqual([
      false,
      false,
      false,
      false
    ]);

    book.rightPaneMode = "browse";
    expect(snippetToolbar.value.visible).toBe(false);
    book.rightPaneMode = "dossier";
    expect(snippetToolbar.value.visible).toBe(false);
  });
});

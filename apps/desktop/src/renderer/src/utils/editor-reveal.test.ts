import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftLineOfBodyLine,
  EDITOR_TEXTAREA_SELECTOR,
  lineStartOffset,
  revealEditorLine
} from "./editor-reveal";

afterEach(() => vi.unstubAllGlobals());

describe("行号换算", () => {
  it("1 起行号换成字符偏移", () => {
    expect(lineStartOffset("第一行\n第二行\n第三行", 1)).toBe(0);
    expect(lineStartOffset("第一行\n第二行\n第三行", 2)).toBe(4);
    expect(lineStartOffset("第一行\n第二行\n第三行", 3)).toBe(8);
  });

  it("越界或非法行号回 null，不抛", () => {
    expect(lineStartOffset("只有一行", 2)).toBeNull();
    expect(lineStartOffset("只有一行", 0)).toBeNull();
    expect(lineStartOffset("只有一行", 1.5)).toBeNull();
  });

  it("正文行号换算回带 frontmatter 的编辑框行号", () => {
    const draft = "---\ntitle: 开局\n---\n\n他走了。\n";
    expect(draftLineOfBodyLine(draft, 1)).toBe(4);
    expect(draftLineOfBodyLine(draft, 2)).toBe(5);
  });

  it("没有围栏时原样返回", () => {
    expect(draftLineOfBodyLine("他走了。\n", 1)).toBe(1);
    expect(draftLineOfBodyLine("他走了。\n", 0)).toBe(0);
  });
});

describe("选中并滚动到某一行", () => {
  it("单测环境没有 DOM 时回 false，不抛", () => {
    expect(revealEditorLine(2)).toBe(false);
  });

  it("有编辑框时选中整行，并按行高把行滚到视口中间", () => {
    const text = "第一行\n第二行\n第三行";
    const el = {
      value: text,
      clientHeight: 100,
      scrollTop: 0,
      focus: vi.fn(),
      setSelectionRange: vi.fn()
    };
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (selector === EDITOR_TEXTAREA_SELECTOR ? el : null)
    });
    vi.stubGlobal("getComputedStyle", () => ({ lineHeight: "20" }));
    expect(revealEditorLine(2)).toBe(true);
    expect(el.focus).toHaveBeenCalledOnce();
    expect(el.setSelectionRange).toHaveBeenCalledWith(4, 7);
    expect(el.scrollTop).toBe(0);
  });

  it("行号越界就回 false，不假装跳到了", () => {
    const el = {
      value: "只有一行",
      clientHeight: 100,
      scrollTop: 0,
      focus: vi.fn(),
      setSelectionRange: vi.fn()
    };
    vi.stubGlobal("document", { querySelector: () => el });
    vi.stubGlobal("getComputedStyle", () => ({ lineHeight: "20" }));
    expect(revealEditorLine(3)).toBe(false);
    expect(el.setSelectionRange).not.toHaveBeenCalled();
  });
});

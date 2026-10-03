import { describe, expect, it } from "vitest";
import {
  SNIPPET_KINDS,
  SNIPPET_LABELS,
  applySnippet,
  snippetToolbarState
} from "./markdown-snippets";

/** 三行夹具：行首分别在 0 / 9 / 22（UTF-16 码元下标），总长 25。 */
const THREE_LINES = "雾从海面涌上来。\n海雾涌上来，铁锈味很冲。\n第三行";

describe("md 片段表（铁律 6：标签只一份，模板不再抄）", () => {
  it("SNIPPET_KINDS 四条有序，SNIPPET_LABELS 键与之一致且中文逐字钉死", () => {
    expect(SNIPPET_KINDS).toEqual(["bold", "heading", "list", "quote"]);
    expect(Object.keys(SNIPPET_LABELS).sort()).toEqual([...SNIPPET_KINDS].sort());
    expect(SNIPPET_LABELS).toEqual({ bold: "加粗", heading: "标题", list: "列表", quote: "引用" });
  });
});

describe("applySnippet · 加粗（成对标记）", () => {
  it("非空选区：标记包在两端，返回下标把原文原样留给 setSelectionRange", () => {
    expect(applySnippet("bold", { value: "先读它", start: 0, end: 3 })).toEqual({
      value: "**先读它**",
      start: 2,
      end: 5
    });
  });

  it("空选区：两个标记相邻，光标落在正中（不是留在标记之前）", () => {
    expect(applySnippet("bold", { value: "海雾涌上来。", start: 0, end: 0 })).toEqual({
      value: "****海雾涌上来。",
      start: 2,
      end: 2
    });
  });

  it("跨行只包两端，不在每一行各加一对标记", () => {
    const next = applySnippet("bold", { value: THREE_LINES, start: 0, end: THREE_LINES.length });
    expect(next.value.slice(2, next.value.length - 2)).toBe(THREE_LINES);
    expect(next).toEqual({ value: `**${THREE_LINES}**`, start: 2, end: THREE_LINES.length + 2 });
  });

  it("下标口径是码元、内容口径是码点：空光标停在表情正中 ⇒ 整个码点被加粗，不留半截代理", () => {
    const next = applySnippet("bold", { value: "🐋海雾", start: 1, end: 1 });
    expect(next).toEqual({ value: "**🐋**海雾", start: 2, end: 4 });
    expect(next.value.slice(next.start, next.end)).toBe("🐋");
  });
});

describe("applySnippet · 标题（只作用首行）", () => {
  it("选区跨三行也只在首行行首加 ##，第二、三行行首不是 #", () => {
    const next = applySnippet("heading", { value: THREE_LINES, start: 0, end: THREE_LINES.length });
    expect(next.value).toBe(`## ${THREE_LINES}`);
    expect(next.start).toBe(3);
    expect(next.end).toBe(THREE_LINES.length + 3);
    const lines = next.value.split("\n");
    expect(lines[1]?.startsWith("#")).toBe(false);
    expect(lines[2]?.startsWith("#")).toBe(false);
  });
});

describe("applySnippet · 列表与引用（逐行前缀）", () => {
  it("跨行选区每行都加“- ”（变异 W8 的落点）", () => {
    expect(applySnippet("list", { value: THREE_LINES, start: 0, end: THREE_LINES.length })).toEqual(
      {
        value: "- 雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。\n- 第三行",
        start: 2,
        end: THREE_LINES.length + 6
      }
    );
  });

  it("选区从行中段起：被覆盖的行都加，没被碰到的首行不加", () => {
    const next = applySnippet("list", { value: THREE_LINES, start: 12, end: 23 });
    expect(next.value).toBe("雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。\n- 第三行");
    expect(next.start).toBe(14);
    expect(next.end).toBe(27);
  });

  it("已有“- ”的行不重复加（点两下不会变出“- - ”）", () => {
    const already = "- 雾\n- 海";
    expect(applySnippet("list", { value: already, start: 0, end: already.length })).toEqual({
      value: already,
      start: 0,
      end: already.length
    });
  });

  it("空选区时前缀落在当前行行首，光标随内容一起前移", () => {
    expect(applySnippet("list", { value: "雾从海面。\n次行", start: 4, end: 4 })).toEqual({
      value: "- 雾从海面。\n次行",
      start: 6,
      end: 6
    });
  });

  it("文档以换行开头且光标在 0：前缀插在第 0 行行首，不是插到换行之后", () => {
    expect(applySnippet("list", { value: "\n次行", start: 0, end: 0 })).toEqual({
      value: "- \n次行",
      start: 2,
      end: 2
    });
  });

  it("引用同样逐行，且与列表互不串标记", () => {
    const next = applySnippet("quote", { value: "第一段\n第二段", start: 0, end: 7 });
    expect(next.value).toBe("> 第一段\n> 第二段");
    expect(next).toEqual({ value: "> 第一段\n> 第二段", start: 2, end: 11 });
  });
});

describe("applySnippet · 下标归一化（反向与越界先能红）", () => {
  it("start > end 的倒选区与正选区结果逐字相同（不因方向产生两种形状）", () => {
    const forward = applySnippet("bold", { value: "先读它", start: 2, end: 3 });
    const backward = applySnippet("bold", { value: "先读它", start: 3, end: 2 });
    expect(backward).toEqual(forward);
    expect(forward.value).toBe("先读**它**");
  });

  it("下标越界被钳到文档两端，而不是抛异常或产出负下标", () => {
    expect(applySnippet("bold", { value: "先读它", start: -10, end: 999 })).toEqual({
      value: "**先读它**",
      start: 2,
      end: 5
    });
  });
});

describe("snippetToolbarState（附录 F-F：浏览态隐藏）", () => {
  it("浏览态与作品资料态都不显示工具栏——只读视图里点得出事的按钮不存在", () => {
    for (const mode of ["browse", "dossier"] as const) {
      expect(snippetToolbarState({ mode, hasActiveDoc: true }).visible).toBe(false);
    }
  });

  it("文稿态 + 有活动文稿：四个按钮按 SNIPPET_KINDS 顺序出，全部可点", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: true });
    expect(view.visible).toBe(true);
    expect(view.buttons.map((btn) => btn.label)).toEqual(["加粗", "标题", "列表", "引用"]);
    expect(view.buttons.map((btn) => btn.disabled)).toEqual([false, false, false, false]);
  });

  it("文稿态但没有活动文稿：按钮在位却 disabled（textarea 本就 readonly，不许假装改得动）", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: false });
    expect(view.visible).toBe(true);
    expect(view.buttons.map((btn) => btn.disabled)).toEqual([true, true, true, true]);
  });
});

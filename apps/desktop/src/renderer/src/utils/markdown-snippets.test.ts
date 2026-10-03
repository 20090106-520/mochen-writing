import { describe, expect, it } from "vitest";
import {
  SNIPPET_ICONS,
  SNIPPET_KINDS,
  SNIPPET_LABELS,
  applySnippet,
  snippetToolbarState
} from "./markdown-snippets";

/** 三行夹具：行首分别在 0 / 9 / 22（UTF-16 码元下标），总长 25。 */
const THREE_LINES = "雾从海面涌上来。\n海雾涌上来，铁锈味很冲。\n第三行";

describe("md 片段表（铁律 6：标签与图标各只一份，模板不再抄）", () => {
  // 顺序照参考稿（ref-1 右栏第三行）：成对标记在前、行首标记在后，斜体紧跟加粗。
  it("SNIPPET_KINDS 五条有序，SNIPPET_LABELS 键与之一致且中文逐字钉死", () => {
    expect(SNIPPET_KINDS).toEqual(["bold", "italic", "heading", "list", "quote"]);
    expect(Object.keys(SNIPPET_LABELS).sort()).toEqual([...SNIPPET_KINDS].sort());
    expect(SNIPPET_LABELS).toEqual({
      bold: "加粗",
      italic: "斜体",
      heading: "标题",
      list: "列表",
      quote: "引用"
    });
  });

  // 图标化之后，这一张表就是按钮的全部视觉；`Record<SnippetKind, IconName>` 的穷尽性由裸 tsc 把关，
  // 但「名字写对了、AppIcon 里却没那枚字形」tsc 看不见——那半截住在 document-pane-wiring.test.ts。
  it("SNIPPET_ICONS 与 SNIPPET_KINDS 一键一图，多一枚少一枚都不算过", () => {
    expect(SNIPPET_ICONS).toEqual({
      bold: "bold",
      italic: "italic",
      heading: "heading",
      list: "list",
      quote: "quote"
    });
    expect(Object.keys(SNIPPET_ICONS).sort()).toEqual([...SNIPPET_KINDS].sort());
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

describe("applySnippet · 斜体（与加粗同一条成对标记通路）", () => {
  // 反向用例：斜体若误用了加粗的两两成对（`**`），单星号这条断言立刻红。
  it("非空选区两端各一枚 `*`，返回下标把原文原样留给 setSelectionRange", () => {
    expect(applySnippet("italic", { value: "先读它", start: 0, end: 3 })).toEqual({
      value: "*先读它*",
      start: 1,
      end: 4
    });
  });

  it("空选区：两枚 `*` 相邻，光标落在正中（与加粗同一形状，只是标记长度不同）", () => {
    expect(applySnippet("italic", { value: "海雾涌上来。", start: 0, end: 0 })).toEqual({
      value: "**海雾涌上来。",
      start: 1,
      end: 1
    });
  });

  it("跨行只在选区两端各加一枚，不给每一行配一对星号", () => {
    expect(
      applySnippet("italic", { value: THREE_LINES, start: 0, end: THREE_LINES.length })
    ).toEqual({
      value: `*${THREE_LINES}*`,
      start: 1,
      end: THREE_LINES.length + 1
    });
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

/**
 * 修复轮 F2/F3：两条行首边界。
 * F2 选区正好止于下一行行首时（末位是换行），下一行没有被选中，不该被牵连加前缀。
 * F3 标题的去重判据要认出已有的 `#`——`#` 与 `## ` 在 markdown 里都是标题，
 *     只比整条 `"## "` 字面量会把 `# 手记` 顶成 `## # 手记`（渲染错乱的正文）。
 */
describe("applySnippet · 行首与已有标记的边界（修复轮 F2/F3）", () => {
  it("选区止于下一行行首：只有首行加“- ”，第二行没被选中就不许被碰", () => {
    expect(applySnippet("list", { value: "第一段\n第二段", start: 0, end: 4 })).toEqual({
      value: "- 第一段\n第二段",
      start: 2,
      end: 6
    });
  });

  it("行首已有 `# ` 视为已加过标题：原样返回，不叠成 `## # 手记`", () => {
    expect(applySnippet("heading", { value: "# 手记", start: 0, end: 4 })).toEqual({
      value: "# 手记",
      start: 0,
      end: 4
    });
  });

  it("行首已有 `## ` 也原样返回：只插入，不反解析也不改写既有层级", () => {
    expect(applySnippet("heading", { value: "## 手记", start: 3, end: 5 })).toEqual({
      value: "## 手记",
      start: 3,
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

  it("文稿态 + 有活动文稿：五个按钮按 SNIPPET_KINDS 顺序出，图标与中文标签都带上，全部可点", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: true });
    expect(view.visible).toBe(true);
    expect(view.buttons.map((btn) => btn.kind)).toEqual([...SNIPPET_KINDS]);
    expect(view.buttons.map((btn) => btn.label)).toEqual(["加粗", "斜体", "标题", "列表", "引用"]);
    expect(view.buttons.map((btn) => btn.icon)).toEqual([
      "bold",
      "italic",
      "heading",
      "list",
      "quote"
    ]);
    expect(view.buttons.map((btn) => btn.disabled)).toEqual([false, false, false, false, false]);
  });

  it("文稿态但没有活动文稿：按钮在位却 disabled（textarea 本就 readonly，不许假装改得动）", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: false });
    expect(view.visible).toBe(true);
    expect(view.buttons.map((btn) => btn.disabled)).toEqual([true, true, true, true, true]);
  });

  // F4（评审 Important 4）+ 复审 I-1：Chromium 不给 disabled 按钮弹原生 title，灰态恰恰是唯一
  // 需要解释的时刻（本仓同律先例：左栏「本章新对话（先打开一章）」）。
  // title 只在可点态说用途，禁用态留空——挂着弹不出来的解释等于没解释。
  it("disabled 态：理由住在可见的 hint 里（逐字），五枚按钮的 title 空着", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: false });
    expect(view.hint).toBe("打开一篇文稿后才能插入片段");
    expect(view.buttons.map((btn) => btn.title)).toEqual(["", "", "", "", ""]);
    expect(view.buttons.map((btn) => btn.disabled)).toEqual([true, true, true, true, true]);
    // 图标化之后 title 不再是唯一的名字来源：灰态也得有中文可及名，否则读屏只念得出「按钮」。
    expect(view.buttons.map((btn) => btn.label)).toEqual(["加粗", "斜体", "标题", "列表", "引用"]);
  });

  // 反向保护一：可点态的 hint 必须是空串，否则那句「先打开文稿」会在能点的时候继续挂着说假话。
  // 反向保护二：可点态 title 说按钮用途且五枚各不相同（抓「两态同词」与「五枚同句」两种漂移）。
  it("可点态：hint 收空，title 说按钮用途且五枚各不相同", () => {
    const view = snippetToolbarState({ mode: "manuscript", hasActiveDoc: true });
    expect(view.hint).toBe("");
    expect(view.buttons.map((btn) => btn.title)).toEqual([
      "插入「加粗」",
      "插入「斜体」",
      "插入「标题」",
      "插入「列表」",
      "插入「引用」"
    ]);
  });

  // 反向保护三：浏览态与作品资料态整条工具栏不进 DOM，hint 也不该有内容（visible 闸门在 .ts 里）。
  it("非文稿态：visible 为假且 hint 空串（容器由 visible 决定，不靠 hint 兜底）", () => {
    for (const mode of ["browse", "dossier"] as const) {
      const view = snippetToolbarState({ mode, hasActiveDoc: true });
      expect(view.visible).toBe(false);
      expect(view.hint).toBe("");
    }
  });
});

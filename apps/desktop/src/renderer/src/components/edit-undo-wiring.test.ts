import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  scopedStyleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/**
 * 「替换之后能不能退回去」这条通路的**接线**用例（2026-10-09 扫描总单·不存在表）。
 *
 * 三层分工，各钉各的：
 * - 判定（三条红线 + 文案）：`utils/edit-undo.ts` → `edit-undo.test.ts`（18 条纯函数）；
 * - 行为（真 store + 替身 textarea：撤销到底把哪份文本写回草稿）：`composables/useEditUndo.ts`
 *   → `useEditUndo.test.ts`（13 条运行时）；
 * - **接线**（本文件）：DocumentPane 是不是真的把这三样挂到了 DOM 与面板上。
 *
 * 为什么要单独钉接线：`.vue` 不进类型程序、没有运行时覆盖，少挂一个 `@keydown`、少调一次
 * `invalidateUndo()`，tsc 与 build 都不报——而用户按下 Ctrl+Z 时什么都没有发生，
 * 那正是本缺陷交付前的样子（"代码写了、界面没通路"）。
 */
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTemplate = templateSource("components/DocumentPane.vue");
const panelScript = scriptSource("components/FindReplacePanel.vue");
const panelTemplate = templateSource("components/FindReplacePanel.vue");
const panelCss = scopedStyleSource("components/FindReplacePanel.vue");
const composable = typeScriptSource("composables/useEditUndo.ts");

/** 取某个函数体的那段源码（从这里到文件末尾的粗切；本文件里用它钉调用顺序）。 */
function paneFnBody(name: string): string {
  const start = paneScript.indexOf(`function ${name}`);
  expect(start, `${name} 不在 DocumentPane 里`).toBeGreaterThan(-1);
  return paneScript.slice(start);
}

describe("① DocumentPane 只负责接线，不自己长出一套撤销", () => {
  it("真的用了那份 composable，且只用一次", () => {
    expect(paneScript).toContain('from "../composables/useEditUndo"');
    expect(paneScript).toContain("= useEditUndo(editorEl)");
    expect(countNeedle("useEditUndo(editorEl)", paneScript)).toBe(1);
  });

  it("面板与正文都拿到同一份产物：notice 给下去、undo 与 keydown 接回来", () => {
    expect(paneTemplate).toContain(':undo-notice="undoNoticeText"');
    expect(paneTemplate).toContain('@undo="undoLastEdit()"');
    expect(paneTemplate).toContain('@keydown="onEditorKeydown"');
    expect(countNeedle('@keydown="onEditorKeydown"', paneTemplate)).toBe(1);
  });

  it("替换的两条 emit 各自带上 kind，处数由面板递过来", () => {
    expect(paneTemplate).toContain(
      `@replace="(text, count) => replaceWithUndo(text, 'replace', count)"`
    );
    expect(paneTemplate).toContain(
      `@replace-all="(text, count) => replaceWithUndo(text, 'replace-all', count)"`
    );
  });

  it("渲染层不许自己再造一份栈（那会绕过 takeUndoFor 的章校验）", () => {
    expect(paneScript).not.toContain("createEditUndoStack");
    expect(paneScript).not.toContain("takeUndoFor");
    expect(paneScript).not.toContain("editUndo.push");
  });
});

describe("② 红线②的接线：用户一打字就作废整栈", () => {
  it("onContentInput 里先 invalidateUndo()，再写草稿", () => {
    const body = paneFnBody("onContentInput");
    expect(body).toContain("invalidateUndo()");
    expect(body.indexOf("invalidateUndo()")).toBeLessThan(body.indexOf("book.onEdit("));
  });

  it("invalidate 在 composable 那一侧确实是清空整栈（不是只清个 ref）", () => {
    expect(composable).toContain("stack.clear()");
    expect(composable).toContain("function invalidate(): void {");
    expect(composable).toContain("sync()");
  });
});

describe("③ 组合态与接手条件的唯一真身在 composable，不散进 .vue", () => {
  it("imeOwnsKey 与 undoOwnsKey 只在 useEditUndo.ts 里被调，DocumentPane 不自己判键", () => {
    expect(composable).toContain("undoOwnsKey(event, imeOwnsKey(event))");
    expect(paneScript).not.toContain("undoOwnsKey");
    expect(paneScript).not.toMatch(/function onEditorKeydown/);
  });

  it("栈空时先放行：那一下 Ctrl+Z 归原生撤销，不许被我们吞掉", () => {
    expect(composable).toMatch(/if \(undoDepth\.value === 0\) return;/);
    // 顺序钉死：两个闸门都在 preventDefault 之前。反过来说，先吞键再判断就是"键没了、也没撤销"。
    expect(composable.indexOf("if (undoDepth.value === 0) return;")).toBeLessThan(
      composable.indexOf("event.preventDefault()")
    );
  });

  it("还原走的是同一条写草稿通路（book.onEdit），不另开写盘口", () => {
    expect(composable).toContain("book.onEdit(snapshot.text)");
    expect(composable).toContain("setSelectionRange(snapshot.start, snapshot.end)");
    expect(composable).not.toContain("window.mochen.");
  });
});

describe("④ 片段插入接的是同一条通路（同类缺口：整篇赋值清掉原生撤销栈）", () => {
  it("useSnippetToolbar 拿到第二枚实参，且那枚实参调的就是同一份 commitWithUndo", () => {
    expect(paneScript).toContain("useSnippetToolbar(editorEl,");
    expect(paneScript).toContain('commitWithUndo(nextText, "snippet", 1, caret)');
  });

  it("先 useEditUndo 再 useSnippetToolbar：反序就是把还没解构出来的成员递进去", () => {
    expect(paneScript.indexOf("= useEditUndo(editorEl)")).toBeLessThan(
      paneScript.indexOf("useSnippetToolbar(editorEl,")
    );
  });

  it("片段那一路不在 .vue 里自己写草稿——写只经那一条通路（否则快照与写盘会分叉）", () => {
    const body = paneFnBody("onContentInput");
    // 手打那条路仍然直接报给 store（它不该进栈），但片段工具栏在 .vue 里不许出现第三种写法。
    expect(paneScript).not.toContain("applySnippet");
    expect(body).toContain("book.onEdit(target.value)");
  });
});

describe("④ 提示与按钮：界面说的和代码做的一致", () => {
  it("面板收的是 notice 文本、发的是 undo，不自拼第二份文案", () => {
    expect(panelScript).toContain("undoNotice: string");
    expect(panelScript).toContain("undo: []");
    expect(panelTemplate).toContain("{{ undoNotice }}");
    expect(panelTemplate).not.toContain("已替换");
  });

  it("按钮只在有可撤销的东西时出现，点了真的 emit undo", () => {
    expect(panelTemplate).toContain('v-if="undoNotice"');
    expect(panelTemplate).toContain("find-undo-btn");
    expect(panelTemplate).toContain('@click="doUndo()"');
    expect(panelScript).toContain('emit("undo")');
  });

  it("批量替换把处数带到快照里——单处替换恒为 1，两个 kind 不许混", () => {
    expect(panelScript).toContain('emit("replace-all", find.replaceAll(), count)');
    expect(panelScript).toContain("const count = matchCount.value;");
    // 顺序钉死：先取处数，再替换（replaceAll 内部会重算 positions，反序就拿到换完剩下的数）。
    expect(panelScript.indexOf("const count = matchCount.value;")).toBeLessThan(
      panelScript.indexOf('emit("replace-all"')
    );
    expect(panelScript).toContain('emit("replace", find.replaceCurrent(), 1)');
  });

  it("新加的 class 都有真规则，不留死 CSS", () => {
    expect(ruleBlock(panelCss, ".find-undo-notice")).not.toBe("");
    expect(ruleBlock(panelCss, ".find-undo-btn")).not.toBe("");
    expect(ruleBlock(panelCss, ".find-undo-btn:hover")).not.toBe("");
    expect(countNeedle("find-undo-btn", panelTemplate)).toBe(1);
  });
});

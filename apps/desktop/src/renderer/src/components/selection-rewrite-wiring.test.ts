/**
 * 选中即改写的接线守卫（2026-10-11）。
 *
 * 全是**读源码**钉的，因为 `.vue` 不进 tsc、也没有运行时覆盖——
 * 组件挂没挂上、预填走了不走真身、发不自动发送，编译期一概看不出来：
 *
 * ① DocumentPane 里没挂 <SelectionRewriteBar> ⇒ 功能整条不存在，用户永远见不到浮条。
 * ② 点按钮走 prefillComposer + setPaneCollapsed ⇒ 与 ai-check 审核同一条通路；
 *   一旦有人图省事直接改草稿（book.onEdit）或点了就发送，这条守卫红。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";

const PANE = "components/DocumentPane.vue";
const BAR = "components/SelectionRewriteBar.vue";

describe("DocumentPane · 选中即改写浮条挂载", () => {
  it("编辑区容器里真的挂着 <SelectionRewriteBar>，editor 用模板 ref 传进去", () => {
    const tpl = templateSource(PANE);
    // 组件标签没有 class，tagAttributes 按类找的口径用不上——直接钉整条标签串。
    expect(tpl).toContain('<SelectionRewriteBar :editor="editorEl" />');
    // 挂在 textarea 的同一个容器里（.editor-textarea-wrap），浮条才能相对编辑区定位。
    const wrap = tpl.indexOf('class="editor-textarea-wrap"');
    const bar = tpl.indexOf("<SelectionRewriteBar");
    const textarea = tpl.indexOf("<textarea");
    expect(wrap).toBeGreaterThan(-1);
    expect(textarea).toBeGreaterThan(wrap);
    expect(bar).toBeGreaterThan(textarea);
  });
});

describe("SelectionRewriteBar · 点按钮只预填，不发送、不直接改稿", () => {
  it("走 prefillComposer 真身 + threadKeyFor（当前章线程）+ 展开右栏", () => {
    const script = scriptSource(BAR);
    expect(script).toContain("agent.prefillComposer(threadKeyFor(book.activeDocTab)");
    expect(script).toContain('layout.setPaneCollapsed("right", false)');
    expect(script).toContain("selectionRewritePrompt");
  });

  it("反向钉：不自动发送，也不绕过提案直接改草稿", () => {
    const script = scriptSource(BAR);
    // 发送与直改草稿都是「替用户按确认键」——这两条名字不许出现在这个组件里。
    expect(script).not.toContain("sendTurn");
    expect(script).not.toContain("sendCurrent");
    expect(script).not.toContain("book.onEdit");
  });

  it("浮条样式落在 editor-pane.css 的编辑区容器作用域下", () => {
    const css = ruleBlock(
      styleSource("editor-pane.css"),
      ".editor-textarea-wrap .selection-rewrite-bar"
    );
    expect(css).toContain("position: absolute");
    expect(css).toContain("mochen-pop-in");
  });
});

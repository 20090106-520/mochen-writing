/// <reference types="node" />
/**
 * 查找高亮 mirror 层的**挂载接线**（2026-10-10 扫描总单 P2-13：每键全篇重渲）。
 *
 * 病根：`.find-replace-mirror` 原先常驻挂载（编辑区的 `v-else` 那一支里没有按 `findVisible` 收），
 * 面板关着时每次按键仍会读一遍 `highlightMirrorHtml` computed、把整篇稿子过一遍转义并重渲这一层。
 * 修法是把挂载收进条件：只有面板开着才挂这一层 DOM。
 *
 * 这里钉四件事，缺一件都不算修好：
 * ① mirror 标签自己的 `v-if="findVisible"`——判据与 textarea 那层「字让位」的
 *    `.document-editor--with-find` 类**同一个开关**：两层必须同开同关，
 *    只挂一层就是「透明字压空层」或「两层字叠着印」；
 * ② 挂载链上的两道父闸还在：编辑区 `mode === 'manuscript'` 的 v-if、骨架的 v-else
 *    （在途骨架态里根本没有 wrap，mirror 自然也不在）；
 * ③ 条件挂载后 ref 会是 null：`syncMirrorScroll` 的空闸不许丢，且面板**打开的那一瞬**
 *    要补一次滚动同步——textarea 可能已滚到半篇，新挂的层 scrollTop 是 0，不跟一下高亮就错位
 *    （挂常驻时没有这个问题，因为那一层从没被拆过）；
 * ④ 判定只住一处：怎么切仍是 `utils/find-mirror` 的真身，组件里不许出现第二个 `<mark` 拼接。
 *
 * CSS 侧不需要改动的原因写在 `editor-mirror-parity.test.ts` 的射程里：mirror 是
 * `position:absolute; inset:0` 脱离文档流的层，挂与不挂都不参与 wrap 的布局排版——
 * 这里顺带钉住这条定位声明，哪天有人把它改成流内元素，条件挂载就会开始推动 textarea。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  strippedStyleSource,
  tagAttributes,
  templateSource
} from "../utils/vue-source-reader";

const paneTpl = templateSource("components/DocumentPane.vue");
const paneScript = scriptSource("components/DocumentPane.vue");

describe("mirror 只在面板开着时挂（P2-13）", () => {
  it('mirror 标签带 v-if="findVisible"：面板关着时这一层连 DOM 都不在', () => {
    const attrs = tagAttributes(paneTpl, "find-replace-mirror");
    expect(attrs).toHaveLength(1);
    expect(attrs[0], "mirror 必须按 findVisible 条件挂载").toContain('v-if="findVisible"');
    // 全模板里这一枚精确的 `v-if="findVisible"` 只属于 mirror（面板那条是复合条件）。
    expect(countNeedle('v-if="findVisible"', paneTpl)).toBe(1);
  });

  it("mirror 的挂载开关与 textarea 让位类同一个判据（两层同开同关）", () => {
    const mirror = tagAttributes(paneTpl, "find-replace-mirror")[0] ?? "";
    const textarea = tagAttributes(paneTpl, "document-editor")[0] ?? "";
    expect(mirror).toContain("findVisible");
    expect(textarea).toContain("'document-editor--with-find': findVisible");
  });

  it("挂载链上的两道父闸都在：编辑区限文稿态、mirror 在骨架的 v-else 之后", () => {
    const leftPane = tagAttributes(paneTpl, "editor-pane-left")[0] ?? "";
    expect(leftPane).toContain("mode === 'manuscript'");
    const skeletonAt = paneTpl.indexOf(`v-if="bodyState === 'loading'"`);
    const wrapAt = paneTpl.indexOf('v-else class="editor-textarea-wrap"');
    const mirrorAt = paneTpl.indexOf('class="find-replace-mirror"');
    expect(skeletonAt, "骨架的 v-if 不在了，v-else 链就断了").toBeGreaterThan(-1);
    expect(wrapAt).toBeGreaterThan(skeletonAt);
    expect(mirrorAt).toBeGreaterThan(wrapAt);
  });

  it("ref 可能为 null：syncMirrorScroll 的空闸不许丢", () => {
    expect(paneScript).toContain("if (!ta || !mirror) return;");
  });

  it("面板打开的那一瞬补一次滚动同步（新挂的层不许停在 0）", () => {
    expect(paneScript).toMatch(
      /watch\(findVisible,[\s\S]*?\{[\s\S]*?await nextTick\(\);[\s\S]*?syncMirrorScroll\(\);/
    );
  });

  it("切分判定仍只住 utils/find-mirror：组件里没有第二份 <mark 拼接", () => {
    expect(paneScript).toContain("findMirrorHtml(book.draft");
    expect(countNeedle("<mark", paneScript)).toBe(0);
  });

  it("mirror 保持脱离文档流的定位（条件挂载才不会推动 textarea）", () => {
    const rule = ruleBlock(strippedStyleSource("editor-pane.css"), ".find-replace-mirror");
    expect(rule).toContain("position: absolute");
    expect(rule).toContain("inset: 0");
  });
});

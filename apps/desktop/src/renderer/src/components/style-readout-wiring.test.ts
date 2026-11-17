/**
 * 本书读数的四处界面落点（2026-11-16）。
 *
 * 与 document-pane-wiring 同一条理由：本仓零 jsdom / 零 @vue/test-utils，
 * `.vue` 的 `<script setup>` 不进类型程序，所以把「接线形状」钉成读源码断言：
 * 每个落点都必须从 utils/style-readout 取文案，不许界面里再拼第二套百分号与阈值。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";

const terms = "components/SideNavTermsReport.vue";
const slop = "components/SlopPanel.vue";
const pane = "components/DocumentPane.vue";
const footer = "components/EditorFooterMeta.vue";
const sidebar = "components/LeftSidebar.vue";
const badge = "components/ChapterDriftBadge.vue";

describe("书稿体检 · 本书腔调档案", () => {
  it("九行读数来自 style-readout，模板按行渲染而不是各拼各的", () => {
    const script = scriptSource(terms);
    expect(script).toContain('from "../utils/style-readout"');
    expect(script).toContain("bookStyleReadoutOf(contents)");
    expect(script).toContain("readoutRowsOf(readout)");
    const template = templateSource(terms);
    expect(template).toContain('class="stats-readout"');
    expect(template).toContain('v-for="row in styleReadoutRows"');
    expect(template).toContain("styleReadoutNote");
  });
});

describe("去 AI 味浮层 · 本章实时读数", () => {
  it("胶囊与复读台词都从 style-readout 取，浮层不自己算比与次数", () => {
    const script = scriptSource(slop);
    expect(script).toContain("chapterChipsOf(book.draft)");
    expect(script).toContain("bookStyleReadoutOf([book.draft])");
    expect(templateSource(slop)).toContain('<StyleReadoutChips :chips="chips"');
    expect(templateSource(slop)).toContain("ai-slop-readout-repeat");
  });
});

describe("编辑器页脚 · 常驻读数", () => {
  it("DocumentPane 只挂一格页脚组件，读数胶囊在页脚组件里", () => {
    expect(templateSource(pane).match(/<EditorFooterMeta\b/g)?.length).toBe(1);
    expect(scriptSource(footer)).toContain("chapterChipsOf(book.draft)");
    expect(templateSource(footer)).toContain("<StyleReadoutChips v-if=\"mode === 'manuscript'\"");
  });
});

describe("章节列表 · 腔调偏离标", () => {
  it("左栏只挂组件，扫描与缓存住在 store", () => {
    expect(templateSource(sidebar)).toContain("<ChapterDriftBadge");
    const script = scriptSource(badge);
    expect(script).toContain('from "../stores/useStyleReadoutStore"');
    expect(script).toContain("readout.ensure(docs, book.rootPath)");
    expect(script).not.toContain("styleProfileOf");
  });

  it("文字恒为「偏」，档位只走 is-off 一条类名", () => {
    const template = templateSource(badge);
    expect(template).toContain('class="tree-drift"');
    expect(template).toContain("'is-off': mark.severity === 'off'");
  });
});

describe("样式 · 四处新类名都有规则", () => {
  it("体检读数、偏离标、页脚胶囊与浮层读数各就各位", () => {
    expect(ruleBlock(styleSource("left-nav.css"), ".stats-readout-row")).toContain("grid");
    expect(ruleBlock(styleSource("left-nav.css"), ".tree-drift")).toContain("font-size");
    expect(ruleBlock(styleSource("editor-pane.css"), ".editor-footer .style-chips")).toContain(
      "overflow: hidden"
    );
    expect(ruleBlock(styleSource("ai-slop.css"), ".ai-slop-readout")).toContain("flex-wrap");
  });
});

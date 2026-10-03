/**
 * 源码契约测试（ruling T10-8）：DocumentPane.vue 与它新抽出的两枚子组件都没有运行时覆盖
 * （本仓零 jsdom / 零 @vue/test-utils，`.vue` 的 `<script setup>` 连类型程序都不进），
 * 于是把「接线形状」钉成读源码断言：只钉存在性与唯一性，不假装能测渲染行为。
 * 真机行为（点了到底加不加粗、页脚到底显不显示）归 Task 11 的冒烟矩阵。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const pane = "components/DocumentPane.vue";
const bar = "components/DocumentTabBar.vue";
const toolbar = "components/SnippetToolbar.vue";
const paneScript = scriptSource(pane);
const paneTemplate = templateSource(pane);

describe("DocumentPane · 片段工具栏的接线形状（F-F）", () => {
  it("工具栏只有一处挂载点，且喂进去的是 snippetToolbarState 的产物，不在模板里判可见性", () => {
    expect(paneTemplate.match(/<SnippetToolbar\b/g)?.length).toBe(1);
    expect(paneTemplate).toContain(':state="snippetToolbar"');
    expect(paneTemplate).toContain('@pick="applyToSelection"');
    expect(paneTemplate).not.toContain("snippetToolbar.visible");
    expect(paneScript).toContain("useSnippetToolbar(editorEl)");
    // 判定与标签的唯一真身都在 .ts：模板里出现「加粗」这类字面量就是第二份抄写。
    expect(paneTemplate).not.toContain("加粗");
    expect(paneTemplate).not.toContain("引用");
  });

  it("隐藏闸门钉在工具栏自己的容器上：非文稿态连容器都不进 DOM", () => {
    const markup = templateSource(toolbar);
    expect(markup).toContain('<div v-if="state.visible"');
    expect(markup).toContain('class="editor-text-tools"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="插入 md 片段"');
    expect(markup).toContain('class="format-button"');
    // 按钮文案取自 SNIPPET_LABELS（经 state.buttons），子组件不另存一份中文。
    expect(markup).toContain("{{ btn.label }}");
    expect(markup).not.toContain("加粗");
  });

  it("光标与选区回设要拿到 textarea 真身：ref 必须挂在编辑器上，不能只挂在别处", () => {
    const editor = /<textarea\b[\s\S]*?\/>/.exec(paneTemplate)?.[0] ?? "";
    expect(editor).toContain('ref="editorEl"');
    expect(editor).toContain('@input="onContentInput"');
  });
});

describe("DocumentPane · 三枚页签共用一个入口（Ruling T10-4）", () => {
  it("页签是表驱动：模板里只有一处 @click，且没有裸调 openDossier()", () => {
    expect(paneTemplate.match(/@click="switchMode\(tab\.mode\)"/g)?.length).toBe(1);
    expect(paneTemplate).toContain('v-for="tab in VIEW_TABS"');
    expect(paneTemplate).not.toContain("openDossier()");
    expect(paneScript).toContain("book.openDossier()");
    expect(paneScript).toContain('if (next === "dossier")');
  });

  it("右栏三态不在这里抄第二份：联合类型只 import，不留内联字面量", () => {
    expect(paneScript).toContain('type RightPaneMode } from "../stores/useBookStore"');
    expect(paneScript).not.toMatch(/"manuscript" \| "browse" \| "dossier"/);
    expect(vueSource(pane)).not.toMatch(/ToolbarMode/);
  });
});

describe("DocumentPane · 页脚两格只对文稿态成立（Ruling T10-5）", () => {
  it("「N 字」与「约 M 分钟阅读」同在 mode === 'manuscript' 闸门内，只读态只剩保存状态", () => {
    const gated = /<template v-if="mode === 'manuscript'">([\s\S]*?)<\/template>/.exec(
      paneTemplate
    )?.[1];
    expect(gated).toBeDefined();
    expect(gated).toContain("字");
    expect(gated).toContain('class="reading-time"');
    expect(gated?.includes("editor-save-status")).toBe(false);
    // 时长文案是拼好的字符串，模板里不再做三元与算术。
    expect(paneTemplate).toContain("{{ readingTimeLabel }}");
    expect(paneTemplate).not.toContain("分钟阅读");
  });
});

/**
 * 修复轮 F1/F4/F5：页脚那句分钟文案、字数口径、两张右栏文案表都不许住在 `<script setup>` 里。
 * 判据一律是「`.vue` 里不出现该字面量 + 只 import 那一个真身」，与上面「模板不出现第二个加粗」同族。
 */
describe("DocumentPane · 文案与计数口径都下沉 utils/（修复轮 F1/F4/F5）", () => {
  it("分钟文案不在 .vue 里拼装：拼串函数只从 utils/reading-time 进口", () => {
    expect(paneScript).not.toContain("分钟阅读");
    expect(paneScript).not.toContain("— 分钟");
    expect(paneScript).toContain("formatReadingTime");
    expect(paneTemplate).toContain("{{ readingTimeLabel }}");
  });

  it("「N 字」按码点而不是码元：与同一排的时长同口径", () => {
    expect(paneScript).not.toContain("book.draft.length");
    expect(paneScript).toContain("codePointLength(book.draft)");
    // 「字」这个后缀是单一插值字面量，属文案不属判定，留在模板。
    expect(paneTemplate).toContain("字");
  });

  it("两张 mode 文案表搬进 utils/right-pane-labels：.vue 里不再抄第二份中文", () => {
    expect(paneScript).not.toContain("文稿标签");
    expect(paneScript).not.toContain("浏览标签");
    expect(paneScript).toContain('from "../utils/right-pane-labels"');
    expect(paneTemplate).toContain(':label="BAND_LABELS[mode]"');
  });
});

describe("DocumentTabBar · 抽出后闸门与文案不许漂移（Ruling T10-3）", () => {
  it("dossier 闸门留在父侧，带名与关闭 aria 由父侧传进来", () => {
    const mount = /<DocumentTabBar\b[\s\S]*?\/>/.exec(paneTemplate)?.[0] ?? "";
    expect(mount).toContain(`v-if="mode !== 'dossier'"`);
    expect(mount).toContain(':label="BAND_LABELS[mode]"');
    // 两句关闭按钮的 aria 原文仍在父侧（文案选择），没被压成一句。
    expect(mount).toContain(
      ":close-label=\"mode === 'manuscript' ? '关闭当前文稿标签' : '关闭当前浏览标签'\""
    );
  });

  it("子组件只渲染传进来的文案：既不硬编码「关闭当前标签」，也不抄第二份 BAND_LABELS", () => {
    const markup = templateSource(bar);
    expect(markup).toContain(':aria-label="label"');
    expect(markup).toContain(':aria-label="closeLabel"');
    expect(markup).not.toContain("关闭当前标签");
    expect(markup).not.toContain("文稿标签");
    expect(markup).not.toContain("浏览标签");
    expect(scriptSource(bar)).not.toContain("useBookStore");
    expect(markup).toContain('class="section-tabs-bar"');
    expect(markup).toContain('class="section-tabs-remove"');
  });
});

describe("右栏三处源文件都不长出 WYSIWYG（附录 §2.2 明写不做）", () => {
  it("contenteditable 一次都不许出现：编辑器仍是 textarea，片段只是改字符串", () => {
    for (const file of [pane, bar, toolbar]) {
      expect(vueSource(file)).not.toContain("contenteditable");
    }
    expect(vueSource(pane)).toContain("<textarea");
  });
});

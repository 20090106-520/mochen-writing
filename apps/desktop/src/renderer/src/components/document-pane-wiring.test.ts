/**
 * 源码契约测试（ruling T10-8）：DocumentPane.vue 与它新抽出的两枚子组件都没有运行时覆盖
 * （本仓零 jsdom / 零 @vue/test-utils，`.vue` 的 `<script setup>` 连类型程序都不进），
 * 于是把「接线形状」钉成读源码断言：只钉存在性与唯一性，不假装能测渲染行为。
 * 真机行为（点了到底加不加粗、页脚到底显不显示）归 Task 11 的冒烟矩阵。
 */
import { describe, expect, it } from "vitest";
import { SNIPPET_ICONS } from "../utils/markdown-snippets";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const pane = "components/DocumentPane.vue";
const bar = "components/DocumentTabBar.vue";
const toolbar = "components/SnippetToolbar.vue";
const dossier = "components/BookDossier.vue";
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
    // #113a：按钮画的是字形，中文标签退居可及名与 title（参考稿右栏第三行是 B/I/" 三枚图标）。
    expect(markup).toContain(':name="btn.icon"');
    expect(countNeedle("<AppIcon", markup)).toBe(1);
    expect(markup).toContain(':size="16"');
    expect(markup).toContain(':aria-label="btn.label"');
    // deepwrite 的 .text-tool-button 每条都带 @mousedown.prevent：按下不抢 textarea 的焦点与选区。
    expect(markup).toContain("@mousedown.prevent");
    expect(markup).not.toContain("{{ btn.label }}");
    expect(markup).not.toContain("加粗");
  });

  // F4（评审 Important 4）：载体钉——按钮用途住在 .ts 派生的 btn.title，模板只绑 :title="btn.title"。
  // 若漂移回 :title="btn.label"（把 label 再念一遍 = 没解释），这条必须红。判定与理由一律不在模板造。
  it("按钮 title 绑的是 utils 派生出来的 btn.title，不在模板里退回 btn.label", () => {
    const markup = templateSource(toolbar);
    expect(markup).toContain(':title="btn.title"');
    expect(markup).not.toContain(':title="btn.label"');
  });

  // 复审 I-1：Chromium 不给 disabled 按钮弹原生 title，而灰态恰恰是唯一需要解释的时刻
  // （本仓同律先例见 left-sidebar-nav.test.ts 的 M2）⇒ 理由必须是模板里的一枚**可见**节点。
  // 钉的是载体：把 `{{ state.hint }}` 删掉或改回只挂 title，这条必须红。文案本身由 utils 逐字钉。
  it("禁用理由走可见节点：hint 由 utils 给，模板只负责显示它", () => {
    const markup = templateSource(toolbar);
    expect(markup).toContain('v-if="state.hint"');
    expect(markup).toContain("{{ state.hint }}");
    // 那句中文的唯一真身在 utils/markdown-snippets.ts：子组件里再抄一遍就是第二份实现（铁律 6）。
    expect(markup).not.toContain("打开一篇文稿");
  });

  it("光标与选区回设要拿到 textarea 真身：ref 必须挂在编辑器上，不能只挂在别处", () => {
    const editor = /<textarea\b[\s\S]*?\/>/.exec(paneTemplate)?.[0] ?? "";
    expect(editor).toContain('ref="editorEl"');
    expect(editor).toContain('@input="onContentInput"');
  });
});

/**
 * #113a 片段钮图标化。图标名住在 utils（铁律 6），模板只渲染 btn.icon。
 * 这里补的是裸 tsc 看不见的那半截：`IconName` 拼错会被类型关卡拦下，
 * 但「名字合法、AppIcon.vue 里没有对应字形分支」只会画出一枚空白按钮，tsc 与 vitest 都不红。
 */
describe("片段钮的字形真的画得出来（#113a）", () => {
  // templateSource 会剥 HTML 注释：只在注释里写「有这枚字形」不算画得出来。
  const glyphs = templateSource("components/AppIcon.vue");
  for (const [kind, icon] of Object.entries(SNIPPET_ICONS)) {
    it(`${kind} 的图标 ${icon} 在 AppIcon.vue 里有自己的分支`, () => {
      expect(glyphs).toContain(`name === '${icon}'`);
    });
  }
});

/**
 * 工具行排版照 deepwrite 的 `.editor-toolbar`（RightEditorPane.vue:904-970）：
 * 分段控件之间用 `.toolbar-separator` 竖线，整行左排；`.toolbar-spacer` 是把工具推到最右的自创形状。
 * 文字标签时代补的 `width: auto` 覆盖在图标化之后必须删掉——留着它，按钮就不是那枚 27×27 方块，
 * hover 命中区也跟着变形状（同一条理由见 .format-button:focus-visible：图标钮没有文字可描边）。
 */
describe("工具行左排分段 + 按钮回到方块（#113a）", () => {
  it("view-tabs 与片段工具栏之间是一枚分隔线，不是把工具推到最右的撑满空白", () => {
    expect(paneTemplate).toContain('<span class="toolbar-separator" />');
    expect(paneTemplate).not.toContain("toolbar-spacer");
  });

  it("27×27 方块、flex-shrink 与键盘描边都在；文字标签那条覆盖已删", () => {
    const block = ruleBlock(styleSource("editor-pane.css"), ".format-button");
    expect(block).toContain("width: 27px");
    expect(block).toContain("height: 27px");
    expect(block).toContain("flex-shrink: 0");
    expect(ruleBlock(styleSource("editor-pane.css"), ".format-button:focus-visible")).toContain(
      "outline: 2px solid var(--accent)"
    );
    expect(styleSource("interaction.css")).not.toContain(".editor-text-tools .format-button");
  });

  it("化石清理：本仓没有「正文/人物状态」双文件页签，无人消费的规则不留", () => {
    const editor = styleSource("editor-pane.css");
    expect(editor).not.toContain("draft-file-tabs");
    expect(editor).not.toContain("toolbar-spacer");
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

  // #103a：字数与时长都只算「剥掉 frontmatter 之后的正文」。钉三件事：围栏切分只有一份真身
  // （contracts 的 splitFrontmatter）、计数只有一份口径（proseCharCount）、两者吃同一个 prose 派生值。
  // 名字漂回 codePointLength（含空白、不剥围栏）就是第二套口径，这条必须红。
  it("「正文 N 字」与时长同源：先剥围栏，再按非空白码点计数", () => {
    expect(paneScript).not.toContain("book.draft.length");
    expect(paneScript).not.toContain("codePointLength");
    expect(paneScript).toContain("splitFrontmatter(book.draft).body");
    expect(paneScript).toContain("proseCharCount(prose.value)");
    expect(paneScript).toContain("formatReadingTime(prose.value)");
    // textarea 里围栏行仍然看得见，计数却不含它 ⇒ 标签必须写明「正文」，否则名实不符。
    expect(paneTemplate).toContain('正文 {{ characterCount.toLocaleString("zh-CN") }} 字');
  });

  it("两张 mode 文案表搬进 utils/right-pane-labels：.vue 里不再抄第二份中文", () => {
    expect(paneScript).not.toContain("文稿标签");
    expect(paneScript).not.toContain("浏览标签");
    expect(paneScript).toContain('from "../utils/right-pane-labels"');
    expect(paneTemplate).toContain(':label="BAND_LABELS[mode]"');
  });

  // #103b：保存态那句话此前是 `<script setup>` 里的四个中文字面量——改坏它全仓不红。
  // 这里钉的是「句子中不在 .vue + 入参齐 + 头脚同源」：把 `{{ saveStateText }}` 退回字面量、
  // 或者只喂三个入参（漏掉 hasOpenDoc ⇒ 没开稿子也说「已保存到本机」），这条都要红。
  it("保存态句子不在 .vue 里拼：判定交给 utils/save-state，头与脚读同一个值", () => {
    for (const sentence of [
      "外部已改动",
      "正在保存到本机",
      "有未保存修改",
      "已保存到本机",
      "未打开文稿"
    ]) {
      expect(paneScript).not.toContain(sentence);
      expect(paneTemplate).not.toContain(sentence);
    }
    expect(paneScript).toContain('from "../utils/save-state"');
    expect(paneScript).toContain("saveStateLabel({");
    // 只钉键名等于没钉：`hasOpenDoc: true` 一样能过，而那正是「没开稿子也说已保存」的 bug 形状。
    // 所以四个键各自钉回收它的 store 字段。
    const call = paneScript.match(/saveStateLabel\(\{[\s\S]*?\}\)/);
    expect(call, "保存态必须走 utils/save-state 的决策表").not.toBeNull();
    const feeds: Record<string, RegExp> = {
      conflict: /book\.conflict !== null/,
      saving: /book\.saving\b/,
      dirty: /book\.dirty\b/,
      hasOpenDoc: /book\.activeDocTab !== null/
    };
    for (const [key, feed] of Object.entries(feeds)) {
      expect(
        new RegExp(`${key}:\\s*${feed.source}`).test(call![0]),
        `${key} 没接住 store 字段`
      ).toBe(true);
    }
    expect(paneTemplate).toContain("{{ saveStateText }}");
    expect(paneTemplate).toContain("book.notice || saveStateText");
    expect(paneTemplate.match(/saveStateText/g)?.length).toBe(2);
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

describe("BookDossier · 书卡那句「正文 M 字」的载体（#103a）", () => {
  // M5 那一课的复用品：判定/求和在 .ts 里改好不等于接通，钉的是「这个值真的走进了模板」。
  // 把 `{{ summary.chapterChars }}` 删掉、或改回在模板里自己加总，这条都要红。
  it("求和只发生在 utils：模板只插 summary.chapterChars，不在 .vue 里再算一遍", () => {
    const markup = templateSource(dossier);
    const facts = /<p class="dossier-facts">([\s\S]*?)<\/p>/.exec(markup)?.[1] ?? "";
    expect(facts).toContain("章节");
    expect(facts).toContain("summary.chapterCount");
    expect(facts).toContain("正文");
    expect(facts).toContain("summary.chapterChars");
    expect(vueSource(dossier)).not.toMatch(/\.reduce\(/);
    expect(vueSource(dossier)).not.toMatch(/proseCharCount|splitFrontmatter/);
    // 汇总来自父侧唯一一次 dossierSummary()，子组件不自己从 store 取数。
    expect(scriptSource(dossier)).not.toContain("useBookStore");
    expect(paneScript).toContain("dossierSummary(book.meta, book.docs)");
  });
});

describe("右栏四株源文件都不长出 WYSIWYG（附录 §2.2 明写不做）", () => {
  it("contenteditable 一次都不许出现：编辑器仍是 textarea，片段只是改字符串", () => {
    for (const file of [pane, bar, toolbar, dossier]) {
      expect(vueSource(file)).not.toContain("contenteditable");
    }
    expect(vueSource(pane)).toContain("<textarea");
  });
});

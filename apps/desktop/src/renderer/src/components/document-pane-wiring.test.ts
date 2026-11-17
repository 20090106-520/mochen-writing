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
  strippedStyleSource,
  styleSource,
  tagAttributes,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const pane = "components/DocumentPane.vue";
const bar = "components/DocumentTabBar.vue";
const toolbar = "components/SnippetToolbar.vue";
const dossier = "components/BookDossier.vue";
const paneScript = scriptSource(pane);
const paneTemplate = templateSource(pane);
// 2026-11-16：页脚那半格搬去 EditorFooterMeta.vue（DocumentPane 已贴 800 行上限），
// 模板断言跟着搬到新文件；脚本与口径断言仍读 DocumentPane。
const footer = "components/EditorFooterMeta.vue";
const footerTemplate = templateSource(footer);

describe("DocumentPane · 片段工具栏的接线形状（F-F）", () => {
  it("工具栏只有一处挂载点，且喂进去的是 snippetToolbarState 的产物，不在模板里判可见性", () => {
    expect(paneTemplate.match(/<SnippetToolbar\b/g)?.length).toBe(1);
    expect(paneTemplate).toContain(':state="snippetToolbar"');
    expect(paneTemplate).toContain('@pick="applyToSelection"');
    expect(paneTemplate).not.toContain("snippetToolbar.visible");
    // 第二枚实参是把片段接进撤销栈的那条通路（正题钉在 edit-undo-wiring.test.ts，这里只认它挂上了）。
    expect(paneScript).toContain("useSnippetToolbar(editorEl,");
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

  /**
   * 2026-10-22 真机（窗口 1000、右栏约 460）：页签被当成收缩对象压到半个字宽，
   * 中文可在任意字间折行 ⇒ 「文稿 / 浏览 / 作品资料」折成「文/稿」「浏/览」「作品资/料」三摞竖排。
   * 两处各挡一半：整条控件不参与收缩（否则按钮再 nowrap 也只是溢出），按钮文字不折行。
   */
  it("窄栏页签不许折成竖排：分段控件不收缩，按钮文字 nowrap", () => {
    const tabs = ruleBlock(styleSource("editor-pane.css"), ".view-tabs");
    expect(tabs).toContain("flex: 0 0 auto");
    const button = ruleBlock(styleSource("editor-pane.css"), ".view-tabs button");
    expect(button).toContain("white-space: nowrap");
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
    expect(paneTemplate.match(/<EditorFooterMeta\b/g)?.length).toBe(1);
    const gated = /<template v-if="mode === 'manuscript'">([\s\S]*?)<\/template>/.exec(
      footerTemplate
    )?.[1];
    expect(gated).toBeDefined();
    expect(gated).toContain("字");
    expect(gated).toContain('class="reading-time"');
    expect(gated?.includes("editor-save-status")).toBe(false);
    // 时长文案是拼好的字符串，模板里不再做三元与算术。
    expect(footerTemplate).toContain("{{ readingTimeLabel }}");
    expect(footerTemplate).not.toContain("分钟阅读");
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
    expect(footerTemplate).toContain("{{ readingTimeLabel }}");
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
    expect(footerTemplate).toContain('正文 {{ characterCount.toLocaleString("zh-CN") }} 字');
  });

  it("两张 mode 文案表搬进 utils/right-pane-labels：.vue 里不再抄第二份中文", () => {
    expect(paneScript).not.toContain("文稿标签");
    expect(paneScript).not.toContain("浏览标签");
    expect(paneScript).toContain('from "../utils/right-pane-labels"');
    expect(paneTemplate).toContain(':label="BAND_LABELS[mode]"');
  });

  // 2026-10-10 巡检：markdownToSimpleHtml 全篇重算 + v-html 全量重挂，十万字开分栏
  // 每键实测 437ms。预览改为「落后一拍」的 previewDraft，排程真身在
  // composables/usePreviewDraft（判定在 utils/preview-debounce）。
  // 这里钉三件事：接线只从 composable 进口、预览真身吃 previewDraft 而不是 book.draft、
  // .vue 里不许再自己抄 setTimeout 排程（第二份排程就是第二份口径）。
  it("分栏预览走静默窗：previewHtml 吃 previewDraft，排程只住在 usePreviewDraft", () => {
    expect(paneScript).toContain('from "../composables/usePreviewDraft"');
    expect(paneScript).toContain("usePreviewDraft(() => book.draft, viewMode)");
    // 2026-10-23：预览先剥 frontmatter 再渲染——草稿原文会印出 `---` / `title:` 三行元数据，
    // 标题在围栏里与正文 h1 里各说一遍。剥围栏复用 contracts 的 splitFrontmatter，不另写规则。
    expect(paneScript).toContain("markdownToSimpleHtml(splitFrontmatter(previewDraft.value).body)");
    expect(paneScript).not.toContain("markdownToSimpleHtml(book.draft)");
    expect(paneScript).not.toContain("setTimeout");
  });

  // #103b：保存态那句话此前是 `<script setup>` 里的四个中文字面量——改坏它全仓不红。
  // 批次 5-⑳ 起，「头与脚读同一个值」的做法改成**只留一处**（底栏），理由是真机量出来的账：
  // 1440 视口下右栏 490，栏头右侧为系统窗控留 146 ⇒ 内容盒 328px；栏头那一行要
  // 74（保存状态）+ 288（九枚 32px 按钮）+ 45（九个 5px 间隙）= 407px。缺的 79px 全砸在左端：
  // 面包屑被压成 0px 宽度，右端两枚按钮画进窗控带里（伏笔台账 / 收起文本内容栏压在最小化、最大化上）。
  // 去掉重复显示正好腾出 79px，与缺口分毫不差。
  //
  // 所以这里钉的不再是「出现两次」，而是**方向反过来**：不许再冒出第二处。
  // 把「判据放松成不检查」是另一回事——下面三条都比原来的计数更紧。
  it("保存态句子不在 .vue 里拼：判定交给 utils/save-state，全栏只显示一处（底栏）", () => {
    for (const sentence of [
      "外部已改动",
      "正在保存到本机",
      "有未保存修改",
      "已保存到本机",
      "未打开文稿"
    ]) {
      expect(paneScript).not.toContain(sentence);
      expect(paneTemplate).not.toContain(sentence);
      expect(footerTemplate).not.toContain(sentence);
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
    // 5-⑳ 之前这里还有一条 `toContain("{{ saveStateText }}")`，它是被**栏头**那份满足的。
    // 栏头那份去掉后唯一一处是 `{{ book.notice || saveStateText }}`——下面这条断言把它盖住了，
    // 而且盖得更严（连 notice 优先一并钉住），所以不是把保证改小，是把同一份保证换个更强的写法。
    expect(footerTemplate).toContain("book.notice || stateText");
    // 5-⑳：只剩底栏那一处。多一处就把栏头那 79px 吃回去，按钮重新压到窗控上。
    // 2026-11-16：页脚搬进 EditorFooterMeta 后，父侧只剩把 saveStateText 当 prop 传一次。
    expect(paneTemplate.match(/saveStateText/g)?.length).toBe(1);
    expect(footerTemplate.match(/stateText/g)?.length).toBe(1);
    // 栏头不许再有第二份保存状态（`.save-state` 这条链已随它一起删干净）。
    expect(paneTemplate).not.toContain('class="save-state"');
    expect(footerTemplate).not.toContain('class="save-state"');
    // 副本去掉时，告警色必须跟着搬走——否则「有未保存修改」只剩字面变化、丢掉颜色信号。
    const saveStatus = footerTemplate.match(/<span class="editor-save-status"[^>]*>/);
    expect(saveStatus, "底栏那一处必须还在").not.toBeNull();
    expect(saveStatus![0]).toContain("is-dirty");
  });

  // 5-⑳：`is-dirty` 这个类名本身不产生任何视觉效果，颜色在样式表里。
  // 只钉模板上的类名的话，把那条 CSS 删了断言照样全绿——而「有未保存修改」就只剩字面变化。
  // 所以这里读 styles/editor-pane.css，把那条规则钉住。
  it("告警色跟着保存状态搬到了底栏那一处（类名不产生颜色，规则得在）", () => {
    const css = styleSource("editor-pane.css");
    const dirty = ruleBlock(css, ".editor-footer .editor-save-status.is-dirty");
    expect(dirty).toContain("color: var(--warning)");
    // 旧那条已随栏头副本一起删干净：留着会让人以为还有第二处告警色。
    // 否定断言必须读**剥掉注释**的那份——原地那段「为什么删」的说明里就写着 `.save-state.is-dirty`，
    // 读原文会被自己的注释反咬（详见 strippedStyleSource 的说明）。
    const bare = strippedStyleSource("editor-pane.css");
    expect(bare).not.toContain(".save-state {");
    expect(bare).not.toContain(".save-state.is-dirty");
    expect(strippedStyleSource("theme-runtime.css")).not.toContain(".save-state");
  });

  // 5-⑳：栏头那一行的宽度账。真机 1440 视口量到的是
  //   右栏 490 = 栏头 489 = 左 15 + 内容 328 + 右 146（为系统窗控预留）
  //   操作区 407（74 保存状态 + 288 九枚 32px 按钮 + 45 间隙）⇒ 缺 79px
  // 去掉重复显示后操作区正好 328、缺额 0。这是那笔账的**回归线**：
  // 往后谁往栏头里再塞一个 32px 以上的控件，缺额就会重新变正，
  // 右端按钮会再次画进窗控带（伏笔台账 / 收起文本内容栏压在最小化、最大化上）。
  // 判据只钉「按钮数量」这一个会变且能算得出来的量——宽度本身在样式表里查不到。
  it("栏头操作区不许重新长出第二份保存状态或第十枚按钮（那 79px 的账）", () => {
    const header = paneTemplate.slice(
      paneTemplate.indexOf('<div class="editor-header-actions">'),
      paneTemplate.indexOf("</header>")
    );
    expect(header.match(/class="icon-button"/g)?.length ?? 0).toBeLessThanOrEqual(9);
    expect(header).not.toContain("saveStateText");
    expect(header).not.toContain("save-state");
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

/**
 * deepwrite 对齐收尾：标题行从只读变可编辑。改的是 frontmatter 的 title 行
 * （book.renameDocTitle 走指纹链），文件名与 relPath 一概不动。提交唯一路径是 blur——
 * Enter 只主动移开焦点（避免 Enter+blur 双发），Esc 当场弹回，空名不发请求。
 */
describe("DocumentPane · 标题行可编辑（deepwrite 对齐收尾）", () => {
  const titleInput =
    /<input\s+class="document-title-input"[\s\S]*?\/>/.exec(paneTemplate)?.[0] ?? "";

  it("只读态收窄到「没开文稿」：readonly 绑 activeTabId === null，提示与 aria 都说明这是可改的标题", () => {
    expect(titleInput).not.toBe("");
    expect(titleInput).toContain(':readonly="activeTabId === null"');
    expect(titleInput).toContain('aria-label="文档标题（回车或移开焦点即保存）"');
    expect(titleInput).toContain('title="点这里可以改标题（只改 frontmatter，不动文件名）"');
  });

  it("Enter / Esc / blur 各走各的真身：提交唯一路径是 blur，Enter 只负责失焦", () => {
    // 5-㊶：模板上的 `.enter.prevent` / `.esc.prevent` 换成单一入口 onTitleKeydown。
    // 【这不是改形状好看，是修真缺陷】模板修饰符是无条件执行的——它先 preventDefault、
    // 再调 handler。组合态里那一下回车是输入法在选词，handler 里再怎么提前 return 也拦不住，
    // 于是拼音被当标题提交（title.value 此刻就是拼音）再 blur 落盘。
    expect(titleInput).toContain('@keydown="onTitleKeydown"');
    expect(titleInput).not.toContain("@keydown.enter.prevent");
    expect(titleInput).not.toContain("@keydown.esc.prevent");
    expect(titleInput).toContain('@blur="commitTitle($event)"');
    // 闸门与 preventDefault 必须在同一个函数里：顺序也钉（前者在后者之前 return）。
    const onTitle = /function onTitleKeydown[\s\S]*?\n\}/.exec(paneScript)?.[0] ?? "";
    expect(onTitle, "onTitleKeydown 读不到").not.toBe("");
    expect(onTitle).toContain("if (imeOwnsKey(event)) return;");
    expect(onTitle).toContain("blurTitle(event)");
    expect(onTitle).toContain("revertTitle(event)");
    expect(onTitle).toContain("event.preventDefault()");
    // 顺序：闸门必须排在第一行判断上，否则「先 preventDefault 再判组合态」等于没修。
    expect(onTitle.indexOf("imeOwnsKey(event)")).toBeGreaterThan(-1);
    expect(onTitle.indexOf("imeOwnsKey(event)")).toBeLessThan(
      onTitle.indexOf("event.preventDefault()")
    );
    // 双发防线：blurTitle 的实现就是主动 blur，Enter 分支里不许再摸 commitTitle。
    const blurBody = /function blurTitle[\s\S]*?\n\}/.exec(paneScript)?.[0] ?? "";
    expect(blurBody).not.toBe("");
    expect(blurBody).not.toContain("commitTitle");
  });

  it("Esc 弹回旧值、提交对齐 store 真相：commitTitle 三道闸与 renameDocTitle 调用逐字钉", () => {
    const revert = /function revertTitle[\s\S]*?\n\}/.exec(paneScript)?.[0] ?? "";
    expect(revert).toContain("target.value = title.value");
    const body = /function commitTitle[\s\S]*?\n\}/.exec(paneScript)?.[0] ?? "";
    expect(body).toContain("if (relPath === null) return;");
    expect(body).toContain("if (value === title.value) return;");
    expect(body).toContain('if (value.trim() === "")');
    expect(body).toContain("book.renameDocTitle(relPath, value)");
    // 提交后无论成败都把显示值对齐 store 的真相（成功换新 / 失败弹回）。
    expect(body).toContain("target.value = title.value");
  });
});

/**
 * 2026-10-05：正文三件套（行距 / 字号 / 拼写检查）落进编辑器。行距与字号是 CSS 变量
 * （偏好真身在设置页「写作」的 localStorage，样式表 var 缺席即原值），拼写检查直接绑布尔——
 * 此前写死 spellcheck="false"，这里钉住「绑定存在 + 写死不许回来」，退回写死这条必须红。
 *
 * 2026-10-06：变量挂哪一层，挪了两次。从 textarea 挪到 `.editor-textarea-wrap`（5-㉑），
 * 5-㉒ 又挪到 `.editor-document` —— 那是编辑面 / 分栏预览 / 浏览态 / 查找高亮
 * 这四个盒子的**共同祖先**。挂在任何一个上，另外几个就读不到、只吃样式表兜底：
 * 挂 textarea 时 mirror 不跟（18px 对 15px，行数 12 对 14）；挂 wrap 时预览与浏览不跟
 * （分栏视图左右并排却是两种字号）。所以这条钉的是「共同祖先」这个形状：`.editor-document` 上有，
 * textarea 与 wrap 上都没有——保证没变小：从禁 1 个盒子扩到禁 2 个。
 * 拼写检查仍绑在 textarea 上（它是属性不是变量）。
 */
describe("DocumentPane · 正文偏好三件套（2026-10-05 建，5-㉑/5-㉒ 两改挂法）", () => {
  it("拼写检查绑 :spellcheck，写死的 spellcheck=false 不许回来", () => {
    const editor = /<textarea\b[\s\S]*?\/>/.exec(paneTemplate)?.[0] ?? "";
    expect(editor).toContain(':spellcheck="editorSpellcheck"');
    expect(editor).not.toContain('spellcheck="false"');
    expect(paneScript).toContain("loadEditorSpellcheck(editorTextPreferenceStorage())");
  });

  it("行距/字号/列宽三档经 :style 绑在 .editor-document 上，textarea 与 wrap 自己都不许带", () => {
    const editor = /<textarea\b[\s\S]*?\/>/.exec(paneTemplate)?.[0] ?? "";
    expect(editor, "textarea 上不该再有 :style——兄弟盒子读不到，变量会只作用在一层").not.toContain(
      ":style="
    );
    expect(
      tagAttributes(paneTemplate, "editor-textarea-wrap").filter((a) => a.includes(":style=")),
      "wrap 上不该再有 :style"
    ).toHaveLength(0);
    expect(
      tagAttributes(paneTemplate, "editor-document").filter((a) =>
        a.includes(':style="editorLayoutStyle"')
      )
    ).toHaveLength(1);
    for (const v of ['"--editor-leading"', '"--editor-font-size"', '"--editor-measure"']) {
      expect(paneScript).toContain(v);
    }
    expect(paneScript).toContain("loadEditorLeading(editorLeadingPreferenceStorage())");
    expect(paneScript).toContain("loadEditorSize(editorTextPreferenceStorage())");
    expect(paneScript).toContain("loadEditorMeasure(editorMeasurePreferenceStorage())");
  });

  it("样式表的 var 兜底原值：变量缺席时行距 1.95、字号 1.07143rem，两边不互相冒充默认档", () => {
    const css = styleSource("editor-pane.css");
    expect(css).toContain("line-height: var(--editor-leading, 1.95)");
    expect(css).toContain("font-size: var(--editor-font-size, 1.07143rem)");
  });
});

/**
 * 2026-10-23 窄窗走查：页脚原样写着「目标 [未设] 字」——单位挂在 input 后面无条件渲染，
 * 空态里那个「字」没有所指。没设目标时只留「目标 [未设]」，设了才带单位。
 */
describe("页脚本章目标：没设目标时不挂单位", () => {
  it("「字」的单位与 label 都只在有目标时渲染", () => {
    const tpl = templateSource("components/ChapterQuota.vue");
    expect(tpl).toContain('<span v-if="quota.target > 0">字</span>');
    expect(tpl).not.toMatch(/\n\s*字<span v-if="quota.label"/);
  });
});

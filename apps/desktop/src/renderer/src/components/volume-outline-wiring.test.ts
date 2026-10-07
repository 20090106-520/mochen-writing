import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  countNeedle,
  scriptSource,
  styleSource,
  tagAttributes,
  templateSource
} from "../utils/vue-source-reader";

/**
 * 卷纲 → 章纲结构化（2026-10-05，批次 5-②）的**接线契约**。
 *
 * 判定与拼装在 `packages/contracts/volume-outline.ts`（44 条真单测，含往返一致那条），
 * 本文件只钉「接没接上」——本仓 `.vue` 不进类型程序，组件里漏一个 import 编译器不报、
 * 运行时才炸（批次 4-① 在 `CenterPane.vue` 上真撞到过一次）。
 *
 * 钉的九件事：
 * ① 入口按钮亮不亮由 `isStructuredKind` 判，不在模板里写死 kind 字面量；
 * ② `STRUCTURED_KINDS` 就是分卷 + 大纲这两类（写全了才不会漏）；
 * ③ 按钮与面板用的图标名真实存在（挂一个不存在的名字会静默渲染成空白）；
 * ④ 面板真的 import 了 store；
 * ⑤ 判定只在 contracts 一处实现——组件与 store 都不许自带一份认章的正则；
 * ⑥ 生成路径问 `planDocRelPath`，不许另写一份文件名清洗（铁律 6）；
 * ⑦ 字段标签只有 contracts 那一份，组件不许写中文标签字面量；
 * ⑧ 三段式结构（4-② 的教训：sticky 按钮会压住内容）；
 * ⑨ 样式表接上了，且这个新面板的类不与别的面板重名（重名会让覆盖清单守卫判错消费者）。
 */
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const panelScript = scriptSource("components/VolumeOutlinePanel.vue");
const panelTpl = templateSource("components/VolumeOutlinePanel.vue");
const storeScript = readFileSync(
  new URL("../stores/useVolumeOutlineStore.ts", import.meta.url),
  "utf8"
);
const css = styleSource("outline.css");
const stylesCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const icons = readFileSync(new URL("../types/icons.ts", import.meta.url), "utf8");
const timelineCss = styleSource("timeline.css");

/**
 * 这个面板的类名一次成型：**根类没有后缀**（`.volume-outline`），子类才有（`-head`/`-body`…）。
 * 早先的写法 `\.(volume-outline|outline)-[a-z-]+` 匹配不到根类，
 * 于是「模板用了 volume-outline，样式表里没有规则」这条是假的——它把根类漏在了比对之外。
 */
const OUTLINE_CLASS_RE = /\.(?:volume-outline|outline)(?:-[a-z-]+)?\b/g;

/** 脚本里写成字符串字面量的本面板类名（`fieldClass` 返回的那两个就是这种）。 */
const OUTLINE_CLASS_LITERAL_RE = /"((?:volume-outline|outline)-[a-z-]*)"/g;

describe("入口挂在哪、什么时候亮", () => {
  it("右栏头部有这颗按钮", () => {
    expect(paneTpl).toContain('aria-label="卷纲转章纲"');
    expect(paneTpl).toContain('ref="volumeOutlineButton"');
  });

  it("禁用条件问的是 canStructure，不是 `!book.meta`（没开书 ≠ 不能拆章纲）", () => {
    expect(paneTpl).toContain(':disabled="!canStructure"');
    expect(paneScript).toContain(
      'const canStructure = computed(() => isStructuredKind(activeDoc.value?.kind ?? "chapter"));'
    );
  });

  it("按钮点的是 store 那一格，不是组件本地布尔", () => {
    expect(paneTpl).toContain('@click="void volumeOutline.toggleFor(activeDoc)"');
    expect(paneScript).not.toMatch(/volumeOutlineOpen\s*=\s*ref/);
  });

  it("组件真的 import 了 store 与判据函数（漏 import 编译器不报、运行时才炸）", () => {
    expect(paneScript).toContain(
      'import { isStructuredKind, useVolumeOutlineStore } from "../stores/useVolumeOutlineStore";'
    );
    expect(paneScript).toContain("const volumeOutline = useVolumeOutlineStore();");
  });

  it("STRUCTURED_KINDS 就是分卷 + 大纲这两类，加一类就要同步改这里", () => {
    expect(storeScript).toContain(
      'export const STRUCTURED_KINDS = ["volume", "outline"] as const;'
    );
  });

  it("按钮挂的是真实存在的图标名——不存在的名字会静默渲染成空白", () => {
    const names = [...paneTpl.matchAll(/<AppIcon name="([a-z-]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      if (name === "list") continue;
      expect(icons).toContain(`| "${name}"`);
    }
    expect(icons).toContain('| "list"');
  });

  it("面板挂载条件就是 store 那一格 + 锚点", () => {
    expect(paneTpl).toContain("<VolumeOutlinePanel");
    expect(paneTpl).toContain('v-if="volumeOutline.open && volumeOutlineAnchor"');
    expect(paneTpl).toContain('@close="volumeOutline.close()"');
  });
});

describe("判定只在 contracts 一处（铁律 6）", () => {
  it("store 调的是 contracts 的 parseVolumeOutline，不自带一份", () => {
    expect(storeScript).toContain("parseVolumeOutline(loaded.content)");
    expect(storeScript).toContain("parseVolumeOutline,");
    expect(storeScript).not.toMatch(/HEADING_RE|NUMBERED_RE|FIELD_ALIASES/);
  });

  it("组件里没有第二份认章正则（标题/第N章 判定只在 contracts）", () => {
    expect(panelScript).not.toMatch(/#\{2,3\}|第\\s\*|FIELD_ALIASES/);
  });

  it("字段标签只有一个来源，组件不许写中文标签字面量", () => {
    expect(panelScript).toContain("CHAPTER_OUTLINE_LABELS[field]");
    // 面板里出现「视角」「目标」这类词，只许出现在「还缺：」那种把结果拼给人看的字符串里。
    for (const literal of ['"视角"', '"目标"', '"冲突"', '"转折"', '"钩子"']) {
      expect(panelScript, `组件里写死了标签字面量 ${literal}`).not.toContain(literal);
    }
  });

  it("字段枚举走 contracts 的那张表，模板里不许自己列一遍", () => {
    expect(panelTpl).toContain('v-for="field in CHAPTER_OUTLINE_FIELDS"');
    expect(panelTpl).not.toMatch(/v-for="field in \["/);
  });
});

describe("生成章纲落盘这一段", () => {
  it("路径问 planDocRelPath，不另写一份文件名清洗", () => {
    expect(panelScript).toContain('planDocRelPath("outline", chapter.title)');
    expect(storeScript).toContain('planDocRelPath("outline", chapter.title)');
    // 自己拼 `outline/${title}.md` 是最常见的回头路，一出现就红。
    expect(panelScript).not.toMatch(/`outline\/\$\{/);
  });

  it("store 走 createDoc + writeDoc 两步，且指纹来自 createDoc（不重读盘）", () => {
    expect(storeScript).toContain("await window.mochen.createDoc(relPath, chapter.title)");
    expect(storeScript).toContain("buildChapterOutlineMarkdown(chapter, this.sourceTitle)");
    expect(storeScript).toContain("created.fingerprint");
    expect(storeScript).not.toMatch(/await window\.mochen\.readDoc\(relPath\)/);
  });

  it("生成完要温和重扫：主进程更新了它自己的快照，渲染层的 book.docs 不扫就是旧的", () => {
    // 真机撞出来的：生成成功了、盘上也有文件，但 `book.docs` 停在生成之前——
    // 面板上那枚「已有同名大纲」要等下次开书才变，作者会连点第二次然后撞上拒绝。
    expect(storeScript).toContain("await book.refreshDocs();");
  });

  it("同名不覆盖：先查 docs 再建（createDocFile 会拒，但不能把那句英文原样透给用户）", () => {
    expect(storeScript).toContain("book.docs.some((d) => d.relPath === relPath)");
    expect(storeScript).toContain("已经有一篇《${chapter.title}》了，没动它。");
  });

  it("成功与失败都要说一句（静默失败会让作者以为已经生成）", () => {
    expect(panelScript).toContain("lastMessage.value = result.message");
    expect(panelScript).toContain("lastMessageFailed.value = !result.ok");
    expect(panelTpl).toContain("v-if=\"lastMessage !== ''\"");
    expect(panelTpl).toContain(":class=\"{ 'is-failed': lastMessageFailed }\"");
  });

  it("loose 节不给生成按钮（多半是分组标题，但由作者定，所以只标出来+禁用，不替它决定）", () => {
    expect(panelTpl).toContain("chapter.isLoose");
    expect(panelTpl).toContain("outline-chapter-foot");
  });

  it("**`chapter.isLoose` 得在生成按钮的 :disabled 里**，光在提示文案里出现不算数", () => {
    // 上一条只断言「模板里出现过 chapter.isLoose」，而 `v-if="chapter.isLoose"` 的那句
    // 「这一节一个字段都没写……」就把它喂饱了：2026-10-06 变异实测把 `chapter.isLoose`
    // 从 :disabled 里删掉，22 条断言照样全绿，面板照常标出 loose 节却让作者一键生成。
    // 这里改成按标签切开取属性块（:disabled 被 prettier 折了多行，按行 grep 不成立）。
    const buttons = tagAttributes(panelTpl, "outline-generate");
    const disabled = buttons
      .map((attrs) => /:disabled="([\s\S]*?)"/.exec(attrs)?.[1] ?? "")
      .join("\n");
    expect(disabled, "生成按钮没有 :disabled 绑定").not.toBe("");
    expect(disabled).toContain("chapter.isLoose");
    // 同一个按钮上的另外两条禁用理由也不能丢（生成中不重复点、已有同名不再建）。
    expect(disabled).toContain("outline.generating.includes(chapter.order)");
    expect(disabled).toContain("existsAlready(chapter)");
  });

  it("字段全写的那几行不留空标签（「还缺：」后面什么都没有）", () => {
    expect(panelScript).toContain("if (chapter.missing.length === 0) return");
    expect(panelScript).toContain("项都写了");
  });
});

describe("结构与诚实边界", () => {
  it("三段式：滚动区是 .volume-outline-body 自己滚，行内按钮跟着自己那一行走", () => {
    expect(panelTpl).toContain('<div class="volume-outline-body">');
    expect(panelTpl).toContain('<section class="volume-outline-blind">');
    expect(css).toContain(".volume-outline-body {");
    expect(css).toMatch(/\.volume-outline-body\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("盲区块在**滚动区内**，且滚动区有 min-height 下限（真机：475px 高的窗口里列表只剩 40px）", () => {
    // 「能滚」不等于「看得见」。盲区块是说明文字、里面没有按钮，放外面会把滚动区挤没。
    const bodyAt = panelTpl.indexOf('<div class="volume-outline-body">');
    const bodyEnd = panelTpl.indexOf("</div>", panelTpl.indexOf("</ol>"));
    const blindAt = panelTpl.indexOf('<section class="volume-outline-blind">');
    expect(bodyAt).toBeGreaterThan(-1);
    expect(blindAt).toBeGreaterThan(bodyAt);
    expect(blindAt).toBeLessThan(bodyEnd);
    expect(css).toMatch(/\.volume-outline-body\s*\{[^}]*min-height:\s*1\d\dpx/);
  });

  it("「算不出来的事」单列一块，且数据来自 contracts 那份常量", () => {
    expect(panelTpl).toContain('v-for="spot in VOLUME_OUTLINE_BLIND_SPOTS"');
    expect(panelScript).toContain("VOLUME_OUTLINE_BLIND_SPOTS,");
  });

  it("零章时给的是判定层返回的那句话，不是组件自己编的空态", () => {
    expect(panelTpl).toContain("{{ outline.verdict }}");
    expect(storeScript).toContain('return this.outline?.note ?? "";');
  });

  it("已写 / 没写两态长得不一样（不能只靠有无文字区分）", () => {
    expect(panelScript).toContain(
      'return chapter.fields[field] === "" ? "outline-field is-blank" : "outline-field";'
    );
    expect(css).toMatch(/\.outline-field\.is-blank\s*\{[^}]*border-style:\s*dashed/);
  });

  it("读盘失败有单独的一行提示，不静默留空", () => {
    expect(storeScript).toContain("卷纲没读回来：");
    expect(panelTpl).toContain("v-if=\"outline.notice !== ''\"");
  });

  it("字数合计不用 formatByteSize（那是给文件字节数用的，「三千二百字」按字节出来是 3.2 KB）", () => {
    expect(panelScript).not.toContain("formatByteSize");
    expect(panelScript).toContain('outline.wordTotal.toLocaleString("zh-CN")');
  });
});

describe("样式表", () => {
  it("outline.css 接进了 styles.css", () => {
    expect(stylesCss).toContain('@import "./styles/outline.css";');
  });

  it("这个面板的类不与时间线面板重名（重名会让覆盖清单守卫判错消费者）", () => {
    const names = [...css.matchAll(OUTLINE_CLASS_RE)].map((m) => m[0]);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(timelineCss, `${name} 与时间线样式表重名`).not.toContain(name);
    }
  });

  it("面板里用到的类在样式表里都有规则，样式表里也没有没人用的规则（反方向都钉）", () => {
    const used = new Set<string>();
    // ① 模板里的字面量 class。
    for (const m of panelTpl.matchAll(/class="([^"]+)"/g)) {
      for (const token of (m[1] ?? "").split(/\s+/)) {
        // 只比**本面板自己的**类：`context-picker-close` 是共用类，规则在 dialog.css 里，
        // 它不在 outline.css 是对的，在这里要求它出现才是错的。
        // is- 前缀是动态挂上去的状态类，单独一条断言管，不混进字面量比对。
        if (token.startsWith("volume-outline") || token.startsWith("outline-")) used.add(token);
      }
    }
    // ② 脚本里由函数拼出来的类（`fieldClass` 返回的那两个）——它不在模板的字面量里，
    // 只扫模板会把它判成「样式表里的规则没有消费者」，是假红。
    for (const m of panelScript.matchAll(OUTLINE_CLASS_LITERAL_RE)) {
      if (m[1] !== undefined) used.add(m[1]);
    }
    const defined = new Set([...css.matchAll(OUTLINE_CLASS_RE)].map((m) => m[0].slice(1)));
    expect(used.size).toBeGreaterThan(10);
    for (const name of used) {
      expect(defined, `模板用了 ${name}，样式表里没有规则`).toContain(name);
    }
    for (const name of defined) {
      expect(used, `样式表里的 ${name} 没有消费者`).toContain(name);
    }
  });

  it("动态挂上去的两个状态类也各有规则", () => {
    expect(countNeedle("is-loose", panelScript + panelTpl)).toBeGreaterThan(0);
    expect(css).toContain(".outline-chapter.is-loose");
    expect(css).toContain(".volume-outline-verdict.is-clean");
    expect(css).toContain(".volume-outline-last.is-failed");
  });
});

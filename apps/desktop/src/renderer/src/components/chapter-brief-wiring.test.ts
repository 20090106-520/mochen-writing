import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource
} from "../utils/vue-source-reader";

/**
 * 「本章参考」的接线契约（2026-11-09 W-03）。
 *
 * 本仓零 jsdom / 零 @vue/test-utils，`.vue` 不进类型程序；漏一个 import 只有运行时才炸。
 * 这里只钉四件事：
 * ① 右栏只挂一处，位置在视图切换条之后、正文之前；
 * ② 数据只走既有只读通道——`book.docs` / `readDoc` / `loadForeshadows`，没有一条写盘或模型调用；
 * ③ 换章先清空旧结果，不把上一章的摘要留在新标题底下；
 * ④ 新增的样式表接上了，布局行号与既有面板的守卫同步更新。
 */

const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const briefScript = scriptSource("components/ChapterReference.vue");
const briefTpl = templateSource("components/ChapterReference.vue");
const briefCss = styleSource("chapter-reference.css");
const editorCss = styleSource("editor-pane.css");
const stylesCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("入口与位置", () => {
  it("右栏只有一处挂载，且排在视图切换条之后、正文之前", () => {
    expect(paneTpl.match(/<ChapterReference\b/g)?.length).toBe(1);
    expect(paneScript).toContain('import ChapterReference from "./ChapterReference.vue";');
    const switchAt = paneTpl.indexOf('class="editor-view-switch"');
    const briefAt = paneTpl.indexOf("<ChapterReference />");
    const documentAt = paneTpl.indexOf('class="editor-document"');
    expect(switchAt).toBeGreaterThan(-1);
    expect(briefAt).toBeGreaterThan(switchAt);
    expect(documentAt).toBeGreaterThan(briefAt);
  });

  it("新栏占 editor-pane 第 6 行；文档与页脚行号同步后移", () => {
    expect(ruleBlock(editorCss, ".editor-pane > .chapter-brief")).toContain("grid-row: 6;");
    expect(ruleBlock(editorCss, ".editor-pane > .editor-document")).toContain("grid-row: 7;");
    expect(ruleBlock(editorCss, ".editor-pane > .editor-footer")).toContain("grid-row: 8;");
  });

  it("只在文稿态显示；没书不摆这条带子", () => {
    expect(briefScript).toContain('book.rightPaneMode === "manuscript"');
    expect(briefScript).toContain("book.meta !== null");
    expect(briefTpl).toContain('v-if="visible"');
  });
});

describe("只读：数据全走既有通道，没有写盘与模型调用", () => {
  it("章纲走 book.docs + readDoc，解析交给 contracts", () => {
    expect(briefScript).toContain("lookupChapterOutline(book.docs, title");
    expect(briefScript).toContain("window.mochen.readDoc(relPath)");
    expect(briefScript).not.toContain("parseVolumeOutline(");
  });

  it("人物只从 character 类条目取名字，不读卡正文", () => {
    expect(briefScript).toContain('doc.kind === "character"');
    expect(briefScript).toContain("mentionedCharacters(characterCards.value");
  });

  it("伏笔只读既有台账 action，不另开读取通道", () => {
    expect(briefScript).toContain("book.loadForeshadows()");
    expect(briefScript).toContain("book.foreshadowRows");
    expect(briefScript).not.toContain("readForeshadowRaws");
  });

  it("没有写盘 / 模型调用", () => {
    for (const forbidden of [
      "writeDoc",
      "createDoc",
      "deleteDoc",
      "saveActive",
      "invoke(",
      "sendPrompt",
      "useAgentStore"
    ]) {
      expect(countNeedle(forbidden, briefScript)).toBe(0);
    }
  });
});

describe("本章只认当前打开的那一篇", () => {
  it("换章先清空旧结果，并用令牌挡住迟到的回包", () => {
    expect(briefScript).toContain('lookup.value = { kind: "none" };');
    expect(briefScript).toContain("const token = ++reloadToken;");
    expect(briefScript).toContain("if (token !== reloadToken) return;");
  });

  it("没打开文稿时显示空态，不显示上一章的内容", () => {
    expect(briefTpl).toContain('v-if="activeDoc === null"');
    expect(briefTpl).toContain("{{ NO_DOC_TEXT }}");
    expect(briefTpl).toContain('v-else-if="chapterDoc === null"');
    expect(briefTpl).toContain('notChapterText(activeDoc?.title ?? "")');
  });
});

describe("样式与文案", () => {
  it("样式表接上了，类名有真规则", () => {
    expect(stylesCss).toContain('@import "./styles/chapter-reference.css";');
    expect(ruleBlock(briefCss, ".chapter-brief")).not.toBe("");
    expect(ruleBlock(briefCss, ".chapter-brief-body")).not.toBe("");
    expect(ruleBlock(briefCss, ".chapter-brief-empty")).not.toBe("");
  });

  it("三项的中文标签都在模板里，没有散落的第二份判定", () => {
    expect(briefTpl).toContain("本章章纲摘要");
    expect(briefTpl).toContain("出场人物");
    expect(briefTpl).toContain("待回收伏笔");
  });
});

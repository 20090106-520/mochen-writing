import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const CHECKLIST = "components/SubmissionChecklist.vue";
const STORE = "stores/useSubmissionChecklistStore.ts";
const ASSEMBLY = "utils/submission-checklist.ts";
const REVEAL = "utils/editor-reveal.ts";

describe("入口与挂载", () => {
  it("入口是 W-03 参考栏标题行上的「体检」按钮，清单只挂一处", () => {
    const template = templateSource("components/ChapterReference.vue");
    expect(template).toContain('class="chapter-brief-head"');
    expect(template).toContain('class="chapter-brief-check"');
    expect(template).toContain('@click="checklist.toggle()"');
    expect(template).toContain('aria-label="交稿体检"');
    expect(countNeedle("<SubmissionChecklist", template)).toBe(1);
    expect(template).toContain(':chapter-rel-path="activeRelPath"');
    expect(template).toContain(':chapter-title="chapterTitle"');
  });

  it("清单浮层 Teleport 到 body，不新增右栏网格行", () => {
    const template = templateSource(CHECKLIST);
    expect(template).toContain('<Teleport to="body">');
    expect(template).toContain('class="submission-check"');
    expect(styleSource("editor-pane.css")).not.toContain(".submission-check");
  });

  it("W-03 参考栏原有结构没被搬走：三个标题仍在", () => {
    const template = templateSource("components/ChapterReference.vue");
    expect(template).toContain("本章章纲摘要");
    expect(template).toContain("出场人物");
    expect(template).toContain("待回收伏笔");
  });
});

describe("数据来源：只走既有检查通道", () => {
  it("加载时调既有 store 的 load，不新造检查规则", () => {
    const store = typeScriptSource(STORE);
    expect(store).toContain("book.loadForeshadows()");
    expect(store).toContain("timeline.load()");
    expect(store).toContain("cast.load()");
    expect(store).toContain("book.loadForeshadowChapters()");
    expect(store).toContain("buildSubmissionChecklist(");
    expect(store).toContain("keywordMisses(");
    expect(store).toContain("cast.findings");
    expect(store).toContain("timeline.issues");
    expect(store).toContain("book.foreshadowRows");
  });

  it("组装层用既有检查函数，不自写一套判据", () => {
    const assembly = typeScriptSource(ASSEMBLY);
    expect(assembly).toContain("findAiSlop(");
    expect(assembly).toContain("reviewReport(");
    expect(assembly).toContain("scoreBandOf(");
    expect(assembly).toContain("draftLineOfBodyLine(");
  });

  it("「无法定位」如实标 none，不伪造行号", () => {
    const template = templateSource(CHECKLIST);
    expect(template).toContain("item.locate !== 'none'");
    expect(typeScriptSource(ASSEMBLY)).toContain("有结果但无法定位");
  });
});

describe("状态只活在本会话", () => {
  it("状态是 store 里的内存表，不写盘、不进 book.json、不用 localStorage", () => {
    const store = typeScriptSource(STORE);
    expect(store).toContain("statuses: {} as Record<string, ChecklistStatus>");
    expect(store).toContain("statusKeyOf(");
    for (const source of [store, typeScriptSource(CHECKLIST), typeScriptSource(ASSEMBLY)]) {
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("writeDoc");
      expect(source).not.toContain("saveDoc");
      expect(source).not.toContain("window.mochen");
    }
    expect(store).not.toContain("book.json");
  });

  it("面板里写明跨章/跨次行为", () => {
    expect(templateSource(CHECKLIST)).toContain("STATUS_HINT_TEXT");
    expect(typeScriptSource(ASSEMBLY)).toContain("换章再回来还在，关掉软件就清空");
  });
});

describe("换章竞态", () => {
  it("开始就清空旧清单，迟到的回包被令牌挡掉", () => {
    const store = typeScriptSource(STORE);
    expect(store).toContain("const token = ++this.loadToken;");
    expect(store).toContain("this.items = [];");
    expect(store).toContain("if (token !== this.loadToken) return;");
    expect(store).toContain("clearFor(chapterRelPath: string)");
  });

  it("面板监听换章，正文没载完不重算", () => {
    const script = scriptSource(CHECKLIST);
    expect(script).toContain("checklist.clearFor(relPath)");
    expect(script).toContain("book.docLoading");
    expect(script).toContain("void checklist.load(relPath, book.draft)");
  });
});

describe("跳回原文", () => {
  it("行级选中整行并滚动，标题是定位按钮", () => {
    const reveal = typeScriptSource(REVEAL);
    expect(reveal).toContain('"textarea.document-editor"');
    expect(reveal).toContain("setSelectionRange(start, end)");
    expect(reveal).toContain("el.scrollTop");
    expect(templateSource(CHECKLIST)).toContain("jumpTo(item)");
  });

  it("跳不动就如实说，不假装跳到了", () => {
    const script = scriptSource(CHECKLIST);
    expect(script).toContain("没能定位到第");
    expect(script).toContain("book.openDocTab(item.relPath)");
  });

  it("预览态先切回编辑，否则没有可落选中的 textarea", () => {
    expect(scriptSource(CHECKLIST)).toContain('book.editorViewMode === "preview"');
  });
});

describe("不改既有检查面板", () => {
  it("清单不碰五套面板的开合开关", () => {
    const sources = [scriptSource(CHECKLIST), typeScriptSource(STORE)];
    for (const source of sources) {
      expect(source).not.toContain("slopOpen");
      expect(source).not.toContain("reviewOpen");
      expect(source).not.toContain("foreshadowOpen");
      expect(source).not.toContain("cast.open");
      expect(source).not.toContain("timeline.open");
    }
  });

  it("样式单独成表并接进 styles.css，三条状态与「无法定位」都有规则", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/submission-checklist.css";');
    const css = styleSource("submission-checklist.css");
    expect(ruleBlock(css, ".submission-check")).toContain("max-height");
    expect(ruleBlock(css, ".submission-check-mark.is-todo.is-active")).not.toBe("");
    expect(ruleBlock(css, ".submission-check-mark.is-fixed.is-active")).not.toBe("");
    expect(ruleBlock(css, ".submission-check-mark.is-ignored.is-active")).not.toBe("");
    expect(ruleBlock(css, ".submission-check-where.is-blind")).toContain("background");
  });
});

describe("空态", () => {
  it("没打开章节、正在汇总、全部干净都有诚实文案", () => {
    const template = templateSource(CHECKLIST);
    expect(template).toContain("NO_CHAPTER_TEXT");
    expect(template).toContain("LOADING_TEXT");
    expect(template).toContain("CLEAN_TEXT");
  });
});

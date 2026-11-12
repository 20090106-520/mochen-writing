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

/**
 * 状态只有一份（W-04 收尾，2026-11-12）。
 *
 * 原先体检 store 自己存一张内存状态表，落盘清单另存一份：同一条目在体检页标了「忽略」，
 * 去 AI 味页仍是待修，还会被「交给 AI 改」原样喂回模型。现在体检页读写的是
 * useReviewIssuesStore 那份 review-issues.json。这几条钉住「不许再长出第二份」：
 * 体检 store 不留状态表、面板不自己算状态、写盘只经清单 store。
 */
describe("状态只有一份：与落盘清单同源", () => {
  it("体检 store 不再自建状态表，状态不留在内存里", () => {
    const store = typeScriptSource(STORE);
    expect(store).not.toContain("statusKeyOf(");
    expect(store).not.toContain("statuses:");
    expect(store).not.toContain("setStatus(");
    expect(store).not.toContain("ChecklistStatus");
    for (const source of [store, scriptSource(CHECKLIST)]) {
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("writeDoc");
      expect(source).not.toContain("saveDoc");
      expect(source).not.toContain("window.mochen");
    }
  });

  it("面板从同一个清单 store 读状态、把点击交给它落盘", () => {
    const script = scriptSource(CHECKLIST);
    expect(script).toContain("useReviewIssuesStore(");
    expect(script).toContain("ISSUE_TO_CHECKLIST[");
    expect(script).toContain("setStatusOfItem(");
    expect(script).toContain(".issuesFor(props.chapterRelPath)");
    const template = templateSource(CHECKLIST);
    expect(template).toContain("statusOf(item.id) === status");
    expect(template).toContain("mark(item, status)");
    expect(template).not.toContain("checklist.setStatus");
    expect(template).toContain("counts.todo");
  });

  it("体检页也会写盘：存不下时读同一枚 saveError 上屏", () => {
    const tpl = templateSource(CHECKLIST);
    expect(tpl).toContain('v-if="reviewIssues.saveError"');
    expect(tpl).toContain("{{ reviewIssues.saveError }}");
    expect(tpl).toContain('role="status"');
    expect(tpl).toContain('aria-live="polite"');
  });

  it("文案如实说重开还在，不许再写回「关掉软件就清空」", () => {
    const hint = typeScriptSource(ASSEMBLY);
    expect(templateSource(CHECKLIST)).toContain("STATUS_HINT_TEXT");
    expect(hint).toContain("关掉软件重开都还在");
    expect(hint).toContain("review-issues.json");
    expect(hint).not.toContain("关掉软件就清空");
    expect(hint).not.toContain("没有落任何文件");
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

/**
 * 落盘清单的身份锚（2026-11-12 第二轮普查）。
 *
 * 交稿体检的条目 id 现在同时是 `review-issues.json` 里的主键：id 一变，复检合并就把
 * 同一条问题判成「旧的已修 + 新的待修」。词表条目先踩过（带行号）并已修掉，
 * 这轮又翻出人物核对带行号、审稿打分带分数。纯函数用例钉住行为，这条钉住**写法**：
 * 以后有人往 id 里顺手加一个读数，这里当场拦下，不必等真机看见清单炸开。
 */
describe("条目 id 不许夹带易变读数", () => {
  const assembly = typeScriptSource(ASSEMBLY);

  it("五套来源的 id 模板都在这一份汇总层里（守卫不许空转）", () => {
    const idLines = assembly.split("\n").filter((line) => line.includes("id: `"));
    expect(idLines.length).toBeGreaterThanOrEqual(6);
  });

  it("id 里不出现 .line / .score：行号与打分是随每次编辑都变的量", () => {
    for (const line of assembly.split("\n").filter((row) => row.includes("id: `"))) {
      expect(line).not.toContain(".line");
      expect(line).not.toContain(".score");
    }
  });

  it("行号、分数仍然留在显示字段里（身份稳 ≠ 不刷新读数）", () => {
    expect(assembly).toContain("line: hit.line");
    // 篇级读数没有行号，仍老实存 0，不为了填 id 伪造一个第 1 行。
    expect(assembly).toContain("line: 0");
    // 分数写在标题里，由复检的 `{ ...fresh }` 刷新；身份稳不等于读数不更新。
    expect(assembly).toContain("${score.label}读数 ${score.score}");
  });
});

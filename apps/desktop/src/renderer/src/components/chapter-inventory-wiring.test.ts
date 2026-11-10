import { describe, expect, it } from "vitest";
import {
  countNeedle,
  scriptSource,
  scopedStyleSource,
  tagAttributes,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const PANEL = "components/ChapterInventoryPanel.vue";
const STORE = "stores/useChapterInventoryStore.ts";
const UTIL = "utils/chapter-inventory.ts";

describe("入口与挂载", () => {
  it("入口是左栏「更多」书务组里的「存稿仪表」，整本书没开时先过既有 requireBook", () => {
    const template = templateSource("components/LibraryNavRows.vue");
    expect(template).toContain('data-nav-id="inventory"');
    expect(template).toContain("存稿仪表");
    expect(template).toContain("@click=\"requireBook('存稿仪表') || layout.openChapterStatus()\"");
    const script = scriptSource("components/LibraryNavRows.vue");
    expect(script).toContain("useLayoutStore()");
    expect(script).toContain("requireBook: (label: string) => boolean");
    expect(templateSource("components/LeftSidebar.vue")).toContain(':require-book="requireBook"');
  });

  it("面板只挂一处，开合走既有 layout 面板开关", () => {
    const app = templateSource("App.vue");
    expect(countNeedle("<ChapterInventoryPanel", app)).toBe(1);
    expect(app).toContain(':visible="layout.panelVisibility.chapterStatus"');
    expect(app).toContain("@close=\"layout.closePanel('chapterStatus')\"");
  });

  it("是标准模态：遮罩、aria-modal、tabindex 与 useModalFocus 都在", () => {
    const markup = templateSource(PANEL);
    const script = scriptSource(PANEL);
    expect(markup).toContain('class="ci-overlay"');
    expect(markup).toContain("@click.self=\"emit('close')\"");
    const attrs = tagAttributes(markup, "ci-panel").join(" ");
    expect(attrs).toContain('ref="panelRoot"');
    expect(attrs).toContain('aria-modal="true"');
    expect(attrs).toContain('tabindex="-1"');
    expect(script).toContain('from "../composables/useModalFocus"');
    expect(script).toContain("isOpen: toRef(() => props.visible)");
    expect(script).toContain('close: () => emit("close")');
    expect(script).not.toContain('"Escape"');
  });
});

describe("档位与读数：只读既有事实", () => {
  it("章节来自既有扫描结果，目标来自既有逐章目标，不另造判据", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain("chapterInventoryRows({");
    expect(script).toContain("chapterInventorySummary(");
    expect(script).toContain("goalStore.chapterTargetOf(relPath)");
    expect(script).toContain("goalStore.goal.totalWordTarget");
    expect(script).toContain("docs.value");
    expect(script).toContain("meta.value?.chapterOrder");
  });

  it("档位判据只看字数与目标，没有「手动打勾当已交」的入口", () => {
    const util = typeScriptSource(UTIL);
    expect(util).toContain("doc.chars ?? 0");
    expect(util).toContain("chapterStatusOf(chars, target)");
    const script = scriptSource(PANEL);
    const markup = templateSource(PANEL);
    for (const source of [script, markup]) {
      expect(source).not.toContain("setStatus");
      expect(source).not.toContain("v-model");
      expect(source).not.toContain("已交稿");
    }
    // 「已交稿」只在说明文案里出现，讲明白为什么不设这一档。
    expect(util).toContain("仓库没有「已交稿」这类既有事实");
  });

  it("最近改动取既有改稿历史，按篇取最新一条", () => {
    const util = typeScriptSource(UTIL);
    expect(util).toContain("latestChangeByDoc(");
    expect(util).toContain("entry.docRelPath");
    expect(util).toContain("changeTimeLabel(");
    expect(typeScriptSource(STORE)).toContain("window.mochen.listChanges()");
  });
});

describe("汇总里哪些是真数据、哪些被跳过", () => {
  it("总字数/章节数/平均用既有扫描字数；全书目标读既有写作目标", () => {
    const util = typeScriptSource(UTIL);
    expect(util).toContain("rows.reduce((sum, row) => sum + row.chars, 0)");
    expect(util).toContain("Math.round(totalChars / chapterCount)");
    expect(util).toContain("totalWordTarget > 0");
    expect(util).toContain(
      "remaining: totalTarget > 0 ? Math.max(0, totalTarget - totalChars) : null"
    );
  });

  it("没设全书目标时如实写未设并给去设定的入口，不编默认值", () => {
    const markup = templateSource(PANEL);
    expect(markup).toContain("全书目标未设");
    expect(markup).toContain('@click="goSetTotalTarget"');
    const script = scriptSource(PANEL);
    expect(script).toContain("layout.openWordCount()");
    for (const source of [markup, script, typeScriptSource(UTIL)]) {
      expect(source).not.toContain("100000");
      expect(source).not.toContain("100_000");
    }
  });
});

describe("跳到那一章", () => {
  it("点章节名走既有 openDocTab，换章成功后收起面板", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain("book.openDocTab(relPath)");
    expect(script).toContain('emit("close")');
  });
});

describe("状态存哪里与换书", () => {
  it("面板不写盘、不进 book.json、不用 localStorage；状态全部现算", () => {
    for (const source of [typeScriptSource(UTIL), typeScriptSource(STORE), scriptSource(PANEL)]) {
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("writeDoc");
      expect(source).not.toContain("saveDoc");
      expect(source).not.toContain("book.json");
    }
  });

  it("换书整体重读：组件听书 id，store 用令牌挡住旧书回包", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain("meta.value?.id");
    expect(script).toContain("void inventory.loadChanges()");
    const store = typeScriptSource(STORE);
    expect(store).toContain("const token = ++this.loadToken;");
    expect(store).toContain("if (token !== this.loadToken) return;");
    expect(store).toContain("this.changes = [];");
    expect(store).toContain("reset(): void");
  });

  it("读回包没到之前不拿旧书的时间凑数", () => {
    expect(scriptSource(PANEL)).toContain("inventory.loading ? [] : inventory.changes");
    expect(templateSource(PANEL)).toContain("读取中…");
  });
});

describe("样式与空态", () => {
  it("样式跟着组件走（scoped），四项汇总与列表都有规则", () => {
    const css = scopedStyleSource(PANEL);
    expect(css).toContain(".ci-panel");
    expect(css).toContain(".ci-stats");
    expect(css).toContain(".ci-row");
    expect(css).toContain(".is-empty");
    expect(css).toContain(".is-done");
    expect(css).toContain(".ci-row.is-current");
  });

  it("没有章节时给诚实空态，不摆假数据", () => {
    expect(templateSource(PANEL)).toContain("INVENTORY_EMPTY_TEXT");
    expect(typeScriptSource(UTIL)).toContain("这本书还没有章节文稿。");
  });
});

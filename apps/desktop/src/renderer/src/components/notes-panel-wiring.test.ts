import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scopedStyleSource,
  scriptSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 笔记面板的三条通路（2026-10-09 扫描总单·假控件 + P0-8 归档单向门）。
 *
 * 三条病灶都在"界面说了、代码没做"这一族里：
 * ① 「批注」页签筛的是 `kind === "annotation"`，而 `createAnnotation` 全仓零调用——
 *    那一页永远空着，空态还写着「速记灵感，或在文档上添加批注」；
 * ② 标签只有展示端（`note.tags`、底部标签集），录入端一个字段都没有 ⇒ 标签集恒空；
 * ③ 归档是单向门：`unarchiveNote` 零调用，归档 = 作者眼里的"软件删了我的东西"。
 *
 * 判定本身住在 `utils/note-scope.ts`（那边 17 条纯函数用例，先红后绿）；
 * 这里钉的是**接线**——`.vue` 不进类型程序，少挂一个 `v-model`、少调一个 store 动作，
 * tsc 与 build 都不报，只有用户点下去才发现没通路。
 */
const script = scriptSource("components/NotesPanel.vue");
const tpl = templateSource("components/NotesPanel.vue");
const css = scopedStyleSource("components/NotesPanel.vue");
const appSrc = vueSource("App.vue");

describe("① 批注：从「只有页签没有入口」变成真能建", () => {
  it("面板真的调了 store 的 createAnnotation，并把当前章的 relPath 递进去", () => {
    expect(script).toContain("notes.createAnnotation(content, target.docRelPath");
    // 判定只有一处：relPath 由 utils 给，组件不自己拼 book.activeDocTab 的兜底。
    expect(script).toContain("const target = attachTarget.value;");
    expect(script).toContain("annotationTarget(book.activeDocTab)");
    expect(countNeedle("notes.createAnnotation(", script)).toBe(1);
  });

  it("挂不上时不建笔记、把原因上屏——静默降级成速记是最坏的那条路", () => {
    expect(script).toContain("notice.value = target.reason;");
    // 顺序钉死：先判 ok、再落库。反过来写就是"用户以为挂了章，实际成了速记"。
    expect(script.indexOf("notice.value = target.reason;")).toBeLessThan(
      script.indexOf("notes.createQuickNote(")
    );
    expect(script).toMatch(/if \(target\.ok === false\) \{[\s\S]{0,120}return;/);
  });

  it("勾选项在屏上，且没当前章时是真的 disabled（不是只灰个样式）", () => {
    expect(tpl).toContain('v-model="attachToCurrentDoc"');
    expect(tpl).toContain('type="checkbox"');
    expect(tpl).toContain(':disabled="attachTarget.ok === false"');
    expect(tpl).toContain("附在当前章上");
  });

  it("那条没人听的 create-annotation emit 已摘掉（App.vue 从不听它）", () => {
    expect(script).not.toContain('"create-annotation"');
    expect(appSrc).not.toContain("@create-annotation");
  });
});

describe("② 标签：录入端接上了，标签集才可能不恒空", () => {
  it("新建表单里有标签输入，落库前过 parseTags 那一份切法", () => {
    expect(tpl).toContain('v-model="newNoteTags"');
    expect(script).toContain("parseTags(newNoteTags.value)");
    expect(script).toContain('from "../utils/note-scope"');
    // 组件里不许再手抄一份逗号切分（故事圣经那边同样调 parseTags）。
    expect(script).not.toMatch(/\.split\(","\)/);
  });

  it("两条创建路都把 tags 传给 store，不是只切了不用", () => {
    expect(script).toContain("notes.createQuickNote(content, tags)");
    expect(script).toContain(", undefined, tags)");
  });
});

describe("③ 归档双向：取回入口在屏上", () => {
  it("已归档那条给的是「取回」，调的是 store 的 unarchiveNote", () => {
    expect(tpl).toContain("notes.unarchiveNote(note.id)");
    expect(tpl).toContain('v-if="note.archived"');
    expect(tpl).toContain("取回");
    // 归档钮只在未归档的那条上出现——两枚钮共用一个位置，靠数据真身分岔。
    expect(tpl).toContain("v-else");
    expect(countNeedle("notes.archiveNote(note.id)", tpl)).toBe(1);
  });

  it("档位表来自 utils 那一份，第四档「已归档」不是本地手列的名单", () => {
    expect(tpl).toContain('v-for="s in NOTE_SCOPES"');
    expect(tpl).toContain("{{ s.label }}");
    expect(script).toContain('const tab = ref<NoteScope>("all")');
    // 模板里不许再留一份三元链当标签来源。
    expect(tpl).not.toContain('t === "all" ? "全部"');
  });

  it("列表来源只有一处判定，归档视图由 store 给（activeNotes/archivedNotes 都取到手）", () => {
    expect(script).toContain(
      "notesForScope(tab.value, { active: activeNotes.value, archived: archivedNotes.value })"
    );
    expect(script).toContain("const { activeNotes, archivedNotes, allTags } = storeToRefs(notes);");
    expect(typeScriptSource("stores/useNotesStore.ts")).toContain("archivedNotes,");
  });

  it("空态那两行取自 scopeEmptyText，旧那句没有入口的承诺已经不在源文件里", () => {
    expect(tpl).toContain("{{ emptyText.title }}");
    expect(tpl).toContain("{{ emptyText.hint }}");
    expect(vueSource("components/NotesPanel.vue")).not.toContain("或在文档上添加批注");
    expect(script).toContain("scopeEmptyText({");
  });
});

describe("新加的这几类都有规则（死 CSS 的反方向：有 class 没样式）", () => {
  for (const cls of [
    ".notes-input",
    ".notes-attach",
    ".notes-attach-box",
    ".notes-notice",
    ".notes-restore-btn"
  ]) {
    it(`${cls} 在内联样式里有真规则`, () => {
      expect(ruleBlock(css, cls)).not.toBe("");
    });
  }

  it("模板里用到的这些 class 都能对上样式，不留没人用的死规则", () => {
    // 一条 class 允许多条规则（基态 + 状态变体），所以钉的是"两边都至少有一处"，
    // 而不是 `.notes-restore-btn` 在样式里恰好出现一次——那种字面量计数会被 :hover 打死。
    for (const cls of [
      "notes-input",
      "notes-attach",
      "notes-attach-box",
      "notes-notice",
      "notes-restore-btn"
    ]) {
      expect(tpl.includes(cls), `${cls} 模板里没人用`).toBe(true);
      expect(countNeedle(`.${cls}`, css) >= 1, `${cls} 没有对应样式`).toBe(true);
    }
    // 状态变体各有真规则：禁用态只灰一下、hover 没反应，都是"看着能点"的假控件。
    expect(ruleBlock(css, ".notes-attach.is-disabled")).not.toBe("");
    expect(ruleBlock(css, ".notes-restore-btn:hover")).not.toBe("");
  });
});

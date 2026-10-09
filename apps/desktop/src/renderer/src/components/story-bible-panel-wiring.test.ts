import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 故事圣经面板的接线（2026-10-09 扫描总单·假控件那一批的第三族）。
 *
 * 判定本身住在 `utils/bible-scope.ts`（15 条纯函数用例）与 store（9 条落库用例），
 * 这里钉的是**接线**——`.vue` 不进类型程序，少挂一个 `v-model`、少调一个 store 动作，
 * tsc 与 build 都不报，只有用户点下去才发现没通路。四条通路：
 * ① 归档双向（取回钮 + 第五档）；② 详情不跟着筛选丢选中；③ 标签有录入端、建完进编辑态；
 * ④ 列表与空态都走 utils 那一份判定，面板里不许留第二份。
 */
const script = scriptSource("components/StoryBiblePanel.vue");
const tpl = templateSource("components/StoryBiblePanel.vue");
const css = typeScriptSource("components/story-bible-panel.css");
const storeSrc = typeScriptSource("stores/useStoryBibleStore.ts");

describe("① 归档双向：第五档看得见、取回钮按得动", () => {
  it("档位表来自 utils 那一份，第五档「已归档」不是本地手列的名单", () => {
    expect(tpl).toContain('v-for="s in BIBLE_SCOPES"');
    expect(tpl).toContain("{{ s.label }}");
    expect(script).toContain('const filterTab = ref<BibleScope>("all")');
    expect(tpl).not.toContain('t === "all" ? "全部"');
    expect(tpl).not.toMatch(/\['all', 'character'/);
  });

  it("已归档那条的详情头给的是「取回」，调的是 store 的 restoreEntry", () => {
    expect(tpl).toContain("bible.restoreEntry(selectedEntry.id)");
    expect(tpl).toContain('v-if="selectedEntry.archived"');
    expect(tpl).toContain("取回");
    // 归档钮只在未归档那条上出现：两枚钮占同一个位置，靠数据真身分岔。
    expect(tpl).toContain("v-else");
    expect(countNeedle("bible.archiveEntry(selectedEntry.id)", tpl)).toBe(1);
    expect(countNeedle("bible.restoreEntry(selectedEntry.id)", tpl)).toBe(1);
  });

  it("归档视图由 store 给（archivedEntries 真的导出了）", () => {
    expect(script).toContain("archived: bible.archivedEntries");
    expect(storeSrc).toContain("archivedEntries,");
  });

  it("示例条目已从 store 摘干净：空库就是空库，不再有「示例人物·林夜」那三条", () => {
    expect(storeSrc).not.toContain("defaultEntries");
    expect(storeSrc).not.toContain("示例人物");
    expect(storeSrc).not.toContain("bible_seed");
    // 面板侧也不许留一份种子数据兜底。
    expect(vueSource("components/StoryBiblePanel.vue")).not.toContain("林夜");
  });
});

describe("② 详情不跟着筛选丢选中", () => {
  it("selectedEntry 按 id 在全量 entries 里查，不在筛完的列表里查", () => {
    expect(script).toContain("bible.entries.find((e) => e.id === selectedId.value)");
    expect(script).not.toContain("filteredEntries.value.find");
  });
});

describe("③ 标签有录入端、建完直接进编辑态", () => {
  it("新建表单里有标签输入，落库前过 tag-input 那一份切法", () => {
    expect(tpl).toContain('v-model="newTags"');
    expect(script).toContain("tags: parseTags(newTags.value)");
    expect(script).toContain('from "../utils/tag-input"');
  });

  it('编辑态的标签与别名也换成那一份切法，两份手抄的 .split(",") 已不在', () => {
    expect(script).toContain("tags: parseTags(editTags.value)");
    expect(script).toContain("partial.aliases = parseTags(editAliases.value)");
    expect(script).not.toMatch(/\.split\(","\)/);
  });

  it("创建完把这条送进编辑态——类型专属字段只有编辑态才有输入框", () => {
    // 只认 createEntry 函数体内的那一次：`selectedId.value = entry.id` 在 selectEntry 里也有，
    // 拿整份脚本比 indexOf 会让"顺序对"变成侥幸。
    const body = script.slice(script.indexOf("function createEntry"));
    expect(body).toContain("startEdit(entry);");
    expect(body.indexOf("selectedId.value = entry.id;")).toBeLessThan(
      body.indexOf("startEdit(entry);")
    );
    expect(tpl).toContain("创建后直接进编辑态");
  });
});

describe("④ 列表与空态只有一处判定", () => {
  it("列表来自 visibleEntries(档位, {active, archived}, 搜索词)，面板不再自己 filter", () => {
    expect(script).toContain("visibleEntries(");
    expect(script).toContain("{ active: bible.activeEntries, archived: bible.archivedEntries }");
    expect(script).not.toContain("list.filter((e) => e.type === filterTab.value)");
    // store 那份重复实现（searchEntries / getEntriesByType）已摘掉，口径只剩 utils 一处。
    expect(storeSrc).not.toContain("function searchEntries");
    expect(storeSrc).not.toContain("function getEntriesByType");
  });

  it("空态两行取自 bibleScopeEmptyText，旧那句不分状态的「没有匹配的条目」已经不在", () => {
    expect(tpl).toContain("{{ emptyText.title }}");
    expect(tpl).toContain("{{ emptyText.hint }}");
    expect(script).toContain("bibleScopeEmptyText({");
    expect(vueSource("components/StoryBiblePanel.vue")).not.toContain("没有匹配的条目");
  });
});

describe("新加的这几类都有规则（模板用了、样式忘了写是同一族假控件）", () => {
  it(".bible-empty-title 与 .bible-empty-hint 有真规则", () => {
    expect(ruleBlock(css, ".bible-empty-title")).not.toBe("");
    expect(ruleBlock(css, ".bible-empty-hint")).not.toBe("");
  });

  it(".bible-new-hint 有真规则", () => {
    expect(ruleBlock(css, ".bible-new-hint")).not.toBe("");
  });

  it(".bible-restore-btn 有基态与 hover 两条规则，且写在 .icon-btn 之后才盖得住宽度", () => {
    expect(ruleBlock(css, ".bible-restore-btn")).not.toBe("");
    expect(ruleBlock(css, ".bible-restore-btn:hover")).not.toBe("");
    expect(ruleBlock(css, ".bible-restore-btn")).toContain("width: auto");
    expect(css.indexOf(".bible-restore-btn {")).toBeGreaterThan(css.indexOf(".icon-btn {"));
  });

  it("模板里用到的这几个 class 都能在样式里找到对应规则", () => {
    for (const cls of ["bible-empty-title", "bible-empty-hint", "bible-new-hint"]) {
      expect(tpl.includes(cls), `${cls} 模板里没人用`).toBe(true);
      expect(countNeedle(`.${cls}`, css) >= 1, `${cls} 没有对应样式`).toBe(true);
    }
    expect(tpl).toContain("bible-restore-btn");
  });
});

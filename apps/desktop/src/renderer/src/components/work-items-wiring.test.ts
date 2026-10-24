/**
 * 作品工作项面板（§174）· 源码接线契约。
 *
 * 用户原话：「可以做一个跟你这一样的工作面板，只不过上面显示的是小说的。」
 * ⇒ 左栏常驻的那一列，形态照 MiniMax Code 的会话列表，内容换成小说的东西。
 *
 * 本仓零 jsdom / @vue/test-utils，`.vue` 又不进类型程序（裸 tsc + vue-shim），
 * 所以「面板接的是不是真身」只能靠读源断言钉（先例：conversation-history-menu-wiring.test.ts、
 * composer-context-bar-wiring.test.ts）。vue-source-reader 会剥注释：
 * 只在注释里宣称「已经接上」不算数。
 *
 * 四条裁定一并反向钉：
 * R1 **判据只有一份**（铁律 6）：分组表、行组装、跳转目标全在 utils/work-items.ts，
 *    组件只接线。组件里不许再抄一份组名与文案。
 * R2 **跳转落现成真身**：会话 → agent.showSession；文稿 → book.openDocTab；浏览 → book.browse。
 *    面板不许自己造通路（不许自己发 IPC、不许自己读盘）。
 * R3 **会话行的可点性走现成那份**（utils/session-row-action.ts）：四档禁用理由一句都不许在组件里。
 * R4 **中栏那个「历史对话」浮层与左栏这份面板引同一份判据**：两块面板各写一遍文案，
 *    改一边忘了另一边，两边就会对不上。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  cssRules,
  ruleBlock,
  scriptSource,
  styleSource,
  strippedStyleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const PANEL = "components/WorkItemsPanel.vue";
const SIDEBAR = "components/LeftSidebar.vue";
const MENU = "components/ConversationHistoryMenu.vue";
const ITEMS = "utils/work-items.ts";
const CSS = "work-items.css";

function markup(): string {
  return templateSource(PANEL);
}

/** 只看代码、不看注释的一份源：反着钉的断言必须用它。 */
function codeOf(path: string): string {
  return path.endsWith(".vue") ? scriptSource(path) + templateSource(path) : typeScriptSource(path);
}

describe("R1 · 判据只有一份：组件只接线", () => {
  it("组件引的是 utils/work-items.ts 那份表，组装与计数都调它", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain('from "../utils/work-items"');
    expect(s).toContain("workItemGroups(");
    expect(s).toContain("workItemCount(");
    expect(s).toContain("WORK_ITEMS_TITLE");
  });

  it("三个组名一句都不在组件里（它们住在表里）", () => {
    const code = codeOf(PANEL);
    for (const label of ["对话", "待审", "伏笔"]) {
      expect(code, `${label} 只能住在 ${ITEMS}`).not.toContain(label);
    }
    // 表里确实有这三个（反向：不是「组件里没写，表里也没写」那种假绿）。
    const table = typeScriptSource(ITEMS);
    for (const label of ["对话", "待审", "伏笔"]) {
      expect(table).toContain(label);
    }
  });

  it("行上摆的四件（标题/副行/右格/悬停说明）都从 row 上读，组件不重排文案", () => {
    const m = markup();
    expect(m).toContain("{{ row.title }}");
    expect(m).toContain("{{ row.detail }}");
    expect(m).toContain("{{ row.meta }}");
    expect(m).toContain(':title="row.hint"');
    expect(m).toContain(':disabled="row.disabled"');
  });

  it("组头那几件也是从 group 上读：标签、数字、图标", () => {
    const m = markup();
    expect(m).toContain("{{ group.label }}");
    expect(m).toContain("{{ group.rows.length }}");
    expect(m).toContain(':name="group.icon"');
  });
});

describe("R2 · 跳转落现成真身，面板不自己造通路", () => {
  it("会话 → agent.showSession（与中栏那个浮层同一条路）", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain("await agent.showSession(target.item)");
    expect(s).toContain('target.kind === "session"');
  });

  it("文稿 → book.openDocTab；伏笔 → 有埋设章跳那一章、没有就打开伏笔文稿本身", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain("await book.openDocTab(target.relPath)");
    expect(s).toContain('target.plantedIn !== "" ? target.plantedIn : target.relPath');
    expect(s).toContain("book.browse(ref)");
    expect(s).toContain('ref.kind === "chapter"');
  });

  it("右栏折着的时候打开哪一篇就把它摆出来（与左栏树行同一条约定）", () => {
    expect(scriptSource(PANEL)).toContain('layout.setPaneCollapsed("right", false)');
  });

  it("面板不许自己发 IPC 或自己读盘（数据只从 store 来）", () => {
    expect(codeOf(PANEL)).not.toContain("window.mochen");
  });

  it("三份真数据各走各的通道：会话 / 待审提案 / 伏笔台账", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain("agent.sessions");
    expect(s).toContain("agent.proposals");
    expect(s).toContain("book.foreshadowRows");
  });

  it("换书就重读：会话与伏笔都随书根走，不摆上一本书的东西", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain("watch(");
    expect(s).toContain("() => book.rootPath");
    expect(s).toContain("await agent.refreshSessions()");
    expect(s).toContain("await book.loadForeshadows()");
  });

  it("刚聊完的那一条也要冒出来：会话是每一问写一个文件的，清单得跟着重读", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain("const turnRunning = computed(");
    expect(s).toContain("thread.running");
    expect(s).toContain("watch(turnRunning");
  });
});

describe("R3 · 会话行的可点性走现成那一份", () => {
  it("组件调 agent.rowActionFor，不自己判", () => {
    expect(scriptSource(PANEL)).toContain("agent.rowActionFor(item)");
  });

  it("四档禁用理由一句都不在组件里（它们住在 utils/session-row-action.ts）", () => {
    const code = codeOf(PANEL);
    for (const reason of [
      "回复完成或停止后可切换",
      "这条对话没有绑定文稿",
      "这条对话的文稿已经不在书里",
      "正在看这一条"
    ]) {
      expect(code, `${reason} 只能住在 utils/session-row-action.ts`).not.toContain(reason);
    }
  });

  it("禁用的行点了不做事（不是「点了没反应」）", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain("if (row.disabled) return;");
  });

  it("正在看的那一条亮着（照参照面板那份「当前项亮着」），点了是原地不动", () => {
    const m = markup();
    expect(m).toContain(":class=\"{ 'is-current': row.current }\"");
    expect(scriptSource(PANEL)).toContain("if (row.current) return;");
    // 当前项亮着用的底色是**选中档**，不是 hover 档（两者深浅不同，别混）。
    expect(ruleBlock(styleSource(CSS), ".work-items-row.is-current")).toContain(
      "var(--surface-selected)"
    );
  });
});

describe("R4 · 两块面板引同一份判据", () => {
  it("中栏那个「历史对话」浮层也引 utils/work-items.ts 的标题与副行", () => {
    // sessionTitle 只在模板里用（`{{ sessionTitle(item) }}`），scriptSource 读不到它 ⇒ 断言落在 codeOf 上。
    const s = codeOf(MENU);
    expect(s).toContain('from "../utils/work-items"');
    expect(s).toContain("sessionDocLabel(");
    expect(s).toContain("sessionTitle(");
  });

  it("浮层里不再自己判空标题、不再自己判 unbound（判据搬走了）", () => {
    const code = codeOf(MENU);
    expect(code).not.toContain('item.title === ""');
    expect(code).not.toContain("item.docRelPath === UNBOUND");
    // 反向：真身仍在 utils 里（不是「两边都没有」）。
    expect(typeScriptSource(ITEMS)).toContain('item.title === ""');
    expect(typeScriptSource(ITEMS)).toContain("item.docRelPath === UNBOUND");
  });

  it("两块面板的会话标题与副行来自同一对函数（不许各写一遍）", () => {
    const items = typeScriptSource(ITEMS);
    expect(items).toContain("export function sessionDocLabel(");
    expect(items).toContain("export function sessionTitle(");
  });
});

describe("左栏挂载 · 常驻、开书才显形、位置在「工作台」之后", () => {
  it("只挂一次", () => {
    const m = templateSource(SIDEBAR);
    expect(countNeedle("<WorkItemsPanel", m)).toBe(1);
    expect(scriptSource(SIDEBAR)).toContain('import WorkItemsPanel from "./WorkItemsPanel.vue"');
  });

  it("没书就不显形（没书时它是空的——空壳没用，§168）", () => {
    expect(templateSource(SIDEBAR)).toContain('<WorkItemsPanel v-if="book.hasBook" />');
  });

  it("位置：工作台那一行之后、「我的作品」组之前", () => {
    const m = templateSource(SIDEBAR);
    const at = m.indexOf("<WorkItemsPanel");
    const workspace = m.indexOf('data-nav-id="workspace"');
    const works = m.indexOf("我的作品");
    expect(at).toBeGreaterThan(-1);
    expect(workspace).toBeGreaterThan(-1);
    expect(works).toBeGreaterThan(-1);
    expect(at, "工作项面板排在「工作台」之后").toBeGreaterThan(workspace);
    expect(at, "工作项面板排在「我的作品」之前").toBeLessThan(works);
  });
});

describe("样式 · 全 token、全 rem、零色值字面量", () => {
  it("这一份样式表里没有一处色值字面量（颜色全走 token）", () => {
    const css = styleSource(CSS);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });

  it("字号一律 rem（写死 px 的让「界面字号」设置对这一块不生效）", () => {
    expect(styleSource(CSS)).not.toMatch(/font-size\s*:\s*[\d.]+px\b/);
    expect(styleSource(CSS)).toMatch(/font-size:\s*[\d.]+rem/);
  });

  it("行是三件套：图标 / 标题+副行 / 右格（长标题不许把右格顶走）", () => {
    const row = ruleBlock(styleSource(CSS), ".work-items-row");
    expect(row).toContain("grid-template-columns: 16px minmax(0, 1fr) auto");
    // 标题那一格自己得能收缩，否则长标题会把右格顶出这一行。
    expect(ruleBlock(styleSource(CSS), ".work-items-copy")).toContain("min-width: 0");
  });

  it("标题与副行都能省略（两行都锁 nowrap + ellipsis）", () => {
    // 两条规则是**合写**的一条（`ruleBlock` 按选择器精确匹配，命中的是后面那条单独的），
    // 所以这里从规则表里找那条同时点到两个类的。
    const shared = cssRules(strippedStyleSource(CSS)).find(
      (rule) =>
        rule.selector.includes(".work-items-title") && rule.selector.includes(".work-items-detail")
    );
    expect(shared, "标题与副行的省略规则不见了").toBeDefined();
    expect(shared!.body).toContain("overflow: hidden");
    expect(shared!.body).toContain("text-overflow: ellipsis");
    expect(shared!.body).toContain("white-space: nowrap");
  });

  it("全局表已经挂进 styles.css 的 import 列表", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/work-items.css";');
  });

  it("列表区自己封顶、自己滚（十几条对话不许把下面的文稿树顶出视野）", () => {
    const groups = ruleBlock(styleSource(CSS), ".work-items-groups");
    expect(groups).toContain("max-height:");
    expect(groups).toContain("overflow-y: auto");
  });

  it("滚动条走左栏那套 transient（滚起来才显，停下来自己藏）", () => {
    const s = scriptSource(PANEL);
    expect(s).toContain("createTransientScrollbarController");
    expect(s).toContain("onBeforeUnmount");
    expect(markup()).toContain('class="work-items-groups transient-scrollbar"');
    expect(markup()).toContain('@scroll.passive="handleScroll"');
  });
});

describe("反着钉 · 面板不许退回空壳", () => {
  it("一件事都没有时说的是一句人话，不是「暂无」两个字", () => {
    const m = markup();
    expect(m).toContain('class="work-items-empty"');
    expect(m).toContain("这本书眼下没有在等着你的事。");
    expect(m).not.toContain("暂无");
  });

  it("空组不出现：组是 v-for 出来的，没有就不摆（不靠 v-if 硬开一个空组头）", () => {
    const m = markup();
    expect(m).toContain('v-for="group in groups"');
    expect(m).toContain('v-if="groups.length"');
    // 组头不是「永远摆着」：它跟着 groups 走。
    expect(m).not.toContain('v-if="group.rows.length"');
  });

  it("组可以折起来（这一族是「一眼看见还欠着什么」，折起来就白做了 ⇒ 默认全开）", () => {
    const m = markup();
    expect(m).toContain(':aria-expanded="!collapsed[group.id]"');
    expect(m).toContain('v-if="!collapsed[group.id]"');
    expect(scriptSource(PANEL)).toContain("const collapsed = ref<Record<string, boolean>>({});");
  });
});

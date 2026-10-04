/**
 * #113d 中栏头部动作区 · 源码接线契约。
 * 真身：deepwrite `AgentConversation.vue:272-297` 的 `.conversation-header-actions`——
 * 那一格里有「历史对话」+「新建对话」（`:281-288` 就是照抄的钮），**没有**「模型设置」。
 * 我们原先反过来：头部挂一枚自造的「模型设置」，新建对话只住在左栏。本文件钉这次的对调：
 * 钮照搬他的，动作走本仓已有的唯一真身（`agent.clearThreadView`），设置浮层的入口退回左栏。
 * 本仓 `.vue` 不进类型程序（裸 tsc + vue-shim），所以接线只能读源断言（先例：composer-card-wiring）。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource
} from "../utils/vue-source-reader";

const CENTER = "components/CenterColumn.vue";
const LEFT = "components/LeftSidebar.vue";

/** 只看代码、不看注释的一份源：反着钉的断言必须用它，否则「这里没有 X」那句注释自己就能让断言红。 */
function codeOf(path: string): string {
  return scriptSource(path) + templateSource(path);
}

/** 头部动作区那一格（从 actions 容器到 `</header>`）。 */
function headerActions(): string {
  const m = templateSource(CENTER);
  const at = m.indexOf('class="conversation-header-actions"');
  expect(at, "头部动作区容器必须在").toBeGreaterThan(-1);
  return m.slice(at, m.indexOf("</header>", at));
}

describe("照搬他的头部钮 · 「新建对话」取代自造的「模型设置」", () => {
  it("动作区只有一枚 header-text-button，内容是 plus 图标 + 「新建对话」，几何照他的 16px 图标", () => {
    const actions = headerActions();
    expect(countNeedle('class="header-text-button"', actions)).toBe(1);
    // 切片只看得见头部：同一份样式名在文件别处再挂一次，切片计数抓不到——全文件再数一遍。
    expect(
      countNeedle('class="header-text-button"', templateSource(CENTER)),
      "整份模板只允许一枚"
    ).toBe(1);
    expect(actions).toContain('@click="startNewConversation"');
    expect(actions).toContain('<AppIcon name="plus" :size="16" />');
    expect(actions).toContain("新建对话");
  });

  it("点它走的是与左栏同一个真身：store 的 clearThreadView，键用现成的 threadKey computed", () => {
    const s = scriptSource(CENTER);
    expect(s).toContain("function startNewConversation(): void {");
    expect(s).toContain("agent.clearThreadView(threadKey.value)");
    // 键只从 computed 拿：模板里再 threadKeyFor(...) 一次就是第二份判据。
    expect(templateSource(CENTER)).not.toContain("threadKeyFor(");
    expect(s).toContain("const threadKey = computed(() => threadKeyFor(book.activeDocTab));");
  });

  it("title 说实话：这一格只做渲染层清空（与左栏同一句常量，不手抄第二份文案）", () => {
    const actions = headerActions();
    expect(actions).toContain(':title="CLEAR_VIEW_SENTENCE"');
    expect(scriptSource(CENTER)).toContain("CLEAR_VIEW_SENTENCE,");
    expect(templateSource(LEFT)).toContain(':title="CLEAR_VIEW_SENTENCE"');
  });

  it("「模型设置」整块退役：代码里找不到头部的设置入口，但浮层真身与它的开关都还在", () => {
    const code = codeOf(CENTER);
    expect(code).not.toContain("layout.showSettings(");
    expect(code).not.toContain('name="settings"');
    expect(code).not.toContain("模型设置");
    // 浮层照旧由 layout.currentView 决定可见——删的是入口，不是通路。
    expect(templateSource(CENTER)).toContain('<ProviderSettings v-if="showSettings"');
    expect(scriptSource(CENTER)).toContain(
      'const showSettings = computed(() => layout.currentView === "settings");'
    );
  });

  it("左栏那一格不受影响：仍然缺章即禁用，且两栏都不绕过 store 自己改视图", () => {
    const left = templateSource(LEFT);
    expect(left).toContain(':disabled="book.activeDocTab === null"');
    for (const file of [CENTER, LEFT]) {
      expect(countNeedle("clearThreadView(", codeOf(file)), `${file} 只调一次`).toBe(1);
      expect(codeOf(file)).not.toContain("hydrated = true");
      expect(codeOf(file)).not.toContain("items = []");
    }
  });

  it("禁用口径按各自判据分家：左栏缺章禁用，头部那枚恒可点（R1）", () => {
    // 头部清的是「屏上这一页」——没开章时 threadKey 是 unbound，钮仍然说实话，所以不该跟着禁用。
    // 反过来若给头部补上缺章判据，就是把两栏的语义又混回一份。
    expect(headerActions()).not.toContain("disabled");
    expect(templateSource(LEFT)).toContain(':disabled="book.activeDocTab === null"');
  });

  it("样式照他的原值：基态与 :hover 的声明逐条对上（deepwrite styles.css:501-517）", () => {
    const css = styleSource("conversation-pane.css");
    const base = ruleBlock(css, ".header-text-button");
    for (const decl of [
      "display: inline-flex",
      "align-items: center",
      "gap: 6px",
      "min-height: 30px",
      "padding: 0 9px",
      "border-radius: 7px",
      "cursor: pointer"
    ]) {
      expect(base, `基态少了 ${decl}`).toContain(decl);
    }
    // 空壳规则不算数（`{\n}` 曾被 not.toBe("") 放过，故 ruleBlock 现在返回 trim 后的正文）。
    const hover = ruleBlock(css, ".header-text-button:hover");
    expect(hover, ":hover 不许留空壳").not.toBe("");
    expect(hover).toContain("background: var(--surface-hover)");
    expect(hover).toContain("color: var(--text-primary)");
  });
});

/**
 * #113d 中栏头部动作区 · 源码接线契约。
 * 真身：deepwrite `AgentConversation.vue:272-297` 的 `.conversation-header-actions`——
 * 那一格里有「历史对话」+「新建对话」（`:281-288` 就是照抄的钮），**没有**「模型设置」。
 * 我们原先反过来：头部挂一枚自造的「模型设置」，新建对话只住在左栏。本文件钉这次的对调：
 * 钮对齐他的，动作走本仓已有的唯一真身（`agent.clearThreadView`），设置浮层的入口退回左栏。
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
/** 头部动作区（2026-11-20 自 CenterColumn 拆出）：动作区自己的判据读这一份。 */
const ACTIONS = "components/CenterHeaderActions.vue";
const LEFT = "components/LeftSidebar.vue";

/** 只看代码、不看注释的一份源：反着钉的断言必须用它，否则「这里没有 X」那句注释自己就能让断言红。 */
function codeOf(path: string): string {
  return scriptSource(path) + templateSource(path);
}

/** 头部动作区那一格（从 actions 容器到模板结尾——拆出后它就是 Actions 组件的整份模板）。 */
function headerActions(): string {
  const m = templateSource(ACTIONS);
  const at = m.indexOf('class="conversation-header-actions"');
  expect(at, "头部动作区容器必须在").toBeGreaterThan(-1);
  return m.slice(at);
}

describe("对齐他的头部钮 · 「新建对话」取代自造的「模型设置」", () => {
  it("动作区只有一枚 header-text-button，内容是 plus 图标 + 「新建对话」，几何照他的 16px 图标", () => {
    const actions = headerActions();
    expect(countNeedle('class="header-text-button"', actions)).toBe(1);
    // 切片只看得见动作区：同一份样式名在文件别处再挂一次，切片计数抓不到——两个文件各数一遍。
    // 「历史对话」那枚住在 ConversationHistoryMenu.vue 自己的模板里（#113e），不数进这里。
    expect(
      countNeedle('class="header-text-button"', templateSource(ACTIONS)),
      "动作区整份模板只允许一枚"
    ).toBe(1);
    expect(
      countNeedle('class="header-text-button"', templateSource(CENTER)),
      "中栏骨架里不许再留一枚——动作区已经整块拆去了 CenterHeaderActions"
    ).toBe(0);
    expect(actions).toContain('@click="startNewConversation"');
    expect(actions).toContain('<AppIcon name="plus" :size="16" />');
    expect(actions).toContain("新建对话");
  });

  it("点它走的是与左栏同一个真身：store 的 clearThreadView，键用现成的 threadKey computed", () => {
    const s = scriptSource(ACTIONS);
    expect(s).toContain("function startNewConversation(): void {");
    expect(s).toContain("agent.clearThreadView(threadKey.value)");
    // 键只从 computed 拿：模板里再 threadKeyFor(...) 一次就是第二份判据。
    expect(templateSource(ACTIONS)).not.toContain("threadKeyFor(");
    expect(s).toContain("const threadKey = computed(() => threadKeyFor(book.activeDocTab));");
  });

  it("title 说实话：这一格只做渲染层清空（与左栏同一句常量，不手抄第二份文案）", () => {
    const actions = headerActions();
    expect(actions).toContain(':title="CLEAR_VIEW_SENTENCE"');
    expect(scriptSource(ACTIONS)).toContain("CLEAR_VIEW_SENTENCE,");
    // 2026-10-23：「写作」组（AI 写作 / 章节编辑器）已删，左栏不再消费 CLEAR_VIEW_SENTENCE——
    // 这句常量现在只有头部动作区那一处（上面 :title）在用。左栏仍挂 childState 的 title 载体。
    expect(scriptSource(LEFT)).not.toContain("CLEAR_VIEW_SENTENCE");
    expect(templateSource(LEFT)).toContain(':title="childState(child).hint"');
  });

  it("「模型设置」整块退役：代码里找不到头部的设置入口，浮层骨架也已让位整页设置中心", () => {
    const code = codeOf(CENTER);
    // 2026-10-05：模型浮层的失败态新增了「去模型设置」出口（openModelSettings → layout.showSettings("model")），
    // 所以中栏第一次合法地出现 layout.showSettings( —— 判据从「一个字符都不许有」改成
    // **只许这一处，且必须走 layout 真身**：自己另捏一份开关（showSettings.value = ）仍然禁止。
    expect(code).not.toContain("showSettings.value = ");
    expect(code).not.toContain('name="settings"');
    // 动作区拆出去之后，「模型设置」三字在两个文件里都不许有（ModelSelect 的失败出口说的
    // 是「去模型设置」，按按钮文案判——它写的是『去模型设置』，含这三个字的是同一处）。
    expect(codeOf(ACTIONS)).not.toContain('name="settings"');
    expect(codeOf(ACTIONS)).not.toContain("showSettings");
    // 正面钉住那唯一一处的形状：它在 ModelSelect 的 open-settings 事件上，不是常驻头部入口。
    expect(code).toContain('@open-settings="openModelSettings"');
    const fn = /function openModelSettings\(\): void \{[\s\S]*?\}/.exec(code)?.[0] ?? "";
    expect(fn).toContain('layout.showSettings("model")');
    // 设置中心整页化（对齐上游 SettingsPage 的承载方式）：中栏不再挂浮层，
    // 可见性与分类真身都在 layout.currentView / layout.settingsTab，整页视图挂载在 App.vue。
    expect(code).not.toContain("<ProviderSettings");
    expect(templateSource("App.vue")).toContain(
      "<SettingsPage v-if=\"currentView === 'settings'\""
    );
  });

  it("左栏那一格不受影响：缺章不再是禁用而是引导（全部可点裁定），且两栏都不绕过 store 自己改视图", () => {
    // 2026-10-04 二次裁定：侧边栏全部可点、点哪都有真响应——左栏缺章时点击引导去开一章
    // （childState 报 need-doc，onChildAction → guideToDoc），判定真身仍在 script 的 childState。
    // 2026-10-23：审核四项改为内置技能后，左栏那条 aiCheckOf 缺章引导已删除（needChapterState 同删）；
    // 「全部可点、点了有真响应」这条裁定仍由 side-nav 四态（ready / need-book / need-doc / planned）承担。
    expect(scriptSource(LEFT)).toContain("sideNavChildState(child, book.docs)");
    expect(scriptSource(LEFT)).toContain("guideToDoc");
    // 2026-10-23：左栏「AI 写作」已删，clearThreadView 只剩头部动作区一处；
    // 动作区拆出后，中栏骨架（CENTER）里不许再有第二次。
    expect(countNeedle("clearThreadView(", codeOf(ACTIONS)), "动作区只调一次").toBe(1);
    expect(codeOf(CENTER), "中栏骨架里不再有 clearThreadView").not.toContain("clearThreadView(");
    expect(codeOf(LEFT), "左栏不再有 clearThreadView").not.toContain("clearThreadView(");
    for (const file of [CENTER, ACTIONS, LEFT]) {
      expect(codeOf(file)).not.toContain("hydrated = true");
      expect(codeOf(file)).not.toContain("items = []");
    }
  });

  it("禁用口径按各自判据分家：头部那枚恒可点，左栏缺章走引导不走禁用（R1，2026-10-04 修订）", () => {
    // 头部清的是「屏上这一页」——没开章时 threadKey 是 unbound，钮仍然说实话，所以不该跟着禁用。
    // 反过来若给头部补上缺章判据，就是把两栏的语义又混回一份。
    expect(headerActions()).not.toContain("disabled");
    /* 【5-㊳ 改钉】原来是 `toMatch(/book\.activeDocTab === null[\s\S]*?mode: "need-doc"/)`——
       它钉的是**两段文本在文件里相邻**。而 5-㊳ 把「去开一章 / 先建一章」那三种引导收进了
       needChapterState 一处真身，need-doc 那个字面量因此跑到了**触发条件之前**，不相邻了。

       决定一个字没变：**左栏缺章的响应是引导，不是禁用**。变的是它现在由哪一处提供，
       所以判据跟着改成「触发条件在」+「引导那一份在」+「模板里没有 disabled」，
       而不再是把两段文本绑在一起——那种写法对实现的重排毫无容忍度，
       【2026-10-23】审核四项改为内置技能后，左栏已没有「缺章」这一支：needChapterState 删除，
       所以改钉「它确实不在」——缺章引导这条判据随功能一起退场。 */
    expect(scriptSource(LEFT)).not.toContain("needChapterState");
    expect(scriptSource(LEFT)).not.toContain('mode: "need-doc", docKind: "chapter"');
    expect(templateSource(LEFT)).not.toContain(':disabled="childState(child).disabled"');
  });

  it("样式照他的原值：基态与 :hover 的声明逐条对上（参考稿 styles.css 501-517）", () => {
    const css = styleSource("conversation-pane.css");
    const base = ruleBlock(css, ".header-text-button");
    for (const decl of [
      "display: inline-flex",
      "align-items: center",
      "gap: 6px",
      "min-height: 32px",
      "padding: 0 9px",
      "border-radius: 8px",
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

/**
 * 顶栏标题（2026-10-05 用户裁定）：原先是 `${stage.name}智能体` 拼出来的「正文智能体」，
 * 那是功能泛称——不论哪枚档案在干活都这么写，看不出「现在是谁在写」。
 * 改为报档案名，判定下沉 utils（`.vue` 不进类型程序，判定写在模板里等于没钉）。
 */
describe("顶栏标题 · 报当前 AI 的名字而不是功能泛称", () => {
  it("标题读 utils 的 conversationTitleLabel，组件里不再自己拼标题", () => {
    const code = codeOf(CENTER);
    expect(code).toContain("conversationTitleLabel(book.meta)");
    // 反向钉：拼法退回 `${stage.name}智能体` 时这里立刻红（codeOf 已剥注释，防注释自证）。
    expect(code).not.toMatch(/\$\{stage\.name\}智能体/);
  });

  it("头部与工作台 hero 共用同一个 agentLabel，不许各自再拼一份标题", () => {
    const tpl = templateSource(CENTER);
    expect(tpl).toContain("<strong>{{ agentLabel }}</strong>");
    expect(tpl).toContain(':agent-label="agentLabel"');
    // 两处是**同一个真身的两个消费者**（无书时 hero 的 h1 靠 CSS 撤掉，值仍来自这里），
    // 所以此处钉的是「都读它」，不是「只出现一次」。
    expect(countNeedle("agentLabel", tpl), "模板里的 agentLabel 只许是这两个消费者").toBe(2);
  });
});

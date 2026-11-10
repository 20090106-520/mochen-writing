/**
 * 插件 / 技能那两处（中栏）的接线契约（2026-10-07 批次 5-㉛ 写，5-㉜ 按用户指正改钉）。
 *
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`vue-shim.d.ts` 把 `*.vue` 声明成 any ⇒ 组件零类型检查，
 * 于是「这一页到底接没接上」只能钉成读源码断言（同律先例：model-select-wiring、
 * tool-args-wiring、skill-market-wiring、plugin-panel-wiring）。
 * 注释会被 vue-source-reader 剥掉：只在注释里宣称的接线不算数。
 *
 * 【这一份顶的是哪两份退役守卫】
 * 批次 5-㉛ 之前，插件住 `PluginPanel.vue` 浮层、技能住 `SkillBrowserPanel.vue` 浮层，
 * 各有一份守卫（`plugin-panel-wiring` / `skill-market-wiring`）。用户裁定要「单独页面」，
 * 两个浮层连同它们的样式与判定层一起退役，那两份守卫随之退役。
 * 退役不等于把保证丢掉。**下面每一条都对应旧守卫里的一条**，逐条搬过来而不是重写：
 * ┌ 旧守卫保证的是                              │ 现在钉在哪
 * │ 已停用/已装那一态只来自主进程                 │ script 不许 `.disabled =` / `.installed =`
 * │ 动作只递目录名，路径由主进程拼                 │ browse 的 script 里只有 `row.dirName`，无路径拼接
 * │ 列不出来时不许同时摆「真的没有」               │ 空态分三档，「没列出来」那档不许吞下一档的话
 * │ 出处/许可/书内同名会盖掉 三句都在卡上          │ 卡上有 `row.sourceLabel`、`shadowedByBook`、逐字原文预览
 * │ 出处与警告不复用两行截断                      │ `.extension-card-warn` 显式撤掉 line-clamp
 * │ 动作结果用 role="status" 摆出来               │ `.extensions-notice` 带 role="status"
 * │ 正文预览自己限高并滚动                        │ `.extension-card-source` 有像素级 max-height + 滚动
 * │ 装卸完市场与技能库两张表都要刷                │ useSkillMarketStore 的两条 finally（未动，照钉）
 * │ 挂入技能这一轮真的发得出去                    │ ContextMeter 喂真实名单（未动，照钉）
 * │ 合成器取 min(limitPx, spacePx)               | 那条底线还在服务别的浮层，照钉
 * └ 三个分组不许塌成一个 / 模板不自筛              │ 见下面各组（新形状，逐条对应）
 *
 * 【5-㉜ 改钉的那一条，它在文件最上面那组里】
 * 5-㉛ 我把这两样做成 `currentView === "extensions"` 的整页，真机点进去**左栏整个消失**。
 * 用户在截图上指正：「不是重新创建侧边栏还是有的，然后旁边变成了那个技能库或插件」。
 * 于是下面第一组那三条：左栏恒定、只换中栏、左栏三枚钮的高亮互斥。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  strippedStyleSource,
  tagAttributes,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const PAGE = "components/ExtensionsPage.vue";
const NAV = "components/ExtensionsNavRow.vue";
const BROWSE = "stores/useExtensionBrowse.ts";
const MARKET_STORE = "stores/useSkillMarketStore.ts";
const PLUGIN_STORE = "stores/usePluginStore.ts";
// 主进程那几处的边界守卫在 `apps/desktop/src/main/plugin-service.test.ts`、
// `apps/desktop/src/main/skill-market-service.test.ts`、`packages/fs-store` 的测试里：
// 本仓的 `vue-source-reader` 把路径解到 `renderer/src`，够不到 `src/main`，
// 在这边硬读只会得到一个 ENOENT——那种红是「测试自己坏了」，不是产品缺陷。

describe("5-㉝ · 左栏恒定，右栏不跟，这一处占中栏+右栏一整个页面", () => {
  it("App.vue：右栏（与它的拖拽条）只在对话那条路上出现", () => {
    const app = templateSource("App.vue");
    // 用户在截图上单独框住右栏那一片：「这一片技能库和插件库，应该是不会有这个的。
    // 其他的地方正常有，那是正常的。这地方有，就不正常」。
    // 那一片（文稿 / 浏览 / 作品资料）是编辑器的配套设施，与技能库/插件无关。
    expect(app).toContain(
      "<DocumentPane\n        v-if=\"!rightCollapsed && centerView === 'chat'\""
    );
    expect(app).toContain("<CenterColumn\n        v-if=\"centerView === 'chat'\"");
    /* 5-㊵ 改钉：这一条从 `<ExtensionsPage v-if="centerView !== 'skins'" />` 改成
       `v-else-if="centerView === 'skills' || centerView === 'plugins'"`。

       **改钉的理由是它自己红了，真机撞出来的**：那个 `!== 'skins'` 让 ExtensionsPage
       在**对话那条路上也渲染**，实测 `.extensions-page` 与 `.conversation-pane`
       完整重叠 664×902（同一 grid 格）。画面上看不出来（对话后画、盖在上面），
       但插件页整页活在 DOM 里——用户报的症状是「插件里的东西卡到工作台里了」，
       根因在这一行，差了三层。

       而上一版注释里担心的「串成 v-else 会让谁盖谁变成书写顺序决定」在这里不成立：
       三个条件读**同一个 centerView 且穷尽它的取值**，互斥由构造保证。 */
    expect(app).toContain(
      `<ExtensionsPage v-else-if="centerView === 'skills' || centerView === 'plugins'" />`
    );
    // 反向：**绝不许**再用那个 `!== 'skins'` 的写法——它正是让插件页活在对话路上的那一行。
    expect(app).not.toContain(`<ExtensionsPage v-if="centerView !== 'skins'" />`);
    expect(app).toContain(`<SkinGalleryPage v-else-if="centerView === 'skins'" />`);
    // 反向：只判 !rightCollapsed 的话，右栏会与这一页并排，画面上就是「两个页面」。
    expect(app).not.toContain('<DocumentPane v-if="!rightCollapsed"');
    // 拖拽条也得跟着：它在时右栏那一格还留一条可拖的边，可那一格根本没有内容。
    expect(app).toMatch(
      /v-if="!rightCollapsed && centerView === 'chat'"\s*\n\s*class="pane-resizer pane-resizer-right"/
    );
  });

  it("左栏恒定：它**不在**任何 v-else 里，设置视图下也在", () => {
    const app = templateSource("App.vue");
    expect(app).not.toContain("v-else-if=\"currentView === 'extensions'\"");
    /* 5-㊵ 改钉：`expect(app).not.toContain("<ExtensionsPage v-else-if")` 这条被删了。

       它当年禁的是「整页那版」——`v-else-if="currentView === 'extensions'"`，
       那一支是 5-㉛ 的错误落点（左栏会整个消失）。**那条仍然禁着**，见上一行。

       而这条笼统的 `not.toContain` 顺手把**任何** `v-else-if` 都禁了，
       包括 5-㊵ 修「插件页活在工作台上」时不得不用的那一支。
       当年那条注释担心的「谁盖谁由书写顺序决定」，在**三页读同一个 centerView
       且穷尽它的取值**时不成立——互斥由构造保证，与顺序无关。

       ⇒ 现在禁的是**具体那个错误条件**，不是「语法」本身。 */
    expect(app).not.toContain(`v-else-if="currentView === 'extensions'"`);

    /* 5-㊱ 再改钉：这一条从「左栏在 v-else 里，只有设置中心整页时才被跳过」改成
       「左栏不在任何 v-else 里」。原来那句话是**如实描述当时的代码**，而那份代码
       与同一段上一行的裁定自相矛盾：5-㊜ 已经把插件与技能退回中栏，理由逐字是
       「左栏是恒定的导航，任何时候都在」；设置却因为它的 `v-if` 排在
       `<template v-else>` **之前**（左栏就在那个 v-else 里面）而被漏掉。

       ⇒ 钉在「左栏不落在任何 v-else 里」这条形状上，而不是钉「设置这一支怎么写」：
       判据落在**左栏**而不是设置页，将来设置页再改落点也不必动这条。 */
    const leftSidebarAt = app.indexOf("<LeftSidebar");
    const elseAt = app.indexOf("<template v-else>");
    expect(leftSidebarAt, "模板里找不到 LeftSidebar").toBeGreaterThan(-1);
    expect(elseAt, "模板里找不到 template v-else").toBeGreaterThan(-1);
    expect(
      leftSidebarAt < elseAt,
      "左栏必须排在那个 v-else 之前（v-else 只该管中栏与右栏的内容）"
    ).toBe(true);
    expect(app).toContain('<LeftSidebar v-if="!leftCollapsed"');
    // 设置视图仍然是 currentView 的唯一真身，只是它不再吃掉左栏。
    expect(app).toContain(`<SettingsPage v-if="currentView === 'settings'" />`);
  });

  it("左栏固定宽度：拖拽条整枚撤掉（2026-11-09 用户裁定「侧边栏应该是固定的」）", () => {
    const app = templateSource("App.vue");
    // 留着拖拽条就等于左栏还可拖宽拖窄——那正是用户点名不要的「不固定」。
    expect(countNeedle("pane-resizer-left", app)).toBe(0);
    expect(countNeedle('aria-label="调整左侧栏宽度"', app)).toBe(0);
    // 右栏那一枚照旧在（可拖的只有右栏），且仍跟着对话视图显隐。
    expect(countNeedle('class="pane-resizer pane-resizer-right"', app)).toBe(1);
  });

  it("三个内容页占同一格落点 `2 / -1`：设置 / 插件·技能 / 皮肤广场", () => {
    // `1 / -1`（5-㉛ 整页那版）会把**左栏**也吃掉——用户指正「不是重新创建侧边栏还是有的」。
    // 什么都不写（5-㉜ 那版）又成了「中栏一块 + 右栏一块」两个页面并排——
    // 用户在截图上框住整片说「应该是一整个页面，不应该分两个页面」。
    const page = ruleBlock(styleSource("extensions.css"), ".extensions-page");
    expect(page).toContain("grid-column: 2 / -1;");
    expect(page, "左栏会被吃掉").not.toContain("grid-column: 1 / -1");
    expect(page, "整屏写法也不该回来").not.toContain("100vw");
    // 中间那两列里 center 是 minmax(320px, 1fr)：grid item 不给 min-width: 0 就不肯缩到内容宽。
    expect(page).toContain("min-width: 0;");
    // 5-㊱ 补：皮肤广场与设置中心必须落在**同一格**上。
    // 三个内容页各写各的，就会有一个哪天漏掉 grid-row 而被排到第二行，
    // 于是 shell 从「一行三列」变「两行三列」、左栏被压扁、后半截导航点不到
    // （那次真机量测的完整记录在 `.extensions-page` 那段注释里）。
    const gallery = ruleBlock(styleSource("skin-gallery.css"), ".skin-gallery");
    expect(gallery).toContain("grid-column: 2 / -1;");
    expect(gallery).toContain("grid-row: 1;");
    const settings = ruleBlock(styleSource("settings-page.css"), ".settings-page");
    expect(settings).toContain("grid-column: 2 / -1;");
    expect(settings, "grid-row 漏了，左栏会被挤到第一行那一格").toContain("grid-row: 1;");
    expect(settings).toContain("min-width: 0;");
    // 「整页」那一版的遗留写法不许回来：它是 grid item 了，撑满视口宽会横向溢出。
    expect(settings, "整屏写法也不该回来").not.toContain("100vw");
    // 反向：desktop-shell 哪天不是三列 grid 了，这条就该重写而不是继续通过。
    const shell = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(shell).toContain(".desktop-shell {");
    expect(shell).toContain("grid-template-columns:");
  });

  it("三处指同一个真身：左栏两枚钮、两个斜杠命令、中栏自己那格判定", () => {
    const nav = scriptSource(NAV);
    expect(nav).toContain("useLayoutStore()");
    const navMarkup = templateSource(NAV);
    expect(navMarkup).toContain("@click=\"layout.showCenter('skills')\"");
    expect(navMarkup).toContain("@click=\"layout.showCenter('plugins')\"");
    // 2026-10-21：斜杠命令的派发表搬到 `agent-slash-dispatch.ts`，两处 showCenter 在那里。
    const agent = typeScriptSource("stores/agent-slash-dispatch.ts");
    expect(agent).toContain('useLayoutStore().showCenter("skills");');
    expect(agent).toContain('useLayoutStore().showCenter("plugins");');
    // 反向：上一版那个整页入口必须已经不存在，否则两处真身并存。
    expect(agent).not.toContain("showExtensions");
    expect(navMarkup).not.toContain("showExtensions");
    expect(templateSource(PAGE)).not.toContain("showExtensions");
  });

  it("左栏三枚钮的高亮**互斥**：亮着的那一枚就是在说「你在这儿」", () => {
    // 两枚同时亮 = 左栏在说两件事，而用户只会当成渲染坏了。
    // 所以「工作台」那枚不能只绑 currentView：中栏摆着技能库时 currentView 仍是 workspace。
    const sidebar = templateSource("components/LeftSidebar.vue");
    // 正则而不是整串字面量：prettier 会按 printWidth 100 把这条属性折成多行，
    // 写整串 `toContain` 的话，红的原因会变成「格式变了」而不是「判定变了」。
    expect(sidebar).toMatch(
      /'is-active': layout\.currentView === 'workspace' &&\s+layout\.centerView === 'chat'/
    );
    const navMarkup = templateSource(NAV);
    expect(navMarkup).toContain(":class=\"{ 'is-active': layout.centerView === 'skills' }\"");
    expect(navMarkup).toContain(":class=\"{ 'is-active': layout.centerView === 'plugins' }\"");
    // 工作台亮着的时候，那两枚必须不亮（它们绑的是 centerView，天然互斥）。
    expect(navMarkup).toContain('data-nav-id="skills"');
    expect(navMarkup).toContain('data-nav-id="plugins"');
  });

  it("回到对话只有一条通路：showWorkspace 顺手把 centerView 复位成 chat", () => {
    // 不复位的话，Esc 关掉设置之后中栏还摆着技能库，而左栏亮的是「工作台」——
    // 两枚都在说「你在这儿」。
    const src = typeScriptSource("stores/layoutStore.ts");
    const fn = /function showWorkspace\(\): void \{[\s\S]*?\n {2}\}/.exec(src)?.[0] ?? "";
    expect(fn, "showWorkspace 读不到").not.toBe("");
    expect(fn).toContain('centerView.value = "chat";');
  });

  it("从设置页（整页，没有中栏）点那两枚钮会回到工作区，否则点了像没反应", () => {
    const src = typeScriptSource("stores/layoutStore.ts");
    const fn = /function showCenter\([\s\S]*?\n {2}\}/.exec(src)?.[0] ?? "";
    expect(fn, "showCenter 读不到").not.toBe("");
    expect(fn).toContain("centerView.value = page;");
    expect(fn).toContain('currentView.value = "workspace";');
  });

  it("这一页不再有页签：两处各自一个页面，页签会让人在一个地方选、再点一次才能到", () => {
    const markup = templateSource(PAGE);
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain('role="tabpanel"');
    // 标题跟着落在哪一处走。
    expect(markup).toContain("{{ title }}");
    expect(markup).toContain("extensions-title");
  });
});

describe("2026-10-17 · 左栏收起后「出得来」：抓手恒在 shell 上（四页都在）", () => {
  /**
   * 真机取证（`.superpowers/tmp-app-probe.mjs`）：左栏在**非对话视图**收起后
   * `hasExpandBtn=false`、`leftSidebar=null`——广场页 / 设置页 / 技能页都出不来，
   * 唯一退路是 Ctrl+B（不可见）。
   *
   * 根因在落点：那枚「展开左侧栏」原先住在 `CenterColumn` 的头部，而 `CenterColumn`
   * 只在 `centerView === 'chat'` 渲染；`SettingsPage` 与 `ExtensionsPage` 都不渲染它
   * ⇒ 三页都没有入口。
   *
   * 改法：抓手搬出中栏、恒挂 shell，只读 `leftCollapsed`（与 `currentView` / `centerView` 无涉）。
   */
  it("App.vue：那枚抓手只读 leftCollapsed，且排在 v-else 之前", () => {
    const app = templateSource("App.vue");
    const tagAt = app.indexOf("<PaneEdgeToggle");
    expect(tagAt, "App.vue 里找不到那枚展开抓手").toBeGreaterThan(-1);
    const elseAt = app.indexOf("<template v-else>");
    expect(elseAt, "模板里找不到 template v-else").toBeGreaterThan(-1);
    // v-else 里面的东西在设置视图下整个不渲染——抓手排在里面就回到「只在某一页」。
    expect(tagAt, "抓手必须排在 v-else 之前").toBeLessThan(elseAt);
    const tag = app.slice(tagAt, app.indexOf("/>", tagAt) + 2);
    expect(tag, "抓手不是按 leftCollapsed 显隐").toContain('v-if="leftCollapsed"');
    // 带上 centerView / currentView 就又变成「只在某一页」——那正是这次要修的缺陷。
    expect(tag, "抓手不该绑 centerView").not.toContain("centerView");
    expect(tag, "抓手不该绑 currentView").not.toContain("currentView");
  });

  it("CenterColumn.vue：那枚「展开左侧栏」已撤，同一动作不留两份真身", () => {
    const centerPath = "components/CenterColumn.vue";
    const center = templateSource(centerPath);
    expect(center).not.toContain("展开左侧栏");
    // 撤了按钮，`leftCollapsed` prop 与 `toggleLeft` emit 就没有消费者了——留着是死接线。
    const script = scriptSource(centerPath);
    expect(script).not.toContain("toggleLeft");
    expect(script).not.toContain("leftCollapsed");
    // App.vue 那一侧也要跟着撤，否则传一个不存在的 prop、监听一个不存在的 emit。
    const app = templateSource("App.vue");
    expect(app).not.toContain("@toggle-left");
    expect(app).not.toContain(":left-collapsed");
  });

  it("抓手是 shell 的绝对定位元素，落在左缘（与分栏拖拽条同源）", () => {
    const shell = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const block = ruleBlock(shell, ".pane-edge-toggle");
    expect(block).toContain("position: absolute;");
    expect(block).toContain("left: 0;");
    // 窗口拖动区（`-webkit-app-region: drag`）会吃掉点击：不给 no-drag 这枚钮点不动。
    expect(block, "抓手会盖住窗口拖动区").toContain("-webkit-app-region: no-drag;");
  });

  it("收起后左缘留一条窄轨，内容不落在抓手底下", () => {
    const shell = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    // 真机量过：收起时列宽若回到 0，内容就从 x=0 起画，而抓手占 0..31——
    // 设置中心自带左导航的第一个字从 x=22 起，正好被切掉；对话页同样压住正文左缘。
    expect(shell, "没有那条窄轨").toContain("--left-rail-width:");
    const collapsed = ruleBlock(shell, ".desktop-shell.is-left-collapsed");
    expect(collapsed).toContain("var(--left-rail-width)");
    expect(collapsed, "列宽回到 0 会让抓手压在内容上").not.toMatch(/grid-template-columns:\s*0\b/);
  });

  it("抓手是纯图标件：与左栏那枚「收起左侧栏」同款，不再挂竖排文字", () => {
    /* 用户 2026-10-17：「两边收缩的比例不对都说了，就不要显示展开侧边栏了，
       就和旁边的那个一样，点一下就行了」。
       改前那枚是**竖排文字竖条**——真机量到 31×122，而旁族图标钮是 32×32：
       「比例不对」有一半就出在这里（另外那半在下面那条轨宽）。 */
    const markup = templateSource("components/PaneEdgeToggle.vue");
    expect(markup, "抓手还挂着竖排文字那一条").not.toContain("pane-edge-toggle-label");
    expect(markup, "竖排写法不许回来").not.toContain("writing-mode");
    expect(markup, "抓手不是纯图标件（没借旁族那枚的样式）").toContain(
      'class="icon-button pane-edge-toggle"'
    );
    const shell = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    // 定位块里只许有落点：观感若在这里再写一遍（width/居中/圆角/底色），
    // 那就是同一族控件第二份实现——改一处忘另一处时界面上看不出来。
    const block = ruleBlock(shell, ".pane-edge-toggle");
    expect(block, "定位块里混进了观感").not.toMatch(/writing-mode|width:|height:|border-radius:/);
    /* 轨宽必须**等于**那枚图标钮的边长：留一条比钮还宽的底，就是「收起后左缘多出
       一条没有东西住的空白带」。两处值一改一漏，这条当场红。 */
    const iconSide = /width:\s*(\d+)px;/.exec(
      ruleBlock(styleSource("conversation-pane.css"), ".icon-button")
    )?.[1];
    expect(iconSide, "读不出 .icon-button 的边长").toBeTruthy();
    expect(shell, `窄轨宽度必须等于图标钮边长（${iconSide}px）`).toContain(
      `--left-rail-width: ${iconSide}px;`
    );
  });
});

describe("落在哪一处 · 取数全走 store", () => {
  it("模板不自己 listPlugins / listMarket / filter", () => {
    const script = scriptSource(PAGE);
    expect(script).toContain("usePluginStore()");
    expect(script).toContain("useSkillMarketStore()");
    const markup = templateSource(PAGE);
    expect(markup).not.toContain("listPlugins");
    expect(markup).not.toContain("listMarket");
    expect(markup).not.toContain(".filter(");
  });

  it("搜索是「敲完按搜索」才生效的：输入框绑 draft，提交才落 query", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain('v-model="conditions.draft"');
    expect(markup).toContain('@submit.prevent="browse.submitSearch(page)"');
    // 反向：直接 v-model 到 query = 一边敲一边筛，打到第三个字结果就变了。
    expect(markup).not.toContain('v-model="browse.pages');
  });

  it("两处各管一份条件，来回切不串；筛选档直接从 MARKET_CATEGORIES 取", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain('v-for="f in filters"');
    expect(markup).toContain('@click="browse.setFilter(page, f)"');
    expect(markup).toContain('@click="browse.clearConditions(page)"');
    const src = typeScriptSource(BROWSE);
    expect(src).toContain('plugins: { draft: "", query: "", filter: "全部" }');
    expect(src).toContain('skills: { draft: "", query: "", filter: "全部" }');
    // 另写一份的后果很具体：加一个分类要改两个地方，漏改的那个让那类永远筛不出来。
    expect(src).toContain("...MARKET_CATEGORIES,");
    expect(src).not.toMatch(/SkillFilter\s*=\s*[^;]*"文风"/);
  });
});

describe("插件那一处 · 状态与动作不许渲染层自己拿主意", () => {
  it("已停用 / 装不上两枚徽标都在，且停用那张要写明后果", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain(">已停用</span>");
    expect(markup).toContain(">装不上</span>");
    expect(markup).toContain("模型调不到它的工具");
  });

  it("渲染层不许自己把 disabled 翻成 false/true——那是第二份判据", () => {
    const script = scriptSource(PAGE);
    expect(script).not.toMatch(/\.disabled\s*=/);
    expect(script).not.toContain("querySelector");
  });

  it("按钮递的是目录名，且方向由 enabled 参数说清（不是目录名约定出来的）", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain('@click="plugins.toggle(one.dirName, !one.disabled)"');
    expect(markup).toContain('@click="plugins.uninstall(one.dirName)"');
    expect(markup).toContain('@click="plugins.openSource(one.dirName)"');
    // 反向：**script** 里不许出现任何路径拼接。模板里的 `client.js` 是给用户看的一句说明
    // （「一个目录 + 一份 client.js」），不是拿它去读文件——所以这条钉 script，不钉模板。
    const script = scriptSource(PAGE);
    expect(script).not.toContain("pluginsDir");
    expect(script).not.toContain("client.js");
  });

  it("在跑时按钮写「停用」、停用后写「启用」——两枚文案不许同形", () => {
    expect(templateSource(PAGE)).toContain('one.disabled ? "启用" : "停用"');
  });

  it("动作中的那颗钮禁用：停用/卸载看 isBusyOn，读源码看 readingDirName", () => {
    const markup = templateSource(PAGE);
    // 停用与卸载各自对应一个动作，用 store 的 busyDirName 判；
    // 「看源码」是另一类动作（读文件，不是改状态），它看 readingDirName。
    for (const cls of ["is-toggle", "is-uninstall"]) {
      for (const attr of tagAttributes(markup, cls)) {
        expect(attr, `${cls} 少了一处禁用`).toContain(':disabled="plugins.isBusyOn(one.dirName)"');
      }
    }
    for (const attr of tagAttributes(markup, "is-source")) {
      expect(attr).toContain(':disabled="plugins.readingDirName === one.dirName"');
    }
  });

  it("空态分三档，不许对着没拿到的清单下结论", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain('v-if="plugins.listed === null"');
    expect(markup).toContain('v-else-if="plugins.listed === false"');
    const failedText =
      /v-else-if="plugins\.listed === false"[^>]*>\s*([^<]*?)\s*<\/p>/.exec(markup)?.[1] ?? "";
    expect(failedText, "没找到「没列出来」那一档的正文").not.toBe("");
    expect(failedText).toContain("插件清单没有列出来");
    expect(failedText).not.toContain("还没有插件");
  });
});

describe("技能那一处 · 两张表按目录名并成一行（不许各出一张）", () => {
  it("渲染层不许自己把 installed 翻成 true——那是第二份判据", () => {
    const script = scriptSource(PAGE);
    expect(script).not.toMatch(/\.installed\s*=/);
    expect(script).not.toContain("querySelector");
  });

  it("盘上的与市场清单里的按 dirName join，同一个技能不出两张卡", () => {
    const src = typeScriptSource(BROWSE);
    // 各出一行的话：同一个技能出现两次、两枚钮还不一样（一枚装/卸、一枚挂入/取下），
    // 用户得自己想哪张卡才是真的那一份。
    expect(src).toContain("const joined = new Set<string>();");
    expect(src).toContain("joined.add(skill.dirName);");
    expect(src).toContain("if (joined.has(entry.dirName)) continue;");
  });

  it("哪一份在生效不在渲染层重算：主进程 mergeSkillRefs 已去重且书内优先", () => {
    const src = typeScriptSource(BROWSE);
    // 重算优先级就是第二份判据。而重算的诱因是「同名该用哪份」这个问题本身——
    // 所以这里钉的是「不按 source 做选择」。
    expect(src).not.toContain('source === "book"');
    expect(src).not.toContain('source === "global"');
  });

  it("「挂入/取下」与「装上/卸掉」是两枚钮：落盘与本轮生效不是一件事", () => {
    const markup = templateSource(PAGE);
    // 合成一枚就是把「已经安装」与「这一轮生效」混成同一个「已安装」，
    // 而那是两种不同的期待：用户常常要「盘上有，但这一轮别带」。
    //
    // 【为什么 is-pin 是 2 而不是 1】2026-10-17 起技能页顶上多了一条「推荐」条，
    // 那里也有一颗「挂入」（点击走同一条真身，只是不带 row）。本条钉的是**卡片上两枚钮的区分**，
    // 「装上/卸掉」仍只该出现在卡片上（1），「挂入」则卡片一颗 + 推荐条一颗 = 2。
    expect(tagAttributes(markup, "is-pin")).toHaveLength(2);
    expect(tagAttributes(markup, "is-install")).toHaveLength(1);
    expect(markup).toContain('v-if="row.onDisk"');
    expect(markup).toContain('v-if="row.inMarket"');
    // 挂入只对盘上那份有意义：市场那条没装时不该出现一颗永远失败的钮。
    expect(markup).not.toContain(':disabled="!row.onDisk"');
  });

  it("装卸只递目录名，路径由主进程拼（渲染层不许碰路径）", () => {
    const src = typeScriptSource(BROWSE);
    const action = /async toggleInstalled\([\s\S]*?\n {4}\}/.exec(src)?.[0] ?? "";
    expect(action, "toggleInstalled 读不到").not.toBe("");
    expect(action).toContain("market.uninstall(row.dirName)");
    expect(action).toContain("market.install(row.dirName)");
    expect(src).not.toContain("skillsDir");
  });

  it("装卸按钮在 busy 时禁用，禁用的判据来自 store 的 isBusyOn", () => {
    const markup = templateSource(PAGE);
    for (const attr of tagAttributes(markup, "is-install")) {
      expect(attr).toContain(':disabled="row.busy"');
    }
    const src = typeScriptSource(BROWSE);
    // 反向钉：busy 必须由调用方从市场那个 store 递进来，不能在本 store 里另算一份。
    expect(src).toContain("marketBusy(dirName: string): boolean;");
    expect(src).toContain("busy: input.marketBusy(entry.dirName)");
  });

  it("出处、许可与「书内同名会盖掉」三句都在卡上，且正文预览摆的是逐字原文", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain("{{ row.sourceLabel }}");
    expect(markup).toContain('v-if="row.shadowedByBook"');
    expect(markup).toContain("书内那份优先");
    expect(markup).toContain("<details");
    expect(markup).toContain("{{ row.skillMd }}");
    // 出处与许可不许在渲染层临时拼：那是 contracts 的 MarketEntry 字段的形状问题。
    expect(typeScriptSource(BROWSE)).toContain("`${entry.origin} · ${entry.license}`");
  });

  it("列不出来时不许撒谎：空态分三档，「没列出来」那档不许吞下一档的话", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain('v-if="!agent.skillsListed && market.listed === null"');
    expect(markup).toContain('v-else-if="market.listed === false"');
    const failedText =
      /v-else-if="market\.listed === false"[^>]*>\s*([^<]*?)\s*<\/p>/.exec(markup)?.[1] ?? "";
    expect(failedText, "没找到「没列出来」那一档的正文").not.toBe("");
    expect(failedText).toContain("清单没有列出来");
    expect(failedText).not.toContain("盘上还没有技能");
  });

  it("按某一类筛到底空的时候，那句话得说清是哪一类空着", () => {
    // 对着一个刚筛过的空列表说「盘上还没有技能」是在撒谎——它是有的，只是被这一档滤掉了。
    expect(templateSource(PAGE)).toContain("「${conditions.filter}」这一类里现在没有技能。");
  });

  it("徽标是四枚且穷尽（P0-4 补「已停用」），另有一枚独立说清挂入是谁定的", () => {
    const markup = templateSource(PAGE);
    // 真机症状：重启后「本轮已挂入」清空，而那一档原本没写，于是「装在盘上但这一轮没带」
    // 那一种一行徽标都没有——它和「可以装」只差两颗钮的形状。
    expect(markup).toContain('v-if="row.disabled"');
    expect(markup).toContain('v-else-if="row.pinned"');
    expect(markup).toContain('v-else-if="row.onDisk"');
    expect(markup).toContain(">已停用</span>");
    expect(markup).toContain(">已安装</span>");
    expect(markup).toContain(">可以装</span>");
    expect(markup).toContain('class="extension-badge is-quiet">已安装');
    expect(markup).toContain('class="extension-badge is-quiet">可以装');
    // P0-4：书级默认与本会话临时改过要分得开——这是两件事，不能合成一枚。
    expect(markup).toContain('v-if="row.onDisk && row.overridden"');
    expect(markup).toContain('v-else-if="row.onDisk && row.defaultOn"');
    // 用户指正「技能库那边应该也加一个已安装」：第二枚写的是状态，不是事实。
    // 「在盘上」说的是「它在磁盘上」，而这一页那枚钮写的是「装上/卸掉」——
    // 徽标与钮各说一套，用户得自己推断这两者是一件事。
    expect(markup).not.toContain(">在盘上</span>");
  });

  it("「已安装」是一个词、两页一份：档名与徽标不许各写各的", () => {
    const markup = templateSource(PAGE);
    const src = typeScriptSource(BROWSE);
    // 档名提出常量后才不会漂：插件页叫「已装」、技能页叫「在盘上」时，
    // 同一个状态在两页有两个名字，用户会以为那是两种状态。
    expect(src).toContain('export const INSTALLED_FILTER = "已安装";');
    expect(src).toContain('export type PluginFilter = "全部" | typeof INSTALLED_FILTER;');
    expect(src).toContain('typeof INSTALLED_FILTER | "全部"');
    // 模板里的判定走同一个常量，不许再写一个字面量「已安装」——
    // 改档名时只改一处，两处不会一个改了另一个没改。
    expect(markup).toContain("conditions.filter === INSTALLED_FILTER");
    expect(markup).not.toContain('conditions.filter === "已安装"');
    expect(markup).not.toContain('conditions.filter === "已装"');
    // 空态那两句话也要跟着：说「没有盘上已装的技能」时用户还得自己翻译一遍。
    expect(markup).toContain("现在还没有已安装的技能。");
  });
});

describe('动作结果用 role="status" 摆出来：失败也要看得见', () => {
  it("插件与市场两侧的回执都带 role=status", () => {
    const markup = templateSource(PAGE);
    expect(tagAttributes(markup, "extensions-notice")).toHaveLength(2);
    for (const attr of tagAttributes(markup, "extensions-notice")) {
      expect(attr).toContain('role="status"');
    }
  });
});

describe("插件 store 里不许有第二格开关", () => {
  it("整页/中栏的显隐都不住在它身上", () => {
    const src = typeScriptSource(PLUGIN_STORE);
    expect(src).not.toContain("open: false");
    // 留着会出两个真身，而它们可以一个说开一个说关。
    expect(src).not.toMatch(/\bopen:\s*false/);
  });
});

describe("usePluginStore · 动作之后必须重列（未受本批次影响，照钉）", () => {
  it("成败都重列：失败时界面要回到真身说的那一态，不能停在乐观的假象上", () => {
    const src = typeScriptSource(PLUGIN_STORE);
    const run = /async runAction\([\s\S]*?\n {4}\}/.exec(src)?.[0] ?? "";
    expect(run, "runAction 读不到").not.toBe("");
    const finallyBlock = /finally \{[\s\S]*?\n {6}\}/.exec(run)?.[0] ?? "";
    expect(finallyBlock, "runAction 里没有 finally").toContain("await this.refresh()");
  });

  it("卸载完要把预览里那份源码也清掉（它已经不存在了，留着是骗人）", () => {
    const src = typeScriptSource(PLUGIN_STORE);
    const body = /async uninstall\([\s\S]*?\n {4}\}/.exec(src)?.[0] ?? "";
    expect(body).toContain("delete this.sources[dirName]");
  });

  it("源码预览是点了才去读，不预取（几十个插件全读一遍会把启动拖慢）", () => {
    const src = typeScriptSource(PLUGIN_STORE);
    expect(src).not.toContain("await window.mochen.readPluginSource(dirName); // 预取");
    const onMounted = /openSource\([\s\S]*?readPluginSource/.exec(src)?.[0] ?? "";
    expect(onMounted).not.toBe("");
  });
});

describe("useSkillMarketStore · 装卸完两张表都要刷（未受本批次影响，照钉）", () => {
  it("市场**和**技能库都刷——后者是 agent store 的另一张表，漏刷它用户看不到新技能", () => {
    const src = typeScriptSource(MARKET_STORE);
    const runInstall = /async runInstall\([\s\S]*?\n {4}\}/.exec(src)?.[0] ?? "";
    expect(runInstall, "runInstall 读不到").not.toBe("");
    expect(runInstall).toContain("await this.refresh();");
    expect(runInstall).toContain("await useAgentStore().refreshSkills();");
    // 两句都在 finally 里：成败都要刷。漏了失败那一次，下次重开页面还是旧的表。
    const finallyBlock = /finally \{[\s\S]*?\n {6}\}/.exec(runInstall)?.[0] ?? "";
    expect(finallyBlock, "runInstall 里没有 finally").toContain("this.refresh()");
    expect(finallyBlock).toContain("refreshSkills()");
  });
});

describe("挂入技能 ⇒ 这一轮真的发得出去（2026-10-07 真机撞出来的产品缺陷）", () => {
  /**
   * 真机症状：`useAgentStore.startTurn` 把 `skillPathsOf()` 直接递过 IPC，
   * 而那是 Vue 的 reactive **Proxy** —— 结构化克隆拒收，报 `An object could not be cloned.`
   * ⇒ 只要挂入技能，**发任何一轮都起不来**。单测抓不到是因为它们传纯数组。
   *
   * 修法在 preload 的收口处（那里出网，一条通道一个出口），所以
   * 「每条通道都走了那一个收口」这条形状守卫住在 **`preload/renderer-api.test.ts`**——
   * 渲染层的 `vue-source-reader` 把路径解到 `renderer/src`，够不到 `src/preload`。
   */
  it("占用条喂的是真实挂入名单——它那句「显示的就是这一轮真会发出去的」不许再是假的", () => {
    const script = scriptSource("components/ContextMeter.vue");
    expect(script).toContain("pinned: agent.skillPathsOf(threadKeyFor(book.activeDocTab))");
    // 反向钉：写死的空数组就是这次缺陷的温床（空数组恰好是可克隆的普通数组，
    // 于是缺陷在占用条这一侧完全隐形，直到有人给它喂上真的名单才炸）。
    expect(script).not.toContain("pinned: [] as readonly string[]");
  });

  it("这一页算「已挂入」时喂的也是当前线程的名单（挂入是每条线程的事）", () => {
    const script = scriptSource(PAGE);
    expect(script).toContain("threadKeyFor(book.activeDocTab)");
    expect(script).toContain("pinned: agent.skillPathsOf(threadKey.value)");
  });
});

describe("浮层合成器 · 底线还在服务别的浮层（旧守卫里与技能库无关的那一半）", () => {
  it("合成器取 min(limitPx, spacePx)，贴着窗口下沿也不会跑出屏幕", () => {
    const src = typeScriptSource("composables/useComposerContextPopover.ts");
    // 【为什么要钉这一整句而不是只钉 limitPx 存在】limitPx 在、但合成器改回只用
    // maxHeightPx，那个数就完全没用（面板还是默认那档）；反过来合成器写成
    // min(limitPx, 999999) 也不行——那就没有底线了。所以钉的是**这一行算式本身**。
    // 5-㉛ 起技能库与插件都不再用这个合成器，但对话上下文菜单那一类还在用。
    expect(src).toContain(
      "maxHeight: `${Math.min(options?.limitPx ?? POPOVER_MAX_HEIGHT, p.spacePx)}px`"
    );
  });
});

describe("extensions.css · 形状", () => {
  it("模板用到的 class 都得有规则：漏一条在窄屏上就是一块没样式的裸文本", () => {
    const css = strippedStyleSource("extensions.css");
    for (const selector of [
      ".extensions-page",
      ".extensions-head",
      ".extensions-title",
      ".extensions-close",
      ".extensions-tools",
      ".extensions-search",
      ".extensions-search-input",
      ".extensions-search-go",
      ".extensions-filters",
      ".extensions-filter",
      ".extensions-notice",
      ".extensions-body",
      ".extensions-note",
      ".extensions-empty",
      ".extensions-grid",
      ".extension-card",
      ".extension-card-head",
      ".extension-icon",
      ".extension-card-title",
      ".extension-card-origin",
      ".extension-badge",
      ".extension-card-desc",
      ".extension-card-warn",
      ".extension-card-foot",
      ".extension-card-tags",
      ".extension-card-actions",
      ".extension-btn",
      ".extension-card-source",
      ".extension-card-more"
    ]) {
      expect(css, `样式表里没有 ${selector}`).toContain(selector);
    }
  });

  it("本页只占中栏那一格：**.extensions-page 不许再有 grid-column: 1 / -1**", () => {
    // 5-㉛ 整页那一版为跨满三栏加过这一条。真机点进去左栏整个消失，
    // 用户指正「侧边栏还是有的，旁边变成技能库或插件」⇒ 必须撤掉。
    // 留着它会让中栏那一页又铺满整个窗口——正是被指正的那个症状换个写法复发。
    const css = styleSource("extensions.css");
    expect(ruleBlock(css, ".extensions-page")).not.toContain("grid-column: 1 / -1");
    expect(ruleBlock(css, ".extensions-page")).not.toContain("100vw");
    // 而中栏是 minmax(320px, 1fr)：grid item 不给 min-width: 0 就不肯缩到内容宽。
    expect(ruleBlock(css, ".extensions-page")).toContain("min-width: 0;");
    // 反向：desktop-shell 哪天不是三列 grid 了，这条就该重写而不是继续通过。
    const shell = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(shell).toContain(".desktop-shell {");
    expect(shell).toContain("grid-template-columns:");
  });

  it("内容区自己滚，且肯缩：不给 min-height: 0 它就不肯缩，卡片一多就把页面撑到视口外", () => {
    // 逐条规则匹配而不是 `css.toContain("min-height: 0")`：这个文件里那两个字眼就写在
    // 注释里（「min-height: 0 不是可选的」），而 vue-source-reader 的 styleSource
    // 只剥选择器那一侧的注释，不剥规则正文里的——块级断言会被注释喂饱。
    const css = styleSource("extensions.css");
    expect(ruleBlock(css, ".extensions-page")).toContain("min-height: 0;");
    const body = ruleBlock(css, ".extensions-body");
    expect(body).toContain("min-height: 0;");
    expect(body).toContain("overflow-y: auto;");
  });

  it("卡片网格用 auto-fill + minmax：宽屏多列、中栏那一格排得下，都不必另写断点", () => {
    const block = ruleBlock(styleSource("extensions.css"), ".extensions-grid");
    expect(block).toContain("grid-template-columns: repeat(auto-fill, minmax(");
    // 卡片必须是 grid item 上带 min-width: 0，否则一个长插件名会把徽标顶出卡片。
    expect(ruleBlock(styleSource("extensions.css"), ".extension-card")).toContain("min-width: 0;");
  });

  it("样式表里不许再引用已退役的两个浮层的 class：留着就是一份没人渲染的规则", () => {
    const css = strippedStyleSource("extensions.css");
    expect(css).not.toContain(".skill-browser");
    expect(css).not.toContain(".plugin-panel");
  });

  it("出处与警告**不复用**说明文字那三行截断——出处被截一半等于没写，警告被截一半等于没警告", () => {
    const css = styleSource("extensions.css");
    expect(ruleBlock(css, ".extension-card-desc")).toContain("-webkit-line-clamp: 3;");
    const warn = ruleBlock(css, ".extension-card-warn");
    expect(warn, "警告没有撤掉截断").not.toContain("-webkit-line-clamp");
    expect(warn, "警告没有撤掉截断").not.toContain("-webkit-box");
  });

  it("出处与许可**一律不许截**，连省略号都不许（真机量到只剩「改编自 linhut/dsh-skills …」）", () => {
    // 真机症状：出处那行原是 `white-space: nowrap` + `text-overflow: ellipsis`，
    // 于是「改编自 linhut/dsh-skills 的 brainstorming（源自 obra/superpowers, MIT）· MIT」
    // 只剩「改编自 linhut/dsh-skills ...」——用户既不知道抄自哪个仓库、也不知道按什么许可发布。
    const origin = ruleBlock(styleSource("extensions.css"), ".extension-card-origin");
    expect(origin, "出处被截断了").not.toContain("text-overflow");
    expect(origin, "出处被截断了").not.toContain("white-space: nowrap");
    expect(origin, "出处被截断了").not.toContain("-webkit-line-clamp");
    // 反向：标题**可以**截（那是名字，截了还能看 tooltip）；出处不行。
    expect(ruleBlock(styleSource("extensions.css"), ".extension-card-title strong")).toContain(
      "text-overflow: ellipsis"
    );
  });

  it("出处那块不给底色、卡片头贴顶：附属信息靠字号与颜色退后，徽标不许压住它", () => {
    // 先给过 `color-mix(... 5%, transparent)` 的浅底，真机截图看下来它比标题还重——
    // 一块三行的灰底把卡片压住了。
    const origin = ruleBlock(styleSource("extensions.css"), ".extension-card-origin");
    expect(origin, "出处不该有底色").not.toContain("background");
    // 出处三行时居中会把徽标压到第二三行上——徽标盖住出处，
    // 正是「出处被截一半等于没写」那个毛病换个姿势复发。
    const head = ruleBlock(styleSource("extensions.css"), ".extension-card-head");
    expect(head).toContain("align-items: flex-start;");
    expect(head, "徽标会压在出处上").not.toContain("align-items: center;");
  });

  it("「已停用」与两枚技能徽标不许上 accent——accent 是「当前生效」的语义", () => {
    const css = styleSource("extensions.css");
    // 给一个还没装的、或只是躺在盘上的条目上了 accent，用户会以为它已经在起作用了。
    for (const selector of [".extension-badge.is-stopped", ".extension-badge.is-quiet"]) {
      expect(ruleBlock(css, selector), `${selector} 用了 accent`).not.toContain("var(--accent)");
    }
    expect(ruleBlock(css, ".extension-badge.is-on")).toContain("var(--accent)");
  });

  it("正文预览自己限高并滚动：不然一条五千字的技能会把整个页面撑到视口外", () => {
    const block = ruleBlock(styleSource("extensions.css"), ".extension-card-source");
    // 必须匹配到**一个像素值**而不是只匹配 `max-height:` 这三个字母——
    // `max-height: none` 也含那三个字母，于是「不限高」这条缺陷会全绿（变异 #22 实测）。
    expect(block, "没有一条像素级的高度上限").toMatch(/\bmax-height:\s*\d+px/);
    expect(block).toContain("overflow-y: auto;");
    expect(block).toContain("white-space: pre-wrap;");
  });
});

/// <reference types="node" />
/**
 * 源码契约测试（F-C）：本仓没有 jsdom / @vue/test-utils，`.vue` 的模板与接线够不着运行时断言，
 * 于是沿用 utils/hotkey-markers.test.ts 的源码读取方式（一份真身：utils/vue-source-reader.ts，
 * 抽 `<template>` / `<script setup>` 并剥掉注释——只活在注释里的字符串不算数），
 * 把「主操作各调一个真身」钉成可失败的断言：
 * ① 各段的 data-nav-id 在模板里真实存在；② handler 调的是**真身函数名**
 * （layout.showSettings / agent.clearThreadView / layout.openNewBook），不是另捏一份打开逻辑（§2.7）；
 * ③ 全部可点、点哪都有真响应（2026-10-04 二次裁定）：四态判定在 childState（side-nav 纯函数打底），
 * 占位/引导统一走响应对话框（SideNavNoticeDialog）；④「同源」：设置入口只剩 footer 齿轮一个门面、
 * 同一个真身（openSettingsOverlay → layout.showSettings()），中栏不得有第二份。
 * 2026-10-04 演示图裁定：功能导航分组化（完整按图 + 诚实占位），表与占位判定的真身在 utils/side-nav.ts。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const script = scriptSource("components/LeftSidebar.vue");
const template = templateSource("components/LeftSidebar.vue");

describe("LeftSidebar · 主操作各调一个真身（F-C，§2.7）", () => {
  it("「打开作品目录」入口已按裁定退役：左栏不再有该行；同一真身仍由书架空态钮、输入卡书格与 Ctrl+O 消费", () => {
    expect(template).not.toContain('data-nav-id="open-book"');
    expect(template).not.toContain("打开作品目录");
    expect(template).not.toContain("<kbd>Ctrl O</kbd>");
    // 通路没死：pickAndOpen 的消费者各钉一处（BookWorkbench 空态钮 / ComposerContextBar 书格；
    // Ctrl+O 的接线由 utils/hotkeys.test.ts 与 useHotkeys 的用例负责）。
    expect(templateSource("components/BookWorkbench.vue")).toContain("workbench-open-book");
    expect(scriptSource("components/ComposerContextBar.vue")).toContain("book.pickAndOpen()");
  });

  it("「模型配置」入口已按裁定退役：模型配置住设置中心的模型面板，左栏不再有该行", () => {
    expect(template).not.toContain('data-nav-id="model-config"');
    expect(template).not.toContain("模型配置");
  });

  it("子项 data-nav-id 语义化 + 文案诚实：模板只调 helper", () => {
    // 「写作」组（AI 写作 / 章节编辑器）2026-10-23 已删；同一天「审核检查」组也迁成内置技能，
    // 所以左栏不再有「缺章去开一章」这条引导（needChapterState 已删）。下面几条通用约束仍成立。
    expect(template).toContain(':data-nav-id="navIdOf(group, child)"');
    expect(script).toContain('if (child.reality.kind === "action") return child.reality.action;');
    expect(template).toContain(':title="childState(child).hint"');
    expect(template).not.toContain(':disabled="childState(child).disabled"');
    // 反向：缺章引导整条退场（连同它的文案）。
    expect(script).not.toContain("去开一章");
    expect(script).toContain("guideToDoc(state.docKind)");
  });

  it("同源断言：设置入口只剩 footer 齿轮一个门面（导航行已退役），中栏不持有第二份开关（评审 T8-2）", () => {
    const center = vueSource("components/CenterColumn.vue");
    // 正向：唯一门面挂 openSettingsOverlay，它调 layout.showSettings()——唯一真身。
    expect(countNeedle('@click="openSettingsOverlay"', template)).toBe(1);
    const body = /function openSettingsOverlay\(\): void \{[\s\S]*?\}/.exec(script)?.[0] ?? "";
    expect(body).toContain("layout.showSettings()");
    // 反向：不许为门面另捏一份打开逻辑（第二处真相）。
    expect(countNeedle("layout.showSettings()", script)).toBe(1);
    // 中栏不许有自己的局部开关——钉的是写形式 `showSettings.value = `。
    // 2026-10-05 放宽一处：模型浮层的失败态「去模型设置」出口合法地走 layout 真身
    // （center-header-actions.test.ts 钉住它只此一处且带 "model" 参数），
    // 但裸调 layout.showSettings() 这一路仍然只许左栏 footer 齿轮一处。
    expect(center).not.toContain("showSettings.value = ");
    expect(countNeedle("layout.showSettings()", center)).toBe(0);
  });

  it("导航区「设置」行已按裁定退役：与底部齿轮重复；且其 is-active 态本就永远点不亮（整页视图已卸载本组件）", () => {
    expect(template).not.toContain('data-nav-id="settings"');
    expect(template).not.toContain(":class=\"{ 'is-active': layout.currentView === 'settings' }\"");
    // 反向鉴别：不是把行删了而忘了留门面——settings 字形只剩 footer 齿轮那一个（:size="16"），
    // 导航行连同它的「设置」文案一并消失。
    expect(countNeedle('name="settings"', template)).toBe(1);
    expect(template).toContain('<AppIcon name="settings" :size="16" />');
    expect(template).not.toContain("<span>设置</span>");
  });
});

describe("LeftSidebar · 功能导航（2026-10-04 演示图裁定：完整按图 + 诚实占位）", () => {
  it("导航表是唯一真身：组件 import SIDE_NAV_GROUPS，模板不抄第二份子项清单", () => {
    expect(script).toContain('from "../utils/side-nav"');
    expect(template).toContain('v-for="group in SIDE_NAV_GROUPS"');
    // 反向：子项 label 不许在组件里再枚举一份（表在 utils，组件只渲染）。
    expect(template).not.toContain("世界观");
    expect(template).not.toContain("审核检查");
  });

  it("工作台是视图直达：调 layout 真身，active 态绑「在工作区**且**中栏在对话」（设置由 footer 齿轮进，不占导航行）", () => {
    expect(template).toContain('data-nav-id="workspace"');
    // showWorkspace 挂在工作台行的 @click 上（视图直达），active 态绑 currentView。
    expect(template).toContain('@click="layout.showWorkspace()"');
    // 【5-㉜ 改钉】原先只绑 `currentView === 'workspace'`。5-㉛ 把技能库/插件做成整页时
    // 这条仍然成立，可 5-㉜ 用户指正「侧边栏还是有的，旁边变成技能库或插件」——
    // 于是技能库/插件换的是**中栏**，`currentView` 仍是 workspace。
    // 不加 `centerView === 'chat'` 的话，左栏会同时亮「工作台」与「技能库」两枚，
    // 而亮着的那一枚正是在说「你在这儿」——两枚同时亮，用户只会当成渲染坏了。
    //
    // 【为什么用正则而不是整串字面量】prettier 会按 printWidth 100 把这条属性折成多行，
    // 写整串 `toContain(...)` 的话，红的原因会变成「格式变了」而不是「判定变了」。
    // `\s+` 吃掉那个换行，两边都只关心判定本身。
    expect(template).toMatch(
      /'is-active': layout\.currentView === 'workspace' &&\s+layout\.centerView === 'chat'/
    );
  });

  it("「AI 智能体」一级项已按裁定退役：左栏不再有该行；面板展开真身留给两个台账动作", () => {
    // 2026-10-04 三次裁定：该行与「AI 写作」重复、是摆设——删行不删真身。
    // 2026-10-23：审核四项迁出导航表（改为内置技能），aiCheckOf 分派删除；
    // revealAgentPanel 改由伏笔台账 / 时间线核对两个动作消费，真身仍在。
    // 2026-11-09：那两次调用收成 action 分派里**共用的一次前置**（先展右栏、再判是哪枚台账），
    // 于是先后次序反过来。这里钉的是「共用真身仍在，且发生在台账分派之前」，
    // 而不是旧代码里那一条已经不成立的次序。
    expect(template).not.toContain('data-nav-id="agent"');
    expect(script).not.toContain('data-nav-id="agent"');
    expect(script).toContain("function revealAgentPanel(): void");
    expect(script).toContain('layout.setPaneCollapsed("right", false)');
    expect(script).not.toContain("aiCheckOf");
    const actionDispatch = script.slice(script.indexOf('if (child.reality.kind === "action")'));
    expect(actionDispatch).toMatch(/revealAgentPanel\(\);[\s\S]*?foreshadow-ledger/);
  });

  it("「去开一章」引导随 AI 检查迁出：needChapterState 删除，缺章规则只剩 side-nav 一处（5-㊳→2026-10-23）", () => {
    // 【这条决定是 2026-10-07 批次 5-㊳ 立的】
    // 当时三处「去开一章 / 先建一章」引导收进 needChapterState 一处真身：没打开作品时
    // 改走 need-book 对话框（打开目录 = Ctrl+O，新建作品 = 组头「+」，两项现成真身）。
    //
    // 2026-10-23：审核四项改为内置技能后，左栏再没有「动作类但要求当前章」的子项——
    // needChapterState 连同它的唯一调用一并删除。规则本身（一篇文档都没有 = 大概率没打开作品）
    // 仍只留在 `utils/side-nav.ts` 的 sideNavChildState 一处，组件只调它、不另写一份。
    expect(script).not.toContain("needChapterState");
    expect(script).not.toContain('mode: "need-doc", docKind: "chapter"');
    expect(script).toContain("sideNavChildState(child, book.docs)");
  });

  it("数据统计已落地（深夜裁定）：真功能 openStats，表格数字来自 book.docs 聚合", () => {
    // stats 是 action 真身：点击写 notice（stats 形态），数据在组件里从 docs 聚合。
    // 【2026-10-11】按钮本体随整组低频入口搬进了 LibraryNavRows（折叠壳也一起搬），
    // 所以这枚断言现在跨两个文件成立：**按钮在 LibraryNavRows、响应在 LeftSidebar**，
    // 两者由 `@stats="openStats"` 那一处接上——钉的是这条接线，不是按钮待在哪。
    const library = vueSource("components/LibraryNavRows.vue");
    expect(library).toMatch(/data-nav-id="stats"[\s\S]*?@click="emit\('stats'\)"/);
    // W-05 给这枚壳加了 `:require-book`（存稿仪表的闸门）；把空白压平后再钉整条接线，
    // 免得「少了哪一枚监听」被换行掩盖。
    const flat = template.replace(/\s+/g, " ");
    expect(flat).toContain(
      '<LibraryNavRows :require-book="requireBook" @open="openLibraryDialog" @stats="openStats" />'
    );
    // 提示文案读 side-nav 那一份真身（按钮搬到了 LibraryNavRows，真身没搬走）。
    expect(library).toContain(':title="STATS_HINT"');
    expect(script).toContain("function openStats(): void");
    // 2026-10-10 下沉：聚合真身住 utils/stats-rows.ts（statsRowsOf），组件只调它。
    expect(script).toContain("rows: statsRowsOf(book.docs)");
    const statsUtils = vueSource("utils/stats-rows.ts");
    expect(statsUtils).toMatch(/BOOK_KIND_ORDER\.map/);
    // 数据口径诚实：字数来自扫描元数据 chars（缺省 0），不是拍脑袋数字。
    expect(statsUtils).toContain("(doc.chars ?? 0)");
    // planned 判定仍在纯函数里消费（机制保留，表里暂时没有占位实例）。
    expect(script).toContain("sideNavChildState(child, book.docs)");
  });

  it("审核四项已迁出左栏：改由内置技能在对话框里载入，左栏不再有 ai-check 分派", () => {
    // id 语义化：action 类子项平铺为 data-nav-id（navIdOf 对 action 沿用现成 id）——这条仍在。
    expect(script).toContain(
      "function navIdOf(group: { id: string }, child: SideNavChild): string"
    );
    // 2026-10-23：四项检查改为内置技能（`main/builtin-skills.ts` 落盘，模型经 use_skill 自选载入），
    // 左栏那条「展开面板 + 预填提问」的分派整条删除——组件里不再出现 aiCheckOf / AI_CHECK_PROMPTS。
    expect(script).not.toContain("aiCheckOf");
    expect(script).not.toContain("AI_CHECK_PROMPTS");
    expect(script).not.toContain("先打开一章再做检查");
  });

  it("响应对话框是导航的统一出口：planned 说规划中，need-book 两按钮各挂现成真身", () => {
    expect(template).toContain("<SideNavNoticeDialog");
    expect(script).toContain("const notice = ref<SideNavNotice | null>(null);");
    // need-book 引导的两个动作都是既有真身：打开目录与 Ctrl+O 同路，新建作品与组头「+」同路。
    expect(script).toContain("function openWorkdir(): void");
    expect(script).toContain("void book.pickAndOpen();");
    expect(script).toContain("function openNewBook(): void");
    expect(script).toContain("layout.openNewBook();");
    // need-doc 的引导：展开树分组 + 已有一篇就开第一篇 / 没有就聚到行内新建。
    expect(script).toContain("function guideToDoc(kind: BookKind): void");
    expect(script).toMatch(/guideToDoc[\s\S]*?collapsedSections\.value\[kind\] = false/);
    expect(script).toContain("void startAdding(kind);");
  });

  it("子项分派一条路：docs=展开树对应分组（写作组两项已删）", () => {
    expect(script).toContain("function onChildAction(child: SideNavChild): void");
    expect(script).toMatch(
      /docs[\s\S]*?collapsedSections\.value\[child\.reality\.docKind\] = false/
    );
    expect(script).toContain(
      "function navIdOf(group: { id: string }, child: SideNavChild): string"
    );
    expect(script).toContain("return `tree-${child.reality.docKind}`");
  });

  it("点树行 / 新建：右栏折着时先展开，否则开了也看不见（2026-10-23）", () => {
    // 右栏折叠时（窄窗自动收 / 用户手动收），openDocTab 只是把标签塞进看不见的那一栏，
    // 界面上唯一的反馈是树行亮了——真机读到的就是「点了一行，正文没出来」。
    // 三条入口都先 layout.setPaneCollapsed("right", false)，与 AI 检查先展开右栏同一条约定。
    const entries: Array<[string, RegExp]> = [
      ["activate", /function activate\(kind: BookKind, relPath: string\)[\s\S]*?\n\}/],

      ["confirmAdding", /async function confirmAdding\(\)[\s\S]*?\n\}/]
    ];
    for (const [name, pattern] of entries) {
      const body = pattern.exec(script)?.[0] ?? "";
      expect(body, `${name} 没找到`).not.toBe("");
      expect(body, `${name} 要先展开右栏`).toContain('layout.setPaneCollapsed("right", false)');
    }
  });

  it("品牌区与底部标语逐字照图：副标题在品牌两行里，标语在 footer 右列", () => {
    expect(template).toContain("{{ BRAND_TAGLINE }}");
    expect(template).toContain('class="brand-tagline"');
    expect(template).toContain('class="footer-tagline"');
    expect(template).toContain("{{ FOOTER_TAGLINE }}");
  });

  it("「我的作品」组：文稿树住组内，组头「+」仍是新建作品真身（data-nav-id=new-book 保留）", () => {
    expect(template).toContain('data-nav-id="works"');
    expect(script).toContain("const worksOpen = ref(true)");
    expect(template).toContain('data-nav-id="new-book"');
    expect(script).toContain("layout.openNewBook()");
    // 树的三件套（分组折叠/行尾菜单/行内新建）在组体内原样保留。
    expect(template).toContain('class="resource-section"');
    expect(template).toContain('class="tree-node-action-area"');
    expect(template).toContain('class="tree-add-input"');
  });

  it("CSS 逐条对值：子项行缩进 + 徽标 + 选中态 + 标语省略号", () => {
    const css = styleSource("left-nav.css");
    const subrow = ruleBlock(css, ".nav-subrow");
    expect(subrow).toContain("padding: 0 9px 0 30px;");
    expect(subrow).toContain("grid-template-columns: 14px minmax(0, 1fr) auto;");
    expect(ruleBlock(css, ".nav-row.is-active")).toContain("background: var(--selected);");
    expect(ruleBlock(css, ".nav-soon")).toContain("border-radius: 8px;");
    const tagline = ruleBlock(css, ".footer-tagline");
    expect(tagline).toContain("text-overflow: ellipsis;");
    expect(tagline).toContain("justify-self: end;");
  });

  /**
   * 2026-10-23（第二刀）：「定位」签随 9 个跳树子项一起撤销。子项行仍是三列栅格
   * （字形 / 名字 / 签），只是只剩「规划中」那一种签了；这一条钉的是「签确实撤干净了」，
   * 免得留下一个指向已删函数的绑定或一条没人消费的样式。
   */
  it("「定位」签已撤：组件 / 模板 / 样式表三处都不再出现它，子项行仍是三列栅格", () => {
    expect(script).not.toContain("sideNavLocateTag");
    expect(template).not.toContain("nav-locate");
    const css = styleSource("left-nav.css");
    expect(css).not.toContain(".nav-locate");
    // 子项行仍是三列：字形 / 名字 / 签（只剩「规划中」那一枚）。
    expect(ruleBlock(css, ".nav-subrow")).toContain(
      "grid-template-columns: 14px minmax(0, 1fr) auto;"
    );
    // 名字仍只来自那份表：子项文案里不许出现第二份「素材库」这类手写别名。
    expect(template).toContain("{{ childState(child).label }}");
  });
});

describe("LeftSidebar · 书名与工作目录这一行（#103b：示意稿 B 顶栏的两条事实）", () => {
  // 载体钉（M5 同律）：值在 script 里算好不等于进了 DOM，所以来源与插值各钉一次。
  it("开书才有这一行：书名与绝对路径都读 store，且它是字不是按钮", () => {
    expect(script).toContain("book.meta && book.rootPath");
    const block = /<div v-if="workdirFallback"[\s\S]*?<\/div>/.exec(template)?.[0] ?? "";
    expect(block).toContain('class="sidebar-workdir"');
    expect(block).toContain("{{ workdirFallback.title }}");
    // 字面只留尾部两段（2026-10-22：「C:\Users\17863\Downloa…」把真正想看的目录名截没了）；
    // 完整路径退到 title，悬停仍能读到全称。
    expect(block).toContain("工作目录：{{ shortenRootPath(workdirFallback.rootPath) }}");
    expect(block).toContain(':title="workdirFallback.rootPath"');
    expect(script).toContain('from "../utils/book-path"');
    // 这一行没有动作可谈 ⇒ 不许长出按钮或链接（点了没反应的 button 就是摆设）。
    expect(block).not.toMatch(/<(button|a)\b/);
    // 反向：没开书时整行不进 DOM，也不许预先糊一个假路径上去。
    expect(template).toContain('v-if="workdirFallback"');
    expect(template).not.toContain("墨宸AI\\");
  });

  /**
   * 2026-10-23：作品库那一行已经把「当前这本 + 路径 + 正在写」摆全了，
   * 紧接着再摆一遍同样的书名与路径，真机上就是两个「海雾手记」上下叠着（一个能点、一个不能点）。
   * 这一行现在只做清单未回填时的补位，判据必须是「清单里有没有这本」，不是「开没开书」。
   */
  it("作品库清单里已经有这本时不再补位：同一件事只说一遍", () => {
    expect(script).toContain("book.recentBooks.some(");
    expect(script).toContain("entry.rootPath === open.rootPath");
    expect(script).toContain("return listed ? null : open;");
  });
});

describe("LeftSidebar · 底部齿轮行（#113b：对齐 deepwrite 的 .sidebar-footer，作者那一格缺契约不复用）", () => {
  const footer = /<footer class="sidebar-footer">[\s\S]*?<\/footer>/.exec(template)?.[0] ?? "";

  it("footer 真挂在滚动区之后——它填的正是 .left-sidebar 预留的那格 58px 行", () => {
    expect(footer).not.toBe("");
    expect(template.indexOf('class="sidebar-scroll')).toBeLessThan(template.indexOf("<footer"));
    expect(template.indexOf("<footer")).toBeLessThan(template.lastIndexOf("</aside>"));
  });

  it("齿轮是钮不是装饰：类名、无障碍标签、字形、真身动作一次钉全", () => {
    expect(footer).toContain('class="icon-button account-settings-button"');
    expect(footer).toContain('aria-label="打开设置"');
    expect(footer).toContain('title="设置"');
    expect(footer).toContain('<AppIcon name="settings" :size="16" />');
    expect(footer).toContain('@click="openSettingsOverlay"');
  });

  it("作者那一格缺契约 ⇒ 不复用：footer 里只许一枚齿轮 + 引导入口 + 一句标语，不许长出头像或账号菜单", () => {
    // 反向鉴别：不先钉「footer 有且只有一枚按钮」，下面这几条 notMatch 在 footer 根本不存在时会空转通过。
    // （2026-11-20：引导的「?」入口搬进来后，footer 里有一枚齿轮按钮 + 一枚组件化的「?」——
    //   「?」是组件标签不是 <button>，所以下面这一条数 <button> 仍是 1。）
    expect(countNeedle("<button", footer)).toBe(1);
    expect(footer).not.toMatch(/avatar|account-profile|account-menu|account-identity|account-copy/);
    expect(footer).not.toContain("作者");
    expect(footer).not.toMatch(/<(a|input|select)\b/);
    // 右列是品牌标语（演示图逐字），不是第二份可点的东西。
    expect(footer).toContain('class="footer-tagline"');
  });

  it("引导入口在 footer 里：组件化的「?」钮调 onboarding.reopen()（此前 reopen 全仓零生产调用方）", () => {
    expect(footer).toContain("<SidebarHelpButton />");
    const help = vueSource("components/SidebarHelpButton.vue");
    expect(help).toContain("onboarding.reopen()");
    expect(help).toContain('aria-label="使用引导"');
  });

  it("CSS 逐条对值：footer 的 7px 内边距与上分隔线、controls 的三列（齿轮 → 引导「?」 → 标语）", () => {
    const css = styleSource("left-nav.css");
    const footerRule = ruleBlock(css, ".sidebar-footer");
    expect(footerRule).toContain("display: flex;");
    expect(footerRule).toContain("align-items: center;");
    expect(footerRule).toContain("padding: 7px;");
    expect(footerRule).toContain("border-top: 1px solid var(--line-soft);");
    const controlsRule = ruleBlock(css, ".account-controls");
    expect(controlsRule).toContain("display: grid;");
    // 三列：齿轮（32px）+ 引导「?」（32px）+ 标语（1fr）。
    expect(controlsRule).toContain("grid-template-columns: 32px 32px minmax(0, 1fr);");
    expect(controlsRule).toContain("gap: 4px;");
    expect(controlsRule).toContain("width: 100%;");
    // 齿轮钉在第一列（左端，用户裁定挪到另一边，对齐 VS Code / Obsidian 设置在左下的惯例）。
    expect(ruleBlock(css, ".account-settings-button")).toContain("grid-column: 1;");
    expect(ruleBlock(css, ".account-help-button")).toContain("grid-column: 2;");
    expect(ruleBlock(css, ".footer-tagline")).toContain("grid-column: 3;");
  });

  it("settings 字形只剩 footer 齿轮一处门面，「模型」立方图标已随「模型配置」行退役", () => {
    expect(template).not.toContain('name="model"');
    expect(countNeedle('name="settings"', template)).toBe(1);
  });

  it("化石清账：作者那一格那五条规则连同 theme-runtime 的 :where 条目一起删净", () => {
    const css = styleSource("left-nav.css");
    const runtime = styleSource("theme-runtime.css");
    for (const dead of [
      "account-profile",
      "account-row",
      "account-copy",
      "account-menu",
      "avatar"
    ]) {
      // 只钉「规则形」（选择器后面跟 { 或 ,）：styleSource 不剥注释，我在台账注释里提这些名字是说明，
      // 不是死样式——按裸串钉会让自己的注释把断言弄红。
      expect([dead, new RegExp(`\\.${dead}\\s*[{,]`).test(css)]).toEqual([dead, false]);
      expect([dead, new RegExp(`\\.${dead}\\b`).test(runtime)]).toEqual([dead, false]);
    }
  });

  it("死样式清账：导航并组后退役的 .new-book-nav / .scrollable-primary-nav 删净（零消费者不留尸）", () => {
    const css = styleSource("left-nav.css");
    expect(css).not.toMatch(/\.new-book-nav\s*[{,]/);
    expect(css).not.toMatch(/\.scrollable-primary-nav\s*[{,]/);
  });
});

describe("LeftSidebar · 新建通路（行内新建 + 新建作品对话框）", () => {
  it("「新建作品」挂「我的作品」组头「+」，调 layout.openNewBook()——开合真身唯一", () => {
    expect(template).toContain('data-nav-id="new-book"');
    expect(script).toContain("layout.openNewBook()");
    // 反向：模板里不许自己捏 layout.newBookOpen = true 的第二份写入口。
    expect(template).not.toContain("newBookOpen = true");
  });

  it("每个文稿分组标题挂一枚「+」，说明来自 newDocButtonTitle（文案唯一真身在 utils/new-doc）", () => {
    expect(template).toContain('class="section-add"');
    expect(script).toContain("newDocButtonTitle");
    expect(template).toContain('name="plus" :size="13"');
    // 判定不落在模板：planDocRelPath / sanitize 不许在组件里被直接调。
    expect(template).not.toContain("planDocRelPath");
    expect(template).not.toContain("sanitizeDocFileName");
  });

  // 5-㊶：两个输入框的裁决共用一个工厂 textRowKeydown（只有 confirm/cancel 不同）。
  // 2026-10-10 下沉：工厂本体住 utils/text-row-keydown.ts，形状钉在那边；组件钉两条接线。
  const addHandler =
    /export function textRowKeydown[\s\S]*?\n {2}\};\n\}/.exec(
      vueSource("utils/text-row-keydown.ts")
    )?.[0] ?? "";

  it("行内新建行：Enter 确认 / Esc 取消，确认钮在判定不过关时 disabled", () => {
    expect(template).toContain('class="tree-add-input"');
    // 5-㊶：模板修饰符换成单一入口——组合态那一键必须原样还给输入法（见 fix-stage2 的理由）。
    expect(template).toContain('@keydown="onAddKeydown"');
    expect(template).not.toContain("@keydown.enter.prevent");
    expect(addHandler).toContain("if (imeOwnsKey(event)) return;");
    // 工厂体里只有 confirm()/cancel()，具体动作接在这一行 —— 接线也要钉，否则会有人另写一份。
    expect(script).toMatch(
      /const onAddKeydown = textRowKeydown\(\(\) => void confirmAdding\(\), cancelAdding\);/
    );
    expect(addHandler.indexOf("imeOwnsKey(event)")).toBeLessThan(
      addHandler.indexOf("event.preventDefault()")
    );
    expect(script).toContain("const onAddKeydown = textRowKeydown(");
    expect(script).toContain("const onRenameKeydown = textRowKeydown(");
    expect(template).toMatch(/tree-add-confirm[\s\S]*?:disabled="addingPlan\?\.ok !== true"/);
    // 失焦即取消：别让半截输入永久挂在树上。
    expect(template).toContain('@blur="cancelAdding"');
  });

  it("确认走 book.createDoc(kind, title)，且先读后清——取消不许吞字（顺序钉死）", () => {
    const body = /async function confirmAdding[\s\S]*?\n\}/.exec(script)?.[0] ?? "";
    expect(body).not.toBe("");
    const readPos = body.indexOf("newDocTitle.value");
    const clearPos = body.indexOf("cancelAdding()");
    expect(readPos).toBeGreaterThan(-1);
    expect(clearPos).toBeGreaterThan(readPos);
    expect(script).toContain("book.createDoc(kind, title)");
  });

  it("对话框真身只挂 App.vue 一处，v-if 读 layout.newBookOpen", () => {
    const app = vueSource("App.vue");
    expect(countNeedle("<NewBookDialog", app)).toBe(1);
    expect(app).toMatch(/<NewBookDialog v-if="newBookOpen"/);
    // 左栏与工作台只开不关：关闭回调统一走 layout.closeNewBook()。
    expect(app).toContain('@close="layout.closeNewBook()"');
  });

  it("工作台无书降级区两枚入口：打开与新建并存，且新建也走 layout.openNewBook()", () => {
    const bench = vueSource("components/BookWorkbench.vue");
    expect(bench).toContain('class="workbench-empty-actions"');
    // 数类名而不是数 `class="workbench-open-book"` 那句精确字符串：修饰类（is-primary）
    // 加进来就会把精确匹配打破，可入口数量本身没变。意图是"两枚都在"，不是"两个 class 长得一样"。
    expect(countNeedle("workbench-open-book", bench)).toBe(2);
    // 主次分明：两枚里恰好一枚吃主 CTA 口径（.workbench-open-book.is-primary）。
    expect(countNeedle("workbench-open-book is-primary", bench)).toBe(1);
    expect(bench).toContain("layout.openNewBook()");
    // 文案不再指向不存在的按钮：「新建一篇」如今有真通路。
    expect(bench).toContain("或者直接建一本新书");
  });
});

/**
 * deepwrite 对齐收尾：树行的原位操作。样式全套（.tree-node-action-area / .tree-node-action-menu /
 * .tree-row.has-node-action）本就住在 left-nav.css，这里钉的是组件接线——没有接线，
 * 那些规则就是零消费者的死样式。同一铁律：判定与落盘都在 book.renameDocTitle（指纹链），
 * 组件只做开合与聚焦，不另捏一份改标题逻辑（§2.7）。
 */
describe("LeftSidebar · 树行操作菜单与行内改名（deepwrite 对齐收尾）", () => {
  // 5-㊶：改名输入框的键盘裁决改走单一入口 onRenameKeydown。工厂本体 2026-10-10
  // 下沉进 utils/text-row-keydown.ts，形状钉在那边。
  const renameHandler =
    /export function textRowKeydown[\s\S]*?\n {2}\};\n\}/.exec(
      vueSource("utils/text-row-keydown.ts")
    )?.[0] ?? "";

  it("行尾「…」区真的挂在树上：tree-row 带 has-node-action 类，动作区按钮有展开态与 Esc 关闭", () => {
    expect(template).toContain('class="tree-row has-node-action"');
    expect(template).toContain('class="tree-node-action-area"');
    // 逐属性钉（prettier 会把长标签折成多行，块级正则会被折行弄瞎）：
    // 按钮本体有 aria-expanded 随菜单开合、点击不冒泡（stop）、Esc 直接关。
    expect(template).toContain('class="tree-node-action"');
    expect(template).toContain(':aria-expanded="actionMenuFor === node.relPath"');
    expect(template).toContain('@click.stop="toggleActionMenu(node.relPath)"');
    expect(template).toContain('@keydown.esc.prevent="closeActionMenu"');
  });

  it("菜单项「改标题」调 startRenaming(node.relPath, node.title)：开合判定只有 script 一份，模板不抄第二份", () => {
    expect(template).toContain('role="menu"');
    expect(template).toContain('@click="startRenaming(node.relPath, node.title)"');
    expect(template).toContain("<span>改标题</span>");
    expect(template).toContain('<AppIcon name="edit"');
    // 判定在 script（toggleActionMenu 三元），模板不许自己写第二份开合逻辑。
    expect(template).not.toContain("actionMenuFor.value");
    expect(script).toContain("actionMenuFor.value === relPath ? null : relPath");
  });

  it("菜单项「改文件名」与改标题分两条：文件名那条调 book.renameDocFile（relPath 真的换）", () => {
    expect(template).toContain('@click="startRenamingFile(node.relPath, node.title)"');
    expect(template).toContain("<span>改文件名</span>");
    expect(script).toContain('const renameMode = ref<"title" | "file">("title")');
    const body = /async function confirmRenaming[\s\S]*?\n\}/.exec(script)?.[0] ?? "";
    expect(body).toContain("book.renameDocFile(relPath, title)");
    expect(body).toContain("book.renameDocTitle(relPath, title)");
  });

  it("行内改名行沿用 tree-add-row 形状：Enter 确认 / Esc 取消 / blur 取消，确认钮空名 disabled 且 mousedown.prevent", () => {
    const row = /<div v-if="renamingPath === node\.relPath"[\s\S]*?@click="confirmRenaming"/.exec(
      template
    )?.[0];
    expect(row).toBeDefined();
    expect(row).toContain('v-model="renameValue"');
    expect(row).toContain(':ref="setRenameInput"');
    // 5-㊶：同上。组合态里那一下回车曾会把 renameValue 里的拼音当标题落盘。
    expect(row).toContain('@keydown="onRenameKeydown"');
    expect(row).not.toContain("@keydown.enter.prevent");
    expect(renameHandler).toContain("if (imeOwnsKey(event)) return;");
    expect(script).toMatch(
      /const onRenameKeydown = textRowKeydown\(\(\) => void confirmRenaming\(\), cancelRenaming\);/
    );
    expect(renameHandler.indexOf("imeOwnsKey(event)")).toBeLessThan(
      renameHandler.indexOf("event.preventDefault()")
    );
    expect(row).toContain('@blur="cancelRenaming"');
    expect(row).toContain(":disabled=\"renameValue.trim() === ''\"");
    // mousedown.prevent：按下不抢输入框焦点（同 .format-button 那条老规矩）。
    expect(row).toContain("@mousedown.prevent");
    expect(row).toContain('aria-label="确认改标题"');
  });

  it("确认先读后清再落盘（与 confirmAdding 同序）：判定与改写全在 book.renameDocTitle", () => {
    const body = /async function confirmRenaming[\s\S]*?\n\}/.exec(script)?.[0] ?? "";
    expect(body).not.toBe("");
    const readPos = body.indexOf("const relPath = renamingPath.value");
    const clearPos = body.indexOf("cancelRenaming()");
    expect(readPos).toBeGreaterThan(-1);
    expect(clearPos).toBeGreaterThan(readPos);
    expect(body).toContain("book.renameDocTitle(relPath, title)");
  });

  it("进入改名态先关菜单再聚焦选中：startRenaming 的次序钉死，聚焦用的 ref 不许缺席", () => {
    const body = /async function startRenaming[\s\S]*?\n\}/.exec(script)?.[0] ?? "";
    expect(body).not.toBe("");
    const closePos = body.indexOf("closeActionMenu()");
    const focusPos = body.indexOf("renameInput.value?.focus()");
    const selectPos = body.indexOf("renameInput.value?.select()");
    expect(closePos).toBeGreaterThan(-1);
    expect(focusPos).toBeGreaterThan(closePos);
    expect(selectPos).toBeGreaterThan(focusPos);
    // 函数 ref（模板无法用 TS 断言）：元素真身由 setRenameInput 判定 instanceof 收下。
    expect(script).toContain("el instanceof HTMLInputElement");
  });

  it("「…」按钮是 morphicons 变形钮：菜单开 = Ellipsis 变 X，判定与开合同一份 actionMenuFor", () => {
    // 图标变形的数据真身是 lucide 的 IconNode（Ellipsis/X），组件只绑开合状态。
    expect(script).toContain('from "morphicons/vue"');
    expect(script).toContain('from "lucide"');
    expect(template).toContain("<MorphIcon");
    expect(template).toContain(':icon="actionMenuFor === node.relPath ? X : Ellipsis"');
    // 旧静态字形已清账：AppIcon 不再消费 more（化石不留）。
    expect(template).not.toContain('name="more"');
  });
});

describe("书稿体检 · AI 味一键改写（2026-10-10 二段）", () => {
  it("对话框按钮：拿当前章真扫的命中清单预填对话，不自动发送；面板展开与审核检查同一句真身", () => {
    // 2026-10-11 体量拆分：体检那一支搬进了 SideNavTermsReport.vue（八类报告 272 行模板 +
    // 整套计算，而另外五支合计不到 60 行）。**搬的是内容不是外壳**——backdrop / 焦点 / Esc /
    // 入场动画与 close / onAction 两个出口仍归 SideNavNoticeDialog，所以断言跟着内容走。
    const dialog = vueSource("components/SideNavTermsReport.vue");
    expect(dialog).toContain("async function rewriteWithAgent");
    // 展开右栏与审核检查同一路（layout.setPaneCollapsed），不许第二份「展开某栏」。
    expect(dialog).toMatch(/rewriteWithAgent[\s\S]*?setPaneCollapsed\("right", false\)/);
    expect(dialog).toContain("styleCheckPrompt(");
    expect(dialog).toContain("agent.prefillComposer(threadKeyFor(relPath)");
    // 不自动发送：只有预填，没有 send/submit——发送权留在用户手里。
    expect(dialog).not.toMatch(/agent\.\s*(send|submit)/);
    // 没开章不摆死按钮：引导去开章。
    expect(dialog).toContain('v-if="book.activeDocTab !== null"');

    // 钉住「外壳仍在父组件」：拆的是体量，不是职责。这三样若哪天也搬走了，
    // 六支形态就各自有了焦点与 Esc 的第二份实现。
    const shell = vueSource("components/SideNavNoticeDialog.vue");
    expect(shell).toContain("useModalFocus({");
    expect(shell).toContain("useDialogMotion({ root: dialogRoot");
    expect(shell).toContain("<SideNavTermsReport");
    expect(shell).toContain(':open="true"');
    // 判定不许在两边各留一份：doc-checkup 的九个检查函数只在体检那一支里 import。
    expect(shell, "父组件还留着体检的判定 import ⇒ 搬漏了或抄了第二份").not.toMatch(
      /from "\.\.\/utils\/doc-checkup"/
    );
    expect(shell, "外壳不再 import 体检的展示名与类型").not.toContain("AI_FLAVOR_CATEGORY_LABELS");
  });
});

import { describe, expect, it } from "vitest";
import {
  countNeedle,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 素材库面板的接线（2026-10-23）。
 *
 * 起因（用户原话）：「素材库就是一个空壳……它不是一个单独的界面……」。
 * 真身是一篇篇 `materials/` 文稿（导入与「AI 能读到」两条链早已在盘上：`ImportTxtDialog`
 * 可导 `material`、`agent-runtime/context.ts` ⑥ 会注入它）。缺的是**一个能把它们列出来、
 * 并给两条真动作的地方**——本面板即那一处。
 *
 * 这里钉的是**接线**：`.vue` 不进类型程序，少挂一个 anchor、少调一个 store 动作，
 * tsc 与 build 都不报，只有用户点下去才发现没通路。
 */
const buttonScript = scriptSource("components/MaterialButton.vue");
const buttonTpl = templateSource("components/MaterialButton.vue");
const panelScript = scriptSource("components/MaterialPanel.vue");
const panelTpl = templateSource("components/MaterialPanel.vue");

describe("素材库 · 入口按钮（右栏头部的锚点）", () => {
  it("开合真身是 useMaterialStore，按钮就是浮层的锚点", () => {
    expect(buttonScript).toContain(
      'import { useMaterialStore } from "../stores/useMaterialStore";'
    );
    expect(buttonScript).toContain(
      "const anchor = computed<HTMLElement | null>(() => button.value ?? null);"
    );
    // 开合动作挂在按钮上（模板里那一颗），不是脚本里另调一次。
    expect(buttonTpl).toContain("material.toggle()");
    // 浮层只在「开着 + 锚点已挂」时渲染——没有锚点就没有定位依据。
    expect(buttonTpl).toContain('<MaterialPanel v-if="material.open && anchor" :anchor="anchor"');
    expect(buttonTpl).toContain('@close="material.close()"');
  });

  it("没开作品时按钮是禁用的（素材属于某一本书）", () => {
    expect(buttonTpl).toContain(':disabled="!book.meta"');
  });
});

describe("素材库 · 浮层本体", () => {
  it("清单是派生的：kind === material 的文稿，不存第二本账", () => {
    expect(panelScript).toContain('book.docs.filter((doc) => doc.kind === "material")');
    expect(panelTpl).toContain('v-for="doc in entries"');
    // 点某一篇 → 右栏打开它（与另外三张台账同一条口径）。
    expect(panelScript).toContain("await book.openDocTab(relPath);");
  });

  it("两条真动作：导入到素材库（走既有导入通路）、让 AI 整理入库（只预填不自动发送）", () => {
    // 导入不另造一套：直接开既有的导入对话框，并**预设到「素材库」档**（2026-10-23）。
    expect(panelScript).toContain('layout.openImportTxt("material");');
    // 整理入库只预填一句指令，发送权留在用户手里（与去 AI 味 / 书稿体检同一条纪律）。
    expect(panelScript).toContain("agent.prefillComposer(");
    expect(panelScript).not.toMatch(/prefillComposer\([\s\S]{0,200}\.send\(/);
    // 本线程的键由 threadKeyFor 给，不自己拼。
    expect(panelScript).toContain("threadKeyFor(book.activeDocTab)");
  });

  it("空态是诚实的引导，不假装有素材；**没打开作品时不说「这本书」**", () => {
    expect(panelTpl).toContain('v-if="entries.length === 0"');
    // 有书那一支：说清两条下一步。
    expect(panelTpl).toContain("这本书还没有素材");
    // 没书那一支（2026-10-23 真机复验抓到：原先无论有没有书都写「这本书」，而根本没书）。
    expect(panelTpl).toContain('v-if="book.hasBook"');
    expect(panelTpl).toContain("还没打开作品——先在左栏打开一本");
  });

  it("浮层根类进了「弹层出场」动效表（overlay-chrome 从 useComposerContextPopover 反推）", () => {
    expect(panelScript).toContain("useComposerContextPopover(");
    expect(styleSource("motion.css")).toContain(".material-panel,");
  });

  it("样式表被 styles.css 引入（不引入 = 面板裸奔）", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/material-panel.css";');
  });
});

/**
 * 从网上搜（2026-10-24）。
 *
 * 用户要的是「素材库能直接从网上搜索加入进去」——不绕对话、不等模型。
 * 出网那一段在主进程（`web-search.ts` 那条源链），渲染层只递一个搜索词；
 * **写盘不另造通路**：仍走 `importTxtCommit(targetKind: "material")` 那扇门。
 */
describe("素材库 · 从网上搜", () => {
  it("搜走 window.mochen.materialsSearch，结果直接在面板里摆出来", () => {
    expect(panelScript).toContain("window.mochen.materialsSearch(query)");
    expect(panelScript).toContain("hits.value = result.hits");
    // 答上这一轮的源要报出来——结果不能看起来像凭空来的。
    expect(panelScript).toContain("searchSource.value = result.sourceLabel");
    // 一条都没有时如实说没搜着，不把空手说成「搜完了」。
    expect(panelScript).toContain("没搜着");
  });

  it("「加入素材库」走既有那条写盘通路，不另造第二套", () => {
    expect(panelScript).toContain("window.mochen.importTxtCommit(");
    expect(panelScript).toContain('targetKind: "material"');
    // 标题与正文的收口住在 utils/material-card（网页标题是别人写的，不能直接当文件名）。
    expect(panelScript).toContain("materialCardTitle(hit.title)");
    expect(panelScript).toContain("materialCardBody(hit,");
    // 落完盘把树刷一遍，否则新素材在树里不出现。
    expect(panelScript).toContain("await book.refreshDocs();");
  });

  it("没打开作品时搜不了（素材要落进某一本里）", () => {
    expect(panelTpl).toContain(':disabled="!book.hasBook || searching"');
    expect(panelTpl).toContain(':disabled="!book.hasBook"');
  });
});

/**
 * 第二刀（2026-10-24）：搜索那条路真机上没人走过一遍，于是把它当新功能重新审了一遍，
 * 逮到六处**反人类**的地方。这一组守卫钉的就是那六处——
 * 它们都不会报错、不会红屏，只是让人在该省事的地方多走一步，或者把东西弄丢。
 */
describe("素材库 · 从网上搜（第二刀：六处反人类）", () => {
  it("① 搜失败**不抹掉**上一批结果：失败只加一句说明", () => {
    // 失败分支只许有一句话。此前那版顺手把 hits 清空了——用户可能正盯着上一批读呢，
    // 一句「没搜着」把人家的东西擦掉，是把工具的失败算到了用户头上。
    expect(panelScript).toMatch(/\}\s*else\s*\{\s*searchNote\.value = result\.message;\s*\}/);
    // 清空结果这件事只发生在「收起搜索结果」那一个动作里（全局只许出现一次）。
    expect(countNeedle("hits.value = []", panelScript)).toBe(1);
  });

  it("② 搜索结果与素材清单**并存**，不是顶掉", () => {
    // 此前搜到东西就把「我的素材」整块换掉了；加进去的那一张也得点「收起」才看得见。
    const hitsAt = panelTpl.indexOf('v-if="hits.length > 0"');
    const listAt = panelTpl.indexOf('v-if="entries.length === 0"');
    expect(hitsAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(hitsAt);
    // 两块之间不许有 v-else：有 v-else 就是「顶掉」而不是「并存」。
    expect(panelTpl.slice(hitsAt, listAt)).not.toContain("v-else");
  });

  it("③ 每条结果看得见来源站点，也点得开原页", () => {
    // 卡片正文里写着「打开上面的链接自己看一眼」，而界面上**从来没有一个链接**——
    // 那句话把人指向一个不存在的东西。
    expect(panelScript).toContain("window.mochen.openWebSource(url)");
    expect(panelTpl).toContain("打开原页");
    expect(panelTpl).toContain("material-hit-meta");
    expect(panelScript).toContain("materialCardHost(hit.url)");
  });

  it("④ 加入前先取全文；取不到就退回收摘要那一档（不整条作废）", () => {
    expect(panelScript).toContain("window.mochen.materialsFetch(hit.url)");
    expect(panelScript).toContain("materialCardBody(hit, materialCardStamp(new Date()), page)");
    // 抓取失败要说出来：用户得知道手上的是摘要而不是正文。
    expect(panelScript).toContain("这条只收了搜索摘要");
  });

  it("⑤ 撞名自动改名重试——不许把人堵在「改好标题再导」上", () => {
    // 导入那条通路撞名时回的是「改好标题再导」，而这个界面上**没有改标题的地方**：
    // 那是一句把人引到死路的话。
    expect(panelScript).toContain('result.reason === "name-conflict"');
    expect(panelScript).toContain("materialCardTitleVariant(base, attempt)");
  });

  it("⑥ 一条在飞时按钮禁用：点两下不会落两张卡", () => {
    expect(panelTpl).toContain(":disabled=\"addingUrl !== ''\"");
    expect(panelTpl).toContain("addingUrl === hit.url");
  });

  it("空搜索词当场给一句人话（主进程那句永远走不到）", () => {
    expect(panelScript).toContain("先给一个搜索词。");
  });

  it("搜索词长度与主进程那道闸一致：超长的请求压根不该发出去", () => {
    expect(panelTpl).toContain('maxlength="120"');
  });

  it("打开面板就落在搜索框上——这一面板的主动作是「搜点什么」", () => {
    expect(panelScript).toContain('focusSelector: ".material-search-input"');
    // 判据住在 composable 里（焦点归位那套时序判定只有一份），这里钉住它的两个条件：
    // 指定的目标**真的能聚焦**时优先落在它身上，否则落回第一个能聚焦的。
    const popoverScript = typeScriptSource("composables/useComposerContextPopover.ts");
    expect(popoverScript).toContain("focusSelector");
    expect(popoverScript).toContain("picked.matches(POPOVER_FOCUSABLE)");
    expect(popoverScript).toContain("el.querySelector<HTMLElement>(POPOVER_FOCUSABLE) ?? el");
  });
});

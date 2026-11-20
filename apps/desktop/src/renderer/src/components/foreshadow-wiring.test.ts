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
import { SIDE_NAV_GROUPS } from "../utils/side-nav";

/**
 * 伏笔台账的**接线契约**（2026-10-05）。
 *
 * 判定分两层，各有真单测：`contracts/foreshadow`（状态机与 frontmatter 解析，6 条）
 * 与 `utils/foreshadow`（行组装、排序、统计，16 条）。本文件只钉「接没接上」：
 * ① 文稿体系认了 `foreshadow` 这一类（左栏建得出、图标有）；
 * ② 两个入口都能打开同一份台账，且**只有一份**（store 那一格，不许组件各持一个布尔）；
 * ③ 读盘走 store，不许组件自己摸 `window.mochen`；
 * ④ 读不到的伏笔**仍要列出来**——凭空消失的那条恰恰最需要被看见。
 */
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const menuTpl = templateSource("components/ReviewMenu.vue");
const panelScript = scriptSource("components/ForeshadowPanel.vue");
const panelTpl = templateSource("components/ForeshadowPanel.vue");
const sideScript = scriptSource("components/LeftSidebar.vue");
// store 是散装 .ts：读它得用 typeScriptSource（scriptSource 只认 .vue 的 <script setup>）。
const store = typeScriptSource("stores/useBookStore.ts");
// 读原文那段的家（2026-10-09 从 store 搬进 utils），契约跟着搬：判定在哪就钉哪。
const foreshadowUtil = typeScriptSource("utils/foreshadow.ts");
const reviewTools = typeScriptSource("utils/review-tools.ts");
const css = styleSource("foreshadow.css");

describe("文稿体系认了这一类", () => {
  it("左栏「故事规划」里有一项「伏笔台账」，走 action（聚合视图不是文稿筛选）", () => {
    const plan = SIDE_NAV_GROUPS.find((g) => g.id === "plan");
    const item = plan?.children.find((c) => c.label === "伏笔台账");
    expect(item).toBeDefined();
    expect(item?.reality).toEqual({ kind: "action", action: "foreshadow-ledger" });
  });

  it("左栏点了它：展开右栏 + 开台账 + 读盘，三件事都在同一分支", () => {
    expect(sideScript).toContain('child.reality.action === "foreshadow-ledger"');
    expect(sideScript).toContain("book.foreshadowsOpen = true;");
    expect(sideScript).toContain("void book.loadForeshadows();");
    // 与 AI 检查三项共用展开真身，不另写一份
    expect(sideScript).toContain("revealAgentPanel();");
  });

  it("点了必有可见响应：先回对话视图（面板宿主在那儿），没书先过引导闸（2026-11-09）", () => {
    // 面板真身住在 DocumentPane，它只在对话视图且右栏展开时挂载；
    // 人在技能库 / 皮肤广场 / 设置时点入口，不回对话视图就是「点了没反应」。
    expect(sideScript).toContain("layout.showWorkspace();");
    // 没书时右栏整格不挂载：置开关只会留下一个等不到锚点的真值 ⇒ 先弹引导对话框。
    expect(sideScript).toContain("if (requireBook(child.label)) return;");
  });

  it("KIND_ICON 有伏笔这一行（.vue 不进 tsc，编译器抓不到这张表）", () => {
    // 2026-10-10 改钉：LeftSidebar 那份 KIND_ICON 表已抽进 utils/kind-icons（单一真身，
    // LeftSidebar 只 import），图标拼写的双向对齐由 utils/icons-coverage.test 钉；
    // 这里钉的是「伏笔这一行存在」与「另一处（OutlinePanel 自持的那份）也没丢」。
    expect(typeScriptSource("utils/kind-icons.ts")).toContain("foreshadow:");
    expect(scriptSource("components/OutlinePanel.vue")).toContain("foreshadow:");
    // 【2026-11-20 · 批次①】树的分组判定搬进了 utils/manuscript-sections（章节组常驻那条），
    // 于是「谁在读那张图标表」从 LeftSidebar 变成了那个 util——单一真身这件事没变，
    // 变的只是读它的人。左栏自己不许再养一份。
    expect(typeScriptSource("utils/manuscript-sections.ts")).toContain('from "./kind-icons"');
    expect(scriptSource("components/LeftSidebar.vue")).not.toContain('from "../utils/kind-icons"');
  });
});

describe("两个入口，一份台账", () => {
  // P0-5：右栏这一枚从平铺收进了「审稿」下拉；左栏那个入口、store 那一格都没动。
  it("「审稿」下拉里有这一项，开合读 store 那一格", () => {
    expect(reviewTools).toContain('id: "foreshadow"');
    expect(reviewTools).toContain('label: "伏笔台账"');
    expect(menuTpl).toContain(':disabled="disabled"');
    // 开合仍写 store（左栏也要开它），不是组件本地布尔：
    expect(paneScript).toContain("book.foreshadowsOpen = true;");
    expect(paneScript).not.toMatch(/const foreshadowOpen\s*=\s*ref\(/);
  });

  it("面板挂在 DocumentPane，锚点是「审稿」那颗稳定按钮（不是菜单行）", () => {
    expect(paneTpl).toContain("<ForeshadowPanel");
    expect(paneTpl).toContain(':anchor="reviewMenuAnchor"');
    expect(paneScript).toContain("reviewMenuAnchor");
    expect(menuTpl).not.toContain("<ForeshadowPanel");
  });

  it("浮层走 Teleport 到 body（本仓弹层规矩）", () => {
    expect(panelTpl).toContain('<Teleport to="body">');
    expect(panelScript).toContain("useComposerContextPopover");
  });
});

describe("读盘走 store", () => {
  it("loadForeshadows 在 store 里，读原文与筛选走 utils/foreshadow 那一份真身", () => {
    expect(store).toContain("async loadForeshadows(): Promise<void> {");
    // 2026-10-09：并发读原文那段从 store 搬进了 utils（与行组装同一处，也腾出 store 的行数预算），
    // 契约不变——store 必须**真的调用**它，不然「读盘走 store」就退化成「谁都没读」。
    expect(store).toContain("readForeshadowRaws(this.docs");
    expect(store).toContain("foreshadowRows(this.docs, raws)");
    expect(foreshadowUtil).toContain('d.kind === "foreshadow"');
  });

  it("用 allSettled 逐篇读：一篇读失败不许把整张表拖垮", () => {
    expect(foreshadowUtil).toContain("Promise.allSettled(");
  });

  it("面板不自己摸 window.mochen", () => {
    expect(panelScript).not.toContain("window.mochen");
  });

  it("行组装在 utils 判定层，不在组件里", () => {
    expect(panelScript).toContain("foreshadowStats(rows.value)");
    expect(panelScript).not.toContain("parseForeshadowMeta");
  });
});

describe("不许替作者下结论", () => {
  it("空表给的是引导（去左栏新建），不是空白", () => {
    expect(panelTpl).toContain("还没有伏笔");
    expect(panelTpl).toContain("故事规划");
  });

  it("异常态在界面上有位置：状态坏了单独一格、读不到用虚线边", () => {
    expect(panelTpl).toContain('class="is-broken"');
    expect(panelTpl).toContain("stats.broken");
    expect(ruleBlock(css, ".foreshadow-row.is-unknown")).toContain("dashed");
    expect(ruleBlock(css, ".foreshadow-stats > div.is-broken")).toContain("var(--danger");
  });

  it("每行都摆出埋在哪/收在哪，没写就说「没写埋在哪」而不是留白", () => {
    expect(panelTpl).toContain("没写埋在哪");
    expect(panelTpl).toContain("埋于");
    expect(panelTpl).toContain("收于");
  });
});

describe("样式", () => {
  it("五种语气都有规则（字面量三元绑定，dead-css-guard 才认得出）", () => {
    for (const tone of ["pending", "paid", "dropped", "broken", "unknown"]) {
      expect(ruleBlock(css, `.foreshadow-row.is-${tone}`), `缺 is-${tone}`).not.toBe("");
    }
  });

  it("组件里不写 <style>：本仓样式全在 styles/ 下", () => {
    expect(countNeedle("<style", vueSource("components/ForeshadowPanel.vue"))).toBe(0);
    expect(css).toContain(".foreshadow");
  });
});

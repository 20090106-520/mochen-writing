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

/**
 * 去 AI 味检查的**接线契约**（2026-10-05）。
 *
 * 判定与文案在 `utils/ai-slop.ts`（那里有 14 条真单测），本文件只钉「接没接上」：
 * ① 入口是真按钮，按钮切的是组件那一格，不是自己持的另一个布尔；
 * ② 面板挂在 DocumentPane 里、锚点就是那颗按钮；
 * ③ **扫的是活动文稿的草稿**——扫盘上那份的话，用户会对着没写过的内容被指正；
 * ④ 交清单给 AI 走 `prefillComposer` 且**不自动发送**（用户保留最后一道编辑权）；
 * ⑤ 强信号与弱信号在界面上分开摆，且文案不许说成「错误」。
 *
 * 读法走 vue-source-reader（剥注释），否则「这里没有 X」这句话本身写着 X。
 */
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const menuScript = scriptSource("components/ReviewMenu.vue");
const menuTpl = templateSource("components/ReviewMenu.vue");
const panelScript = scriptSource("components/SlopPanel.vue");
const panelTpl = templateSource("components/SlopPanel.vue");
const reviewTools = typeScriptSource("utils/review-tools.ts");
const css = styleSource("ai-slop.css");

describe("入口挂在哪", () => {
  // P0-5 之后这枚检查从平铺按钮收进了「审稿」下拉：入口仍在，判据仍在，只是入口的位置变了。
  it("「审稿」下拉里有这一项，禁用条件是「没开书」而不是永远可点", () => {
    expect(reviewTools).toContain('id: "slop"');
    expect(reviewTools).toContain('label: "去 AI 味"');
    expect(reviewTools).toContain('icon: "wand"');
    expect(menuTpl).toContain('@click="choose(tool)"');
    expect(menuTpl).toContain(':disabled="disabled"');
    expect(menuScript).toContain("const disabled = computed(() => !book.meta);");
  });

  it("面板挂在 DocumentPane 里，锚点是「审稿」那颗稳定按钮（不是菜单行）", () => {
    expect(paneTpl).toContain("<SlopPanel");
    expect(paneTpl).toContain(':anchor="reviewMenuAnchor"');
    expect(paneScript).toContain("reviewMenuAnchor");
    // 菜单行一关就卸载，拿它当锚点面板会跟着消失；锚点必须是常驻的触发钮。
    expect(menuTpl).not.toContain("<SlopPanel");
  });

  it("浮层走 Teleport 到 body（本仓弹层规矩）", () => {
    expect(panelTpl).toContain('<Teleport to="body">');
    expect(panelScript).toContain("useComposerContextPopover");
  });
});

describe("扫的是哪一份", () => {
  it("扫活动文稿的当前草稿（含未保存手改），不是盘上那份", () => {
    expect(panelScript).toContain("findAiSlop(book.draft)");
    expect(panelScript).not.toContain("window.mochen.readDoc");
  });

  it("列表是随草稿重算的 computed，组件里不许缓存一份 hits", () => {
    expect(panelScript).toContain("const hits = computed(() => findAiSlop(book.draft));");
    expect(panelScript).not.toMatch(/const hits\s*=\s*ref\(/);
  });
});

describe("交清单给 AI", () => {
  it("走 prefillComposer（与左栏 AI 检查同一条通路），不自己发请求", () => {
    expect(panelScript).toContain("agent.prefillComposer(");
    expect(panelScript).toContain("threadKeyFor(book.activeDocTab)");
    expect(panelScript).toContain("slopChecklistPrompt(hits.value, docTitle.value, gate.value)");
    expect(panelScript).not.toContain("agent.send(");
  });

  it("没打开文稿时交不出去（刷新的是别的文稿）", () => {
    expect(panelScript).toContain("if (book.activeDocTab === null) return;");
  });
});

describe("提醒不许说成判决", () => {
  it("弱信号单列一档，标题里写明「自己判断」", () => {
    expect(panelTpl).toContain("常见句式 · 先留着自己判断");
    expect(panelTpl).toContain("套话 · 建议改");
    expect(panelTpl).toContain('class="ai-slop-item is-mild"');
  });

  it("文案里出现「提醒，不是判你写错了」这句边界声明", () => {
    expect(panelTpl).toContain("报出来是提醒，不是判你写错了");
  });

  it("零命中给的是肯定的话，不是空白面板", () => {
    expect(panelTpl).toContain("没扫出 AI 腔");
    expect(panelTpl).toContain("这一篇还没有正文");
  });
});

describe("退稿闸预演（2026-11-12）", () => {
  it("读数走 slopGateOf（闸自己的判决），不在这边重写一遍判据", () => {
    expect(panelScript).toContain("const gate = computed(() => slopGateOf(book.draft));");
    expect(panelScript).toContain("slopGateOf");
    // 不许在组件里自己数阈值：那等于把闸的判据抄成第二份。
    expect(panelScript).not.toContain("AI_FLAVOR_GATE");
  });

  it("零命中时这一格照样在——节奏与结构的问题本来就不挂在某一行套话上", () => {
    // 旧结构是 `v-else-if="hits.length === 0"` 整段吃掉面板，闸预演会跟着消失。
    expect(panelTpl).not.toContain('v-else-if="hits.length === 0"');
    expect(panelTpl).toContain('class="ai-slop-gate"');
    expect(panelTpl).toContain("gate.headline");
    expect(panelTpl).toContain("gate.reasons");
  });

  it("闸判退时那几条一起交给 AI（否则改完词还是会被拦一轮）", () => {
    expect(panelScript).toContain("slopChecklistPrompt(hits.value, docTitle.value, gate.value)");
  });

  it("样式：闸这一格的规则不是空壳，且没新画状态底色", () => {
    expect(ruleBlock(css, ".ai-slop-gate")).toContain("border-left");
    expect(ruleBlock(css, ".ai-slop-gate.is-blocked")).toContain("border-left-color");
    expect(ruleBlock(css, ".ai-slop-gate-list")).toContain("color");
    // 新画一档状态底色就得进对比度普查表；这一格刻意不画。
    expect(ruleBlock(css, ".ai-slop-gate")).not.toContain("background");
  });
});

describe("样式", () => {
  it("新规则的正文都非空壳", () => {
    for (const selector of [
      ".ai-slop-item",
      ".ai-slop-word",
      ".ai-slop-hand",
      ".ai-slop-verdict",
      ".ai-slop-excerpt"
    ]) {
      expect(ruleBlock(css, selector), `${selector} 不许是空壳`).not.toBe("");
    }
  });

  // 回归：清单可能很长，主操作「交给 AI 改」掉到折叠线以下就等于没有（改稿历史同款教训）。
  it("主操作吸底，不许被清单推到折叠线以下", () => {
    expect(ruleBlock(css, ".ai-slop-hand")).toContain("position: sticky");
  });

  it("组件里不写 <style>：本仓样式全在 styles/ 下", () => {
    expect(countNeedle("<style", vueSource("components/SlopPanel.vue"))).toBe(0);
    expect(css).toContain(".ai-slop");
  });
});

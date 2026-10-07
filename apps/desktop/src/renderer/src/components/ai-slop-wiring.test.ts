import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
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
const panelScript = scriptSource("components/SlopPanel.vue");
const panelTpl = templateSource("components/SlopPanel.vue");
const css = styleSource("ai-slop.css");

describe("入口挂在哪", () => {
  it("右栏头部有这颗按钮，禁用条件是「没开书」而不是永远可点", () => {
    expect(paneTpl).toContain('aria-label="去 AI 味"');
    expect(paneTpl).toContain('@click="slopOpen = !slopOpen"');
    expect(paneTpl).toContain(':disabled="!book.meta"');
    expect(paneTpl).toContain('<AppIcon name="wand"');
  });

  it("面板挂在 DocumentPane 里，锚点就是那颗按钮", () => {
    expect(paneTpl).toContain("<SlopPanel");
    expect(paneTpl).toContain(':anchor="slopAnchor"');
    expect(paneScript).toContain("slopButton");
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
    expect(panelScript).toContain("slopChecklistPrompt(hits.value, docTitle.value)");
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

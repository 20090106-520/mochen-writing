import { describe, expect, it } from "vitest";
import { ruleBlock, scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";
import { REVIEW_TOOLS } from "../utils/review-tools";

/**
 * P0-5 · 右栏工具条收敛的接线契约。
 *
 * 这次改动只许动「入口摆在哪」，不许动「入口还在不在」：
 * ① 写作组五枚（改稿历史 / 素材库 / 卷纲→章纲 / 导出 / 字数统计）常驻头部；
 * ② 检查组五枚（去 AI 味 / 审稿打分 / 时间线核对 / 人物设定核对 / 伏笔台账）收进「审稿」下拉，
 *    清单从 utils/review-tools 来——一个都不许掉；
 * ③ 桌面端 `.editor-pane` 有 overflow:hidden，下拉必须 Teleport 出去，否则被裁在 50px 头部里；
 * ④ 键位仍走共用范式：↑↓ 高亮、Enter 选高亮那条、Esc 收菜单且 stopPropagation，
 *    不许把全局 escape-policy 弄坏。
 *
 * `.vue` 零运行时覆盖，只能读源文件钉（读法走 vue-source-reader，剥注释）。
 */
const paneTpl = templateSource("components/DocumentPane.vue");
const paneScript = scriptSource("components/DocumentPane.vue");
const menuTpl = templateSource("components/ReviewMenu.vue");
const menuScript = scriptSource("components/ReviewMenu.vue");
const css = styleSource("editor-pane.css");

describe("分组：写作常驻、检查收进「审稿」", () => {
  it("写作组五枚入口都还在头部", () => {
    for (const label of ["改稿历史", "导出作品", "字数统计", "卷纲转章纲"]) {
      expect(paneTpl).toContain(`aria-label="${label}"`);
    }
    expect(paneTpl).toContain("<MaterialButton");
    expect(paneTpl).toContain('aria-label="写作工具"');
  });

  it("检查组五项一个都没少：清单五项、下拉按清单渲染、触发钮的 title 点名全部五项", () => {
    expect(REVIEW_TOOLS.map((tool) => tool.id)).toEqual([
      "slop",
      "review",
      "timeline",
      "cast",
      "foreshadow"
    ]);
    expect(menuTpl).toContain('v-for="(tool, index) in REVIEW_TOOLS"');
    // 触发钮那句把五项名字都点出来：光有清单不算入口，界面上得能看见它们去哪了。
    for (const tool of REVIEW_TOOLS) {
      expect(paneTpl, `触发钮没提 ${tool.label}`).toContain(tool.label);
    }
    expect(paneTpl).toContain('<div class="editor-tool-group" role="group" aria-label="检查工具">');
  });

  it("原来的平铺检查按钮不再留在头部：入口搬进下拉，不是又平铺又多一份", () => {
    for (const label of ["去 AI 味", "审稿打分", "时间线核对", "伏笔台账", "人物设定核对"]) {
      expect(paneTpl).not.toContain(`aria-label="${label}"`);
    }
    expect(paneTpl).toContain('aria-label="审稿工具"');
  });
});

describe("浮层与锚点", () => {
  it("下拉 Teleport 到 body 且走共用的定位合成器（头部会裁掉行内浮层）", () => {
    expect(menuTpl).toContain('<Teleport to="body">');
    expect(menuScript).toContain("useComposerContextPopover");
  });

  it("五块检查面板都锚在同一颗**常驻**触发钮上，不拿菜单行当锚点", () => {
    expect(paneScript).toContain("const reviewMenuButton = ref<HTMLElement>();");
    expect(paneScript).toContain(
      "const reviewMenuAnchor = computed(() => reviewMenuButton.value ?? null);"
    );
    for (const panel of [
      "<SlopPanel",
      "<ReviewScorePanel",
      "<TimelineCheckPanel",
      "<CastCheckPanel",
      "<ForeshadowPanel"
    ]) {
      expect(paneTpl).toContain(panel);
    }
    expect(paneTpl.match(/:anchor="reviewMenuAnchor"/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    // 菜单行一关就卸载；拿行当锚点，面板会跟着一起消失。
    for (const panel of [
      "SlopPanel",
      "ReviewScorePanel",
      "TimelineCheckPanel",
      "ForeshadowPanel"
    ]) {
      expect(menuTpl).not.toContain(`<${panel}`);
    }
  });
});

describe("键盘可达性不砸掉原有的 Esc / 焦点", () => {
  it("触发钮交代自己是下拉，并在展开时同步 aria-expanded", () => {
    expect(paneTpl).toContain('aria-haspopup="listbox"');
    expect(paneTpl).toContain(':aria-expanded="reviewMenuOpen"');
  });

  it("↑↓ 走高亮、Enter 选高亮那条、Tab 走浮层的焦点循环（共用范式）", () => {
    expect(menuScript).toContain("highlight.move(");
    expect(menuScript).toContain("highlight.pickActive()");
    expect(menuScript).toContain("tab(event)");
  });

  it("Esc 在这一层收菜单并 stopPropagation：全局裁决不该越过它", () => {
    expect(menuScript).toContain("popoverOwnsKey(");
    expect(menuScript).toContain("event.stopPropagation();");
    // 焦点还停在触发钮上时按 Esc，同样由这一层先收（不然会去关别的浮层）。
    expect(paneScript).toContain("function onReviewMenuKeydown(event: KeyboardEvent): void {");
  });
});

describe("样式", () => {
  it("分组线、下拉触发钮、浮层面的规则都不是空壳", () => {
    expect(ruleBlock(css, ".editor-tool-group")).not.toBe("");
    expect(ruleBlock(css, ".editor-tools-divider")).not.toBe("");
    expect(ruleBlock(css, ".review-menu-toggle")).not.toBe("");
  });
});

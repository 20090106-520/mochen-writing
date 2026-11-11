/// <reference types="node" />
/**
 * 无边框窗口的窗口按钮区（2026-11-11）。
 *
 * 真机 `navigator.windowControlsOverlay` 量到：可见，`titlebar-area-width` = 1570，
 * 窗口宽 1707 ⇒ 系统在右上角画了 137px 宽的「— □ ×」。
 * 而技能库 / 皮肤广场 / 改稿历史的关闭钮按内容区右缘摆，落在 x=1655..1687 ——
 * **正好压在那一条下面**：屏上是一枚被盖住的 X，点下去命中系统关闭键（应用直接退出）。
 *
 * 这三页此前也没有 drag 区：在它们上面根本拖不动窗口。两条公用件因此落在
 * styles/window-chrome.css，这里钉「公用件本身」与「三处页头真的挂了」。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ruleBlock, styleSource, templateSource } from "../utils/vue-source-reader";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const CHROME = styleSource("window-chrome.css");
const PAGES = [
  "components/ExtensionsPage.vue",
  "components/SkinGalleryPage.vue",
  "components/ChangeHistoryPanel.vue"
];

describe("公用件：可拖区 + 右侧让位", () => {
  it("drag 区必须把里面的控件逐个豁免（否则按钮按不动）", () => {
    expect(ruleBlock(CHROME, ".titlebar-drag")).toContain("-webkit-app-region: drag");
    const exempt = /\.titlebar-drag button,([\s\S]*?)\{([\s\S]*?)\}/.exec(CHROME)?.[2] ?? "";
    expect(exempt).toContain("-webkit-app-region: no-drag");
    // 会吃掉点击的控件都要在里面：按钮、输入、可点角色。
    // 刻意不列 `a`：本仓的渲染层不产 `<a>`（dead-css-guard 那条「孤儿标签选择器」就是为这个设的），
    // 写一条永远匹配不到的豁免只是给下一个人留个假线索。
    const selectors = CHROME.slice(0, CHROME.indexOf("no-drag"));
    for (const sel of ["button", "input", "select", "textarea", '[role="button"]']) {
      expect(selectors, `豁免清单漏了 ${sel}`).toContain(sel);
    }
  });

  it("让位公式是相消式 fallback：不支持 titlebar-area-* 时加 0，不推走内容", () => {
    const rule = ruleBlock(CHROME, ".titlebar-inset-right");
    expect(rule).toContain(
      "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))"
    );
    // 反向：不许写成固定的 138px / 137px —— 那是把某一台机器的缩放写死进样式。
    expect(rule).not.toMatch(/\d{3}px/);
  });
});

describe("三处整页头都挂了这两件", () => {
  for (const page of PAGES) {
    it(`${page} 的头带 titlebar-drag 与 titlebar-inset-right`, () => {
      const markup = templateSource(page);
      const header = /<header class="([^"]*)"/.exec(markup)?.[1] ?? "";
      expect(header, `${page} 的 header 类名读不到`).not.toBe("");
      expect(header).toContain("titlebar-drag");
      expect(header).toContain("titlebar-inset-right");
    });
  }

  it("styles.css 真的把它导进来了（没导 = 一条规则都不生效）", () => {
    expect(read("../styles.css")).toContain('@import "./styles/window-chrome.css";');
  });
});

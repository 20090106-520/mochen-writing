/// <reference types="node" />
/**
 * 无边框窗口接线（去原生标题条，用户裁定）：main 开 titleBarStyle: "hidden" + titleBarOverlay
 * （高度对齐栏头 50px，配色取自外观主题），渲染层栏头既有 drag 区 + 让位 CSS。
 * main/index.ts 是装配文件没有单测，这里按源码契约钉字面量；读法与 typeScriptSource 同一条
 * 剥注释纪律——注释里写着 needle 不等于真做了这件事（vue-source-reader 的路径解析只到
 * renderer/src，这里自行解到 main/）。纯函数本体另有 main/title-bar.test.ts。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleSource } from "../utils/vue-source-reader";

const mainSource = readFileSync(
  fileURLToPath(new URL("../../../main/index.ts", import.meta.url)),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

/** 剥 CSS 注释后压掉全部空白再钉字面量：prettier 怎么折行断言都不脆。 */
const compact = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

/**
 * 顶格锚定的规则正文（vue-source-reader 的 ruleBlock 只认「 selector {」不管行首，
 * `html[data-platform="darwin"] .editor-header` 这类嵌套选择器会抢先匹配到别的块）。
 * 同一条纪律：找不到一律抛错，不静默返回空串。
 */
const topLevelBlock = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error(`样式表里找不到顶格规则 ${selector}`);
  }
  return match[1];
};

describe("main · 无边框窗口开关与 overlay 配色接线", () => {
  it("BrowserWindow 开 titleBarStyle: hidden + titleBarOverlay，高度对齐栏头 50px", () => {
    expect(mainSource).toContain('titleBarStyle: "hidden"');
    expect(mainSource).toContain("titleBarOverlay: {");
    expect(mainSource).toContain("height: 50");
  });

  it("overlay 配色来自主题纯函数，且外观读取在窗口创建之前（坏档退默认值不挡启动）", () => {
    expect(mainSource).toContain("resolveTitleBarOverlayColors(");
    expect(mainSource).toContain("resolveTitleBarPreferDark(");
    expect(mainSource).toContain("createAppearanceStore(");
    expect(mainSource.indexOf("createAppearanceStore(")).toBeLessThan(
      mainSource.indexOf("new BrowserWindow")
    );
  });

  it("主题变化两条通路都刷新 overlay：外观保存（wrapper）与系统深浅切换（nativeTheme updated）", () => {
    expect(mainSource).toContain("const applyTitleBarOverlay = () => {");
    expect(mainSource).toContain('nativeTheme.on("updated", applyTitleBarOverlay);');
    // Linux 没有 setTitleBarOverlay 这个方法，typeof 守卫不许被当冗余删掉。
    expect(mainSource).toContain('typeof win.setTitleBarOverlay !== "function"');
    // wrapper 仍是 appearance-store 同一份真身；保存成功才记 currentAppearance 并刷新。
    expect(mainSource).toContain("read: () => appearanceStore.read()");
    expect(mainSource).toContain("await appearanceStore.save(next);");
    expect(mainSource).toContain("currentAppearance = next;");
  });
});

describe("CSS · 窗控区让位与顶部拖动区（让位 = env 相消式 fallback，不支持时退回原 padding）", () => {
  it("editor-header 常驻最右列：右侧让出窗控区；drag 与按钮 no-drag 既有接线不回退", () => {
    const header = compact(topLevelBlock(styleSource("editor-pane.css"), ".editor-header"));
    expect(header).toContain(
      "padding-right:calc(9px+100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw))"
    );
    expect(header).toContain("-webkit-app-region:drag");
    expect(styleSource("editor-pane.css")).toContain(".editor-header button");
  });

  it("右编辑栏收起时对话栏成为最右列：conversation-header 补同款让位", () => {
    const header = compact(
      topLevelBlock(
        styleSource("conversation-pane.css"),
        ".is-right-collapsed .conversation-header"
      )
    );
    expect(header).toContain(
      "padding-right:calc(10px+100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw))"
    );
  });

  it("设置页盖过整个窗口：大标题这片空白是拖动区；左栏品牌行 drag 不回退", () => {
    const title = compact(topLevelBlock(styleSource("settings-page.css"), ".settings-title"));
    expect(title).toContain("-webkit-app-region:drag");
    const brand = compact(topLevelBlock(styleSource("left-nav.css"), ".sidebar-brand-row"));
    expect(brand).toContain("-webkit-app-region:drag");
  });
});

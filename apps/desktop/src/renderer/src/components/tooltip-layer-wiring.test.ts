/// <reference types="node" />
/**
 * 应用内 Tooltip 的接线契约（2026-11-11）。
 *
 * 这一层最容易坏成「看起来还在、其实全是浏览器原生提示」：
 * CSS 忘了 @import ⇒ 提示是裸文字；装配忘了挂 ⇒ 137 处 title 一个也没被接管；
 * 只搬首屏不接 MutationObserver ⇒ Vue 重渲染写回来的 title 又弹系统提示；
 * 监听加得上摘不掉 ⇒ 切视图时一层层堆；延迟写死 1000 ⇒ 又回到原生手感。
 * 所以这里钉的是接线，不是「文件存在」。
 */
import { describe, expect, it } from "vitest";
import {
  scriptSource,
  strippedStyleSource,
  styleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";
import { TOOLTIP_ATTR, TOOLTIP_HOVER_DELAY_MS } from "../utils/tooltip-placement";

const appTemplate = templateSource("App.vue");
const appScript = scriptSource("App.vue");
const layerTemplate = templateSource("components/TooltipLayer.vue");
const layerScript = scriptSource("components/TooltipLayer.vue");
const tooltipCss = strippedStyleSource("tooltip.css");

describe("装配：恒挂一层、接进样式表、不破 density 的最后一条", () => {
  it("App.vue 既 import 又挂了 TooltipLayer，且挂在 NotificationToast 之后（同档层级靠 DOM 顺序）", () => {
    expect(appScript).toContain('import TooltipLayer from "./components/TooltipLayer.vue";');
    expect(appTemplate).toContain("<TooltipLayer />");
    expect(appTemplate.indexOf("<NotificationToast />")).toBeLessThan(
      appTemplate.indexOf("<TooltipLayer />")
    );
  });

  it("tooltip.css 接进 styles.css，且仍排在 density.css 之前", () => {
    const imports = vueSource("styles.css");
    expect(imports).toContain('@import "./styles/tooltip.css";');
    expect(imports.indexOf('@import "./styles/tooltip.css";')).toBeLessThan(
      imports.indexOf('@import "./styles/density.css";')
    );
  });

  it("Teleport 到 body，带 role=tooltip，量尺寸的那一帧不许被看见", () => {
    expect(layerTemplate).toContain('to="body"');
    expect(layerTemplate).toContain('role="tooltip"');
    expect(layerTemplate).toContain("is-measuring");
    expect(tooltipCss).toContain(".mochen-tooltip.is-measuring");
    expect(tooltipCss).toContain("opacity: 0");
  });
});

describe("接管：原生 title 必须被搬走，重渲染写回来的也要接住", () => {
  it("搬运用的是唯一属性名，且删掉 title 而不是留着两套提示", () => {
    expect(layerScript).toContain('removeAttribute("title")');
    expect(layerScript).toContain("setAttribute(TOOLTIP_ATTR");
    expect(typeScriptSource("utils/tooltip-placement.ts")).toContain(
      `export const TOOLTIP_ATTR = "${TOOLTIP_ATTR}";`
    );
  });

  it("MutationObserver 只看 title 属性，首屏与新增子树都要扫", () => {
    expect(layerScript).toContain("new MutationObserver");
    expect(layerScript).toContain('attributeFilter: ["title"]');
    expect(layerScript).toContain("adoptSubtree(document)");
    expect(layerScript).toContain("observer.observe(document.body");
    expect(layerScript).toContain("observer?.disconnect()");
  });

  it("悬停延迟读常量，键盘聚焦不等；点击与滚动都收起", () => {
    expect(layerScript).toContain("TOOLTIP_HOVER_DELAY_MS");
    expect(TOOLTIP_HOVER_DELAY_MS).toBe(320);
    expect(layerScript).toContain("void show(el, text);");
    expect(layerScript).toContain('"pointerdown", hide');
    expect(layerScript).toContain('"scroll", onScroll, true');
  });

  it("不为提示开第二路 keydown：全局 Esc 仍只归 useHotkeys（裁定 G5）", () => {
    expect(layerScript).not.toContain('addEventListener("keydown"');
    expect(layerScript).not.toContain("preventDefault");
    expect(layerScript).not.toContain("stopPropagation");
    // 顶替它的是两条被动通路：锚点脱离 DOM、窗口失焦。
    expect(layerScript).toContain("!anchorEl.isConnected");
    expect(layerScript).toContain('window.addEventListener("blur", hide)');
  });

  it("八枚监听逐个配对摘除，切视图不堆监听器", () => {
    const events = [
      "pointerover",
      "pointerout",
      "focusin",
      "focusout",
      "pointerdown",
      "scroll",
      "resize",
      "blur"
    ];
    for (const name of events) {
      expect(layerScript, `没监听 ${name}`).toContain(`"${name}"`);
      expect(layerScript, `没摘除 ${name}`).toContain(`removeEventListener("${name}"`);
    }
  });
});

describe("形状：跟皮肤翻色、压得住浮层、长路径折行、不吞指针", () => {
  it("底色走会跟着明暗翻过来的一对 token，层级读表", () => {
    expect(styleSource("tooltip.css")).toContain("--neutral-solid");
    expect(tooltipCss).toContain("background: var(--neutral-solid)");
    expect(tooltipCss).toContain("color: var(--neutral-solid-contrast)");
    expect(tooltipCss).toContain("z-index: var(--z-toast)");
  });

  it("多行提示真换行、长路径能断，且整层不吃鼠标事件", () => {
    expect(tooltipCss).toContain("white-space: pre-line");
    expect(tooltipCss).toContain("overflow-wrap: anywhere");
    expect(tooltipCss).toContain("max-width: 280px");
    expect(tooltipCss).toContain("pointer-events: none");
  });

  it("出场读动效 token，不另写一份时长（减少动效总闸才管得住）", () => {
    expect(tooltipCss).toContain("animation: mochen-tip-in var(--dur-fast) var(--ease-out-soft)");
    expect(tooltipCss).not.toContain("ms !important");
  });

  it("定位判定来自纯函数，组件里不许再写一份夹边算式", () => {
    expect(layerScript).toContain("placeTooltip(");
    expect(typeScriptSource("utils/tooltip-placement.ts")).toContain(
      "export function placeTooltip("
    );
    expect(layerScript).not.toContain("innerWidth - box.width");
  });
});

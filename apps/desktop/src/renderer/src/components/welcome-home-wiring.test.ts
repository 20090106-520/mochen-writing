/// <reference types="node" />
/**
 * 大堂（欢迎首页）这一轮改动的守卫（2026-11-20 通知整修 C4+A5+B3+C6）。
 *
 * welcome-home.test.ts 钉的是「文案不许撒谎」；本文件钉的是「入口不许是假的、
 * 判据不许是死的」——五项改动都有过真机级缺陷史，逐条钉回去。
 */
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  strippedStyleSource,
  templateSource
} from "../utils/vue-source-reader";

const composerScript = scriptSource("components/ComposerBox.vue");
const composerTemplate = templateSource("components/ComposerBox.vue");
const welcomeCss = strippedStyleSource("welcome-home.css");

describe("A5：问候语必须跟着时间走", () => {
  it("不再是无依赖的 computed——那个写法一整天不换挡", () => {
    expect(
      composerScript,
      "greeting 又写回 computed(() => welcomeGreeting(new Date().getHours())) 了"
    ).not.toContain("computed(() => welcomeGreeting(new Date().getHours()))");
    expect(composerScript).toContain("ref(welcomeGreeting(new Date().getHours()))");
  });

  it("每分钟对一次表，卸载时清掉计时器", () => {
    expect(composerScript).toContain("60_000");
    expect(composerScript).toContain("clearInterval");
  });
});

describe("C4：「继续写《书名》」必须是一条真路", () => {
  it("入口读最近作品清单的第一条，点击走 book.openBook 同一真身", () => {
    expect(composerScript).toContain("book.recentBooks[0]");
    expect(composerScript).toContain("book.openBook(last.rootPath)");
  });

  it("书名显示走 bookDisplayTitle，不裸读 title（无题书要退回目录名）", () => {
    expect(composerScript).toContain("bookDisplayTitle(last.title, last.rootPath)");
  });

  it("高亮 class 在模板里接上了，样式表里有真规则", () => {
    expect(composerTemplate).toContain("is-resume");
    const resume = ruleBlock(welcomeCss, ".welcome-shortcut.is-resume");
    expect(resume).toContain("var(--focus)");
  });

  it("挂载时幂等补拉一次清单（大堂自洽，不依赖左栏先挂载）", () => {
    expect(composerScript).toContain("book.loadRecentBooks()");
  });
});

describe("C6：门口那张脸", () => {
  it("hero 里有一枚表情球，画的是待机表情常量（不写编号字面量）", () => {
    expect(composerTemplate).toContain("welcome-hero-face");
    expect(composerTemplate).toContain("<EmotionAvatar");
    expect(composerScript).toContain("EMOTION_IDLE");
    expect(composerScript, "表情编号是契约，不许在本组件里写字面量").not.toContain('emotion="');
  });

  it("表情球的定位盒在样式表里，34px 与对话链头像同口径", () => {
    // ruleBlock 只取第一条匹配（@media 里那条 display:none 会先命中），
    // 所以主规则用整串断言直接钉住。
    expect(welcomeCss).toContain(".welcome-hero-face {\n  width: 34px;");
    expect(welcomeCss).toContain(".welcome-hero-face {\n  width: 34px;\n  height: 34px;");
  });

  it("矮窗口降档整枚收掉表情球：纯装饰先牺牲，不挤正文可读性", () => {
    expect(welcomeCss).toContain(".welcome-hero-face {\n    display: none;");
  });
});

describe("B3：胶囊按压手感与全仓对齐", () => {
  it("hover 之外还有 :active 下沉", () => {
    expect(ruleBlock(welcomeCss, ".welcome-shortcut:active")).toContain("translateY(1px)");
  });

  it("过渡里带 transform 一项", () => {
    const transition = ruleBlock(welcomeCss, ".welcome-shortcut");
    expect(transition).toContain("transform");
  });
});

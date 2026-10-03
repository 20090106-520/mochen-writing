/// <reference types="node" />
/**
 * 源码契约测试（F-C）：本仓没有 jsdom / @vue/test-utils，`.vue` 的模板与接线够不着运行时断言，
 * 于是沿用 utils/hotkey-markers.test.ts 的源码读取方式（一份真身：utils/vue-source-reader.ts，
 * 抽 `<template>` / `<script setup>` 并剥掉注释——只活在注释里的字符串不算数），
 * 把「三段主操作各调一个真身」钉成可失败的断言：
 * ① 三段各自的 data-nav-id 与 <kbd> 键标在模板里真实存在；② handler 调的是**真身函数名**
 * （layout.showSettings / agent.clearThreadView / book.pickAndOpen），不是另捏一份打开逻辑（§2.7）；
 * ③ 第三段的 disabled 判定以属性形态出现，不是恒可点；④「同源」不止是说明文字——
 * 中栏头部也必须调同一个 layout.showSettings()，且不得退回私有的 `showSettings.value = true` 局部开关。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const script = scriptSource("components/LeftSidebar.vue");
const template = templateSource("components/LeftSidebar.vue");

describe("LeftSidebar · 三段主操作各调一个真身（F-C，§2.7）", () => {
  it("段①打开作品目录仍在位且 Ctrl O 键标已接通（核对现状：附录 §3 的账）", () => {
    expect(template).toContain('data-nav-id="open-book"');
    expect(template).toContain("<kbd>Ctrl O</kbd>");
    expect(script).toContain("book.pickAndOpen()");
  });

  it("段②模型配置调 layout.showSettings()，与中栏头部同源", () => {
    expect(template).toContain('data-nav-id="model-config"');
    expect(script).toContain("showSettings()");
  });

  it("段③本章新对话调 agent.clearThreadView(threadKeyFor(...))，只清渲染层", () => {
    expect(template).toContain('data-nav-id="new-thread"');
    expect(script).toContain("clearThreadView(threadKeyFor(book.activeDocTab))");
  });

  it("文案诚实：新对话一段复用 CLEAR_VIEW_SENTENCE 作 title、灰态可见原因写进标签，绝不写「新建会话线程」", () => {
    expect(script).toContain("CLEAR_VIEW_SENTENCE");
    expect(template).toContain('data-nav-id="new-thread"');
    expect(template).not.toContain("新建会话线程");
    // 反向鉴别：无书时第三段 disabled 的判定必须真出现（不是恒可点）。
    expect(template).toMatch(
      /data-nav-id="new-thread"[\s\S]*?:disabled="book\.activeDocTab === null"/
    );
    // I1：tooltip 的载体必须真是段③上的 title 属性——上面那条 script 含常量的断言单靠 import 行就能满足，
    // 删掉 :title 也不会红（评审实测）。载体与常量各钉一次。
    expect(template).toMatch(/data-nav-id="new-thread"[\s\S]*?:title="CLEAR_VIEW_SENTENCE"/);
    // M2：Chromium 不给 disabled 按钮弹原生 title，灰态恰恰是唯一需要解释的时刻 ⇒ 原因必须是可见标签。
    expect(template).toContain("本章新对话（先打开一章）");
    // M5：三段导航现在还管着「模型配置」「本章新对话」，aria-label 再说「作品」就是假话。
    expect(template).toContain('aria-label="主操作"');
  });

  it("同源断言：中栏头部也只调 layout.showSettings()，没有私有浮层（评审 T8-2）", () => {
    const center = vueSource("components/CenterColumn.vue");
    // 正向：头部按钮走同一个真身动作（左栏与头部都调无实参的 showSettings()，同源）。
    expect(center).toContain("layout.showSettings()");
    // 反向：头部不得再有自己的局部开关——`const showSettings = computed(...)` 是只读视图判定，
    // 钉的是写形式 `showSettings.value = `，只读那一处不该被误伤。
    expect(center).not.toContain("showSettings.value = ");
  });
});

describe("LeftSidebar · 书名与工作目录这一行（#103b：示意稿 B 顶栏的两条事实）", () => {
  // 载体钉（M5 同律）：值在 script 里算好不等于进了 DOM，所以来源与插值各钉一次。
  it("开书才有这一行：书名与绝对路径都读 store，且它是字不是按钮", () => {
    expect(script).toContain("book.meta && book.rootPath");
    const block = /<div v-if="workspace"[\s\S]*?<\/div>/.exec(template)?.[0] ?? "";
    expect(block).toContain('class="sidebar-workdir"');
    expect(block).toContain("{{ workspace.title }}");
    expect(block).toContain("工作目录：{{ workspace.rootPath }}");
    expect(block).toContain(':title="workspace.rootPath"');
    // 这一行没有动作可谈 ⇒ 不许长出按钮或链接（点了没反应的 button 就是摆设）。
    expect(block).not.toMatch(/<(button|a)\b/);
    // 反向：没开书时整行不进 DOM，也不许预先糊一个假路径上去。
    expect(template).toContain('v-if="workspace"');
    expect(template).not.toContain("墨宸AI\\");
  });
});

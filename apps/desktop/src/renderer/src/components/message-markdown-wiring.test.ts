/**
 * 对话正文渲染与输入卡聚焦态的守卫（2026-10-10）。
 *
 * 两条都是**读源码**钉的，因为它们都不会被 tsc 拦住：
 *
 * ① **助手正文此前压根没有渲染**。`.message-content` 的类名写着 `message-markdown`、
 *   `theme-runtime.css` 里 `.message-markdown pre/code/a` 的样式也早写好了，
 *   可模板是 `<p class="message-text">{{ block.text }}</p>`——纯文本插值。
 *   于是模型吐什么符号就显示什么符号（`**粗体**`、`## 标题`、`- 列表`、代码围栏）。
 *   类名承诺了、样式铺好了、渲染没接上——三样里缺最要紧的那一样，肉眼根本看不出「缺」。
 *
 * ② **点输入框弹出亮框**。`theme-runtime.css` 有一条把 `.composer:focus-within` 和
 *   `.dialog-content textarea:focus` 写在一起的选择器，给了 accent 边框 + 3px 光环。
 *   输入卡是每句话都要点一下的地方，点一下整张卡内侧就弹出一圈亮框。
 *   光环还有第二个副作用：`box-shadow` 是单值属性，它把 `agent-pane.css` 的景深阴影
 *   **整个盖掉**，所以聚焦那一刻卡片反而变扁了。
 */
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  styleSource,
  strippedStyleSource,
  tagAttributes,
  templateSource
} from "../utils/vue-source-reader";

const TIMELINE = "components/AgentTimeline.vue";

describe("AgentTimeline · 助手正文真的走 markdown 渲染", () => {
  it("v-html 那一格调用的是**共享**渲染器，不是本仓第二份实现", () => {
    const script = scriptSource(TIMELINE);
    expect(script).toContain('from "@mochen/fs-store/export-shared"');
    expect(script).toContain("markdownToSimpleHtml");
    // 反向钉：渲染层不许引 fs-store 的 barrel（会把 Node 模块拖进 bundle，见 check-package-boundary）。
    //
    // **这条断言本身不能写成「from + 引号 + 包名」的字面量**：那正是边界检查器
    // SPECIFIER 正则 `(?:from|import)\s*\(?\s*["']…` 要找的形状，于是这条守卫文件
    // 自己被判成违规（2026-10-10 真撞过，边界检查当场把本文件报出来）。
    // 所以这里写成正则源：`from` 后面跟的是字面的 `\s` 两个字符而不是空白，扫不到。
    expect(script).not.toMatch(/from\s+["']@mochen\/fs-store["']/);
  });

  it("模板用的是 v-html，**正文那格不许退回纯文本插值**", () => {
    const tpl = templateSource(TIMELINE);
    expect(tpl).toContain('v-html="messageHtml(block.text)"');
    // 不能断言「`{{ block.text }}` 全文一处不许有」——它本来就该剩四处，而且每一处都是对的：
    // 你自己发的消息（user-text）、思考摘要的预览与正文（thinking-peek / thinking-text）、
    // 主进程写的报错回执（error-line）。这四样都不是模型吐的 markdown，
    // 把它们也渲染一遍才会出事（用户打的字里一个 * 变成斜体、报错里的 JSON 被吃掉尖括号）。
    // 所以这里钉的是**正文那一格**。
    expect(tpl).not.toMatch(/class="message-text"[^>]*>\s*\{\{/);
  });

  it("外层从 `<p>` 换成块级容器：渲染器输出自带 `<p>`，再套一层就是非法嵌套", () => {
    const tpl = templateSource(TIMELINE);
    // message-text 那一格不能还是 <p>（浏览器会自动拆开，间距全乱）。
    expect(tpl).not.toMatch(/<p class="message-text"/);
    expect(tpl).toContain('<div class="message-text" v-html="messageHtml(block.text)" />');
  });

  it("tail-flag 仍与正文平级（在 v-html 那一格之外，不会被 v-html 抹掉）", () => {
    const tpl = templateSource(TIMELINE);
    expect(tpl).toContain('class="tail-flag"');
    expect(tpl).toContain('v-if="block.interrupted"');
  });

  it("错误那一行仍是纯文本（报错是系统自己写的，不是模型吐的 markdown），并在前面标出发生时间", () => {
    const tpl = templateSource(TIMELINE);
    const line = /<p v-else-if="block\.kind === 'error'"[\s\S]*?<\/p>/.exec(tpl)?.[0] ?? "";
    expect(line, "错误那一行读不到").not.toBe("");
    // 纯文本插值：这一行不许走 v-html（走 v-html 的只有正文那一格）。
    expect(line).toContain("{{ block.text }}");
    expect(line).not.toContain("v-html");
    // 2026-10-23：前面挂一格时间戳——回放旧会话时，一屏失败条没有日期就等于「应用现在坏了」。
    expect(line).toContain("formatHistoryTime(block.at)");
  });
});

describe("message-markdown · 渲染出来的块级元素要排得住", () => {
  const css = () => styleSource("agent-pane.css");

  it("正文容器不再是 pre-wrap：块标签之间的换行会被它变成空白行", () => {
    const block = ruleBlock(css(), ".message-text");
    expect(block).not.toContain("pre-wrap");
    expect(block).toContain("white-space: normal");
  });

  it("块级元素外边距归零，且相邻块之间留一点气口", () => {
    const all = css();
    expect(all).toContain(".message-markdown p,");
    expect(all).toMatch(/\.message-markdown > \* \+ \*/);
    expect(all).toContain("margin-top: 0.6em");
  });

  it("列表有缩进可继承（外边距归零之后 padding 是唯一的缩进来路）", () => {
    expect(css()).toContain("padding-left: 1.5em");
  });

  it("**编号与圆点显式写回**：`styles.css` 那条全局 `ul, ol { list-style: none }` 会覆盖到正文", () => {
    // 2026-10-10 真机撞出来的第二个原因，与「没有 `<ol>`」互相独立：
    // 渲染器补上 `<ol>` 之后，DOM 里三个 `<li>` 齐活、padding 也在，**屏上一个号都没有**——
    // `styles.css:147` 的全局 reset 把 ::marker 关了。只钉「有 `<ol>`」的守卫照样全绿。
    // 写法照 editor-pane.css 的 `.markdown-body ul/ol`（文稿预览那边早踩过同一条）。
    //
    // **不能用 ruleBlock**：`.message-markdown ul,\n.message-markdown ol {` 那条合并规则
    // 的选择器里也含 `.message-markdown ol`，ruleBlock 命中的是它，于是拿到 padding 那块正文。
    // 所以钉成「`ol {` 后面第一件事就是 list-style-type」——容忍换行，且不会被合并规则冒充。
    expect(css()).toMatch(/\.message-markdown ol\s*\{\s*list-style-type:\s*decimal/);
    expect(css()).toMatch(/\.message-markdown ul\s*\{\s*list-style-type:\s*disc/);
  });

  it("代码块有自己的面与圆角，行内代码只有一点点内边距", () => {
    expect(css()).toContain(".message-markdown pre {");
    expect(css()).toContain(".message-markdown pre code {");
  });

  it("流式光标挂在**最后一个渲染块**上，不是容器上", () => {
    const all = css();
    // 挂在容器上 ⇒ ::after 落到最后一个块之后、另起一行，像断在正文下面。
    expect(all).not.toContain(".message-line.is-streaming .message-text::after");
    expect(all).toContain(".message-line.is-streaming .message-text > :last-child::after");
  });
});

describe("输入卡聚焦态 · 那个亮框不许回来", () => {
  const theme = () => strippedStyleSource("theme-runtime.css");

  it("输入卡**没有** 3px 光环，也不许被换成 accent 边框", () => {
    const all = theme();
    // 这两条曾经长在同一句里（与对话框的输入框共用）。
    expect(all).not.toMatch(/composer:focus-within[\s\S]{0,160}box-shadow/);
    const block = ruleBlock(all, "html[data-theme] .composer:focus-within .composer-input-surface");
    expect(block).not.toContain("box-shadow");
    expect(block).not.toContain("var(--accent);");
  });

  it("对话框里的输入框**焦点环仍在**（表单字段、Tab 得到，环是唯一提示）", () => {
    const all = theme();
    expect(all).toContain("html[data-theme] .dialog-content textarea:focus");
    expect(all).toMatch(/dialog-content textarea:focus\s*\{[^}]*box-shadow: 0 0 0 3px/);
  });

  it("反向钉：输入卡与对话框不许再共用同一条选择器", () => {
    expect(theme()).not.toMatch(
      /:where\(\s*\.composer:focus-within[\s\S]*\.dialog-content textarea:focus/
    );
  });

  it("输入卡的景深阴影没被盖掉：那条规则里没有 box-shadow 参与（专注力的活儿）", () => {
    const block = ruleBlock(
      strippedStyleSource("agent-pane.css"),
      ".composer:focus-within .composer-input-surface"
    );
    expect(block).toContain("box-shadow");
  });
});

describe("对话正文容器本身没被拆散", () => {
  it("message-markdown 那层还在（theme-runtime 里那些 pre/code/a 样式要挂在它身上）", () => {
    const attrs = tagAttributes(templateSource(TIMELINE), "message-content");
    expect(attrs.length).toBeGreaterThan(0);
    expect(attrs.some((a) => a.includes("message-markdown"))).toBe(true);
  });
});

/**
 * 联网来源在工具卡上的接线守卫（2026-10-06 批次 5-⑨）。
 *
 * **为什么这一节值得单钉**：来源是「用户能点开去核对」的唯一出口，而它整条链跨了六层——
 * contracts 的 `webSourceSchema` → 主进程 ToolOutcome.sources → tool-loop 的事件 → preload 的
 * event 透传 → timeline 的归一 → 工具卡的模板与那条唯一的 URL 通道。
 * 任何一层悄悄漏掉，界面都**不报错**：要么来源整块不显示（用户以为没搜到），
 * 要么点不开（用户以为是自己网络的问题）。`.vue` 零自动化覆盖，所以这里读源码钉接线形状。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS } from "@mochen/contracts";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

// timeline.ts 是 .ts 不是 .vue，scriptSource 只认 .vue 的 <script setup>，所以这里直接读文件。
const timeline = readFileSync(
  fileURLToPath(new URL("../utils/timeline.ts", import.meta.url)),
  "utf8"
);
const cardTpl = templateSource("components/AgentTimeline.vue");
const cardScript = scriptSource("components/AgentTimeline.vue");
const linkPolicy = readFileSync(
  fileURLToPath(new URL("../../../main/web-source-link.ts", import.meta.url)),
  "utf8"
);
const preload = readFileSync(
  fileURLToPath(new URL("../../../preload/renderer-api.ts", import.meta.url)),
  "utf8"
);
const css = readFileSync(
  fileURLToPath(new URL("../styles/agent-pane.css", import.meta.url)),
  "utf8"
);
const webSearch = readFileSync(
  fileURLToPath(new URL("../../../main/web-search.ts", import.meta.url)),
  "utf8"
);

describe("来源从事件一路走到卡片", () => {
  it("timeline 取的是 event.sources 且归一成数组，不是从 resultText 里抠 URL", () => {
    // 2026-10-06 批次 5-⑪：这一行从内联字段改成了先取局部变量（`rawFolded` 要用同一份），
    // 所以断言跟到归一那一步本身，不再钉某一种写法——钉字面量会在重构时假红。
    expect(timeline).toMatch(/const sources = event\.sources \?\? \[\];/);
    // 这条是本节最关键的负向判据：从回执文本反解链接等于把排版当数据源，
    // 改个版式（编号换成来源键）链接就全丢，而且丢得不报错。
    expect(timeline).not.toMatch(/resultText\.(match|split|replace)\([^)]*https/);
  });

  it("工具卡模板渲染来源清单：来源键、标题、摘要，且没有 <style> 内联", () => {
    expect(cardTpl).toContain("tool-sources");
    expect(cardTpl).toContain("source-list");
    expect(cardTpl).toContain("source-key");
    expect(cardTpl).toContain("source-title");
    expect(cardTpl).toContain("source-snippet");
    expect(cardTpl).toContain('@click="openSource(source.url)"');
    expect(cardTpl).not.toContain("<style");
  });

  it("清单里显示的是来源键而不是序号：一轮里可能搜好几次，序号会撞车（批次 5-⑩）", () => {
    expect(cardTpl).toContain("{{ sourceKey(source.url) }}");
    // 负向判据：把键换回 index + 1 不会让任何东西报错，只是模型写出的「据来源[2]」
    // 在两张工具卡上指代不明，且不报错——只搜一次时它还对，所以只搜一次永远照不出来。
    expect(cardTpl).not.toContain("{{ index + 1 }}");
    // 卡头原话是「这一轮搜到的 N 条」，而一轮里可能有好几次搜索，两张卡都说「这一轮」。
    expect(cardTpl).toContain("这次搜索找到");
    expect(cardTpl).not.toContain("这一轮搜到");
  });

  it("卡上的来源键与回执里的编号是同一个函数算的（两边各算一份就是两份实现）", () => {
    expect(cardScript).toContain("sourceKey");
    expect(cardScript).toContain('from "@mochen/contracts"');
    expect(webSearch).toContain("sourceKey");
    expect(webSearch).toMatch(/import \{ sourceKey \} from "@mochen\/contracts"/);
    // 回执里不许再出现按下标生成的编号。
    expect(webSearch).not.toMatch(/\[\$\{i \+ 1\}\]/);
  });

  it("来源清单外面还留着那份纯文本回执：它是给模型读的，折叠与否都不影响它进上下文", () => {
    expect(cardTpl).toContain("tool-result");
  });

  /**
   * 批次 5-⑪：回执折起来是**条件**的，条件住 utils/timeline.ts（`rawFolded`），
   * 模板只读那个字段。这里钉的是两件事：模板里不许自己再判一次，
   * 以及 `.tool-raw` 这个类在样式表里真的有规则——自定义类没有规则不会报错，
   * 只是那个元素怎么都不对劲，而界面上「就是没生效」，极难定位。
   */
  it("回执折叠的判定只在 timeline.ts 一处，模板读字段不自判", () => {
    expect(cardTpl).toContain(':open="!block.rawFolded"');
    expect(cardTpl).toContain("原始回执");
    // 模板里不许在 :open 上再判一次「有没有来源」——那才是同一判断的第二份实现。
    // （`.tool-sources` 自己的 `v-if="block.sources.length > 0"` 是另一回事：
    //   它答的是「清单该不该渲染」，与「回执折不折」无关，不能一起禁。）
    expect(cardTpl).not.toMatch(/:open="[^"]*block\.sources/);
    expect(timeline).toContain("rawFolded: sources.length > 0");
  });

  it("点开只走 preload 那一条，不开 <a href> 让渲染层自己跳", () => {
    expect(cardScript).toContain("window.mochen.openWebSource(url)");
    // <a href> 在 Electron 里会开新窗口或被拦，两者都不是「叫起系统浏览器」。
    expect(cardTpl).not.toMatch(/<a[^>]+href/);
  });

  it("主机名判据收在共享函数里，组件不自己 new URL", () => {
    expect(cardScript).not.toContain("new URL(");
  });
});

describe("唯一那条递 URL 的通道", () => {
  it("preload 原样递，不改写 URL（主进程的白名单只认原串）", () => {
    expect(preload).toContain(
      "openWebSource: (url: string) => invoke(IPC_CHANNELS.appOpenWebSource, url)"
    );
  });

  it("主进程那道闸只放行 http/https，且策略写在一个文件里（不是散在 handler 里）", () => {
    expect(linkPolicy).toContain('parsed.protocol !== "http:" && parsed.protocol !== "https:"');
    expect(linkPolicy).toContain("username");
    expect(IPC_CHANNELS.appOpenWebSource).toBe("app:open-web-source");
  });

  it("来源清单里每个自定义类在样式表里都有对应的一条，且 focus-visible 单独写了", () => {
    // 这条断言的用意是「模板里不许冒出一个样式表里没有的类」——那种类不会报错，
    // 只是那个元素怎么都不对劲，而界面看上去「就是没生效」，极难定位。
    // <li> 本身没给类：布局由 .source-list 的 flex+gap 管，挂了类又没规则只是死 CSS。
    for (const cls of [
      ".tool-sources",
      ".source-list",
      ".source-open",
      ".source-key",
      ".source-title",
      ".source-snippet",
      ".tool-raw"
    ])
      expect(css, `样式表里没有 ${cls}`).toContain(cls);
    // 键盘走不到按钮是「点不开」的一种，只写 hover 的话没人会发现。
    expect(css).toMatch(/\.source-open:focus-visible/);
  });
});

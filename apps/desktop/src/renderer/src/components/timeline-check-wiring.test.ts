import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";

/**
 * 时间线一致性检查的**接线契约**（2026-10-05，批次 5-①）。
 *
 * 判定与日期算术在 `packages/contracts/timeline-check.ts`（那里有 34 条真单测），
 * 本文件只钉「接没接上」——本仓 `.vue` 不进类型程序，组件里漏一个 import 编译器不报、运行时才炸
 * （批次 4-① 就在 `CenterColumn.vue` 上真撞到过一次 `workModeOf` 未导入）。
 *
 * 钉的七件事：
 * ① 两个入口（右栏头部按钮 + 左栏「时间线核对」）共用 store 那一格，不许各持一个本地布尔；
 * ② 读的是**全部** timeline 文稿，不受当前打开哪一篇影响；
 * ③ 读不到的照样列出来——凭空从台账上消失的那条时间线，恰恰是最该被看见的那条；
 * ④ 日期写坏与没写日期是**两回事**：前者报问题，后者只是「还没排期」；
 * ⑤ 三段式结构（4-② 的教训：sticky 按钮会压住内容）；
 * ⑥ 「查不出的那两项」单列一块，且不许和「查得出的」混成一张列表；
 * ⑦ 样式表接上了、新浮层挂在同一张动效表上。
 */
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const panelScript = scriptSource("components/TimelineCheckPanel.vue");
const panelTpl = templateSource("components/TimelineCheckPanel.vue");
const sidebarScript = scriptSource("components/LeftSidebar.vue");
const storeScript = readFileSync(new URL("../stores/useTimelineStore.ts", import.meta.url), "utf8");
const css = styleSource("timeline.css");
const stylesCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const icons = readFileSync(new URL("../types/icons.ts", import.meta.url), "utf8");

describe("入口挂在哪", () => {
  it("右栏头部有这颗按钮，禁用条件是「没开书」", () => {
    expect(paneTpl).toContain('aria-label="时间线核对"');
    expect(paneTpl).toContain(':disabled="!book.meta"');
  });

  it("按钮切的是 store 那一格，不是组件本地布尔", () => {
    expect(paneTpl).toContain('@click="void timeline.toggle()"');
    expect(paneTpl).not.toMatch(/timelineOpen\s*=\s*ref/);
  });

  it("左栏那一项走同一个 toggle（两个入口共用一格，不许各持一个）", () => {
    expect(sidebarScript).toContain('child.reality.action === "timeline-ledger"');
    expect(sidebarScript).toContain("void timeline.toggle();");
  });

  it("组件真的 import 了 store（漏 import 编译器不报、运行时才炸，4-① 踩过）", () => {
    expect(paneScript).toContain('import { useTimelineStore } from "../stores/useTimelineStore";');
    expect(sidebarScript).toContain(
      'import { useTimelineStore } from "../stores/useTimelineStore";'
    );
    expect(paneScript).toContain("const timeline = useTimelineStore();");
  });

  it("按钮用的图标名真实存在——挂一个不存在的名字会静默渲染成空白", () => {
    const names = [...paneTpl.matchAll(/<AppIcon name="([a-z-]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(icons).toContain(`| "${name}"`);
    }
  });

  it("浮层挂载条件就是 store 那一格 + 锚点", () => {
    expect(paneTpl).toContain("<TimelineCheckPanel");
    expect(paneTpl).toContain('v-if="timeline.open && timelineAnchor"');
  });
});

describe("读的是哪一份", () => {
  it("扫的是全部 timeline 文稿，不随当前打开的标签变", () => {
    expect(storeScript).toContain('book.docs.filter((d) => d.kind === "timeline")');
    // 反向钉：别哪天顺手改成只查当前打开的那一篇——台账的价值全在「全书还欠什么」。
    expect(storeScript).not.toContain("book.activeDocTab");
  });

  it("一篇读失败不拖垮整表（allSettled）", () => {
    expect(storeScript).toContain("Promise.allSettled");
  });

  it("读不到的那篇照样列出来，并写明读不到", () => {
    expect(storeScript).toContain('dateProblem: "这一篇读不出来，没法排进时间线"');
  });

  it("没开书时给空表而不是抛错", () => {
    expect(storeScript).toContain("if (targets.length === 0)");
  });
});

describe("读盘失败要说人话，不静默", () => {
  it("catch 里写 notice 并清空，绝不留一份半截数据", () => {
    expect(storeScript).toContain("时间线没读回来");
    expect(storeScript).toMatch(/catch \(err\)[\s\S]{0,400}this\.rows = \[\]/);
  });

  it("面板真的把它显示出来", () => {
    expect(panelTpl).toContain("v-if=\"timeline.notice !== ''\"");
    expect(panelTpl).toContain("timeline-check-error");
  });
});

describe("日期写坏 vs 没写日期：两回事", () => {
  it("两种状态有各自的类名，不共用一个（混了就是「还没排期」被当成错）", () => {
    expect(panelScript).toContain("is-unknown");
    expect(panelScript).toContain("is-undated");
  });

  it("「没写日期」在界面上说「未排期」，不说「有问题」", () => {
    expect(panelTpl).toContain("未排期");
    expect(panelTpl).toContain("读不出");
  });

  it("两种状态视觉上分得开：琥珀实边 vs 虚线弱化", () => {
    expect(css).toMatch(/\.timeline-row\.is-unknown\s*\{[^}]*border-left-color:/);
    expect(css).toMatch(/\.timeline-row\.is-undated\s*\{[^}]*border-left-style:\s*dashed/);
  });
});

describe("诚实边界：查不出的那两项单列一块", () => {
  it("用的是 contracts 里的那一份文案，不是组件里另写", () => {
    expect(panelScript).toContain("TIMELINE_BLIND_NOTE");
    expect(panelScript).toContain("TIMELINE_BLIND_SPOT");
    expect(panelTpl).toContain("timeline-blind");
  });

  it("独立区块 + 虚线边，与「查得出的问题」在视觉上分开", () => {
    expect(css).toMatch(/\.timeline-blind\s*\{[^}]*border:\s*1px dashed/);
  });

  it("问题列表与条目列表是两个 `<ul>`，不是混成一张", () => {
    expect(panelTpl).toContain("timeline-check-issues");
    expect(panelTpl).toContain("timeline-check-list");
  });
});

describe("结构：主区自己滚，不靠 sticky", () => {
  it("有滚动体且带 overflow-y: auto", () => {
    expect(panelTpl).toContain('class="timeline-check-body"');
    expect(css).toMatch(/\.timeline-check-body\s*\{[^}]*overflow-y:\s*auto/);
  });

  // 4-② 的教训：sticky 只保证不滚出视口，不保证不压内容。
  it("本浮层没有 sticky 按钮这种结构", () => {
    expect(css).not.toContain("position: sticky");
  });
});

describe("样式表接上了", () => {
  it("timeline.css 挂进 styles.css", () => {
    expect(stylesCss).toContain('@import "./styles/timeline.css";');
  });

  it("动效表里有它（推导式守卫会点名，但这里先钉住意图）", () => {
    const motion = readFileSync(new URL("../styles/motion.css", import.meta.url), "utf8");
    expect(motion).toContain(".timeline-check");
  });
});

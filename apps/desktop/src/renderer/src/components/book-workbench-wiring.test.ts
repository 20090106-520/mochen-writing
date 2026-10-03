/// <reference types="node" />
/**
 * 源码契约测试（task #102，示意稿 A）：`.vue` 在本仓既不过 tsc 也没有组件测试环境，
 * 于是「中栏工作台照的是示意稿、每枚按钮都有真身」只能钉在源码字符串上（一份真身：utils/vue-source-reader.ts）。
 * 钉四件事：
 * ① hero 用的是**品牌原图整幅**（CSS 里 object-fit 必须是 contain，cover 就是裁切，违「原图原样用」）；
 * ② 五张卡的图标表与预填句**不在 .vue 里重抄**，一律从 utils/workbench-state 读（铁律 6）；
 * ③ 能力气泡是静态说明，不假造时间戳、不冒充一条真发过的对话；
 * ④ 建议 pill 的两条出路各有真身：prefill ⇒ agent.prefillComposer(...)，palette ⇒ 同一个 paletteOpen 开关。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const script = scriptSource("components/BookWorkbench.vue");
const template = templateSource("components/BookWorkbench.vue");
const center = vueSource("components/CenterColumn.vue");
const css = vueSource("styles/conversation-pane.css");

describe("BookWorkbench · hero 用品牌原图整幅（示意稿 A）", () => {
  it("hero 段落存在，图从 assets/brand 来且带 alt 文字", () => {
    expect(template).toContain('class="workbench-hero"');
    expect(template).toContain('class="workbench-hero-art"');
    expect(template).toContain(':src="brandMark"');
    expect(template).toMatch(/class="workbench-hero-art"[\s\S]{0,120}alt="墨宸 AI/);
    expect(script).toContain('import brandMark from "../assets/brand/mochen-lockup.jpg"');
  });

  it("引言与标题读的是 utils 的常量，不在模板里写死第二份", () => {
    expect(script).toContain("WORKBENCH_HERO_QUOTE");
    expect(template).toContain("{{ WORKBENCH_HERO_QUOTE }}");
    expect(template).toContain("{{ agentLabel }}");
  });

  it("CSS 里 hero 图是 contain 整幅显示，不是 cover 裁切（品牌原图铁律）", () => {
    const block = /\.workbench-hero-art\s*{([^}]*)}/.exec(css)?.[1];
    expect(block).toBeDefined();
    expect(block).toContain("object-fit: contain");
    expect(block).not.toContain("object-fit: cover");
  });
});

describe("BookWorkbench · 五张卡与两张填字卡的单一真身", () => {
  it("卡片遍历 cards、disabled 认 card.enabled、图标名从 WORKBENCH_CARD_ICONS 取（.vue 里没有本地图标表）", () => {
    expect(template).toContain('v-for="card in cards"');
    expect(template).toMatch(/class="workbench-card"[\s\S]{0,160}:disabled="!card\.enabled"/);
    expect(template).toContain("WORKBENCH_CARD_ICONS[card.id]");
    expect(script).not.toMatch(/const CARD_ICONS/);
    expect(script).toContain("WORKBENCH_CARD_ICONS");
  });

  it("事件面只有两条：pick(卡) 与 suggestion(pill)，都是装配处有真身的动作", () => {
    expect(script).toMatch(/pick: \[id: WorkbenchCardId\]/);
    expect(script).toMatch(/suggestion: \[suggestion: WorkbenchSuggestion\]/);
  });
});

describe("BookWorkbench · 能力气泡说实话", () => {
  it("六条清单读的是 utils 的表，且整块只在有书时出现", () => {
    expect(script).toContain("WORKBENCH_CAPABILITIES");
    expect(template).toContain('class="workbench-intro"');
    expect(template).toContain('v-for="line in WORKBENCH_CAPABILITIES"');
    expect(template).toMatch(/v-if="hasBook"[\s\S]{0,40}class="workbench-intro"/);
    // 反向：六条不许在模板里各写一遍（表只有一份，模板只遍历）。
    expect(template).not.toContain("改稿：先整篇读");
  });

  it("不假造时间戳、不冒充对话项（示意稿那个 10:24 是真的会话时间，我们这里没有会话）", () => {
    expect(template).not.toMatch(/\d{1,2}:\d{2}/);
    expect(template).not.toContain("agent-message");
  });
});

describe("BookWorkbench · 建议 pill 的两条出路接到真身", () => {
  it("pill 遍历 suggestions、整块 v-if 认数组非空，点击抛 suggestion 事件", () => {
    expect(template).toContain('class="workbench-suggestions"');
    expect(template).toContain('v-for="item in suggestions"');
    expect(template).toMatch(/v-if="suggestions\.length"/);
    expect(template).toContain("@click=\"emit('suggestion', item)\"");
    // 出路说明的载体必须是 pill 上的 title：常量表在 .ts 里改一遍不算接通（M5 变异目标）。
    expect(template).toMatch(
      /class="workbench-suggestion"[\s\S]{0,160}:title="WORKBENCH_SUGGESTION_TITLES\[item\.kind\]"/
    );
    expect(script).toContain("WORKBENCH_SUGGESTION_TITLES");
  });

  it("装配处：prefill 一类调 agent.prefillComposer(threadKeyFor(target), ...)，palette 一类开同一个 paletteOpen", () => {
    expect(center).toContain("WORKBENCH_CARD_PREFILL");
    expect(center).toMatch(
      /agent\.prefillComposer\(threadKeyFor\(target\), (?:suggestion\.prefill|text)\)/
    );
    expect(center).toMatch(/kind === "palette"[\s\S]{0,120}paletteOpen\.value = true/);
    // 反向：装配处不重抄句子——中栏里出现的预填字面量只该是 import 来的常量名。
    expect(center).not.toContain("给我三个能接着往下写的点子");
    expect(center).not.toContain("我想改这一章：");
  });
});

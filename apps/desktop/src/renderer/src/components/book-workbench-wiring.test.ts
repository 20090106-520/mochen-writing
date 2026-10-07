/// <reference types="node" />
/**
 * 源码契约测试（task #102，示意稿 A）：`.vue` 在本仓既不过 tsc 也没有组件测试环境，
 * 于是「中栏工作台照的是示意稿、每枚按钮都有真身」只能钉在源码字符串上（一份真身：utils/vue-source-reader.ts）。
 * 钉四件事：
 * ① hero 用的是**品牌原图整幅**（CSS 里 object-fit 必须是 contain，cover 就是裁切，违「原图原样用」）；
 * ② 五张卡的图标表与预填句**不在 .vue 里重抄**，一律从 utils/workbench-state 读（铁律 6）；
 * ③ 能力气泡是静态说明，不假造时间戳、不冒充一条真发过的对话；
 * ④ 建议 pill 的两条出路各有真身：prefill ⇒ agent.prefillComposer(...)，palette ⇒ 同一个行内菜单入口。
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

/**
 * 空状态的视觉层级（2026-10-05）：无书时 hero 里那个 h1 读的是 agentLabel，
 * 值是「未选择作品」——它是**状态标签**，不是标题。与下面「还没有打开作品目录…」
 * 同权摆成两个大标题，等于把同一件事说了两遍。所以无书时压成 eyebrow，
 * 主视觉重量交给下面那颗主 CTA。钉住这条，免得哪天悄悄退回两个大标题。
 */
describe("BookWorkbench · 空状态不把同一件事说两遍", () => {
  it("hero 挂 is-no-book 状态钩子，CSS 据此撤掉重复的状态词与空壳卡面", () => {
    expect(template).toContain(":class=\"{ 'is-no-book': !hasBook }\"");
    // 顶栏已经写着「未选择作品」，hero 里那个 h1 读的是同一个 agentLabel ——
    // 第二次出现哪怕很小也是噪音，直接不渲染（2026-10-05 实机截图）。
    const h1 = /\.workbench-hero\.is-no-book h1\s*{([^}]*)}/.exec(css)?.[1];
    expect(h1, "缺 .workbench-hero.is-no-book h1 这条规则").toBeDefined();
    expect(h1).toContain("display: none");

    // 无书时 hero 退回成一段安静的介绍文字：卡面（边/底/影）撤掉，logo 提到上方居中。
    const hero = /\.workbench-hero\.is-no-book\s*{([^}]*)}/.exec(css)?.[1];
    expect(hero, "缺 .workbench-hero.is-no-book 这条规则").toBeDefined();
    expect(hero).toContain("flex-direction: column");
    expect(hero).toMatch(/border-color:\s*transparent/);
    expect(hero).toMatch(/background:\s*transparent/);
    expect(hero).toMatch(/box-shadow:\s*none/);
  });

  it("主 CTA 沿用 .dialog-primary-button 的实心口径，深色那一层归 theme-runtime 那张表", () => {
    const primary = /\.workbench-open-book\.is-primary\s*{([^}]*)}/.exec(css)?.[1];
    expect(primary).toBeDefined();
    expect(primary).toContain("background: var(--neutral-solid)");
    expect(primary).toContain("color: var(--neutral-solid-contrast)");
    // 深色主按钮统一转 accent 的只有 theme-runtime.css 一处；别在自家样式里分家。
    expect(vueSource("styles/theme-runtime.css")).toContain(".workbench-open-book.is-primary");
  });

  // 2026-10-05：上面那条断言只是「字符串出现过」，漏掉了一个真 bug。
  // 基线选择器 .workbench-open-book.is-primary 是 (0,2,0)，而暗色那张表是
  // `html[data-theme="dark"] :where(…)` = (0,1,1)（:where 不加权重）——
  // 表里那条 workbench-open-book.is-primary 永远压不过基线，暗色下等于没写。
  // 这里改成断言它必须以「自带权重的独立选择器」出现，塞进 :where() 一律不算。
  it("暗色主 CTA 必须真压得住基线：不能只挂在 :where() 那张零权重表里", () => {
    const runtime = vueSource("styles/theme-runtime.css");
    // 独立规则：html[data-theme="dark"] .workbench-open-book.is-primary { … }
    const standalone =
      /html\[data-theme="dark"\]\s+\.workbench-open-book\.is-primary\s*{([^}]*)}/.exec(runtime);
    expect(
      standalone,
      '缺 html[data-theme="dark"] .workbench-open-book.is-primary 独立规则：' +
        "塞进 :where() 表里会被 (0,2,0) 的基线压住，暗色下等于没转 accent"
    ).toBeDefined();
    expect(standalone![1]).toContain("background: var(--accent)");
    expect(standalone![1]).toContain("color: var(--accent-contrast");
    // 那张零权重表里不许再留这条：留着就是一条永不生效的死条目，会骗后来人。
    const zeroWeight = /:where\([^)]*workbench-open-book\.is-primary[^)]*\)/.exec(runtime);
    expect(
      zeroWeight,
      ":where() 表里还挂着 workbench-open-book.is-primary —— 它权重为 0，永远不生效，删掉"
    ).toBeNull();
  });
});

describe("BookWorkbench · 五张卡与两张填字卡的单一真身", () => {
  it("卡片遍历 cards、五张一律可点（无目标也发 pick 走引导），图标名从 WORKBENCH_CARD_ICONS 取", () => {
    expect(template).toContain('v-for="card in cards"');
    // 2026-10-05 裁定：空卡不再 disabled（与侧边栏「全部可点」同源）；
    // 悬停文案的判定收在 utils 的 workbenchCardTitle，模板不抄第二份 target 判空。
    expect(template).not.toContain(':disabled="!card.enabled"');
    expect(template).toContain(':title="workbenchCardTitle(card)"');
    expect(template).toContain("WORKBENCH_CARD_ICONS[card.id]");
    expect(script).not.toMatch(/const CARD_ICONS/);
    expect(script).toContain("WORKBENCH_CARD_ICONS");
  });

  it("空卡的真响应：中栏请左栏引导（requestDocGroup），左栏拿同一个 guideToDoc 兑现", () => {
    // 中栏没有树，不许抄一份开合逻辑：它只发「请引导到这一类」，兑现方是左栏。
    expect(center).toMatch(/target === null[\s\S]{0,120}layout\.requestDocGroup\(card\.kind\)/);
    const sidebar = vueSource("components/LeftSidebar.vue");
    expect(sidebar).toMatch(/watch\([\s\S]{0,140}layout\.docGroupRequest/);
    expect(sidebar).toMatch(/guideToDoc\(kind\)/);
    expect(sidebar).toContain("layout.clearDocGroupRequest()");
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

  it("装配处：prefill 一类调 agent.prefillComposer(threadKeyFor(target), ...)，palette 一类走同一个行内菜单入口", () => {
    expect(center).toContain("WORKBENCH_CARD_PREFILL");
    expect(center).toMatch(
      /agent\.prefillComposer\(threadKeyFor\(target\), (?:suggestion\.prefill|text)\)/
    );
    // #106 裁定 D1：第二块命令面板（SlashPalette + 其 paletteOpen ref）已退役，
    // pill 的出路仍与裸 / 键、`/ 命令` chip 共用同一处入口 ⇒ 钉子跟着搬到行内菜单的 summon，语义一字未松。
    expect(center).toMatch(/kind === "palette"[\s\S]{0,120}referenceMenu\.summon\("\/"\)/);
    // 反向：装配处不重抄句子——中栏里出现的预填字面量只该是 import 来的常量名。
    expect(center).not.toContain("给我三个能接着往下写的点子");
    expect(center).not.toContain("我想改这一章：");
  });
});

/**
 * canvas-ui 品牌粒子（无书空状态的创意画布时刻）：引擎真身在 utils/canvasui/（拆分自上游
 * DavidHDev/canvas-ui 的 ParticleObject，ATTRIBUTION.md 有登记）。钉三件事：
 * ① 粒子只在无书空状态跑——写作时不耗 GPU；② 失败回退品牌原图（原图原样用不裁切）；
 * ③ 引擎逻辑不许抄进 .vue（薄壳只 import）。
 */
describe("BookWorkbench · 品牌粒子（canvas-ui，无书空状态）", () => {
  it("粒子画布挂 v-if=!hasBook 且有失败回退：v-else 的静态原图仍在", () => {
    expect(template).toContain("<ParticleObject");
    expect(template).toContain('v-if="!hasBook && !particleFailed"');
    expect(template).toContain("v-else");
    expect(template).toContain('alt="墨宸 AI 品牌图"');
    expect(template).toContain(':on-error="() => (particleFailed = true)"');
    expect(script).toContain("const particleFailed = ref(false)");
  });

  it("薄壳不藏引擎：ParticleObject.vue 只从 utils/canvasui 拿 createParticleObject", () => {
    const shell = vueSource("components/canvasui/ParticleObject.vue");
    expect(shell).toContain('from "../../utils/canvasui/particle-object"');
    expect(shell).not.toContain("three");
    expect(shell).not.toContain("WebGLRenderer");
  });
});

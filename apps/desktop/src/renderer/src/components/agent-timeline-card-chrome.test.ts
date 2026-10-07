/**
 * 时间线里「过程件」的视觉分级守卫（2026-10-06 批次 5-⑪）。
 *
 * **为什么值得单钉**：时间线是用户全程盯着的那块，而「这个块该不该长成一张卡」
 * 是**纯视觉判断**——判错不报错、不抛异常，工具链全绿，界面上只是一堆说不清别扭的框。
 * 本仓 `.vue` 零自动化覆盖，所以这类判断只能读样式表源码钉住形状。
 *
 * 钉两条，各带一次真机读数：
 *  ① **思考摘要折起来时不是卡**。它原来与工具卡/提案卡共用那套卡框，折叠态就是一条
 *     36px 的空壳标题栏，一轮里出现两次，看上去像两张卡卡住了（真机截图即如此）。
 *     现在卡框整套挂在 `.thinking-card[open]` 上：折起来是一行安静灰字，展开才成卡。
 *  ② **原始回执折起来**。`.tool-raw` 是新加的 details，工具卡因此从 398px 降到约 300px，
 *     且先看到的是可点的来源清单而不是 360 的 base64 跳转链。
 *
 * 读法走 vue-source-reader（剥注释），否则「这里没有 X」这句话本身写着 X。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, styleSource, templateSource } from "../utils/vue-source-reader";

const CARD = styleSource("agent-pane.css");
const cardTpl = templateSource("components/AgentTimeline.vue");

/**
 * 取出「`anchor` 这条规则」的完整选择器文本：定位到 anchor（**含结尾的 `{`**）之后往回扫到
 * 上一个 `}`，于是最后一行那个选择器本身也在里面。
 *
 * 没有它的话「thinking 不在卡框那组里」只能拿一个写死的字符串去比——那种断言改 CSS 时
 * 不会红（它比的是测试自己），2026-10-06 第一次变异就是这么漏网的一条。
 */
function selectorBefore(css: string, anchor: string): string {
  const at = css.indexOf(anchor);
  if (at === -1) return "";
  // 只认 `}` 作为上一条规则的边界：`{` 在这里会命中 anchor 自己那个，取 max 就切成空串，
  // 断言会**恒红**（未改动的代码也红）——那种红是假的，比不红更费时间。
  const head = css.slice(0, at + anchor.length);
  return head.slice(head.lastIndexOf("}") + 1);
}

const CARD_CHROME_ANCHOR = ".proposal-card {";

describe("思考摘要：折起来不是一张卡", () => {
  it("它不在「工具卡/提案卡」那组共用卡框里", () => {
    const block = ruleBlock(CARD, ".plan-card,\n.tool-card,\n.proposal-card");
    expect(block).toContain("border: 1px solid var(--line-soft)");
    // 判据本身：thinking 混进那组选择器 ⇒ 折叠态又戴上了卡框。
    const selector = selectorBefore(CARD, CARD_CHROME_ANCHOR);
    expect(selector).toContain(".proposal-card");
    expect(selector).not.toContain("thinking-card");
  });

  it("卡框整套挂在 [open] 上，折起来只剩一行安静注脚", () => {
    const open = ruleBlock(CARD, ".thinking-card[open]");
    expect(open).toContain("border: 1px solid var(--line-soft)");
    expect(open).toContain("border-radius: 12px");
    expect(open).toContain("box-shadow:");
    // 折起来那档：没有边框、没有阴影，字号也退到注脚级。
    const closed = ruleBlock(CARD, ".thinking-card");
    expect(closed).not.toContain("border:");
    expect(closed).not.toContain("box-shadow:");
  });

  it("展开时 summary 回到卡内边距，折叠时不占那一档", () => {
    expect(ruleBlock(CARD, ".thinking-card[open] summary")).toContain("padding: 9px 12px");
    expect(ruleBlock(CARD, ".thinking-card summary")).toContain("padding: 4px 12px");
  });
});

describe("工具卡：原始回执折起来", () => {
  it("模板里是 details，不是裸 <pre>：裸的没法折，360 的跳转链会摊满整张卡", () => {
    expect(cardTpl).toContain('class="tool-raw"');
    expect(cardTpl).toContain("原始回执");
    // pre 还在，但它必须在 details 里面。
    expect(cardTpl).toMatch(/<details[^>]*class="tool-raw"[\s\S]*?<pre class="tool-result">/);
  });

  it("折行那枚 summary 的自定义类都在样式表里有规则", () => {
    expect(ruleBlock(CARD, ".tool-raw > summary")).toContain("cursor: pointer");
    // 展开时三角转向：details[open] 命中 summary 里那枚 svg。
    expect(ruleBlock(CARD, ".tool-raw[open] > summary > svg")).toContain("rotate(90deg)");
  });
});

describe("思考摘要：折起来也得有字（2026-10-06 批次 5-⑭）", () => {
  /**
   * 5-⑪ 把折叠态改成了「一行安静灰字注脚」——但注脚上**只有「思考摘要」四个字**，
   * 摘要正文整段还藏在折起来的身体里。真机量到一整轮里三行，每行 24px，
   * 三行加起来信息量是零，看着像卡住了。这批把它补成「一行有内容的字」。
   */
  it("summary 里挂着摘要正文（.thinking-peek），不是只挂一个标签", () => {
    expect(cardTpl).toContain("thinking-peek");
    // 它读的就是 block.text —— 模板不自己截、不自己取首句
    expect(cardTpl).toMatch(/<span class="thinking-peek">\{\{ block\.text \}\}<\/span>/);
  });

  it("折起来时露那行字，展开时让位给正文（不重复一遍）", () => {
    const shown = ruleBlock(CARD, ".thinking-card:not([open]) .thinking-peek");
    expect(shown).toContain("display: block");
    // 默认那档是 display: none —— 展开时 summary 里不该再重复正文
    expect(ruleBlock(CARD, ".thinking-peek")).toContain("display: none");
  });

  it("那行字是单行省略，不能撑成段落把节奏顶乱", () => {
    const peek = ruleBlock(CARD, ".thinking-peek");
    expect(peek).toContain("white-space: nowrap");
    expect(peek).toContain("text-overflow: ellipsis");
    // flex 子项不设 min-width: 0 就不肯收缩，会把 summary 顶宽
    expect(peek).toContain("min-width: 0");
    expect(peek).toContain("overflow: hidden");
  });
});

describe("来源清单：默认只铺开 5 条（2026-10-06 批次 5-⑭）", () => {
  /**
   * 真机量到（必应源十条那一轮）：卡片 874px，清单占 725px，**每条 69px、十条一模一样**
   * ——不是某条特别长，是条数堆的。那一张卡吃掉对话区 70%，
   * 用户那句问和模型那句答都被挤没了。
   */
  it("预览条数住 utils 的常量，模板不自己写死 5", () => {
    expect(cardTpl).toContain("block.sources.slice(0, SOURCE_LIST_PREVIEW)");
    expect(cardTpl).toContain("block.sources.slice(SOURCE_LIST_PREVIEW)");
    // 模板不许出现裸数字 5 —— 那是第二份真身
    expect(cardTpl).not.toMatch(/slice\(0,\s*5\)/);
  });

  it("折叠件把条数说清楚：展开其余 N 条，N 由长度减出来", () => {
    expect(cardTpl).toContain("展开其余");
    expect(cardTpl).toContain("block.sources.length - SOURCE_LIST_PREVIEW");
    expect(cardTpl).toContain("block.sources.length > SOURCE_LIST_PREVIEW");
  });

  it("摘要压成一行", () => {
    const snip = ruleBlock(CARD, ".source-snippet");
    expect(snip).toContain("-webkit-line-clamp: 1");
    expect(snip).toContain("overflow: hidden");
  });

  it("折叠件长成和原始回执同一套观感（省得界面里两种折叠长得不一样）", () => {
    const more = ruleBlock(CARD, ".source-more > summary");
    expect(more).toContain("cursor: pointer");
    expect(ruleBlock(CARD, ".source-more[open] > summary::before")).toContain("rotate(90deg)");
  });
});

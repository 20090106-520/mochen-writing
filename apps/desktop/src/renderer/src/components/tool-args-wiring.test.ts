/**
 * 工具卡的参数行改成人话（2026-10-07 用户裁定：「只显示文字，不用显示代码」）。
 *
 * 【为什么 `tool-args.test.ts` 不够】那 6 条钉的是**纯函数**：`toolArgsText` 会不会把
 * `{"doc":"chapters/01-开局.md",…}` 变成一句「把《01-开局》里的…改成…」。
 * 这一份钉的是**接线**：那句人话有没有真的被摆上卡、有没有被当成代码体画出来。
 * 两者独立——纯函数全对而模板还在直接摆 `event.args`，用户看到的仍是 JSON（源码契约测试查不出来，
 * 因为没有任何一条会去看模板）。
 *
 * 【只动显示这条纪律的正面钉】原始 args 必须仍留在事件里、仍随会话落盘（给模型读与回放用）。
 * 渲染层因此不许出现「就地改写 event.args」这种写法——那会让落盘的数据也变成人话，回放与排查全废。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  styleSource,
  tagAttributes,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const TIMELINE = typeScriptSource("utils/timeline.ts");
const TOOL_ARGS = typeScriptSource("utils/tool-args.ts");
const MARKUP = templateSource("components/AgentTimeline.vue");
const PANE = styleSource("agent-pane.css");

describe("判定只发生一次：人话由 toolArgsText 出，模板与卡片自己不再拼", () => {
  it("timeline 的 tool 分支把 text/plain 一起交出来", () => {
    expect(TIMELINE).toContain("const argsText = toolArgsText(event.tool, event.args);");
    expect(TIMELINE).toContain("args: argsText.text,");
    expect(TIMELINE).toContain("argsPlain: argsText.plain,");
  });

  it("全仓只有一个转人话的地方（第二份实现 = 改一边忘了另一边）", () => {
    // timeline 是唯一消费者；工具函数本身定义一次 + 调用一次，共 2 次出现。
    expect(countNeedle("toolArgsText(", TIMELINE)).toBe(1);
    expect(countNeedle("export function toolArgsText(", TOOL_ARGS)).toBe(1);
    // 模板不许出现第二个 JSON 化的入口（当年就是这一行直接摆 args 的）。
    expect(MARKUP).not.toContain("JSON.parse");
    expect(MARKUP).not.toContain("event.args");
  });

  it("不许就地改写事件里的原始 args —— 只动显示", () => {
    expect(TIMELINE).not.toMatch(/\bevent\.args\s*=/);
    // 原始 args 仍原样进块之外的地方：事件对象整体仍被摊进 items（回放/落盘读的是它，不读这条拼出来的句子）。
    expect(TIMELINE).toContain("for (const event of items)");
  });
});

describe("卡上那一行的形状", () => {
  it("带 is-plain 的条件类，并且那个条件读的是判定的第二态", () => {
    // tagAttributes 而不是 toContain：同一个 class 名在样式/别的行里再出现一次时它照样绿。
    const tags = tagAttributes(MARKUP, "tool-args");
    expect(tags).toHaveLength(1);
    const tag = tags[0] ?? "";
    expect(tag).toContain(`v-if="block.args"`);
    expect(tag).toContain(`:class="{ 'is-plain': block.argsPlain }"`);
    // tagAttributes 只切属性串，元素**体**要另切——顺带钉住「摆的就是 block.args 本身」，
    // 没有第二个插值、更没有 v-html（人话是纯文本，不该有插值的机会）。
    const body = /<p[^>]*class="tool-args"[^>]*>([\s\S]*?)<\/p>/.exec(MARKUP)?.[1] ?? "";
    expect(body.trim()).toBe("{{ block.args }}");
  });

  it("人话版换掉等宽字体与 break-all：句子不该被画成一列单字", () => {
    const plain = ruleBlock(PANE, ".tool-args.is-plain");
    // 继承正文字体（而不是再写一个字体栈字面量）。
    expect(plain).toContain("font-family: inherit");
    // 断行规则**两条一起换**，少一条就等于什么都没改（2026-10-07 真机量出来的）：
    // 共享规则里的 `word-break: break-all` 优先级高于 `overflow-wrap`，
    // 只写 overflow-wrap 时计算值会是 break-all + break-word 并存 —— 句子照旧被逐字劈开。
    // 这条断言就是那次实测留下的：它防的正是「守卫全绿而屏上没变」。
    expect(plain).toContain("word-break: normal");
    expect(plain).toContain("overflow-wrap: break-word");
    expect(plain).not.toContain("var(--code-font)");
  });

  it("原始回执仍是代码体：它是给人查的机器输出，不在这次裁定范围内", () => {
    const shared = ruleBlock(PANE, ".tool-args,\n.tool-result");
    expect(shared).toContain("font-family: var(--code-font)");
    expect(shared).toContain("word-break: break-all");
  });
});

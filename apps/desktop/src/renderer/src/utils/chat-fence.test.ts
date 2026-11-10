import { describe, expect, it } from "vitest";
import { unfenceProseBlocks } from "./chat-fence";

/**
 * 这一层只干一件事：把「中文正文被包进代码围栏」的块拆出来，其余一律不动。
 * 每条用例的失败都对应屏上能看见的后果，所以按后果写标题。
 */
describe("unfenceProseBlocks", () => {
  it("中文正文包在无标记围栏里 ⇒ 剥掉，屏上不再是一片等宽灰块", () => {
    const source = ["```", "他把灯吹灭了。", "屋里剩下一股油烟味。", "```"].join("\n");
    const { text, removed } = unfenceProseBlocks(source);
    expect(removed).toBe(1);
    expect(text).toBe("他把灯吹灭了。\n\n屋里剩下一股油烟味。");
    expect(text).not.toContain("```");
  });

  it("块内一行一段：段落之间补空行，否则 Markdown 会把两行并成一段", () => {
    const source = ["```text", "第一段。", "第二段。", "```"].join("\n");
    expect(unfenceProseBlocks(source).text).toBe("第一段。\n\n第二段。");
  });

  it("真代码原样留着（用户自己要看的）：json 标记", () => {
    const source = ["```json", '{ "title": "归港", "chapters": 3 }', "```"].join("\n");
    const { text, removed } = unfenceProseBlocks(source);
    expect(removed).toBe(0);
    expect(text).toBe(source);
  });

  it("真代码原样留着：没写语言，但符号密度高", () => {
    const source = [
      "```",
      "const a = b.map((x) => x * 2);",
      "if (a[0] === 1) { run(); }",
      "```"
    ].join("\n");
    expect(unfenceProseBlocks(source).text).toBe(source);
  });

  it("中文注释多、但确实是代码 ⇒ 不剥（符号密度那道闸拦住）", () => {
    const source = ["```", "if (x) { /* 这里判空，否则后面会崩 */ }", "```"].join("\n");
    expect(unfenceProseBlocks(source).text).toBe(source);
  });

  it("未闭合的围栏一行动都不动（流式输出时闭合行还没到）", () => {
    const source = ["```", "他还没说完的话，正在往外吐"].join("\n");
    const { text, removed } = unfenceProseBlocks(source);
    expect(removed).toBe(0);
    expect(text).toBe(source);
  });

  it("空围栏直接删掉，不留一对空符号", () => {
    expect(unfenceProseBlocks("```\n```").text).toBe("");
  });

  it("前后有普通段落 ⇒ 只剥那一块，别处一字不改", () => {
    const source = [
      "先看这一段：",
      "",
      "```",
      "灯灭之后他才发现自己一直攥着那枚铜扣。",
      "```",
      "",
      "大概就是这个意思。"
    ].join("\n");
    const { text, removed } = unfenceProseBlocks(source);
    expect(removed).toBe(1);
    expect(text).toContain("先看这一段：");
    expect(text).toContain("灯灭之后他才发现自己一直攥着那枚铜扣。");
    expect(text).toContain("大概就是这个意思。");
    expect(text).not.toContain("```");
  });

  it("没有围栏的普通文本 ⇒ 原样返回（这条保证常规正文零开销）", () => {
    const source = "他就是不肯说。\n\n第二段也没有围栏。";
    const { text, removed } = unfenceProseBlocks(source);
    expect(text).toBe(source);
    expect(removed).toBe(0);
  });

  it("波浪号围栏同样认得（另一种写法）", () => {
    const source = ["~~~", "这一段是正文。", "~~~"].join("\n");
    expect(unfenceProseBlocks(source).text).toBe("这一段是正文。");
  });

  it("英文小说包在围栏里 ⇒ 不剥：判据只认中文，避免替用户猜", () => {
    const source = ["```", "He put out the lamp and stood in the dark.", "```"].join("\n");
    expect(unfenceProseBlocks(source).text).toBe(source);
  });
});

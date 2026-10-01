import { describe, expect, it } from "vitest";
import { parseProtocolBlocks } from "../src/patch-protocol.js";

const good = [
  "```mochen-patch",
  '{"doc":"chapters/01.md","anchor":"雾","replace":"雾很冷","why":"补温度"}',
  "```"
].join("\n");

describe("parseProtocolBlocks", () => {
  it("正常单块：产出补丁并把围栏从正文里剥掉", () => {
    const out = parseProtocolBlocks(`我给你一条建议：\n\n${good}\n\n要看 diff 吗？`);
    expect(out.patches).toEqual([
      {
        doc: "chapters/01.md",
        mode: "anchor-replace",
        anchor: "雾",
        replace: "雾很冷",
        why: "补温度"
      }
    ]);
    expect(out.problems).toEqual([]);
    expect(out.prose).toBe("我给你一条建议：\n\n要看 diff 吗？");
  });

  it("多块与计划块各自归位", () => {
    const text = [
      good,
      '```mochen-patch\n{"doc":"characters/李深.md","anchor":"他","replace":"李深","why":"指代明确"}\n```',
      '```mochen-plan\n{"items":["读当前章","起两条提案"]}\n```'
    ].join("\n\n");
    const out = parseProtocolBlocks(text);
    expect(out.patches.map((p) => p.doc)).toEqual(["chapters/01.md", "characters/李深.md"]);
    expect(out.planItems).toEqual(["读当前章", "起两条提案"]);
  });

  it("内部更短的围栏算内容，不提前闭合", () => {
    const nested = [
      "````mochen-patch",
      '{"doc":"a.md","anchor":"x","replace":"```","why":"代码块里的围栏"}',
      "```",
      '{"继续":"忽略"}',
      "````"
    ].join("\n");
    const out = parseProtocolBlocks(nested);
    expect(out.patches.length).toBe(1);
    expect(out.patches[0]?.replace).toBe("```");
    // 更短的围栏与 JSON 之后的杂项行都被块吸收，不得漏进正文（钉住闭合围栏的长度比较）
    expect(out.prose).toBe("");
  });

  it("多行缩进 JSON 的补丁块也能解析", () => {
    const pretty = [
      "```mochen-patch",
      "{",
      '  "doc": "chapters/02.md",',
      '  "anchor": "雪",',
      '  "replace": "雪落在檐上",',
      '  "why": "补一层静景"',
      "}",
      "```"
    ].join("\n");
    const out = parseProtocolBlocks(pretty);
    expect(out.patches).toEqual([
      {
        doc: "chapters/02.md",
        mode: "anchor-replace",
        anchor: "雪",
        replace: "雪落在檐上",
        why: "补一层静景"
      }
    ]);
    expect(out.problems).toEqual([]);
  });

  it("坏 JSON 只记问题，不产出提案", () => {
    const out = parseProtocolBlocks('```mochen-patch\n{"doc": 雾}\n```');
    expect(out.patches).toEqual([]);
    expect(out.problems[0]?.reason).toBe("bad-json");
  });

  it("纯协议块消息（除块外只有空行）正文为空串", () => {
    const out = parseProtocolBlocks("\n" + good + "\n");
    expect(out.patches.length).toBe(1);
    expect(out.prose).toBe("");
  });

  it("块内出现带语言标注的围栏行不闭合，只认空语言标注的闭合围栏", () => {
    const text = [
      "```mochen-patch",
      '{"doc":"a.md","anchor":"x","replace":"y","why":"z"',
      "```mochen-patch",
      '{"doc":"b.md","anchor":"p","replace":"q","why":"r"}',
      "```"
    ].join("\n");
    const out = parseProtocolBlocks(text);
    expect(out.patches).toEqual([]);
    expect(out.problems.length).toBe(1);
    expect(out.problems[0]?.reason).toBe("bad-json");
    expect(out.prose).toBe("");
  });

  it("缺 anchor 记 missing-field 并点名字段", () => {
    const out = parseProtocolBlocks('```mochen-patch\n{"doc":"a.md","replace":"x","why":"y"}\n```');
    expect(out.patches).toEqual([]);
    expect(out.problems).toEqual([{ reason: "missing-field", detail: "anchor" }]);
  });

  it("mode 为 doc-overwrite 时允许无锚点整篇替换", () => {
    const out = parseProtocolBlocks(
      '```mochen-patch\n{"doc":"outline/三幕.md","mode":"doc-overwrite","replace":"新大纲","why":"重建"}\n```'
    );
    expect(out.patches[0]?.mode).toBe("doc-overwrite");
    expect(out.patches[0]?.anchor).toBe("");
  });

  it("未闭合围栏（模型被打断）记 unclosed-fence 且不产出", () => {
    const out = parseProtocolBlocks(`前半句\n\n${good.slice(0, good.length - 4)}`);
    expect(out.patches).toEqual([]);
    expect(out.problems.some((p) => p.reason === "unclosed-fence")).toBe(true);
    expect(out.prose).toContain("前半句");
  });

  it("非协议围栏原样保留在正文里（模型贴的代码示例不能被吞）", () => {
    const out = parseProtocolBlocks('说明：\n```json\n{"keep":true}\n```\n完');
    expect(out.patches).toEqual([]);
    expect(out.prose).toContain("```json");
    expect(out.problems).toEqual([]);
  });

  it("items 不是字符串数组的计划块记问题", () => {
    const out = parseProtocolBlocks('```mochen-plan\n{"items":[{"text":"x"}]}\n```');
    expect(out.planItems).toEqual([]);
    expect(out.problems[0]?.reason).toBe("missing-field");
  });
});

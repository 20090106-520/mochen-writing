import { describe, expect, it } from "vitest";
import { buildContextPack, SKILL_HINT } from "./system-pack.js";

const noIndex = { text: "", total: 0, shown: 0 };

describe("系统提示里的上下文包", () => {
  it("什么都没有 ⇒ 空串：不写空标题（空标题比不写更像漏了东西）", () => {
    expect(buildContextPack({ contextBlock: "", skillHint: "", skillIndex: noIndex })).toBe("");
  });

  it("有上下文就带【已装配的上下文】，清单提示跟在它下面", () => {
    const out = buildContextPack({
      contextBlock: "第一章 1200 字",
      skillHint: "技能只是清单，正文没载入",
      skillIndex: noIndex
    });
    expect(out).toContain("【已装配的上下文】\n第一章 1200 字");
    expect(out).toContain("技能只是清单，正文没载入");
    expect(out).not.toContain("【技能库】");
  });

  it("没有上下文条目时，清单提示没有落处（它讲的是那些条目），不单独挂出来", () => {
    const out = buildContextPack({
      contextBlock: "",
      skillHint: "技能只是清单",
      skillIndex: noIndex
    });
    expect(out).toBe("");
  });

  it("技能库索引独立成段：一条正文都不装也照样发出去（2026-11-10）", () => {
    const out = buildContextPack({
      contextBlock: "",
      skillHint: "",
      skillIndex: { text: "- 伏笔（book:伏笔）：埋线收线", total: 1, shown: 1 }
    });
    expect(out).toBe("\n\n【技能库】\n- 伏笔（book:伏笔）：埋线收线");
  });

  it("两段都在时中间空一行：粘在一起会让模型以为索引是上下文条目的一部分", () => {
    const out = buildContextPack({
      contextBlock: "第一章",
      skillHint: "",
      skillIndex: { text: "- a（global:a）：x", total: 1, shown: 1 }
    });
    expect(out).toBe("\n\n【已装配的上下文】\n第一章\n\n【技能库】\n- a（global:a）：x");
  });
});

/**
 * 「技能只是清单」这句提醒（2026-11-12）。
 *
 * 它原先不在这个文件里，而是每行清单行尾各缀一遍；挂 12 条就是 12 遍同一句话。
 * 现在只有这一处说，所以这句话本身要经得起单独出现：说清「读哪个、怎么读、别猜」。
 */
describe("SKILL_HINT · 技能读法只说一次", () => {
  it("给出可照抄的调用形状：带引号的 <id> 占位，不是一句「用 use_skill」", () => {
    expect(SKILL_HINT).toContain('use_skill("<id>")');
  });

  it("堵住「凭名字猜做法」这条退化路", () => {
    expect(SKILL_HINT).toContain("没有载入");
    expect(SKILL_HINT).toContain("别凭名字猜");
  });

  it("整段提示里这句只出现一次（技能条目再多也不复读）", () => {
    const block = ["【技能·挂入 3 份】", "- a（global:a）：x", "- b（global:b）：y"].join("\n");
    const out = buildContextPack({
      contextBlock: block,
      skillHint: SKILL_HINT,
      skillIndex: noIndex
    });
    expect(out.split(SKILL_HINT).length - 1).toBe(1);
  });
});

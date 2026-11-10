import { describe, expect, it } from "vitest";
import { buildContextPack } from "./system-pack.js";

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

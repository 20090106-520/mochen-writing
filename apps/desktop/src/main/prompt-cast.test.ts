import { describe, expect, it } from "vitest";
import type { AssembledContext } from "@mochen/agent-runtime";
import { castConstraintSentence } from "./prompt-assembly.js";

function context(notes: AssembledContext["characterNotes"]): AssembledContext {
  return { items: [], chars: 0, approxTokens: 0, characterNotes: notes ?? [] };
}

describe("castConstraintSentence · 人物卡约束念给这一轮（2026-10-22）", () => {
  it("没声明就返回空串：调用方据此不注入空段", () => {
    expect(castConstraintSentence(context([]))).toBe("");
    expect(castConstraintSentence({ items: [], chars: 0, approxTokens: 0 })).toBe("");
    expect(castConstraintSentence(context([{ title: "李深", voice: [], exit: "" }]))).toBe("");
  });

  it("专属说法：原样列出，并写清只在他说的话里用", () => {
    const got = castConstraintSentence(
      context([{ title: "李深", voice: ["少废话", "闸上不许跑"], exit: "" }])
    );
    expect(got).toContain("- 李深：专属说法：「少废话」、「闸上不许跑」");
    expect(got).toContain("别让别的角色也这么说");
    expect(got).not.toContain("退场");
  });

  it("退场章：写清之后不要再当场出场，回忆转述要交代是谁在提", () => {
    const got = castConstraintSentence(
      context([{ title: "李深", voice: [], exit: "chapters/21-沉船.md" }])
    );
    expect(got).toContain("已在「chapters/21-沉船.md」退场");
    expect(got).toContain("谁在提");
  });

  it("两格都有时连成一句，多张卡各占一行；末尾点明这是作者定的", () => {
    const got = castConstraintSentence(
      context([
        { title: "李深", voice: ["少废话"], exit: "chapters/21-沉船.md" },
        { title: "周砚", voice: [], exit: "chapters/08-断桥.md" }
      ])
    );
    expect(got.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
    expect(got).toContain("周砚：已在「chapters/08-断桥.md」退场");
    expect(got).toContain("不是建议");
  });
});

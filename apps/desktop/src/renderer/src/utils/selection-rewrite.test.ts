import { describe, expect, it } from "vitest";
import {
  SELECTION_REWRITE_ACTIONS,
  SELECTION_REWRITE_MAX_CHARS,
  SELECTION_REWRITE_MIN_CHARS,
  selectionRewritePrompt,
  selectionWorthy
} from "./selection-rewrite";

/** 选中即改写的判定与提示词（2026-10-11）：真身在 .ts，测试钉口径。 */

describe("selectionWorthy：这段选值不值得给按钮", () => {
  it("太短（不足 6 字）、全空白、超长（>2000 字）都不值得", () => {
    expect(selectionWorthy("他走了。")).toBe(false);
    expect(selectionWorthy("他把刀拍在桌上，说别绕弯子。")).toBe(true);
    expect(selectionWorthy("    \n　　")).toBe(false);
    expect(selectionWorthy("字".repeat(SELECTION_REWRITE_MAX_CHARS + 1))).toBe(false);
    expect(selectionWorthy("字".repeat(SELECTION_REWRITE_MAX_CHARS))).toBe(true);
  });

  it("阈值是导出的常量：改阈值要有意识", () => {
    expect(SELECTION_REWRITE_MIN_CHARS).toBe(6);
    expect(SELECTION_REWRITE_MAX_CHARS).toBe(2000);
  });

  it("三个动作齐全，各带按钮文案与悬停说明", () => {
    expect(SELECTION_REWRITE_ACTIONS.map(({ label }) => label)).toEqual([
      "扩写",
      "收着写",
      "更口语"
    ]);
    for (const action of SELECTION_REWRITE_ACTIONS) {
      expect(action.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("selectionRewritePrompt：预填进智能体的指令", () => {
  it("三种改法的要求不同，但都点名 propose_patch、都圈死只许动这一段", () => {
    for (const { kind } of SELECTION_REWRITE_ACTIONS) {
      const prompt = selectionRewritePrompt(kind, "他把刀拍在桌上。");
      expect(prompt).toContain("propose_patch");
      expect(prompt).toContain("这一段之外的任何字都不要动");
      expect(prompt).toContain("他把刀拍在桌上。");
    }
    expect(selectionRewritePrompt("expand", "他把刀拍在桌上。")).not.toBe(
      selectionRewritePrompt("tighten", "他把刀拍在桌上。")
    );
    // 扩写要长、收着写要短、口语要贴人说的话——三份要求各说各的。
    expect(selectionRewritePrompt("expand", "x")).toContain("1.5 到 2 倍");
    expect(selectionRewritePrompt("tighten", "x")).toContain("一半以下");
    expect(selectionRewritePrompt("colloquial", "x")).toContain("口语");
  });

  it("选段前后空白在指令里被 trim 掉，别把空行喂给模型", () => {
    const prompt = selectionRewritePrompt("expand", "  他把刀拍在桌上。  \n");
    expect(prompt).toContain("--------\n他把刀拍在桌上。\n--------");
  });
});

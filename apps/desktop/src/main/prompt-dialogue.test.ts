import { describe, expect, it } from "vitest";
import { DIALOGUE_REPLY_INSTRUCTION } from "./prompt-dialogue.js";

/**
 * 对话回复口径里的「不接客套」（2026-11-12）。
 *
 * 前七条管排版与语言，没有一条管客套；而「好的，我明白了」「希望对你有帮助」是最扎眼的
 * 那一层 AI 味——不是文风问题，是像客服不像人。这几条要钉住的不是「禁了什么」，
 * 而是「禁的同时给了什么替代做法」：只说「别客套」，模型会换一句客套。
 */
describe("对话回复口径 · 不接客套", () => {
  it("点名最常见的三种：开场客套、收尾客套、空夸", () => {
    expect(DIALOGUE_REPLY_INSTRUCTION).toContain("「好的」");
    expect(DIALOGUE_REPLY_INSTRUCTION).toContain("希望对你有帮助");
    expect(DIALOGUE_REPLY_INSTRUCTION).toContain("这个想法很好");
  });

  it("每条禁法都配一个替代做法：认可要落到具体哪一句，拿不准就直说", () => {
    expect(DIALOGUE_REPLY_INSTRUCTION).toContain("点出具体是哪一句对");
    expect(DIALOGUE_REPLY_INSTRUCTION).toContain("这里我拿不准");
  });

  it("管住「复述问题 / 预告步骤」这种拖延式开场", () => {
    expect(DIALOGUE_REPLY_INSTRUCTION).toContain("复述");
    expect(DIALOGUE_REPLY_INSTRUCTION).toContain("直接做");
  });

  it("编号一条不缺：加了条却忘了编号，读的时候会当成上一条的续句", () => {
    for (const mark of ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"]) {
      expect(DIALOGUE_REPLY_INSTRUCTION).toContain(mark);
    }
  });
});

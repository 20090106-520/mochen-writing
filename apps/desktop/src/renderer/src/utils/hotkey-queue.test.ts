import { describe, expect, it } from "vitest";
import { composerTextAfterQueue } from "./hotkey-queue";

/**
 * 评审 X1 的可测接缝：排队「先问后写」的顺序语义就钉在这张返回值表上。
 * 变异自证：把实现改成无条件 `return "";`（这正是“先清空再判断”的旧顺序对用户的等价语义），
 * 下面第 2/3/4 条同时转红——证明该用例能失败，不是永绿装饰。
 */
describe("composerTextAfterQueue · 排队满额不得吃掉用户的字（评审 X1）", () => {
  it("accepted：草稿已进队，输入框该清空", () => {
    expect(composerTextAfterQueue("把第二段改短", true)).toBe("");
  });

  it("rejected（队列已满）：回写就是原文——提示正让用户等这轮结束后重发的就是它", () => {
    const draft = "把第二段改短";
    expect(composerTextAfterQueue(draft, false)).toBe(draft);
  });

  it("rejected 时逐字节归还：前导空格与末尾换行都不许被顺手 Trim 掉", () => {
    const draft = "  段末留了个换行\n";
    expect(composerTextAfterQueue(draft, false)).toBe("  段末留了个换行\n");
  });

  it("返回值只由 (text, accepted) 决定：不存在恒清空或恒保留的暗路", () => {
    for (const text of ["", "有字", "   ", "a\nb"]) {
      expect(composerTextAfterQueue(text, true)).toBe("");
      expect(composerTextAfterQueue(text, false)).toBe(text);
    }
  });
});

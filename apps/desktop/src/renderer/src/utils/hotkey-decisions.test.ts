import { describe, expect, it } from "vitest";
import { PROPOSAL_DECISIONS, type ProposalDecision } from "@mochen/contracts";
import { APPROVAL_DECISIONS } from "./hotkey-decisions";

/**
 * 评审 X2：类型只保证「值是契约成员」，保证不了「哪把键配哪个裁决」。
 * 把 accept-once 与 accept-session 对调 ⇒ 编译过、其余测试全绿、按 y 静默升级审批范围。
 * 下面三条用例合起来让这种对调必红（变异自证见任务报告）。
 */
describe("APPROVAL_DECISIONS · 键与裁决的每一对都钉死（评审 X2）", () => {
  it("整表 toEqual：形状与三个值一次钉尽，多一格、少一格、换一格都转红", () => {
    expect(APPROVAL_DECISIONS).toEqual({
      "approve-once": "accept-once",
      "approve-session": "accept-session",
      "approve-prefix": "accept-prefix"
    });
  });

  it("三对精确配对逐条声明：y 只配「仅这一次」，a 只配「本章不再问」，p 只配「此前都按」", () => {
    expect(APPROVAL_DECISIONS["approve-once"]).toBe("accept-once");
    expect(APPROVAL_DECISIONS["approve-session"]).toBe("accept-session");
    expect(APPROVAL_DECISIONS["approve-prefix"]).toBe("accept-prefix");
  });

  it("每个值都是 contracts 的 PROPOSAL_DECISIONS 真成员，且表恰好三格", () => {
    const values: ProposalDecision[] = Object.values(APPROVAL_DECISIONS);
    expect(values).toHaveLength(3);
    for (const value of values) {
      expect(PROPOSAL_DECISIONS as readonly string[]).toContain(value);
    }
  });
});

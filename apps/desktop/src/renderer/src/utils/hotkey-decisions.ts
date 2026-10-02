/**
 * 审批键 → 契约裁决：全仓唯一一份映射（裁定 G1 + 评审 X2）。
 *
 * 为什么单独立一个无 DOM、无 vue 的模块：住在 useHotkeys.ts 里它够不着任何测试（没有 jsdom），
 * 而「哪把键配哪个裁决」恰恰是编译管不住的部分——`Record<联合, ProposalDecision>` 只保证值是
 * 契约成员，把 accept-once 与 accept-session 对调照样编译过、419 条测试全绿，按 y 却静默变成
 * 「本章不再问」（审批范围一步升级）。所以表放这里，由 hotkey-decisions.test.ts 整表 toEqual
 * + 三对逐对 + 契约成员校验钉死；useHotkeys.ts 只消费本表，不另写第二份。
 */
import type { ProposalDecision } from "@mochen/contracts";

/** 审批键 y/a/p 对应的三个 HotkeyAction 成员（d 是 deny-guidance，只搬焦点、无裁决，不在表内）。 */
export type ApprovalHotkeyAction = "approve-once" | "approve-session" | "approve-prefix";

export const APPROVAL_DECISIONS: Record<ApprovalHotkeyAction, ProposalDecision> = {
  "approve-once": "accept-once",
  "approve-session": "accept-session",
  "approve-prefix": "accept-prefix"
};

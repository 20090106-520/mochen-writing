import { z } from "zod";
import { AGENT_TOOL_NAMES } from "./tools.js";

export const PROPOSAL_DECISIONS = [
  "accept-once",
  "accept-session",
  "accept-prefix",
  "deny-with-guidance",
  "cancel"
] as const;
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];

export const PATCH_MODES = ["anchor-replace", "doc-overwrite"] as const;
export type PatchMode = (typeof PATCH_MODES)[number];

export const PROPOSAL_STATUSES = [
  "pending",
  "written",
  "rejected",
  "cancelled",
  "stale",
  "failed"
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** 提案来自哪条路：原生 tool_calls 还是 mochen-patch 文本块（§6.1 双路）。 */
export const PROPOSAL_SOURCES = ["tool-call", "text-block"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

export const editProposalSchema = z.object({
  id: z.string().min(1),
  threadKey: z.string().min(1),
  turnId: z.string().min(1),
  docRelPath: z.string().min(1),
  mode: z.enum(PATCH_MODES),
  anchor: z.string(),
  replace: z.string(),
  why: z.string(),
  tool: z.enum(AGENT_TOOL_NAMES),
  source: z.enum(PROPOSAL_SOURCES),
  expectedFingerprint: z.string().min(1),
  createdAt: z.string().min(1)
});
export type EditProposal = z.infer<typeof editProposalSchema>;

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "待审批",
  written: "已写入",
  rejected: "已拒绝",
  cancelled: "已取消",
  stale: "文件已变动",
  failed: "写入失败"
};

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
  "failed",
  "expired"
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
  failed: "写入失败",
  expired: "上次会话未处理"
};

/**
 * 提案模式的文案表：与 PERMISSION_LABELS 同一手法，`Record<PatchMode, string>` 让加模式不写文案直接编译不过。
 * 本表是 `PatchMode` 的展示名唯一来源（渲染层提案卡卡头只读这里）；
 * 后续「审批模式（请求批准 / 替我审批）」的同型表将落在同一模块，不得在渲染层复制第二份。
 */
export const PROPOSAL_MODE_LABELS: Record<PatchMode, string> = {
  "anchor-replace": "锚点替换",
  "doc-overwrite": "整篇替换"
};

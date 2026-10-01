import { z } from "zod";
import { editProposalSchema, PROPOSAL_DECISIONS } from "./patch.js";
import { AGENT_TOOL_NAMES } from "./tools.js";

const id = z.string().min(1);
const ts = z.string().min(1);
const turn = { id, ts, turnId: id };

export const AGENT_EVENT_TYPES = [
  "user-message",
  "reasoning",
  "plan",
  "message",
  "tool-call",
  "proposal",
  "decision",
  "written",
  "interrupted",
  "error"
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const sessionMetaSchema = z.object({
  type: z.literal("session-meta"),
  sessionId: id,
  docRelPath: z.string().min(1),
  stageId: z.string().min(1),
  model: z.string().min(1),
  startedAt: ts
});
export type SessionMeta = z.infer<typeof sessionMetaSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...turn, type: z.literal("user-message"), text: z.string() }),
  z.object({ ...turn, type: z.literal("reasoning"), text: z.string(), interrupted: z.boolean() }),
  z.object({
    ...turn,
    type: z.literal("plan"),
    items: z.array(z.object({ text: z.string().min(1), done: z.boolean() })).min(1)
  }),
  z.object({ ...turn, type: z.literal("message"), text: z.string(), interrupted: z.boolean() }),
  z.object({
    ...turn,
    type: z.literal("tool-call"),
    callId: id,
    tool: z.enum(AGENT_TOOL_NAMES),
    args: z.string(),
    ok: z.boolean(),
    resultText: z.string()
  }),
  z.object({ ...turn, type: z.literal("proposal"), proposal: editProposalSchema }),
  z.object({
    ...turn,
    type: z.literal("decision"),
    proposalId: id,
    decision: z.enum(PROPOSAL_DECISIONS),
    guidance: z.string(),
    auto: z.boolean()
  }),
  z.object({
    ...turn,
    type: z.literal("written"),
    proposalId: id,
    docRelPath: z.string().min(1),
    fingerprint: z.string().min(1),
    backupRelPath: z.string().nullable()
  }),
  z.object({ ...turn, type: z.literal("interrupted"), pendingProposals: z.number().int().min(0) }),
  z.object({ ...turn, type: z.literal("error"), message: z.string().min(1) })
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const AGENT_DELTA_KINDS = ["reasoning", "message"] as const;
export type AgentDeltaKind = (typeof AGENT_DELTA_KINDS)[number];
export type TurnEndStatus = "done" | "interrupted" | "failed";

/** 主进程 → 渲染层的唯一外发载荷；delta 不落盘，event 已落盘。 */
export type AgentOutbound =
  | { type: "turn-start"; turnId: string; threadKey: string }
  | {
      type: "delta";
      turnId: string;
      threadKey: string;
      deltaKind: AgentDeltaKind;
      text: string;
    }
  | { type: "event"; turnId: string; threadKey: string; event: AgentEvent }
  | {
      type: "turn-end";
      turnId: string;
      threadKey: string;
      status: TurnEndStatus;
      message: string;
    };

export interface StartTurnInput {
  threadKey: string;
  /** null = 还没打开文稿标签，此时只能问不能改。 */
  docRelPath: string | null;
  stageId: string;
  userText: string;
}

export const decideInputSchema = z
  .object({
    proposalId: id,
    decision: z.enum(PROPOSAL_DECISIONS),
    guidance: z.string()
  })
  .superRefine((value, ctx) => {
    if (value.decision === "deny-with-guidance" && value.guidance.trim() === "")
      ctx.addIssue({
        code: "custom",
        message: "拒绝并说明时必须写清该怎么改",
        path: ["guidance"]
      });
  });
export type DecideInput = z.infer<typeof decideInputSchema>;

export type DecisionResult =
  | {
      ok: true;
      docRelPath: string;
      fingerprint: string;
      backupRelPath: string | null;
      auto: boolean;
    }
  | {
      ok: false;
      reason: "permission-denied" | "stale" | "not-pending" | "cancelled" | "denied" | "io";
      message: string;
    };

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
export const TURN_END_STATUSES = ["done", "interrupted", "failed"] as const;
export type TurnEndStatus = (typeof TURN_END_STATUSES)[number];

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

/**
 * 渲染层可控输入进入服务边界的校验（与 decideInputSchema 同层）：
 * 分工是「业务规则走事件，请求形状与上限走拒绝」——
 * 空/纯空白的 userText、空 threadKey（未打开文稿标签即 unbound 线程）都是合法业务态，
 * 由 agent-service 的优雅路径发中文事件 + turn-end{failed}，这里绝不挡；
 * 本 schema 只挡形状与上限：缺字段、类型不符、threadKey/userText/stageId 超长、
 * stageId 为空（装配处无对应的优雅分支），且每条错误都是用户看得见的中文。
 * 跨字段一致性（裁定 o）：空 threadKey 是「没打开文稿标签」的独立线程态，
 * 此时 docRelPath 必须为 null——否则有当前章的一轮会被塞进 unbound 会话桶，
 * 造成不同章共用同一份 JSONL 历史、session-meta 自述与提案所改文件互相打脸、
 * accept-session 的自动批准授权跨所有空 threadKey 复用。这类组合走中文拒绝。
 * 字段名与可选性和原 interface 一字不改。
 */
export const startTurnInputSchema = z
  .object({
    threadKey: z.string().max(200, "会话线程标识过长（最多 200 字）"),
    /** null = 还没打开文稿标签，此时只能问不能改。 */
    docRelPath: z.string().nullable(),
    stageId: z.string().min(1, "创作阶段标识不能为空").max(200, "创作阶段标识过长（最多 200 字）"),
    userText: z.string().max(20000, "输入内容过长（最多 20000 字）")
  })
  .superRefine((value, ctx) => {
    if (value.threadKey.trim() === "" && value.docRelPath !== null)
      ctx.addIssue({
        code: "custom",
        message: "没打开文稿标签时才算独立线程：会话线程为空就不能再指定文稿路径，两者不能同时给。",
        path: ["threadKey"]
      });
  });
export type StartTurnInput = z.infer<typeof startTurnInputSchema>;

export const decideInputSchema = z
  .object({
    proposalId: z.string().min(1, "提案标识不能为空"),
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

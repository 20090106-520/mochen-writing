/**
 * 审批的落地判定（2026-11-20 从 agent-service.ts 拆出，为 800 行预算）。
 *
 * 这一层回答的是「用户点了同意之后，这一条提案到底能不能写、写到哪」：
 * 正文提案要过档位闸、按指纹复核原稿、重放 patch；设定提案走 bible-approval.ts。
 * 编排层（agent-service）只负责登记提案与转发结果，不在这里重写任何判据（铁律 6）。
 */
import {
  UNBOUND,
  workModeOf,
  type AgentEvent,
  type BibleProposal,
  type DecisionResult,
  type EditProposal,
  type ProposalDecision
} from "@mochen/contracts";
import { applyPatch, checkWritePermission } from "@mochen/agent-runtime";
import { makeFingerprint } from "@mochen/fs-store";
import type { BookService } from "./book-service.js";
import { scopedApprovalKey } from "./book-scope.js";
import { readForApproval } from "./approval-read.js";
import { decideBibleProposal } from "./bible-approval.js";

/**
 * 待审提案分两类：正文提案要拿原稿基线重放 patch；设定提案只是「往设定库里追加一条」，
 * 没有可失效的原稿。判别联合让审批处只需分一次叉，而不是在每个字段上各问一遍。
 */
export type PendingProposal =
  | { kind: "doc"; proposal: EditProposal; baseline: string }
  | { kind: "bible"; proposal: BibleProposal };

/**
 * `accept-prefix`（同文档同类改动不再问）的**本地判别式**：文档::工具。
 * 这一串只是「键的一半」——不含书身份，单独拿去比会跨书撞名（两本书同名文稿的同一工具一模一样）。
 * 真正的存储/命中键一律再过 `scopedApprovalKey(书根, ...)` 这一道（单一真身住在 book-scope.ts）。
 */
export function ruleKey(proposal: EditProposal): string {
  return `${proposal.docRelPath}::${proposal.tool}`;
}

export interface ProposalDecisionDeps {
  pending: Map<string, PendingProposal>;
  book: BookService;
  newId(): string;
  isoNow(): string;
  publish(threadKey: string, event: AgentEvent): void;
  syncBookScope(): void;
  autoSession: Set<string>;
  autoDocTool: Set<string>;
}

export function createProposalDecision(deps: ProposalDecisionDeps) {
  return async function applyDecision(
    proposalId: string,
    decision: ProposalDecision,
    guidance: string,
    auto: boolean
  ): Promise<DecisionResult> {
    deps.syncBookScope();
    const entry = deps.pending.get(proposalId);
    const current = deps.book.current();
    if (entry === undefined || current === null) {
      return {
        ok: false,
        reason: "not-pending",
        message: "这条提案已不在待审列表里（可能已经处理过，或换了作品目录）。"
      };
    }
    const threadKey = entry.proposal.threadKey;
    const event = (body: Record<string, unknown>): AgentEvent =>
      ({
        id: deps.newId(),
        ts: deps.isoNow(),
        turnId: entry.proposal.turnId,
        ...body
      }) as AgentEvent;
    const decideEvent = () => event({ type: "decision", proposalId, decision, guidance, auto });

    if (decision === "cancel" || decision === "deny-with-guidance") {
      deps.pending.delete(proposalId);
      deps.publish(threadKey, decideEvent());
      return decision === "cancel"
        ? { ok: false, reason: "cancelled", message: "已取消这条提案，文件未改动。" }
        : {
            ok: false,
            reason: "denied",
            message: "已拒绝这条提案，你的说明会在下一轮回喂给模型。"
          };
    }

    // 设定提案另走一条：读设定库 JSON → 追加一条 → 写回；权限口径比正文更严（只认全开档）。
    // 判定住在 bible-approval.ts，这里只递依赖——不再把「会不会重复」「文件读不懂怎么办」抄一遍。
    if (entry.kind === "bible")
      return decideBibleProposal(
        {
          proposal: entry.proposal,
          proposalId,
          decision,
          guidance,
          auto,
          snapshot: current,
          threadKey
        },
        {
          readData: () => deps.book.readData("story-bible"),
          writeData: (json) => deps.book.writeData("story-bible", json),
          newId: deps.newId,
          now: deps.isoNow,
          publish: deps.publish,
          drop: () => {
            deps.pending.delete(proposalId);
          },
          event
        }
      );

    const proposal = entry.proposal;

    // 档位闸的是「落地」这一刀：提案生成时不判档（只读档也要能出建议），批准时才判。
    const permission = checkWritePermission({
      mode: current.meta.permissionMode,
      docRelPath: proposal.docRelPath,
      // 审批时的「当前章」取这条提案所绑线程的文稿；Plan 3 换成随右栏活动标签走
      currentChapter: threadKey === UNBOUND ? null : threadKey,
      workMode: workModeOf(current.meta)
    });
    if (!permission.allowed) {
      // 不删 pending：档位收紧只挡这一步，放开后同一条提案还能批准（§5.1 约束 3）
      deps.publish(
        threadKey,
        event({ type: "error", message: `这条提案没有写入：${permission.reason}` })
      );
      return { ok: false, reason: "permission-denied", message: permission.reason };
    }

    const read = await readForApproval(current.root, proposal.docRelPath);
    if (read.status === "unreadable") {
      // 读不到不等于不存在，更不等于「指纹相符」：这一步必须停手，让用户重试（§9 第 2 行）。
      deps.publish(
        threadKey,
        event({
          type: "error",
          message: `读不到 ${proposal.docRelPath}（${read.message}），所以没有写入任何内容。请稍后重试。`
        })
      );
      return { ok: false, reason: "io", message: `读取失败：${read.message}` };
    }

    const onDisk = read.status === "ok" ? read.fingerprint : makeFingerprint("");
    if (onDisk !== proposal.expectedFingerprint) {
      deps.pending.delete(proposalId);
      deps.publish(
        threadKey,
        event({
          type: "error",
          proposalId,
          message:
            `提案之后 ${proposal.docRelPath} 又被改动过，这条建议已失效；` +
            "我没有覆盖你的改动，请让模型基于最新正文重出一条。"
        })
      );
      return { ok: false, reason: "stale", message: "原稿已被改动，没有覆盖。" };
    }

    const applied = applyPatch(
      read.status === "ok" ? read.content : "",
      proposal.mode,
      proposal.anchor,
      proposal.replace
    );
    if (applied.status !== "unique") {
      deps.pending.delete(proposalId);
      deps.publish(threadKey, event({ type: "error", proposalId, message: applied.message }));
      return { ok: false, reason: "stale", message: applied.message };
    }

    // 唯一的写盘通路：批准 → book.writeDoc → writeDocFile（先备份原稿，再按指纹覆写）。
    const write = await deps.book.writeDoc(proposal.docRelPath, applied.content, onDisk);
    if (!write.ok) {
      if (write.reason === "stale") {
        deps.pending.delete(proposalId);
        // 裁定 A：审批前比对通过、落盘那一刻才发现被改——pending 已删，这一支不再静默，
        // 同一条「提案已失效」的中文必须进对话流与 JSONL，否则回放会把它念成 expired。
        deps.publish(
          threadKey,
          event({
            type: "error",
            proposalId,
            message:
              `写入时 ${proposal.docRelPath} 又被改动过，这条建议已失效；` +
              "我没有覆盖你的改动，请让模型基于最新正文重出一条。"
          })
        );
        return { ok: false, reason: "stale", message: "原稿已被改动，没有覆盖。" };
      }
      // io / invalid-path / outside-book：提案留在 pending，用户可以重试（§9 第 2 行）
      deps.publish(threadKey, event({ type: "error", message: `写入失败：${write.message}` }));
      return { ok: false, reason: "io", message: write.message };
    }

    deps.pending.delete(proposalId);
    // 记规则时同样并入书根：这一支的 `current` 必非 null（上面已挡 no-book），键也就必非 null。
    if (decision === "accept-session") {
      const key = scopedApprovalKey(current.root, threadKey);
      if (key !== null) deps.autoSession.add(key);
    }
    if (decision === "accept-prefix") {
      const key = scopedApprovalKey(current.root, ruleKey(proposal));
      if (key !== null) deps.autoDocTool.add(key);
    }
    deps.publish(threadKey, decideEvent());
    deps.publish(
      threadKey,
      event({
        type: "written",
        proposalId,
        docRelPath: proposal.docRelPath,
        fingerprint: write.fingerprint,
        backupRelPath: write.backupRelPath
      })
    );
    return {
      ok: true,
      docRelPath: proposal.docRelPath,
      fingerprint: write.fingerprint,
      backupRelPath: write.backupRelPath,
      auto
    };
  };
}

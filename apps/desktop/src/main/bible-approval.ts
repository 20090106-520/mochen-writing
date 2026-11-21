import {
  normalizeBibleEntries,
  workModeOf,
  type AgentEvent,
  type BibleEntry,
  type BibleProposal,
  type BookDataReadResult,
  type BookDataWriteResult,
  type DecisionResult,
  type ProposalDecision
} from "@mochen/contracts";
import type { BookSnapshot } from "./book-service.js";

/** 设定库在书里的键（与渲染层、上下文装配同一枚，不在别处再拼一次）。 */
export const STORY_BIBLE_KEY = "story-bible";

export interface BibleApprovalInput {
  proposal: BibleProposal;
  proposalId: string;
  decision: ProposalDecision;
  guidance: string;
  auto: boolean;
  snapshot: BookSnapshot;
  threadKey: string;
}

/**
 * 设定提案的批准（2026-11-20）。
 *
 * 与正文提案拆开的原因：正文那一刀要读原稿、比指纹、重放 patch；设定这一刀只是
 * 「读 JSON → 追加一条 → 写回」，中间没有可失效的原稿。硬塞进 applyDecision 会让那条
 * 已经 150 行的函数再多三处 `if (kind === "bible")`。
 *
 * 权限口径刻意比正文更严：设定库是书级资料，**只有全开档**才批得了。
 * 按章写入档连别章正文都不许动，更不该借一条设定提案去改整本书的设定；
 * 策划档本来就不落盘，理由与前两条各自说清楚。
 */
export interface BibleApprovalDeps {
  readData(): Promise<BookDataReadResult>;
  writeData(json: string): Promise<BookDataWriteResult>;
  newId(): string;
  now(): string;
  publish(threadKey: string, event: AgentEvent): void;
  drop(): void;
  event(body: Record<string, unknown>): AgentEvent;
}

export async function decideBibleProposal(
  input: BibleApprovalInput,
  deps: BibleApprovalDeps
): Promise<DecisionResult> {
  const { proposal, proposalId, snapshot, threadKey } = input;

  if (workModeOf(snapshot.meta) === "plan") {
    const message = "现在是策划档：设定提案还停在计划里，没有写进设定库。切到「动手」档再批准它。";
    deps.publish(threadKey, deps.event({ type: "error", message }));
    return { ok: false, reason: "permission-denied", message };
  }
  if (snapshot.meta.permissionMode !== "full-access") {
    const message = "设定库是书级资料，切到「全开」权限再批准这条设定提案。";
    deps.publish(threadKey, deps.event({ type: "error", message }));
    return { ok: false, reason: "permission-denied", message };
  }

  const stored = await deps.readData();
  if (!stored.ok) {
    const message =
      stored.reason === "no-book"
        ? "还没打开作品目录，设定没地方落。"
        : `读不到设定库：${stored.message}`;
    return { ok: false, reason: stored.reason === "no-book" ? "not-pending" : "io", message };
  }
  let entries: BibleEntry[];
  try {
    entries = stored.json === null ? [] : (normalizeBibleEntries(JSON.parse(stored.json)) ?? []);
  } catch {
    // 半截文件、手工改坏：不猜内容，也不用自己的「空库」盖掉它（与 story-bible-read 同一条纪律）。
    return {
      ok: false,
      reason: "io",
      message: "设定库文件读不懂（可能被手工改坏了），先修好它再批准这条提案。"
    };
  }
  const duplicate = entries.find(
    (entry) => entry.type === proposal.type && entry.title === proposal.title
  );
  if (duplicate !== undefined) {
    deps.drop();
    const message = `设定库里已经有一条「${duplicate.title}」，没有重复添加。`;
    // 用带 proposalId 的 error 标死这张卡：与正文提案「这条已确定失效」同一口径，
    // 回放侧 replayProposalStatuses 也会把它改判成 stale，而不是永远停在待审。
    deps.publish(threadKey, deps.event({ type: "error", proposalId, message }));
    return { ok: false, reason: "stale", message };
  }

  const entryId = deps.newId();
  const stamp = Date.parse(deps.now());
  const entry: BibleEntry = {
    id: entryId,
    type: proposal.type,
    title: proposal.title,
    content: proposal.content,
    // 时间戳要能被 normalizeBibleEntries 读回（timeOf 只认有限数）。
    createdAt: Number.isFinite(stamp) ? stamp : Date.now(),
    updatedAt: Number.isFinite(stamp) ? stamp : Date.now(),
    tags: [],
    archived: false
  };
  const written = await deps.writeData(JSON.stringify([...entries, entry], null, 2));
  if (!written.ok) return { ok: false, reason: "io", message: written.message };

  deps.drop();
  // 顺序与正文提案一致（decision → written）：回放派生扫描按顺序覆盖，
  // 反过来写会让「bible-written」先落、随后被 accept 的 decision 改判成 failed。
  deps.publish(
    threadKey,
    deps.event({
      type: "decision",
      proposalId,
      decision: input.decision,
      guidance: input.guidance,
      auto: input.auto
    })
  );
  deps.publish(
    threadKey,
    deps.event({
      type: "bible-written",
      proposalId,
      entryId,
      title: entry.title,
      entryType: entry.type
    })
  );
  return {
    ok: true,
    // 回执里给一枚稳定的伪路径：渲染层的 decide 不看它，但类型要求有；
    // 用真实的设定库位置，比塞空串更不容易在日志里看糊涂。
    docRelPath: `.mochen/data/${STORY_BIBLE_KEY}.json`,
    fingerprint: "story-bible",
    backupRelPath: null,
    auto: input.auto
  };
}

import { randomUUID } from "node:crypto";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  decideInputSchema,
  firstIssueMessage,
  startTurnInputSchema,
  type AgentEvent,
  type AgentOutbound,
  type DecideInput,
  type DecisionResult,
  type DocRef,
  type EditProposal,
  type ProposalDecision,
  type SessionLoadResult,
  type StartTurnInput
} from "@mochen/contracts";
import {
  appendAgentEvent,
  applyPatch,
  checkWritePermission,
  createSession,
  eventsToMessages,
  findLatestSession,
  protocolBlockHint,
  readSession,
  runTurn,
  streamChat,
  unifiedDiff,
  type ChatMessage,
  type ProviderFetch,
  type ToolHost
} from "@mochen/agent-runtime";
import { makeFingerprint, readDocFile } from "@mochen/fs-store";
import type { BookService, BookSnapshot } from "./book-service.js";
import type { ProviderSettings } from "./provider-settings.js";
import { createDocToolHost } from "./doc-tools-host.js";

const UNBOUND = "unbound";
const MAX_TOOL_ROUNDS = 4;

export interface PromptContext {
  title: string;
  stageName: string;
  chapter: DocRef | null;
  permissionLabel: string;
}

/**
 * Plan 2 的临时装配：只带作品名、阶段名、当前文稿与权限档。
 * Plan 3 换成 spec §5 的上下文包时只替换这一个函数，service 的其它部分不动。
 */
export function defaultPromptFor(context: PromptContext): string {
  return [
    "你是墨宸 AI 的写作智能体，在用户本地的一本书上工作。",
    `当前作品：《${context.title}》；创作阶段：${context.stageName}；` +
      `当前文稿：${context.chapter?.relPath ?? "（用户还没打开文稿）"}。`,
    `权限档：${context.permissionLabel}。提案只有在用户批准后才写入磁盘。`,
    "改动文稿用 propose_patch（给 doc/anchor/replace/why），整篇重写用 write_doc。",
    "anchor 必须是文中逐字存在且唯一出现的片段；不确定就先 read_doc。",
    "只读档下不要承诺写入。",
    protocolBlockHint
  ].join("\n");
}

export interface AgentServiceDeps {
  book: BookService;
  settings: ProviderSettings;
  fetchImpl: ProviderFetch;
  emit(outbound: AgentOutbound): void;
  newId(): string;
  isoNow(): string;
  promptFor(context: PromptContext): string;
}

export interface AgentService {
  /** 解析时机：turn 结束（含落盘与自动批准）后才 resolve；turnId 通过 turn-start 事件提前送达。 */
  startTurn(input: StartTurnInput): Promise<{ turnId: string }>;
  interrupt(turnId: string): Promise<boolean>;
  decide(input: DecideInput): Promise<DecisionResult>;
  diffOf(proposalId: string): string;
  /** 只读回放：读这条线程落盘的 JSONL；no-book/no-session 返回 found:false，首行坏/超长抛中文。 */
  loadSession(threadKey: string): Promise<SessionLoadResult>;
  dispose(): void;
}

interface PendingProposal {
  proposal: EditProposal;
  baseline: string;
}

/**
 * 审批时读原稿的三态：读到 / 确实从没写过（ENOENT）/ 这一秒读不到（EBUSY、EACCES、EISDIR…）。
 * 后两者绝不能合并：把「读不到」当成「不存在」会让空指纹基线通过比对，
 * 于是一个刚出现的新文件会被无备份地盖掉。
 */
type ApprovalRead =
  | { status: "ok"; content: string; fingerprint: string }
  | { status: "absent" }
  | { status: "unreadable"; message: string };

async function readForApproval(root: string, relPath: string): Promise<ApprovalRead> {
  try {
    const file = await readDocFile(root, relPath);
    return { status: "ok", content: file.content, fingerprint: file.fingerprint };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    return {
      status: "unreadable",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function ruleKey(proposal: EditProposal): string {
  return `${proposal.docRelPath}::${proposal.tool}`;
}

export function createAgentService(deps: AgentServiceDeps): AgentService {
  const pending = new Map<string, PendingProposal>();
  const diffs = new Map<string, string>();
  const threads = new Map<string, string>();
  const controllers = new Map<string, AbortController>();
  // §6 的 a / p 两态：a 键在会话线程，p 键在「文档::工具」。
  // Plan 3 引入 AgentProfile 后把 autoSession 的键换成 profileId（spec §5.1 约束 1）。
  const autoSession = new Set<string>();
  const autoDocTool = new Set<string>();
  // 同一个 jsonl 上的并发 append 会交错成坏行，所以落盘严格串行。
  let persist: Promise<void> = Promise.resolve();
  // 自动批准发生在 host 的同步回调里，只能排队；轮次 resolve 前必须排空。
  let autos: Promise<unknown> = Promise.resolve();

  function snapshot(): BookSnapshot {
    const current = deps.book.current();
    if (current === null) throw new Error("尚未打开作品目录，请先在左栏选择一本书。");
    return current;
  }

  async function drain(): Promise<void> {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const queued = persist;
      const auto = autos;
      await queued;
      await auto;
      if (persist === queued && autos === auto) return;
    }
    throw new Error("会话落盘或自动批准队列没有收敛，已停下等你介入。");
  }

  function publish(threadKey: string, event: AgentEvent): void {
    deps.emit({ type: "event", turnId: event.turnId, threadKey, event });
    const rel = threads.get(threadKey);
    const current = deps.book.current();
    if (rel === undefined || current === null) return;
    persist = persist
      .then(() => appendAgentEvent(current.root, rel, event))
      .catch((error: unknown) => {
        // 落盘失败只影响 /resume，不影响已经显示给用户的内容；但必须说出来，不能静默。
        deps.emit({
          type: "event",
          turnId: event.turnId,
          threadKey,
          event: {
            id: deps.newId(),
            ts: deps.isoNow(),
            turnId: event.turnId,
            type: "error",
            message: `会话历史写入失败（${rel}）：${error instanceof Error ? error.message : String(error)}；这一轮可能读不回来。`
          }
        });
      });
  }

  /** 会话文件还不存在（没开书 / 没配模型 / 没填密钥 / 空输入）时只发渲染层，不落盘。 */
  function emitOnly(threadKey: string, turnId: string, message: string): void {
    const event: AgentEvent = {
      id: deps.newId(),
      ts: deps.isoNow(),
      turnId,
      type: "error",
      message
    };
    deps.emit({ type: "event", turnId, threadKey, event });
  }

  async function threadFor(
    input: StartTurnInput,
    threadKey: string,
    model: string
  ): Promise<string> {
    const existing = threads.get(threadKey);
    if (existing !== undefined) return existing;
    const current = snapshot();
    const found = await findLatestSession(current.root, threadKey);
    if (found !== null) {
      threads.set(threadKey, found);
      return found;
    }
    // sessionId 会被拼进文件路径，所以这里只用 randomUUID()，不用可被外部左右形状的 newId()。
    const rel = await createSession(current.root, {
      type: "session-meta",
      sessionId: randomUUID(),
      docRelPath: threadKey,
      stageId: input.stageId.trim() === "" ? UNBOUND : input.stageId.trim(),
      model,
      startedAt: deps.isoNow()
    });
    threads.set(threadKey, rel);
    return rel;
  }

  /**
   * 提案登记：turnId 与 threadKey 在唯一一处覆写后再往外发。
   * runTurn 紧接着把同一个对象发成 proposal 事件并落盘，空 turnId 过不了
   * agentEventSchema，历史会被 readSession 计进 droppedLines；而审批是按 id 认的，
   * 所以 id 一个字都不改，只就地补这两个字段。
   */
  function registerProposal(
    turnId: string,
    threadKey: string,
    proposal: EditProposal,
    baseline: string
  ): void {
    proposal.turnId = turnId;
    proposal.threadKey = threadKey;
    pending.set(proposal.id, { proposal, baseline });
    const applied = applyPatch(baseline, proposal.mode, proposal.anchor, proposal.replace);
    diffs.set(
      proposal.id,
      unifiedDiff(
        baseline,
        applied.status === "unique" ? applied.content : baseline,
        proposal.docRelPath
      )
    );
    const bySession = autoSession.has(threadKey);
    if (!bySession && !autoDocTool.has(ruleKey(proposal))) return;
    const decision: ProposalDecision = bySession ? "accept-session" : "accept-prefix";
    autos = autos.then(() => applyDecision(proposal.id, decision, "", true));
  }

  function buildHost(turnId: string, threadKey: string, docRelPath: string | null): ToolHost {
    return createDocToolHost({
      root: () => deps.book.current()?.root ?? null,
      docs: () => deps.book.current()?.docs ?? [],
      context: () => ({
        docRelPath,
        permissionMode: deps.book.current()?.meta.permissionMode ?? DEFAULT_PERMISSION_MODE
      }),
      onProposal: (proposal, baseline) => registerProposal(turnId, threadKey, proposal, baseline),
      newId: deps.newId,
      now: deps.isoNow
    });
  }

  async function applyDecision(
    proposalId: string,
    decision: ProposalDecision,
    guidance: string,
    auto: boolean
  ): Promise<DecisionResult> {
    const entry = pending.get(proposalId);
    const current = deps.book.current();
    if (entry === undefined || current === null) {
      return {
        ok: false,
        reason: "not-pending",
        message: "这条提案已不在待审列表里（可能已经处理过，或换了作品目录）。"
      };
    }
    const { proposal } = entry;
    const threadKey = proposal.threadKey;
    const event = (body: Record<string, unknown>): AgentEvent =>
      ({ id: deps.newId(), ts: deps.isoNow(), turnId: proposal.turnId, ...body }) as AgentEvent;
    const decideEvent = () => event({ type: "decision", proposalId, decision, guidance, auto });

    if (decision === "cancel" || decision === "deny-with-guidance") {
      pending.delete(proposalId);
      publish(threadKey, decideEvent());
      return decision === "cancel"
        ? { ok: false, reason: "cancelled", message: "已取消这条提案，文件未改动。" }
        : {
            ok: false,
            reason: "denied",
            message: "已拒绝这条提案，你的说明会在下一轮回喂给模型。"
          };
    }

    // 档位闸的是「落地」这一刀：提案生成时不判档（只读档也要能出建议），批准时才判。
    const permission = checkWritePermission({
      mode: current.meta.permissionMode,
      docRelPath: proposal.docRelPath,
      // 审批时的「当前章」取这条提案所绑线程的文稿；Plan 3 换成随右栏活动标签走
      currentChapter: threadKey === UNBOUND ? null : threadKey
    });
    if (!permission.allowed) {
      // 不删 pending：档位收紧只挡这一步，放开后同一条提案还能批准（§5.1 约束 3）
      publish(
        threadKey,
        event({ type: "error", message: `这条提案没有写入：${permission.reason}` })
      );
      return { ok: false, reason: "permission-denied", message: permission.reason };
    }

    const read = await readForApproval(current.root, proposal.docRelPath);
    if (read.status === "unreadable") {
      // 读不到不等于不存在，更不等于「指纹相符」：这一步必须停手，让用户重试（§9 第 2 行）。
      publish(
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
      pending.delete(proposalId);
      publish(
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
      pending.delete(proposalId);
      publish(threadKey, event({ type: "error", proposalId, message: applied.message }));
      return { ok: false, reason: "stale", message: applied.message };
    }

    // 唯一的写盘通路：批准 → book.writeDoc → writeDocFile（先备份原稿，再按指纹覆写）。
    const write = await deps.book.writeDoc(proposal.docRelPath, applied.content, onDisk);
    if (!write.ok) {
      if (write.reason === "stale") {
        pending.delete(proposalId);
        // 裁定 A：审批前比对通过、落盘那一刻才发现被改——pending 已删，这一支不再静默，
        // 同一条「提案已失效」的中文必须进对话流与 JSONL，否则回放会把它念成 expired。
        publish(
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
      publish(threadKey, event({ type: "error", message: `写入失败：${write.message}` }));
      return { ok: false, reason: "io", message: write.message };
    }

    pending.delete(proposalId);
    if (decision === "accept-session") autoSession.add(threadKey);
    if (decision === "accept-prefix") autoDocTool.add(ruleKey(proposal));
    publish(threadKey, decideEvent());
    publish(
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
  }

  return {
    async startTurn(input: StartTurnInput): Promise<{ turnId: string }> {
      // 渲染层可控输入进服务边界的校验，与 decide 同层：换 preload 也换不掉这一层。
      // 拒绝必须是单句中文（裁定 n）：裸 ZodError 过 ipcMain.handle 到渲染层就是 issue 数组原文。
      const parsed = startTurnInputSchema.safeParse(input);
      if (!parsed.success)
        throw new Error(firstIssueMessage(parsed.error, "这一轮的参数不对，请重新发送。"));
      const turnId = deps.newId();
      const threadKey = input.threadKey.trim() === "" ? UNBOUND : input.threadKey.trim();
      const docRelPath = input.docRelPath ?? null;
      deps.emit({ type: "turn-start", turnId, threadKey });
      const controller = new AbortController();
      controllers.set(turnId, controller);
      try {
        if (input.userText.trim() === "") {
          emitOnly(threadKey, turnId, "输入是空的，这一轮没有发给模型。");
          deps.emit({
            type: "turn-end",
            turnId,
            threadKey,
            status: "failed",
            message: "输入为空。"
          });
          return { turnId };
        }
        const config = await deps.settings.config();
        const apiKey = await deps.settings.apiKey();
        const failure =
          deps.book.current() === null
            ? "尚未打开作品目录，请先在左栏选择一本书。"
            : config === null
              ? "还没有配置模型服务：请在设置里填写 baseURL 与模型名。"
              : apiKey === null
                ? "还没有保存 API Key：密钥只进主进程，请在设置里填写。"
                : null;
        if (failure !== null || config === null || apiKey === null) {
          emitOnly(threadKey, turnId, failure ?? "模型配置读取失败。");
          deps.emit({
            type: "turn-end",
            turnId,
            threadKey,
            status: "failed",
            message: failure ?? "模型配置读取失败。"
          });
          return { turnId };
        }

        const current = snapshot();
        const rel = await threadFor(input, threadKey, config.model);
        // 坏线程如实失败：把「读不回历史」当成「没有历史」会让模型失忆而用户毫不知情。
        const stored = await readSession(current.root, rel);
        // 历史只到上一次为止：本轮的 user 文本由 runTurn 自己追加，重复塞会看到两行一样的 user
        const history: ChatMessage[] = eventsToMessages(stored.events);
        const context: PromptContext = {
          title: current.meta.title,
          stageName:
            current.meta.stages.find((stage) => stage.id === input.stageId)?.name ?? input.stageId,
          chapter: current.docs.find((doc) => doc.relPath === docRelPath) ?? null,
          permissionLabel: PERMISSION_LABELS[current.meta.permissionMode]
        };
        const outcome = await runTurn(
          {
            stream: (req) => streamChat({ ...req, fetchImpl: deps.fetchImpl }),
            host: buildHost(turnId, threadKey, docRelPath),
            emit: (event) => publish(threadKey, event),
            emitDelta: (deltaKind, text) =>
              deps.emit({ type: "delta", turnId, threadKey, deltaKind, text }),
            newId: deps.newId,
            now: deps.isoNow,
            signal: controller.signal,
            maxToolRounds: MAX_TOOL_ROUNDS,
            provider: { baseURL: config.baseURL, apiKey, model: config.model }
          },
          {
            turnId,
            threadKey,
            systemPrompt: deps.promptFor(context),
            history,
            userText: input.userText,
            thinkingLevel: input.thinkingLevel,
            webSearchEnabled: input.webSearchEnabled
          }
        );
        deps.emit({
          type: "turn-end",
          turnId,
          threadKey,
          status: outcome.status,
          message: outcome.message
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.emit({
          type: "event",
          turnId,
          threadKey,
          event: { id: deps.newId(), ts: deps.isoNow(), turnId, type: "error", message }
        });
        deps.emit({ type: "turn-end", turnId, threadKey, status: "failed", message });
      } finally {
        controllers.delete(turnId);
        await drain();
      }
      return { turnId };
    },

    async interrupt(turnId: string): Promise<boolean> {
      const controller = controllers.get(turnId);
      if (controller === undefined) return false;
      controller.abort();
      return true;
    },

    async decide(input: DecideInput): Promise<DecisionResult> {
      // 同上：审批的拒绝也只送单句中文（裁定 n），渲染层拿不到 issue 数组。
      const parsed = decideInputSchema.safeParse(input);
      if (!parsed.success)
        throw new Error(firstIssueMessage(parsed.error, "这条审批的参数不对，请重试。"));
      const value = parsed.data;
      const result = await applyDecision(value.proposalId, value.decision, value.guidance, false);
      await drain();
      return result;
    },

    diffOf(proposalId: string): string {
      return diffs.get(proposalId) ?? "";
    },

    async loadSession(threadKey: string): Promise<SessionLoadResult> {
      // 入参守卫与 startTurnInputSchema 同口径（spec §4.1，裁定 n 延续）：越界抛单句中文，
      // 非字符串（畸形 preload/被改写的载荷）归一成空串走 unbound，绝不崩在 .trim() 上。
      const raw = typeof threadKey === "string" ? threadKey : "";
      if (raw.length > 200) throw new Error("会话线程标识过长（最多 200 字），历史读不回来。");
      const key = raw.trim() === "" ? UNBOUND : raw.trim();
      const current = deps.book.current();
      if (current === null)
        return { found: false, reason: "no-book", message: "还没打开作品目录，历史读不回来。" };
      // 先查缓存：threads 只在拿到真实相对路径时才写入（threadFor 同口径），不存在「缓存了查不到的线程」。
      const cached = threads.get(key);
      const rel = cached ?? (await findLatestSession(current.root, key));
      if (rel === null)
        return { found: false, reason: "no-session", message: "这本书里没有这条线程的历史。" };
      // 读到即缓存，与 threadFor 用同一个 Map：随后这一章第一次发轮会 append 到同一份 JSONL。
      if (cached === undefined) threads.set(key, rel);
      // 首行坏：readSession 直接抛中文（rollout.ts:77-80 原文），这里不吞、不转 found:false。
      const stored = await readSession(current.root, rel);
      return {
        found: true,
        relPath: rel,
        meta: stored.meta,
        events: stored.events,
        droppedLines: stored.droppedLines
      };
    },

    dispose(): void {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      pending.clear();
      diffs.clear();
      threads.clear();
      autoSession.clear();
      autoDocTool.clear();
    }
  };
}

import { randomUUID } from "node:crypto";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  WORK_MODE_LABELS,
  UNBOUND,
  decideInputSchema,
  firstIssueMessage,
  startTurnInputSchema,
  workModeOf,
  type AgentEvent,
  type AgentOutbound,
  type AgentProfile,
  type ContextPreview,
  type ContextPreviewQuery,
  type DecideInput,
  type DecisionResult,
  type DiscardDraftsInput,
  type DraftSetResult,
  type EditProposal,
  type PickDraftInput,
  type ProposalDecision,
  type SessionListItem,
  type SessionLoadResult,
  type SkillRef,
  type StartTurnInput
} from "@mochen/contracts";
import {
  appendAgentEvent,
  applyPatch,
  checkWritePermission,
  createSession,
  estimateTokens,
  eventsToMessages,
  fitHistoryToWindow,
  findLatestSession,
  foldOrphanUserMessages,
  historyNotice,
  readSession,
  renderContextBlock,
  runTurn,
  streamChat,
  unifiedDiff,
  UPSTREAM_WINDOW_TOKENS,
  type ChatMessage,
  type ProviderFetch,
  type ToolHost
} from "@mochen/agent-runtime";
import { makeFingerprint } from "@mochen/fs-store";
import type { BookService, BookSnapshot } from "./book-service.js";
import type { ProviderSettings } from "./provider-settings.js";
import { createBookScope, scopedApprovalKey } from "./book-scope.js";
import { readForApproval } from "./approval-read.js";
import { createDocToolHost } from "./doc-tools-host.js";
// 会话的只读回程（回放与全书总览）住在 agent-session-read.ts：它不跑 turn、不碰提案，与服务编排不共享状态。
import { listBookSessions, loadSavedSession } from "./agent-session-read.js";
// 多稿采样的编排住在 multi-sample.ts（同 agent-session-read.ts 的拆法：为 800 行预算拆出去，
// 依赖全由这里注入——跑一稿的入口、registerProposal、runningTurns、draftSets 都借这一层的真身）。
import { createMultiSample, type CapturedDraftSet, type TurnCapture } from "./multi-sample.js";
// 装配三件套（该装哪些篇 / 读挂入技能 / 解析档案）住在 turn-context.ts（同 agent-session-read.ts 的拆法）。
import { createTurnContext } from "./turn-context.js";
// 上下文占用条的装配与历史统计住在 agent-context-preview.ts（为 800 行预算拆出去，P0-3）。
import { createContextPreview } from "./agent-context-preview.js";
import { webSearch } from "./web-search.js";
import { webRead } from "./web-read.js";
// 打断与出网时限的接线住在 provider-fetch.ts：这一层只负责把「这一轮那只 signal」递进去。
import { abortableFetch } from "./provider-fetch.js";
import { withPlugins, type PluginTools } from "./plugin-host.js";
// 提示词装配（含「档案写入范围」那句人话）住在 prompt-assembly.ts：那里只把「一轮的现场」排成一段话，不共享状态。
import { bookCountsOf, writeScopeSentence, type PromptContext } from "./prompt-assembly.js";
import { buildContextPack, SKILL_HINT } from "./system-pack.js";

// UNBOUND 取自 contracts（与渲染层 utils/agent-thread.ts 那份同值只是巧合）——这里不再另立一份。
const MAX_TOOL_ROUNDS = 4;

// 这条线程已有一轮在跑时那句当场拒绝（P2-7）：只住这一处，由 startTurn 抛出、走既有拒绝通路
// （useAgentStore.ts:397 把原话写进 notice 与该线程 lastError，渲染层一个字都不许抄，铁律 6）。
const THREAD_BUSY_REASON =
  "这条对话线程上一轮还在生成，不能同时跑两轮。请等它答完，或先按 Esc 打断当前这一轮。";

// 挂入技能的装配层形状（PinnedSkill）随装配三件套搬进了 turn-context.ts，这里原样转出旧公开面。
export type { PinnedSkill } from "./turn-context.js";

export interface AgentServiceDeps {
  book: BookService;
  settings: ProviderSettings;
  fetchImpl: ProviderFetch;
  emit(outbound: AgentOutbound): void;
  newId(): string;
  isoNow(): string;
  promptFor(context: PromptContext): string;
  /**
   * 读一份挂入的技能（spec §11）。读不到就抛中文——这里**不吞**：调用方要把
   * 「有 N 个挂入技能读不到」如实说给用户（总 spec §9：失败可见，不只进日志）。
   * 不给这一项时挂入技能一律读不到，也就是「没挂技能」与「挂了但没接上」在链路上分得出来。
   */
  readSkill?: ((relPath: string) => Promise<{ title: string; text: string }>) | undefined;
  /**
   * 技能库清单（use_skill 的「列出」那一半，2026-10-23）。读正文复用上面的 readSkill。
   * 不给 ⇒ use_skill 只能回「技能库这一轮没接上」。与 readSkill 同一条只读边界。
   */
  listSkills?: (() => Promise<SkillRef[]>) | undefined;
  /** 本书是否停用这条技能（P0-4）：装配层只递判定，不给 ⇒ 不停用任何技能。 */
  skillDisabled?: ((id: string) => boolean) | undefined;
  /** 插件运行时（2026-10-07 批次 5-㉘）。不给 ⇒ 没有插件工具，行为与插件之前逐字一致。 */
  plugins?: PluginTools | undefined;
}

export interface AgentService {
  /** 解析时机：turn 结束（含落盘与自动批准）后才 resolve；turnId 通过 turn-start 事件提前送达。 */
  startTurn(input: StartTurnInput): Promise<{ turnId: string }>;
  interrupt(turnId: string): Promise<boolean>;
  hasRunningTurn(): boolean; // 有没有任意一条线程正在跑一轮（channel-trust sensitive 档判据，真身在下面 runningTurns）
  decide(input: DecideInput): Promise<DecisionResult>;
  /**
   * 选定多稿采样里的某一稿落盘（P0-②）。集只在内存里、且由这里按原始捕获回放落盘——
   * 渲染层只递句柄与稿序号，递不回正文。同一集只能落一次：第二次回 `gone`。
   */
  pickDraft(input: PickDraftInput): Promise<DraftSetResult>;
  /** 丢弃整集候选：一个字都不落盘。 */
  discardDrafts(input: DiscardDraftsInput): Promise<DraftSetResult>;
  diffOf(proposalId: string): string;
  /** 只读回放：读这条线程落盘的 JSONL；no-book/no-session 返回 found:false，首行坏/超长抛中文。 */
  loadSession(threadKey: string, sessionId?: string): Promise<SessionLoadResult>;
  /** 本书全部会话的总览（#113e 历史对话面板）；没开书返回空数组。 */
  listSessions(): Promise<SessionListItem[]>;
  /** 上下文占用条的数据源（spec §5）：只回标签与字数，不回正文。 */
  contextPreview(query: ContextPreviewQuery): Promise<ContextPreview>;
  dispose(): void;
}

interface PendingProposal {
  proposal: EditProposal;
  baseline: string;
}

/**
 * `accept-prefix`（同文档同类改动不再问）的**本地判别式**：文档::工具。
 * 这一串只是「键的一半」——不含书身份，单独拿去比会跨书撞名（两本书同名文稿的同一工具一模一样）。
 * 真正的存储/命中键一律再过 `scopedApprovalKey(书根, ...)` 这一道（单一真身住在 book-scope.ts）。
 */
function ruleKey(proposal: EditProposal): string {
  return `${proposal.docRelPath}::${proposal.tool}`;
}

export function createAgentService(deps: AgentServiceDeps): AgentService {
  const pending = new Map<string, PendingProposal>();
  const diffs = new Map<string, string>();
  const threads = new Map<string, string>();
  const controllers = new Map<string, AbortController>();
  // 同一条线程当前在跑的那一轮（threadKey -> turnId，P2-7）：键用归一后的 threadKey（与 threads、
  // publish 同一把），值带 turnId 是让 finally 只摘自己那一轮——替别人删锁是另一类事故。
  const runningTurns = new Map<string, string>();
  // 多稿采样的候选集（P0-②）：只在内存里——稿子一个字都没落盘，用户挑了才落。值里存的是
  // 「这一稿当初捕获到什么」（message 事件 + 提案 + 原话），落盘时照原样回放。
  const draftSets = new Map<string, CapturedDraftSet>();
  // §6 的 a / p 两态：a 键在会话线程，p 键在「文档::工具」——两者都只存**并入书根之后**的键
  // （`scopedApprovalKey`，单一真身在 book-scope.ts），所以 A 书的授权不会命中 B 书的撞名文稿。
  // Plan 3 引入 AgentProfile 后把 autoSession 的本地那一半换成 profileId（spec §5.1 约束 1）。
  const autoSession = new Set<string>();
  const autoDocTool = new Set<string>();
  // 同一 jsonl 上的并发 append 会交错成坏行 ⇒ 落盘严格串行；自动批准发生在 host 的同步回调里，
  // 只能排队、且轮次 resolve 前必须排空。
  let persist: Promise<void> = Promise.resolve();
  let autos: Promise<unknown> = Promise.resolve();

  function snapshot(): BookSnapshot {
    const current = deps.book.current();
    if (current === null) throw new Error("尚未打开作品目录，请先在左栏选择一本书。");
    return current;
  }

  /**
   * 当前书身份（书根目录）的**唯一取法**：没开书返回 null。
   * 书作用域闸门和自动批准的判据键都从这里拿，别处不再各写一份 `deps.book.current()?.root`。
   */
  const currentRoot = () => deps.book.current()?.root ?? null;

  /**
   * 按书存放的那部分状态——换书/关书即清。
   * 自动批准的两张表（`autoSession`/`autoDocTool`）**也在其列**：P0-4 就是它们原先不清、
   * 键里又不含书根，才让 A 书点过一次免审后 B 书撞名文稿不问自落。
   */
  function clearBookScoped(): void {
    threads.clear();
    pending.clear();
    diffs.clear();
    autoSession.clear();
    autoDocTool.clear();
    // 候选集也在其列（P0-②）：换书 / 关书后旧集必须取不到——否则用户在新书里点「用这一稿」，
    // 会拿旧书那一稿的提案往新书里落（虽然指纹闸多半会拦下，但那是碰运气，不是判据）。
    draftSets.clear();
  }
  const bookScope = createBookScope(currentRoot, clearBookScoped);

  // 装配三件套（按档案算该装哪些篇 / 解析挂入技能清单 / 解析这一轮用哪枚档案）住在 turn-context.ts：
  // 为 800 行预算拆出去，依赖只有 `book` 与 `listSkills` 两项，不跑 turn、不共享状态。
  const turnContext = createTurnContext({
    book: deps.book,
    // P0-2：挂入技能只进清单（名称 / 用途 / 何时用），正文由 use_skill 按需读。
    listSkills: deps.listSkills
  });

  /**
   * 模型配置里的上下文窗口（P0-3）。没填 / 读不出 / 旧配置 ⇒ 回退到默认值。
   * 只给占用条预览用：startTurn 手里已经有 config，直接读同一格，不重复读盘。
   */
  async function contextWindowTokens(): Promise<number> {
    try {
      const config = await deps.settings.config();
      return config?.contextWindow ?? UPSTREAM_WINDOW_TOKENS;
    } catch {
      return UPSTREAM_WINDOW_TOKENS;
    }
  }

  // 占用条的装配与历史统计住在 agent-context-preview.ts（同 multi-sample.ts 的拆法：为 800 行预算
  // 拆出去，不跑 turn、不碰提案；线程表借用这里那张 threads 的真身）。
  const contextPreviewOf = createContextPreview({
    book: deps.book,
    turnContext,
    threadOf: (threadKey) => threads.get(threadKey),
    windowTokens: contextWindowTokens
  });

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
    bookScope.sync();
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
    bookScope.sync();
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
    // 命中判据必须带书身份：两本书的同名文稿 threadKey / ruleKey 会撞（P0-4）。
    // `scopedApprovalKey` 拿不到书根时返回 null ⇒ 这里一律判为「不命中」，保守回落到人工确认，禁止放行。
    const root = currentRoot();
    const sessionKey = scopedApprovalKey(root, threadKey);
    const docToolKey = scopedApprovalKey(root, ruleKey(proposal));
    const bySession = sessionKey !== null && autoSession.has(sessionKey);
    if (!bySession && !(docToolKey !== null && autoDocTool.has(docToolKey))) return;
    const decision: ProposalDecision = bySession ? "accept-session" : "accept-prefix";
    autos = autos.then(() => applyDecision(proposal.id, decision, "", true));
  }

  /**
   * 一轮的工具宿主。`onProposal` 可注入（P0-②）：多稿采样时那一稿的提案只进它自己的收藏夹
   * （不 registerProposal、不发卡、不自动批准），**不传就是既有行为**——单稿那条路的
   * 提案登记一字不变，这就是「不开开关行为一字不变」在装配处的落点。
   */
  function buildHost(
    turnId: string,
    threadKey: string,
    docRelPath: string | null,
    signal: AbortSignal,
    profile: AgentProfile,
    onProposal?: ((proposal: EditProposal, baseline: string) => void) | undefined
  ): ToolHost {
    const register =
      onProposal ??
      ((proposal, baseline) => registerProposal(turnId, threadKey, proposal, baseline));
    const base = createDocToolHost({
      root: () => deps.book.current()?.root ?? null,
      docs: () => deps.book.current()?.docs ?? [],
      context: () => ({
        docRelPath,
        permissionMode: deps.book.current()?.meta.permissionMode ?? DEFAULT_PERMISSION_MODE,
        // 没开书时没有 meta：那一轮本来也写不了盘，工作模式按直接动手兜（同档位的既有兜法）。
        workMode: workModeOf(deps.book.current()?.meta ?? {}),
        // P0-1：工具白名单已在 toolsFor 里生效；写入范围由 doc-tools-host 在落盘前再验一次。
        profile
      }),
      onProposal: register,
      newId: deps.newId,
      now: deps.isoNow,
      // P1-1 的②：联网工具必须接上**这一轮**那只 AbortController。web-search/web-read 各自把
      // signal 覆写成 AbortSignal.timeout（防挂死闸门，不许拿掉），所以 abortableFetch 在最外层
      // 把两只并成一只——单源有界照旧，Esc 当场停下；换一轮就是另一只 signal，与每轮开关同口径。
      webSearch: (query) => webSearch(query, { fetchImpl: abortableFetch(fetch, signal) }),
      webRead: (url) => webRead(url, { fetchImpl: abortableFetch(fetch, signal) }),
      // 技能自选（use_skill，2026-10-23）：列清单与按 id 读正文，都用装配层传进来的那份。
      listSkills: deps.listSkills,
      readSkill: deps.readSkill,
      skillDisabled: deps.skillDisabled
    });
    // 插件工具**叠加**（2026-10-07 批次 5-㉘）；那层住 plugin-host.ts。
    return withPlugins(base, deps.plugins);
  }

  async function applyDecision(
    proposalId: string,
    decision: ProposalDecision,
    guidance: string,
    auto: boolean
  ): Promise<DecisionResult> {
    bookScope.sync();
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
      currentChapter: threadKey === UNBOUND ? null : threadKey,
      workMode: workModeOf(current.meta)
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
    // 记规则时同样并入书根：这一支的 `current` 必非 null（上面已挡 no-book），键也就必非 null。
    if (decision === "accept-session") {
      const key = scopedApprovalKey(current.root, threadKey);
      if (key !== null) autoSession.add(key);
    }
    if (decision === "accept-prefix") {
      const key = scopedApprovalKey(current.root, ruleKey(proposal));
      if (key !== null) autoDocTool.add(key);
    }
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

  // 多稿采样的编排实例（P0-②）：依赖全借这一层的真身——`runningTurns` / `draftSets` 是同一张表，
  // `registerProposal` 是同一份写盘通路，`bookScope.sync()` 与其它方法同口径（先归位再判书）。
  // 跑一稿的入口由 startTurn 现传（那一轮的装配结果只在那一轮里有效）。
  const multiSample = createMultiSample({
    emit: deps.emit,
    newId: deps.newId,
    isoNow: deps.isoNow,
    syncBookScope: () => bookScope.sync(),
    currentRoot,
    runningTurns,
    draftSets,
    publish,
    registerProposal,
    drain
  });

  return {
    async startTurn(input: StartTurnInput): Promise<{ turnId: string }> {
      // 渲染层可控输入进服务边界的校验，与 decide 同层：换 preload 也换不掉这一层。
      // 拒绝必须是单句中文（裁定 n）：裸 ZodError 过 ipcMain.handle 到渲染层就是 issue 数组原文。
      const parsed = startTurnInputSchema.safeParse(input);
      if (!parsed.success)
        throw new Error(firstIssueMessage(parsed.error, "这一轮的参数不对，请重新发送。"));
      const turnId = deps.newId();
      const threadKey = input.threadKey.trim() === "" ? UNBOUND : input.threadKey.trim();
      // P2-7 闸门（判定只在这一处）：这条线程已有一轮在跑 ⇒ 当场拒，一个 outbound 都不发。渲染层那个
      // running 只是某个窗口自己的状态（两个窗口／IPC 重放都能叠两轮进同一个 JSONL）。位置必须在
      // emit(turn-start) 之前：先发再拒，界面已挂上 running 却等不到自己那一轮的 turn-end。
      if (runningTurns.has(threadKey)) throw new Error(THREAD_BUSY_REASON);
      runningTurns.set(threadKey, turnId);
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
        // 注意：fullHistory 只是**候选**——下面 fitHistoryToWindow 之前它一条都不许上桌（P1-3）。
        // P2-6：上一轮失败留下的孤儿 user（开流前就落盘）在这里折掉；判据只在 foldOrphanUserMessages 一处。
        const folded = foldOrphanUserMessages({
          history: eventsToMessages(stored.events),
          userText: input.userText
        });
        if (folded.notice !== "") emitOnly(threadKey, turnId, folded.notice);
        const fullHistory: ChatMessage[] = folded.kept;
        // 档案与上下文包（spec §5 / §5.1）：换档案只换提示词与上下文构造器，不换这条线程。
        const profile = turnContext.profileOf(current, input.stageId);
        // 挂入技能的清单行与「库里还没挂入的那些」的索引并行取：两者都走 listSkills，
        // 技能目录只有几十个小文件，多扫一次的代价远小于串行的等待。
        const [{ skills, missing }, skillIndex] = await Promise.all([
          turnContext.readPinnedSkills(input.skillPaths),
          turnContext.readSkillIndex(input.skillPaths)
        ]);
        if (missing > 0) {
          // 走 emitOnly：它会落一条 type:"error" 的 AgentEvent（外层信封仍是 event）。
          // 挂入技能读不到不是致命错误，但必须让用户看见——总 spec §9「失败可见，不只进日志」。
          emitOnly(threadKey, turnId, `有 ${missing} 个挂入技能读不到，已跳过。`);
        }
        const assembled = await turnContext.assembleFor(current, docRelPath, profile, [], skills);
        // 老书没有工作模式这一格 ⇒ 直接动手。解析只走 workModeOf 一处（铁律 6）。
        const workMode = workModeOf(current.meta);
        const context: PromptContext = {
          title: current.meta.title,
          stageName:
            current.meta.stages.find((stage) => stage.id === input.stageId)?.name ?? input.stageId,
          chapter: current.docs.find((doc) => doc.relPath === docRelPath) ?? null,
          permissionLabel: PERMISSION_LABELS[current.meta.permissionMode],
          workModeLabel: WORK_MODE_LABELS[workMode],
          profile,
          context: assembled,
          webSearchEnabled: input.webSearchEnabled,
          bookCounts: bookCountsOf(current.docs) // 判据与理由见 bookCountsOf / PromptContext
        };
        // 档案的写入范围写进提示词：它是上限不是授权，模型自己先知道能碰哪些目录。
        const prompt = `${deps.promptFor(context)}\n${writeScopeSentence(profile)}`;
        const contextBlock = renderContextBlock(assembled);
        // P0-2：技能只进清单，必须补一句「正文未载入」——否则模型看见名字会以为方法已读过、照印象动笔。
        // 句子只在这里说一次（`SKILL_HINT`），清单行不再逐行复读它。
        const skillHint = assembled.items.some((item) => item.kind === "skill") ? SKILL_HINT : "";
        // P0-3：上下文包单独成串算 token，系统提示只算 prompt 那一截——
        // 三路预算要按比例分，就得各自可量。拼法住在 system-pack.ts 一处。
        const contextPackText = buildContextPack({ contextBlock, skillHint, skillIndex });
        const systemPromptText = `${prompt}${contextPackText}`;
        // P1-3 历史切片 / P0-3 三路预算：窗口取自模型配置的 contextWindow（没填就回退到
        // DEFAULT_CONTEXT_WINDOW_TOKENS）。系统提示与上下文包分开报（见上），两者之和
        // 仍是原来的预留；判据只在 fitHistoryToWindow / windowBudgetPlan 一处。
        const windowTokens = config.contextWindow ?? UPSTREAM_WINDOW_TOKENS;
        const fitted = fitHistoryToWindow({
          history: fullHistory,
          systemTokens: estimateTokens(prompt),
          contextPackTokens: estimateTokens(contextPackText),
          userTokens: estimateTokens(input.userText),
          windowTokens
        });
        // 截断必须让用户看见（spec §9）：走 emitOnly 既有 notice 通路（落一条 error 事件），
        // 不新造事件类型；句子由 historyNotice 组，数字只有 fitted 那一份。
        const notice = historyNotice(fitted);
        if (notice !== "") emitOnly(threadKey, turnId, notice);
        // 一轮的执行体：单稿（默认路）与多稿采样共用同一份装配结果，只换三个「出口」。
        const runOnce = (capture: TurnCapture) =>
          runTurn(
            {
              stream: (req) => streamChat({ ...req, fetchImpl: deps.fetchImpl }),
              host: buildHost(
                turnId,
                threadKey,
                docRelPath,
                controller.signal,
                profile,
                capture.onProposal
              ),
              emit: capture.emit,
              emitDelta: capture.emitDelta,
              newId: deps.newId,
              now: deps.isoNow,
              signal: controller.signal,
              maxToolRounds: MAX_TOOL_ROUNDS,
              // config 自带头形态（MiMo 那类端点只认 api-key，批次 5-⑤）：整个递下去。
              provider: { ...config, apiKey }
            },
            {
              turnId,
              threadKey,
              systemPrompt: systemPromptText,
              history: fitted.kept,
              userText: input.userText,
              thinkingLevel: input.thinkingLevel,
              webSearchEnabled: input.webSearchEnabled,
              // 工具面板关掉的那几枚（2026-10-21）：原样递进循环，清单与闸两处同时摘。
              disabledTools: input.disabledTools ?? [],
              // P0-1：这一轮的档案。报给模型的工具清单、派发闸、落盘范围都以它为准。
              profile
            }
          );
        // 多稿（P0-②）：静默跑 N 稿、由 multi-sample 摆候选（采样期零 publish、零落盘），
        // 只回一句收尾。单稿：还是原来那条路——出口指向既有 publish / delta 通路，一个字节都不多。
        const outcome =
          input.sampleCount > 1
            ? await multiSample.runSilent({
                turnId,
                threadKey,
                userText: input.userText,
                count: input.sampleCount,
                run: runOnce
              })
            : await runOnce({
                emit: (event) => publish(threadKey, event),
                emitDelta: (deltaKind, text) =>
                  deps.emit({ type: "delta", turnId, threadKey, deltaKind, text }),
                onProposal: undefined
              });
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
        // 摘锁在 await drain() **之前**、覆盖每一条出口（早退／失败／异常）：漏一次这条线程就永久锁死，
        // 而 drain 还挂在队列自动送上——它接到 turn-end 立刻打下一轮进来，那时占着就是被自己的闸门误拒。
        // interrupt 不是捷径：它只让流收尾，槽位在这一句才空（本轮 turn-end 没出去之前仍占着）。
        if (runningTurns.get(threadKey) === turnId) runningTurns.delete(threadKey);
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
    hasRunningTurn: () => runningTurns.size > 0, // 与摘锁那句共用同一份真身（只读 runningTurns）

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

    pickDraft: (input: PickDraftInput): Promise<DraftSetResult> => multiSample.pickDraft(input),
    discardDrafts: (input: DiscardDraftsInput): Promise<DraftSetResult> =>
      multiSample.discardDrafts(input),

    diffOf(proposalId: string): string {
      bookScope.sync();
      return diffs.get(proposalId) ?? "";
    },

    async loadSession(threadKey: string, sessionId?: string): Promise<SessionLoadResult> {
      bookScope.sync();
      // 只读回程住在 agent-session-read.ts（同 prompt-assembly.ts：为 800 行预算拆出去，且不共享状态）。
      // 缓存回填用的还是这里那一张 threads 表——threadFor 与它必须共用，否则下一轮又拉回最近那条。
      return loadSavedSession({ book: deps.book, threads }, threadKey, sessionId);
    },

    async listSessions(): Promise<SessionListItem[]> {
      return listBookSessions(deps.book);
    },

    /**
     * 上下文占用条（spec §5）。装配与历史统计住在 agent-context-preview.ts（为 800 行预算拆出去）：
     * 那里与 startTurn 走**同一条**装配路径（assembleFor），所以占用条上显示的条目数与字数就是
     * 这一轮真会发出去的那些——两处各装一遍的话，它就是骗人的装饰。
     * 读盘失败只少装一条、不抛：占用条是辅助信息，不该让界面因此报错（历史那一格同口径）。
     */
    async contextPreview(query: ContextPreviewQuery): Promise<ContextPreview> {
      return contextPreviewOf(query);
    },

    dispose(): void {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      bookScope.reset();
      // reset 已经通过 clearBookScoped 清掉自动批准的两张表；这里再点名清一次是退出兜底，
      // 万一将来 reset 的清空范围被改动，也不会把免审授权留到下一次启动。
      autoSession.clear();
      autoDocTool.clear();
    }
  };
}

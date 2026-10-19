import {
  DRAFT_SET_FAIL_MESSAGES,
  draftTextOf,
  rankDrafts,
  type AgentDeltaKind,
  type AgentEvent,
  type AgentOutbound,
  type DiscardDraftsInput,
  type DraftSetResult,
  type EditProposal,
  type PickDraftInput,
  type TurnEndStatus
} from "@mochen/contracts";

/**
 * 每轮多稿采样的编排（P0-②，2026-10-19）。
 *
 * 【为什么单开一个文件】agent-service.ts 已经贴着 800 行的行数预算
 * （`tools/check-source-line-budget.mjs`），采样这一摊够长，塞进去必然超限。
 * 拆法与 `agent-session-read.ts` / `prompt-assembly.ts` 同一份：这一层只做编排，
 * 依赖全部由调用方注入（跑一稿的那个 `run`、落盘的 `registerProposal`、那张 `runningTurns`），
 * 自己不碰盘、不碰 book、不碰提示词装配——所以两边都能各自长大。
 *
 * 【这一层干什么】开关打开时，一轮里**串行**跑 N 次生成，每次独立捕获（不落盘、不弹卡、
 * 不自动批准），收尾时把 N 稿连读数一起摆给用户；用户点一稿才落盘，点丢弃则一个字都不写。
 *
 * 【为什么不并发跑 N 稿】同一轮 N 次 runTurn 会共用 `newId` / `now` / 会话文件，
 * 并发跑会让 id 与落盘顺序互相踩（`publish` 的串行队列只保证不交错，不保证次序符合预期）。
 * 串行的代价是 N 倍等待，但这里本来就没打算让用户看到「谁先跑完」——只有最后那一批候选。
 */

/** 一次采样要替换的三个「出口」（其余装配一字不动地沿用单稿那条路）。 */
export interface TurnCapture {
  /** 这一稿自己的事件收集口：采样期一律**不 publish**（盘上零写入）。 */
  emit(event: AgentEvent): void;
  /** 增量一律丢弃：N 份增量互相覆盖只会把界面搅成雪花。 */
  emitDelta(kind: AgentDeltaKind, text: string): void;
  /**
   * 这一稿自己的提案收集口：采样期**不 registerProposal**（不入 pending、不发卡、不自动批准）。
   * 不传 ⇒ 回落到既有 `registerProposal`（单稿那条路的行为一字不变）。
   */
  onProposal?: ((proposal: EditProposal, baseline: string) => void) | undefined;
}

/** 跑一稿：返回与单稿同形的收尾（此轮是否跑成、那句话）。 */
export type RunSample = (capture: TurnCapture) => Promise<{
  status: TurnEndStatus;
  message: string;
}>;

/** 一稿的捕获：只留 `message` 事件（其余事件采样期没露过面，落盘时补发等于凭空多一段）。 */
interface CapturedDraft {
  index: number;
  messages: Extract<AgentEvent, { type: "message" }>[];
  proposals: { proposal: EditProposal; baseline: string }[];
}

/** 一集候选：落盘要用的原始捕获 + 回放合成 user 消息要用的原话。 */
export interface CapturedDraftSet {
  draftSetId: string;
  threadKey: string;
  userText: string;
  drafts: CapturedDraft[];
}

export interface MultiSampleDeps {
  emit(outbound: AgentOutbound): void;
  newId(): string;
  isoNow(): string;
  /** 书作用域的既有时机：先 sync 再判书，否则换书后的旧集会被当成「还在」。 */
  syncBookScope(): void;
  /** 当前书根（没开书返回 null）——`no-book` 那一档的判据只在这里一处。 */
  currentRoot(): string | null;
  /** 与 startTurn 共用同一张表（真身在 agent-service）：占锁/摘锁都走它。 */
  runningTurns: Map<string, string>;
  /** 候选集的存放处（真身在 agent-service，归 `clearBookScoped` 管）。 */
  draftSets: Map<string, CapturedDraftSet>;
  /** 落盘 + 推给界面的既有通路（`publish`，含串行 appendAgentEvent）。 */
  publish(threadKey: string, event: AgentEvent): void;
  /** 提案登记的既有通路（发卡、入 pending/diffs、自动批准判据全在那一份里）。 */
  registerProposal(
    turnId: string,
    threadKey: string,
    proposal: EditProposal,
    baseline: string
  ): void;
  drain(): Promise<void>;
}

export interface MultiSampleApi {
  /**
   * 静默跑 N 稿并摆出候选：返回本轮的收尾（`status` 与那句话）。
   * 采样期零 publish、零落盘；唯一会出去的是收尾时那一条 `candidates`。
   */
  runSilent(args: {
    turnId: string;
    threadKey: string;
    userText: string;
    count: number;
    run: RunSample;
  }): Promise<{ status: TurnEndStatus; message: string }>;
  /** 选定某一稿落盘（同一集只能落一次）。 */
  pickDraft(input: PickDraftInput): Promise<DraftSetResult>;
  /** 丢弃整集：一个字都不落盘。 */
  discardDrafts(input: DiscardDraftsInput): Promise<DraftSetResult>;
}

/** 采样收尾那句话（单句中文，只说「有几稿、去哪儿挑」）。 */
export function candidatesReadyMessage(count: number): string {
  return `已生成 ${count} 稿候选，在下方的候选栏里挑一稿落盘，或者整集丢弃。`;
}

/** 一稿的「新增正文」：该稿 message 正文 + 该稿提案的 replace 文本。 */
function textOfDraft(draft: CapturedDraft): string {
  return draftTextOf([
    ...draft.messages.map((message) => message.text),
    ...draft.proposals.map((captured) => captured.proposal.replace)
  ]);
}

export function createMultiSample(deps: MultiSampleDeps): MultiSampleApi {
  /** 采样期的失败也要让人看见（总 spec §9）：与 startTurn 的 emitOnly 同形，只发不落盘。 */
  function notice(threadKey: string, turnId: string, message: string): void {
    deps.emit({
      type: "event",
      turnId,
      threadKey,
      event: { id: deps.newId(), ts: deps.isoNow(), turnId, type: "error", message }
    });
  }

  return {
    async runSilent({ turnId, threadKey, userText, count, run }) {
      const captured: CapturedDraft[] = [];
      const failures: string[] = [];
      // 串行：同一条线程本来就只有这一轮在跑，并发只会让 id / 落盘顺序互相踩。
      for (let index = 0; index < count; index += 1) {
        const draft: CapturedDraft = { index, messages: [], proposals: [] };
        const outcome = await run({
          emit: (event) => {
            if (event.type === "message") draft.messages.push(event);
          },
          emitDelta: () => {
            // 丢弃：N 份增量互相覆盖只会把界面搅成雪花；「正在生成」由状态行承载。
          },
          onProposal: (proposal, baseline) => draft.proposals.push({ proposal, baseline })
        });
        if (outcome.status === "done") captured.push(draft);
        else failures.push(outcome.message);
      }
      if (captured.length === 0) {
        const message = failures.at(-1) ?? "这一轮没有产出任何内容。";
        notice(threadKey, turnId, `多稿采样一稿都没跑成：${message}`);
        return { status: "failed" as const, message };
      }
      if (failures.length > 0)
        notice(
          threadKey,
          turnId,
          `多稿采样里有 ${failures.length} 稿没跑成（${failures.at(-1) ?? ""}），已按跑成的那几稿摆出来。`
        );

      const texts = captured.map(textOfDraft);
      // 排序只用于**摆放次序**（推荐的在最前）；集里存的仍是原始捕获，按 `index` 认。
      const ranked = rankDrafts(texts);
      const draftSetId = deps.newId();
      deps.draftSets.set(draftSetId, { draftSetId, threadKey, userText, drafts: captured });
      deps.emit({
        type: "candidates",
        turnId,
        threadKey,
        draftSetId,
        drafts: ranked.map((reading) => ({
          index: reading.index,
          text: texts[reading.index] ?? "",
          reading
        }))
      });
      return { status: "done" as const, message: candidatesReadyMessage(captured.length) };
    },

    async pickDraft(input) {
      // 与既有那几个方法同口径：先归位书作用域，再判「这集还在不在」——
      // 换过书的那一集必须取不到（`clearBookScoped` 覆盖），否则会往新书里写旧书的稿。
      deps.syncBookScope();
      const set = deps.draftSets.get(input.draftSetId);
      if (set === undefined)
        return { ok: false, reason: "gone", message: DRAFT_SET_FAIL_MESSAGES.gone };
      if (deps.currentRoot() === null)
        return { ok: false, reason: "no-book", message: DRAFT_SET_FAIL_MESSAGES["no-book"] };
      if (deps.runningTurns.has(set.threadKey))
        return { ok: false, reason: "busy", message: DRAFT_SET_FAIL_MESSAGES.busy };
      const draft = set.drafts.find((one) => one.index === input.index);
      if (draft === undefined)
        return { ok: false, reason: "gone", message: DRAFT_SET_FAIL_MESSAGES.gone };
      // **先删集**：同一集只允许落一次（连点两次的第二次必须是 gone，盘上不会多一份）。
      deps.draftSets.delete(input.draftSetId);

      const turnId = deps.newId();
      deps.runningTurns.set(set.threadKey, turnId);
      deps.emit({ type: "turn-start", turnId, threadKey: set.threadKey });
      try {
        // 这一稿当初是怎么来的，就照原样补一次：一条合成 user 消息 + 该稿的 message 正文。
        deps.publish(set.threadKey, {
          id: deps.newId(),
          ts: deps.isoNow(),
          turnId,
          type: "user-message",
          text: set.userText
        });
        for (const message of draft.messages) {
          deps.publish(set.threadKey, { ...message, id: deps.newId(), ts: deps.isoNow(), turnId });
        }
        // 提案走**既有** registerProposal 全链路（发卡、入 pending/diffs、自动批准判据都是那一份）：
        // 这里只补一条 proposal 事件把卡露出来，写盘一个字节都不另开通路。
        for (const captured of draft.proposals) {
          captured.proposal.turnId = turnId;
          deps.publish(set.threadKey, {
            id: deps.newId(),
            ts: deps.isoNow(),
            turnId,
            type: "proposal",
            proposal: captured.proposal
          });
          deps.registerProposal(turnId, set.threadKey, captured.proposal, captured.baseline);
        }
        deps.emit({
          type: "turn-end",
          turnId,
          threadKey: set.threadKey,
          status: "done",
          message: `已按第 ${input.index + 1} 稿落盘。`
        });
      } finally {
        // 摘锁放在 drain **之前**：漏一次这条线程就永久锁死（与 startTurn 的那句同一份理由）。
        if (deps.runningTurns.get(set.threadKey) === turnId)
          deps.runningTurns.delete(set.threadKey);
        await deps.drain();
      }
      return { ok: true };
    },

    async discardDrafts(input) {
      deps.syncBookScope();
      const set = deps.draftSets.get(input.draftSetId);
      if (set === undefined)
        return { ok: false, reason: "gone", message: DRAFT_SET_FAIL_MESSAGES.gone };
      deps.draftSets.delete(input.draftSetId);
      // 零写盘、零事件：用户的书稿一个字都没动，所以也不必打扰界面。
      return { ok: true };
    }
  };
}

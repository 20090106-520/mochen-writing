import { defineStore } from "pinia";
import {
  AGENT_DELTA_KINDS,
  AGENT_EVENT_TYPES,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  TURN_END_STATUSES,
  type AgentDeltaKind,
  type AgentEvent,
  type AgentEventType,
  type AgentOutbound,
  type DecideInput,
  type DecisionResult,
  type EditProposal,
  type PermissionMode,
  type ProposalDecision,
  type ProposalStatus,
  type SessionLoadResult,
  type StartTurnInput,
  type TurnEndStatus
} from "@mochen/contracts";
import { replayProposalStatuses } from "../utils/timeline";
import { matchPermissionMode, type SlashCommand } from "../utils/slash-commands";
import { permissionChipView } from "../utils/permission-chip";
import { prefillText } from "../utils/composer-draft";
import { useLayoutStore } from "./layoutStore";
import { useBookStore } from "./useBookStore";

/** 与主进程 agent-service.ts:38 的同名常量必须一致（裁定 o）。 */
export const UNBOUND = "unbound";

/** 「继续」按钮发出的固定指令：残字已随 interrupted 事件进历史，模型接着写而不是重来。 */
const CONTINUE_TEXT = "接着上一轮未写完的地方继续，不要重复已经写出的内容。";

/** 运行中 Tab 排队的上限（spec §5.1）；满则拒入队并写中文。 */
export const QUEUED_MAX = 5;

/** 排队满额的中文提示（spec §5.1 定稿整句；数字取自 QUEUED_MAX，不留第二份「5」）。 */
const QUEUED_FULL_NOTICE = `排队指令最多 ${QUEUED_MAX} 条，先等这一轮结束。`;

export interface ThreadView {
  turnId: string | null;
  running: boolean;
  startedAt: number;
  /** 已落盘的持久事件，按到达顺序渲染。 */
  items: AgentEvent[];
  /** 流式残字：对应事件落库后归零，永不与定稿正文重复显示。 */
  streaming: { reasoning: string; message: string };
  lastError: string;
  /** 上一轮怎么收场的——决定「继续」按钮是否出现（spec §9 第 4 行）。 */
  endedAs: "" | TurnEndStatus;
  /** 历史是否已回放过（幂等闸门，spec §4.3 第 1/5 条）。 */
  hydrated: boolean;
  /** 是否有一次在途取数（并发合流，spec §4.3 第 3 条）。 */
  hydrating: boolean;
  /** 运行中按 Tab 排好的后续指令，本轮结束后自动发队首（spec §5.1）。 */
  queued: string[];
}

export interface ProposalView {
  proposal: EditProposal;
  status: ProposalStatus;
  message: string;
  diff: string;
}

const EMPTY_STREAM = { reasoning: "", message: "" };

export function newThread(): ThreadView {
  return {
    turnId: null,
    running: false,
    startedAt: 0,
    items: [],
    streaming: { ...EMPTY_STREAM },
    lastError: "",
    endedAs: "",
    hydrated: false,
    hydrating: false,
    queued: []
  };
}

/** 裁定 o：线程键恒等于 `docRelPath ?? UNBOUND`，渲染层不许自己拼别的口径。 */
export function threadKeyFor(activeDocTab: string | null): string {
  // 与主进程 agent-service.ts:385 同口径：trim 后为空即独立线程，避免 "   " 绑出与主进程不同名的键。
  const trimmed = activeDocTab?.trim() ?? "";
  return trimmed === "" ? UNBOUND : trimmed;
}

/** 跨 IPC 的 rejection 一律收成中文句子（裁定 n 保证 message 已是单句中文）。 */
function reasonOf(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : String(err);
}

/**
 * 裁定 m2：preload 的 `onAgentEvent` 只做 `payload as AgentOutbound`，运行时一字未校验，
 * 所以主进程之外的一切（含被改写的推送通道）都可能在渲染层露出畸形形状。
 * 这里补齐形状闸门：返回空串表示可安全归约，否则返回中文原因，调用处忽略并留痕。
 * 闸门只挡「会让中栏掉线/污染线程」的字段：threadKey、turnId、type、event 载荷、
 * deltaKind、delta text、turn-end status；其余字段缺失只会退化成空文案，不致命。
 */
function malformedPush(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "推送不是一个对象";
  const value = raw as Record<string, unknown>;
  if (typeof value.threadKey !== "string" || value.threadKey === "") return "推送缺少会话线程键";
  if (typeof value.turnId !== "string") return "推送缺少轮次标识";
  switch (value.type) {
    case "turn-start":
      return "";
    case "delta": {
      const kind = value.deltaKind;
      if (typeof kind !== "string" || !AGENT_DELTA_KINDS.includes(kind as AgentDeltaKind))
        return `无法识别的增量类型：${String(kind)}`;
      if (typeof value.text !== "string") return "增量文本不是字符串";
      return "";
    }
    case "event": {
      const event = value.event;
      if (typeof event !== "object" || event === null) return "事件载荷不是一个对象";
      const type = (event as Record<string, unknown>).type;
      if (typeof type !== "string" || !AGENT_EVENT_TYPES.includes(type as AgentEventType))
        return `无法识别的智能体事件类型：${String(type)}`;
      return "";
    }
    case "turn-end": {
      const status = value.status;
      if (typeof status !== "string" || !(TURN_END_STATUSES as readonly string[]).includes(status))
        return `无法识别的收尾状态：${String(status)}`;
      return "";
    }
    default:
      return `未知推送类型：${String(value.type)}`;
  }
}

/** 状态行文案（spec §7 的运行态、§6.3 的打断残留、§9 第 4 行的中断原因、§5.1 的排队数）。 */
export function composeStatusLine(
  thread: ThreadView | undefined,
  seconds: number,
  pending: number,
  queued: number
): string {
  // 排队数只在运行中出现：那条队列要等这一轮结束才生效，状态行必须如实说明（spec §5.1）。
  if (thread?.running)
    return `工作中 · ${seconds}s · Esc 打断${queued > 0 ? ` · 排队 ${queued} 条` : ""}`;
  if (thread && thread.endedAs !== "" && thread.endedAs !== "done") {
    const head =
      thread.endedAs === "failed"
        ? thread.lastError === ""
          ? "上一轮失败"
          : thread.lastError
        : "已打断";
    return `${head} · ${pending > 0 ? `${pending} 条待审` : "可点「继续」"}`;
  }
  if (pending > 0) return `${pending} 条待审`;
  return "就绪";
}

/** `/clear` 的确认文案（spec §6 定稿整句）：真实的边界就是「只动渲染层」，一个字都不许夸张。 */
export const CLEAR_VIEW_SENTENCE = "这只清空本页显示；盘上的会话历史不动，重启后仍会完整回放。";

/** 收尾态文案表：`Record<TurnEndStatus, string>` 是编译期闸，加状态不写文案就过不了 tsc（铁律 6）。 */
const END_STATE_LINES: Record<TurnEndStatus, string> = {
  done: "上一轮已完成",
  interrupted: "上一轮已打断，可继续",
  failed: "上一轮失败，可继续"
};

/** 空串是「这一条线程还没收场过」，不是 TurnEndStatus 的成员，所以单独一档，不塞进表里当第四键。 */
function endStateLine(endedAs: "" | TurnEndStatus): string {
  if (endedAs === "") return "尚无收尾记录";
  return END_STATE_LINES[endedAs];
}

export interface StatusFacts {
  threadKey: string;
  thread: ThreadView | undefined;
  cards: number;
  pending: number;
  /** 档位那一格的真相只有 permissionChipView 一份：状态条不接已渲染好的中文标签，只接「有没有书 + 真实档位」。 */
  hasBook: boolean;
  permissionMode: PermissionMode | null;
  stageName: string;
}

/** `/status` 的报告：纯函数，好测也好核对；「已回放」与「未回放」必须分开说，否则用户以为看到的是全部历史。 */
export function composeStatusReport(facts: StatusFacts): string {
  const { thread } = facts;
  // 档位文案的唯一一份判定（缺陷②）：无书 ⇒ NO_BOOK_CHIP_LABEL，这里不兜底 DEFAULT_PERMISSION_MODE、不捏造档位名。
  // saving 传 false：状态条是一次播报而不是按钮忙态，permissionChipView 的 text 也不读它。
  const permission = permissionChipView({
    hasBook: facts.hasBook,
    mode: facts.permissionMode,
    saving: false
  });
  const events = thread?.items.length ?? 0;
  const replay =
    thread?.hydrating === true
      ? "历史正在回放"
      : thread?.hydrated === true
        ? `历史已回放（${events} 条）`
        : `历史未回放（本页 ${events} 条）`;
  const ended = thread === undefined ? "还没有这一条线程" : endStateLine(thread.endedAs);
  const label = facts.threadKey === UNBOUND ? "未绑定文稿" : facts.threadKey;
  const parts = [
    `线程 ${label}`,
    replay,
    `提案 ${facts.cards} 张（待审 ${facts.pending} 张）`,
    `排队 ${thread?.queued.length ?? 0} 条`,
    `权限档：${permission.text}`,
    `阶段：${facts.stageName}`,
    ended
  ];
  return `状态 · ${parts.join(" · ")}`;
}

export const useAgentStore = defineStore("agent", {
  state: () => ({
    threads: {} as Record<string, ThreadView>,
    proposals: {} as Record<string, ProposalView>,
    notice: "",
    seconds: 0,
    listening: false,
    /** 同线程并发 ensureHydrated 合流到同一个 promise（Task 5 用；本任务先建位）。 */
    hydrateInflight: {} as Record<string, Promise<void>>,
    /** 输入框的值上收到的顶层 map（设计决定 3）：键是 threadKey，不进 ThreadView，切章不丢字。 */
    composerDrafts: {} as Record<string, string>,
    /**
     * 「这一轮发出去的是什么字」——只记用户亲手打的，不记「继续」的内置文案（那是机器的话，
     * 不该塞回用户的地盘）。真机上吞字走的是事件路径：主进程把三类 pre-flight 与 try 里的一切异常
     * 都转成 turn-end{failed}，startTurn 照样 resolve，所以 `.catch` 那条拒绝支到不了。
     * 判据是「该轮有没有发过 user-message」：发过 ⇒ 字已经在中栏转录里，绝不再回填成第二份。
     */
    pendingSend: {} as Record<string, string>
  }),

  getters: {
    pendingOf:
      (state) =>
      (threadKey: string): number =>
        Object.values(state.proposals).filter(
          (view) => view.proposal.threadKey === threadKey && view.status === "pending"
        ).length,

    /** 只有「上一轮断了且现在没在跑」才允许继续；正在跑时点继续会并发两轮。 */
    canContinue:
      (state) =>
      (threadKey: string): boolean => {
        const thread = state.threads[threadKey];
        if (!thread || thread.running) return false;
        return thread.endedAs === "interrupted" || thread.endedAs === "failed";
      }
  },

  actions: {
    /**
     * 线程视图的唯一取处。新建时必须**回读** `this.threads[key]` 而不是返回手里的裸对象：
     * 写进 pinia state 的那份会被 Vue 包成响应式代理，裸对象与代理是「同一个 target、两套拦截」，
     * 拿着裸对象改字段真值是对的、依赖通知却一次不发。跨 await 握引用时最要命——建线程那次的
     * 通知被渲染帧消费掉后再写的值（hydrating / 回放 items）永久停在旧缓存，真机表现为占位卡在
     * 「正在恢复这一条线程…」（回归用例见 useAgentStore.hydrate.test.ts）。
     */
    viewOf(threadKey: string): ThreadView {
      const existing = this.threads[threadKey];
      if (existing) return existing;
      this.threads[threadKey] = newThread();
      return this.threads[threadKey];
    },

    /** 读某一格输入框的当前值；缺省空串（老状态从未写过草稿）。 */
    draftOf(threadKey: string): string {
      return this.composerDrafts[threadKey] ?? "";
    },

    setDraft(threadKey: string, value: string): void {
      this.composerDrafts[threadKey] = value;
    },

    /**
     * F-A 预填唯一入口：判定在 prefillText（一处实现）、写入只走 setDraft（一处写者），这里只负责「被挡时写一句中文」。
     * 被挡 = 已有非空草稿、预填没进去（prefillText 原样还回 current）。
     */
    prefillComposer(threadKey: string, value: string): void {
      const current = this.draftOf(threadKey);
      const next = prefillText(current, value);
      this.setDraft(threadKey, next);
      if (next === current && current.trim() !== "")
        this.notice = "输入框里已经有内容，预填没有覆盖你正在写的字。";
    },

    /** 发送成功后清这一格（残留会把上一句带进下一次输入）。 */
    clearDraft(threadKey: string): void {
      delete this.composerDrafts[threadKey];
    },

    /** 中栏唯一的订阅入口：装配处挂载时调一次，重复调用不叠加监听。 */
    startListening(): void {
      if (this.listening) return;
      this.listening = true;
      window.mochen.onAgentEvent((payload) => {
        this.apply(payload);
      });
    },

    apply(outbound: AgentOutbound): void {
      // 裁定 m2：畸形推送在这里止步——忽略、留痕，绝不抛异常、绝不新建或污染线程。
      const malformed = malformedPush(outbound);
      if (malformed !== "") {
        this.notice = `已忽略一条无法归约的智能体推送：${malformed}`;
        return;
      }
      // 事件按「载荷自带的 threadKey」归位（Important 1）：delta / event / turn-end 都不能退回按
      // 激活页路由，否则别的线程的残字与错误会串进当前章视图，激活页看起来「凭空冒字」。
      const thread = this.viewOf(outbound.threadKey);
      if (outbound.type === "turn-start") {
        thread.turnId = outbound.turnId;
        thread.running = true;
        thread.startedAt = Date.now();
        thread.streaming = { ...EMPTY_STREAM };
        thread.lastError = "";
        thread.endedAs = "";
        this.seconds = 0;
        return;
      }
      // Important 2：同线程连发两轮时，thread.turnId 已由最新一次 turn-start 占位；
      // 迟到的旧轮 delta / event / turn-end 与当前 turnId 不一致即忽略，绝不清空当前轮的流式缓冲或状态。
      // turn-start 是唯一的设置入口，上面已先行处理，故这里不会把新一轮也挡掉。
      if (thread.turnId !== null && thread.turnId !== outbound.turnId) return;
      if (outbound.type === "delta") {
        thread.streaming[outbound.deltaKind] += outbound.text;
        return;
      }
      if (outbound.type === "event") {
        // 字已经落到中栏转录里（user-message 是「受理」的唯一凭据）⇒ 这一轮不再需要还字。
        if (outbound.event.type === "user-message") delete this.pendingSend[outbound.threadKey];
        this.reduceEvent(thread, outbound.event);
        return;
      }
      thread.running = false;
      thread.turnId = null;
      thread.streaming = { ...EMPTY_STREAM };
      thread.endedAs = outbound.status;
      if (outbound.status === "failed") thread.lastError = outbound.message;
      // 真机上「这一轮没能启动」走的是这里，不是 send 的 `.catch`：主进程把 pre-flight 与 try 里的
      // 异常全转成 turn-end{failed} 后照样 resolve。所以还字也必须在这一处收口——
      // 只有 failed 且该格已被入口乐观清空才还；「继续」的内置文案从不进这张表（见 state.pendingSend）。
      const unsent = this.pendingSend[outbound.threadKey];
      delete this.pendingSend[outbound.threadKey];
      if (
        outbound.status === "failed" &&
        unsent !== undefined &&
        this.draftOf(outbound.threadKey) === ""
      ) {
        this.setDraft(outbound.threadKey, unsent);
      }
      // 裁定 G3 的顺序（与计划文本相反）：先自动发队首，再谈水合。规则：turn-end{interrupted}
      // 照样自动发下一条（打断不清队，spec §5.1），一轮只发一条。
      // 发了这一条就必须在这里收口——水合的同步前缀若在同一 tick 抢跑，历史会重放进
      // 正要起新轮的这条线程（running 要等 turn-start 推送才置真，规则 2 此刻还挡不住）。
      // 新轮的 turn-end 到达时规则 2 已放行，水合照常补做。
      const next = thread.queued.shift();
      if (next !== undefined) {
        this.send(next);
        return;
      }
      // 规则2 的另一半：轮次跑完才允许补一次水合（running 时上面早退过了）。
      if (!thread.hydrated) void this.ensureHydrated(outbound.threadKey);
    },

    reduceEvent(
      thread: ThreadView,
      event: AgentEvent,
      options?: { fetchDiff?: boolean; absorbWrites?: boolean }
    ): void {
      thread.items.push(event);
      if (event.type === "reasoning") {
        thread.streaming.reasoning = "";
        return;
      }
      if (event.type === "message") {
        thread.streaming.message = "";
        return;
      }
      if (event.type === "proposal") {
        this.proposals[event.proposal.id] = {
          proposal: event.proposal,
          status: "pending",
          message: "",
          diff: ""
        };
        // 实时路径默认取 diff；回放路径显式传 false，重启后绝不给每条历史提案白打一次 IPC（M1）。
        if (options?.fetchDiff !== false) void this.loadDiff(event.proposal.id);
        return;
      }
      if (event.type === "error") {
        thread.lastError = event.message;
        // 缺陷③的 live 半边（评审 T3-1）：带 proposalId 的 error 是主进程「这条提案已确定失效」的
        // 实时口径——applyDecision 只在 pending 已删的三条分支带上它。自动批准（accept-session /
        // accept-prefix）跑在主进程的 autos 队列里，渲染层拿不到 DecisionResult，失败只剩这一条
        // error，于是那张已死的卡在重启前一直显示可批准——卡不许说谎。
        // 规则：只在那张卡仍是 pending 时收编成 stale（严格 ===，written / cancelled / rejected /
        // expired / stale / failed 一律不重判）。不带 proposalId 的 error（模型 503、读盘 io、
        // 档位收紧）一个字都不动：那几条分支的 pending 还在，卡仍可批准，改判就是说谎。
        // 这条只减授权：不造 pending、不动 queued；回放侧仍以 replayProposalStatuses 为权威
        // （水合规则 6 会用它覆盖这些卡的 status，两条路对同一张盘给出同一个答案）。
        if (event.proposalId !== undefined) {
          const card = this.proposals[event.proposalId];
          if (card !== undefined && card.status === "pending") card.status = "stale";
        }
        return;
      }
      if (event.type === "written") {
        const written = this.proposals[event.proposalId];
        if (written) {
          written.status = "written";
          written.message = "";
        }
        // D1：status/message 是规则6/规则8 的依赖，回放也必须落；但实时提示与文档重读
        // 属实时路径副作用——回放 N 条历史 written 若照常吸收，会在重启瞬间打 N 次
        // readDoc 并用陈旧文案覆盖实时 notice，故由 absorbWrites 单独关闸（默认开）。
        if (options?.absorbWrites !== false) {
          this.notice = `已写入 ${event.docRelPath}${event.backupRelPath ? "，原稿已备份" : ""}`;
          // absorbAgentWrite 内部已把重读失败收成中文 notice（Wave A 偏离 2），这里不再包 try。
          void useBookStore().absorbAgentWrite(event.docRelPath, event.fingerprint);
        }
        return;
      }
      if (event.type !== "decision") return;
      const view = this.proposals[event.proposalId];
      if (!view) return;
      // 批准类的终态由 written / decide 返回值落，这里只处理两种即时裁决。
      if (event.decision === "cancel") view.status = "cancelled";
      if (event.decision === "deny-with-guidance") {
        view.status = "rejected";
        view.message = event.guidance;
      }
    },

    /** 裁定 m1：diff 取回失败必须让用户看见，卡片保持待审而不是空着一块。 */
    async loadDiff(proposalId: string): Promise<void> {
      const view = this.proposals[proposalId];
      if (!view) return;
      try {
        view.diff = await window.mochen.proposalDiff(proposalId);
      } catch (err) {
        const reason = reasonOf(err);
        view.diff = "";
        this.notice = `提案差异取回失败：${reason}`;
      }
    },

    /**
     * 中栏唯一的审批出口：主进程是唯一写盘通路，这里只反映结果。
     * 成功等 written 事件；失败一律保持 pending（spec §9：写盘失败可重试）。
     * 裁定 m1：跨 IPC 的拒绝也写成中文贴在卡片上，卡片保持待审可重试。
     */
    async decide(proposalId: string, decision: ProposalDecision, guidance: string): Promise<void> {
      const input: DecideInput = { proposalId, decision, guidance };
      let result: DecisionResult;
      try {
        result = await window.mochen.decideProposal(input);
      } catch (err) {
        const reason = reasonOf(err);
        const card = this.proposals[proposalId];
        if (card) card.message = reason;
        this.notice = `审批没能送达主进程：${reason}`;
        return;
      }
      const view = this.proposals[proposalId];
      if (result.ok || !view) return;
      if (result.reason === "stale") view.status = "stale";
      if (result.reason === "cancelled") view.status = "cancelled";
      if (result.reason === "denied") {
        view.status = "rejected";
        view.message = guidance;
      }
      if (
        result.reason === "permission-denied" ||
        result.reason === "io" ||
        result.reason === "not-pending"
      )
        view.message = result.message;
    },

    /** 裁定 m1：startTurn 被边界拒绝时单句中文进 notice 与该线程 lastError，绝不静默、绝不留悬空 promise。 */
    send(text: string): void {
      const book = useBookStore();
      const input: StartTurnInput = {
        threadKey: threadKeyFor(book.activeDocTab),
        docRelPath: book.activeDocTab,
        stageId: book.meta?.activeStage ?? "draft",
        userText: text
      };
      // startTurn 的 promise 要等整轮跑完才兑现；turnId 走 turn-start 推送，这里不等。
      // running 只由 turn-start / turn-end 拥有，被拒的这一轮从未开始，自然不会停在「工作中」。
      // 「继续」发的是机器文案，它不进 pendingSend：那一轮失败也不该把内置句子塞回用户的地盘。
      if (text !== CONTINUE_TEXT) this.pendingSend[input.threadKey] = text;
      window.mochen.startTurn(input).catch((err: unknown) => {
        const reason = reasonOf(err);
        this.viewOf(input.threadKey).lastError = reason;
        this.notice = `这一轮没能启动：${reason}`;
        // 发送被拒：把用户这一格刚被入口乐观清掉的文本原样还回去（清空是乐观的，失败才回写）。
        // 仅当该线程当前草稿仍是空——失败回执回来前用户可能又打了字，绝不覆盖新输入（本波「不吞字」承诺）。
        // 这条支路一旦还过字，事件路径那份账就地销掉，免得迟到的 turn-end 再还一次把新打的字盖掉。
        delete this.pendingSend[input.threadKey];
        if (this.draftOf(input.threadKey) === "") this.setDraft(input.threadKey, text);
      });
    },

    /** spec §9 第 4 行「支持继续」：只在断了的那条线程上生效。 */
    continueTurn(): void {
      if (!this.canContinue(threadKeyFor(useBookStore().activeDocTab))) return;
      this.send(CONTINUE_TEXT);
    },

    /** 运行中按 Tab：把 composer 文本 trim 后入队，不发 IPC；满 5 条拒收并写中文（spec §5.1）。 */
    queueText(threadKey: string, text: string): boolean {
      const thread = this.viewOf(threadKey);
      const value = text.trim();
      if (value === "") return false;
      if (thread.queued.length >= QUEUED_MAX) {
        this.notice = QUEUED_FULL_NOTICE;
        return false;
      }
      thread.queued.push(value);
      return true;
    },

    /** 裁定 m1：打断的拒绝同样写成中文并返回 false，调用位（Esc/按钮）不需要再包 try。 */
    async stop(): Promise<boolean> {
      const thread = this.threads[threadKeyFor(useBookStore().activeDocTab)];
      const turnId = thread?.turnId;
      if (!turnId) return false;
      try {
        return await window.mochen.interruptTurn(turnId);
      } catch (err) {
        const reason = reasonOf(err);
        if (thread) thread.lastError = reason;
        this.notice = `打断没能送达主进程：${reason}`;
        return false;
      }
    },

    /** 水合入口：八条规则逐字照 spec §4.3。判定与取数全在 store，组件只触发。 */
    async ensureHydrated(threadKey: string): Promise<void> {
      const thread = this.viewOf(threadKey);
      if (thread.hydrated) return; // 规则1 幂等
      if (thread.running) return; // 规则2 running 时不抢顺序
      if (thread.hydrating) {
        // 规则3 并发合流：复用同一次在途取数，不发第二条 IPC
        const inflight = this.hydrateInflight[threadKey];
        if (inflight !== undefined) await inflight;
        return;
      }
      thread.hydrating = true;
      const task = this.runHydrate(threadKey, thread);
      this.hydrateInflight[threadKey] = task;
      try {
        await task;
      } finally {
        delete this.hydrateInflight[threadKey];
      }
    },

    async runHydrate(threadKey: string, thread: ThreadView): Promise<void> {
      let result: SessionLoadResult;
      try {
        result = await window.mochen.loadSession(threadKey);
      } catch (err) {
        // 规则3 失败回滚：首行坏 / IPC 抛 ⇒ 留待用户再按 /resume 重试
        thread.hydrating = false;
        this.notice = `这条线程的历史没有读回来：${reasonOf(err)}`;
        return;
      }
      thread.hydrating = false;
      if (!result.found) {
        // 规则5：no-session 视为确实没有历史 ⇒ 置位；no-book 不置位（下次开书还得能水合）
        if (result.reason === "no-session") thread.hydrated = true;
        return;
      }
      // 规则4：只归约 items 里不存在该事件 id 的那些；回放路径既关 diff 取数（M1），
      // 也关写盘回吸收与实时提示覆盖（D1）——重启回放绝不 spam 文档重读。
      const known = new Set(thread.items.map((item) => item.id));
      for (const event of result.events) {
        if (known.has(event.id)) continue;
        known.add(event.id);
        this.reduceEvent(thread, event, { fetchDiff: false, absorbWrites: false });
      }
      // 规则6：派生扫描覆盖这些卡的 status（expired 卡已在规则4 里没请求 diff）
      const replayed = replayProposalStatuses(result.events);
      for (const [id, status] of Object.entries(replayed)) {
        const view = this.proposals[id];
        if (view) view.status = status;
      }
      // 规则8：只有最后一条是 interrupted 才复活「继续」；error 保守不标 failed
      const last = result.events[result.events.length - 1];
      if (last?.type === "interrupted") thread.endedAs = "interrupted";
      // 规则7：坏行如实播报，不伪造事件、不静默
      if (result.droppedLines.length > 0)
        this.notice = `这条线程有 ${result.droppedLines.length} 行没能读回，其余内容已恢复。`;
      thread.hydrated = true;
    },

    /**
     * `/` 面板唯一派发口（spec §6）：命令落在哪个 store 动作上，只在这里决定一次。
     * 面板组件、快捷键接线都不允许再各写一份 switch。
     */
    runSlashCommand(command: SlashCommand, argument: string): void {
      const book = useBookStore();
      const threadKey = threadKeyFor(book.activeDocTab);
      switch (command) {
        case "model":
          // 与 Ctrl+, 同一条通路（Task 7）：模型设置的唯一真身仍是 ProviderSettings 浮层。
          useLayoutStore().showSettings();
          return;
        case "permissions": {
          // 不带档名 ⇒ 只开菜单（popover 里逐档可点）；带档名 ⇒ 查表直接切档落盘（spec §6）。
          if (argument === "") {
            book.openPermissionMenu();
            return;
          }
          const mode = matchPermissionMode(argument);
          if (mode === null) {
            // 档名列一律来自 PERMISSION_LABELS，这里不手抄第二份中文。
            this.notice = `没有这一档：「${argument}」。可选：${PERMISSION_MODES.map((item) => PERMISSION_LABELS[item]).join(" / ")}。`;
            return;
          }
          void book.setPermissionMode(mode);
          return;
        }
        case "status": {
          this.notice = composeStatusReport({
            threadKey,
            thread: this.threads[threadKey],
            cards: Object.values(this.proposals).filter(
              (view) => view.proposal.threadKey === threadKey
            ).length,
            pending: this.pendingOf(threadKey),
            hasBook: book.hasBook,
            permissionMode: book.meta?.permissionMode ?? null,
            stageName:
              book.meta?.stages.find((stage) => stage.id === book.meta?.activeStage)?.name ?? "无"
          });
          return;
        }
        case "resume":
          void this.ensureHydrated(threadKey);
          return;
        case "clear":
          this.clearThreadView(threadKey);
          return;
        case "stage":
          // availableCommands 已在波 1 把它滤掉；走到这里只可能是有人绕过面板直接调用，给实话而不是假装成功。
          this.notice = "切换创作阶段要连同智能体档案一起切，这一条通路在波 2 接通。";
          return;
      }
    },

    /**
     * `/clear` 的真实边界（spec §6）：只清渲染层视图——不动 JSONL、不动主进程 pending、不生成 boundary 事件。
     * `hydrated` 置真 ⇒ Task 5 的三处自动水合时机不会把刚清掉的内容立刻倒回来；
     * 恢复办法就是确认文案里那句「重启后仍会完整回放」。
     * `queued` 不清：那是用户还没发出去的指令，不是显示内容。
     */
    clearThreadView(threadKey: string): void {
      const thread = this.viewOf(threadKey);
      const pendingCards = Object.values(this.proposals).filter(
        (view) => view.proposal.threadKey === threadKey && view.status === "pending"
      ).length;
      thread.items = [];
      thread.streaming = { ...EMPTY_STREAM };
      thread.lastError = "";
      thread.endedAs = "";
      thread.hydrated = true;
      for (const id of Object.keys(this.proposals)) {
        if (this.proposals[id]?.proposal.threadKey === threadKey) delete this.proposals[id];
      }
      this.notice =
        pendingCards === 0
          ? CLEAR_VIEW_SENTENCE
          : `${CLEAR_VIEW_SENTENCE} 本页还有 ${pendingCards} 条待审批提案，清空后这一轮里点不到它们；重启后会以「上次会话未处理」回来。`;
    },

    tick(): void {
      const running = Object.values(this.threads).filter((thread) => thread.running);
      if (running.length === 0) {
        this.seconds = 0;
        return;
      }
      const earliest = Math.min(...running.map((thread) => thread.startedAt));
      this.seconds = Math.max(0, Math.floor((Date.now() - earliest) / 1000));
    }
  }
});

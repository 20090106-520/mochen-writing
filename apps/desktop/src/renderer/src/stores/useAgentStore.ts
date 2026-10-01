import { defineStore } from "pinia";
import {
  AGENT_DELTA_KINDS,
  AGENT_EVENT_TYPES,
  type AgentDeltaKind,
  type AgentEvent,
  type AgentEventType,
  type AgentOutbound,
  type DecideInput,
  type DecisionResult,
  type EditProposal,
  type ProposalDecision,
  type ProposalStatus,
  type StartTurnInput,
  type TurnEndStatus
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

/** 与主进程 agent-service.ts:38 的同名常量必须一致（裁定 o）。 */
export const UNBOUND = "unbound";

/** 「继续」按钮发出的固定指令：残字已随 interrupted 事件进历史，模型接着写而不是重来。 */
const CONTINUE_TEXT = "接着上一轮未写完的地方继续，不要重复已经写出的内容。";

/** 收尾状态的运行时白名单：与 contracts 的 TurnEndStatus 对齐（漂移时这行编译不过）。 */
const TURN_END_STATUS_VALUES = [
  "done",
  "interrupted",
  "failed"
] as const satisfies readonly TurnEndStatus[];

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
}

export interface ProposalView {
  proposal: EditProposal;
  status: ProposalStatus;
  message: string;
  diff: string;
}

const EMPTY_STREAM = { reasoning: "", message: "" };

function newThread(): ThreadView {
  return {
    turnId: null,
    running: false,
    startedAt: 0,
    items: [],
    streaming: { ...EMPTY_STREAM },
    lastError: "",
    endedAs: ""
  };
}

/** 裁定 o：线程键恒等于 `docRelPath ?? UNBOUND`，渲染层不许自己拼别的口径。 */
export function threadKeyFor(activeDocTab: string | null): string {
  return activeDocTab ?? UNBOUND;
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
      if (typeof status !== "string" || !TURN_END_STATUS_VALUES.includes(status as TurnEndStatus))
        return `无法识别的收尾状态：${String(status)}`;
      return "";
    }
    default:
      return `未知推送类型：${String(value.type)}`;
  }
}

/** 状态行文案（spec §7 的运行态、§6.3 的打断残留、§9 第 4 行的中断原因）。 */
export function composeStatusLine(
  thread: ThreadView | undefined,
  seconds: number,
  pending: number
): string {
  if (thread?.running) return `工作中 · ${seconds}s · Esc 打断`;
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

export const useAgentStore = defineStore("agent", {
  state: () => ({
    threads: {} as Record<string, ThreadView>,
    proposals: {} as Record<string, ProposalView>,
    notice: "",
    seconds: 0,
    listening: false
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
    viewOf(threadKey: string): ThreadView {
      const existing = this.threads[threadKey];
      if (existing) return existing;
      const created = newThread();
      this.threads[threadKey] = created;
      return created;
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
      if (outbound.type === "delta") {
        thread.streaming[outbound.deltaKind] += outbound.text;
        return;
      }
      if (outbound.type === "event") {
        this.reduceEvent(thread, outbound.event);
        return;
      }
      thread.running = false;
      thread.turnId = null;
      thread.streaming = { ...EMPTY_STREAM };
      thread.endedAs = outbound.status;
      if (outbound.status === "failed") thread.lastError = outbound.message;
    },

    reduceEvent(thread: ThreadView, event: AgentEvent): void {
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
        void this.loadDiff(event.proposal.id);
        return;
      }
      if (event.type === "error") {
        thread.lastError = event.message;
        return;
      }
      if (event.type === "written") {
        const written = this.proposals[event.proposalId];
        if (written) {
          written.status = "written";
          written.message = "";
        }
        this.notice = `已写入 ${event.docRelPath}${event.backupRelPath ? "，原稿已备份" : ""}`;
        // absorbAgentWrite 内部已把重读失败收成中文 notice（Wave A 偏离 2），这里不再包 try。
        void useBookStore().absorbAgentWrite(event.docRelPath, event.fingerprint);
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
      window.mochen.startTurn(input).catch((err: unknown) => {
        const reason = reasonOf(err);
        this.viewOf(input.threadKey).lastError = reason;
        this.notice = `这一轮没能启动：${reason}`;
      });
    },

    /** spec §9 第 4 行「支持继续」：只在断了的那条线程上生效。 */
    continueTurn(): void {
      if (!this.canContinue(threadKeyFor(useBookStore().activeDocTab))) return;
      this.send(CONTINUE_TEXT);
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

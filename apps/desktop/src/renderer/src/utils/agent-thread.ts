/**
 * 智能体线程的纯判定与文案层。
 *
 * 从 useAgentStore.ts 拆出来的：这里全是「给一组事实、回一句中文 / 一个键」的纯函数，
 * 零 store 依赖，所以能直接被 node 单测覆盖，不必起 pinia。
 * 留在 useAgentStore 里的动作反过来——它们要读 useBookStore。
 *
 * useAgentStore 用 export * from "../utils/agent-thread" 把这些原样转出去，
 * 公开面与拆分前完全一致，既有 import 一行都不用改。
 */

import {
  AGENT_DELTA_KINDS,
  AGENT_EVENT_TYPES,
  TURN_END_STATUSES,
  type AgentDeltaKind,
  type AgentEvent,
  type AgentEventType,
  type BibleProposal,
  type DecisionResult,
  type EditProposal,
  type PermissionMode,
  type ProposalStatus,
  type TurnEndStatus,
  UNBOUND
} from "@mochen/contracts";
import { permissionChipView } from "./permission-chip";
import { sessionUsageText } from "./token-usage";
import { formatCharCount } from "./char-count";
import type { StatusProgress } from "./turn-progress";

/**
 * 与主进程同名的哨兵：定义只有 contracts 那一份，两侧都从它拿。
 * 先 import 再 export——写成 `export { UNBOUND } from "..."` 是纯再导出，
 * 不会在模块作用域里建绑定，同文件的 threadKeyFor 会吃到 "UNBOUND is not defined"。
 */
export { UNBOUND };

/** 运行中 Tab 排队的上限（spec §5.1）；满则拒入队并写中文。 */
export const QUEUED_MAX = 5;

/** 排队满额的中文提示（spec §5.1 定稿整句；数字取自 QUEUED_MAX，不留第二份「5」）。 */
export const QUEUED_FULL_NOTICE = `排队指令最多 ${QUEUED_MAX} 条，先等这一轮结束。`;

export interface ThreadView {
  turnId: string | null;
  running: boolean;
  startedAt: number;
  /** 已落盘的持久事件，按到达顺序渲染。 */
  items: AgentEvent[];
  /** 流式残字：对应事件落库后归零，永不与定稿正文重复显示。 */
  streaming: { reasoning: string; message: string };
  lastError: string;
  /** 上一轮怎么收场的——终态行文案与错误上报都用它（spec §9）。 */
  endedAs: "" | TurnEndStatus;
  /** 历史是否已回放过（幂等闸门，spec §4.3 第 1/5 条）。 */
  hydrated: boolean;
  /** 是否有一次在途取数（并发合流，spec §4.3 第 3 条）。 */
  hydrating: boolean;
  /** 运行中按 Tab 排好的后续指令，本轮结束后自动发队首（spec §5.1）。 */
  queued: string[];
  /** 这一条视图当前显示的是哪一条会话（回放载荷里的 sessionId）；空串 = 渲染层还不知道，面板靠它标「正在看这一条」。 */
  sessionId: string;
}

export interface ProposalView {
  proposal: EditProposal;
  status: ProposalStatus;
  message: string;
  diff: string;
}

/**
 * 设定提案的视图（2026-11-20）。没有 diff：设定是「往库里追加一条」，不存在原稿可比。
 * 与正文提案分成两张表，是因为两者形状不同（没有 docRelPath/anchor/mode），
 * 硬并成一种视图会让每处渲染都多一串类型判断。
 */
export interface BibleProposalView {
  proposal: BibleProposal;
  status: ProposalStatus;
  message: string;
}

/** 卡片计数/清理只需要这两格：正文提案与设定提案的视图都满足它。 */
export interface CardViewLike {
  proposal: { threadKey: string };
  status: ProposalStatus;
}

export const EMPTY_STREAM = { reasoning: "", message: "" };

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
    queued: [],
    sessionId: ""
  };
}

/** 裁定 o：线程键恒等于 `docRelPath ?? UNBOUND`，渲染层不许自己拼别的口径。 */
export function threadKeyFor(activeDocTab: string | null): string {
  // 与主进程 agent-service.ts:385 同口径：trim 后为空即独立线程，避免 "   " 绑出与主进程不同名的键。
  const trimmed = activeDocTab?.trim() ?? "";
  return trimmed === "" ? UNBOUND : trimmed;
}

/** 跨 IPC 的 rejection 一律收成中文句子（裁定 n 保证 message 已是单句中文）。 */
export function reasonOf(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : String(err);
}

/**
 * 运行中 Tab 入队的**唯一判定**（spec §5.1）：空字与满额都拒收，受理时就地 push。
 * 搬出来只为一件事：store 里那个 action 只剩「写 notice / 回布尔」两行接线。
 */
export function enqueueText(thread: ThreadView, text: string): { ok: boolean; notice: string } {
  const value = text.trim();
  if (value === "") return { ok: false, notice: "" };
  if (thread.queued.length >= QUEUED_MAX) return { ok: false, notice: QUEUED_FULL_NOTICE };
  thread.queued.push(value);
  return { ok: true, notice: "" };
}

/**
 * 递出网之前，把 store state 里的数组摊成**普通数组**（2026-10-07 批次 5-㉖ 真机撞出来的）。
 *
 * 【症状】挂入技能之后发任何一轮都起不来，报 `An object could not be cloned.`
 * 【成因】`skillPathsOf()` 读的是 store state，返回的是 Vue 的 reactive **Proxy**。
 * Proxy 能骗过 `Array.isArray`、逐项读得出，但没有内部槽，结构化克隆拒收。
 *
 * 【为什么不能把摊平写在 preload 里】试过了，**够不着**。哨兵实测（2026-10-07）：
 * 在 preload 的摊平函数第一行插 `throw`，重建后真机上同一个接口递两种实参——
 * 递响应式数组时报的还是 `An object could not be cloned.`（哨兵**没触发**），
 * 递纯数组时才报哨兵。也就是 `contextBridge` 在**进入 preload 函数体之前**就序列化实参，
 * Proxy 那一步在更外面就被拒了。所以只能在这里、在**还没跨边界之前**摊。
 *
 * 【为什么是纯函数而不是 `toRaw`】`toRaw` 要 import Vue，而这个工具文件不依赖框架；
 * 拷贝一份的代价可以忽略（这里最多 12 条），换来的是「这一层与 Vue 无关、可以单测」。
 */
export function plainList<T>(value: readonly T[]): T[] {
  return [...value];
}

/**
 * 智能体写盘撞上冲突时摆给用户的那句话（2026-10-06 批次 5-⑧）。
 *
 * **两种冲突必须说成不同的话**，因为用户该做的事不同：
 * ① 有未保存手改 ⇒ 你的字还在、正文一个字没动，确认后重载**再手工合并**；
 * ② 设置页那枚「批准改稿后自动同步正文」被关掉 ⇒ 根本没有冲突，只是右栏还没换过来，
 *    说「没有丢」会让人以为刚才发生了什么、只说「重新加载」又没提那个开关。
 *
 * 文案与判定一起住在这里（铁律 6）：store 只报「哪一种」，不自己挑句子。
 */
export function absorbConflictNotice(hasUnsavedEdits: boolean): string {
  return hasUnsavedEdits
    ? "智能体改写了本章，你的未保存修改没有丢；确认后重载再手工合并"
    : "智能体改写了本章，但右栏正文还是旧的；确认后重载，或去设置里打开自动同步";
}

/**
 * 裁定 m2：preload 的 `onAgentEvent` 只做 `payload as AgentOutbound`，运行时一字未校验，
 * 所以主进程之外的一切（含被改写的推送通道）都可能在渲染层露出畸形形状。
 * 这里补齐形状闸门：返回空串表示可安全归约，否则返回中文原因，调用处忽略并留痕。
 * 闸门只挡「会让中栏掉线/污染线程」的字段：threadKey、turnId、type、event 载荷、
 * deltaKind、delta text、turn-end status、candidates 的 draftSetId / drafts；其余字段缺失只会退化成空文案，不致命。
 */
export function malformedPush(raw: unknown): string {
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
    // 候选集（P0-②）：缺了列表就没得挑，缺了句柄就没法回执——两者都直接挡在归约之外。
    case "candidates": {
      if (typeof value.draftSetId !== "string" || value.draftSetId === "")
        return "候选集缺少集标识";
      if (!Array.isArray(value.drafts)) return "候选集缺少稿件列表";
      return "";
    }
    default:
      return `未知推送类型：${String(value.type)}`;
  }
}

/**
 * 审批回执 → 卡片终态（纯映射）：`decide` 的返回值与卡上的 status / message 是同一件事的两种面孔，
 * 口径只留这一份。`message` 缺省表示「这条支路不改卡片上那句话」，不是「清空它」。
 * 成功（ok）回 null：终态由随后的 `written` 事件落，这里一个字都不许抢着写。
 */
export function decisionViewPatch(
  result: DecisionResult,
  guidance: string
): { status?: ProposalStatus; message?: string } | null {
  if (result.ok) return null;
  if (result.reason === "stale") return { status: "stale" };
  if (result.reason === "cancelled") return { status: "cancelled" };
  if (result.reason === "denied") return { status: "rejected", message: guidance };
  return { message: result.message };
}

function num(value: number): string {
  return value.toLocaleString("zh-CN");
}

/** 等待时长的上屏串：不到一分钟报秒，之后报分钟。负数与坏值一律按 0s。 */
function elapsedLabel(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}min`;
}

/** 状态行文案（spec §7 的运行态、§6.3 的打断残留、§9 第 4 行的中断原因、§5.1 的排队数；W-06 的字数进度）。
 *
 * 第五参是可选的：不递进度时，**旧四态逐字不变**（守卫钉着）。递了才在「工作中」与
 * 「上一轮已完成」两态插入读数——打断与失败态故意不加，那两态第一句该是原因，不是成绩单。
 */
export function composeStatusLine(
  thread: ThreadView | undefined,
  seconds: number,
  pending: number,
  queued: number,
  extra?: StatusProgress
): string {
  const progress = extra?.progress;
  const chars = Number.isFinite(progress?.chars)
    ? Math.max(0, Math.floor(progress?.chars ?? 0))
    : 0;
  const target = Number.isFinite(extra?.targetChars)
    ? Math.max(0, Math.floor(extra?.targetChars ?? 0))
    : 0;
  const paragraphs = progress?.paragraphs ?? 0;
  const edits = progress?.edits ?? 0;
  const wrote = chars > 0;
  // W-06：等待时长按人读的单位走——过了 1 分钟再报 137s 没人会换算。
  const elapsed = elapsedLabel(seconds);
  // 排队数只在运行中出现：那条队列要等这一轮结束才生效，状态行必须如实说明（spec §5.1）。
  if (thread?.running) {
    const readouts: string[] = [];
    if (wrote) {
      readouts.push(
        target > 0 ? `已写 ${num(chars)} / ${num(target)} 字` : `已写 ${formatCharCount(chars)}`
      );
      if (paragraphs > 0) readouts.push(`${paragraphs} 段`);
    }
    readouts.push(elapsed);
    return `${["工作中", ...readouts].join(" · ")} · Esc 打断${queued > 0 ? ` · 排队 ${queued} 条` : ""}`;
  }
  // 一轮正常收场后留一行成绩单：写了多少字、真落盘几处、还剩几条等批。
  // 数字只从事件流来，「改了 0 处」「待批 0 条」这类空话不摆。
  if (thread && thread.endedAs === "done" && wrote) {
    const readouts = [`本轮 ${formatCharCount(chars)}`];
    if (edits > 0) readouts.push(`改了 ${edits} 处`);
    if (pending > 0) readouts.push(`${pending} 条待审`);
    return ["上一轮已完成", ...readouts].join(" · ");
  }
  if (thread && thread.endedAs !== "" && thread.endedAs !== "done") {
    const head =
      thread.endedAs === "failed"
        ? thread.lastError === ""
          ? "上一轮失败"
          : thread.lastError
        : "已打断";
    // 这里**不再**写「可点「继续」」（2026-11-20 · 主线第一刀）：那一句话所在的位置是
    // 状态栏里的纯文本 `<span>`，全仓没有一枚「继续」按钮——用户点的是一句空话。
    // 现在「继续」是一枚真按钮：挂点判定在 utils/turn-resume.ts，渲染在中栏状态栏。
    // 状态行只负责说清「上一轮怎么了」，出口由按钮自己说。
    return pending > 0 ? `${head} · ${pending} 条待审` : head;
  }
  if (pending > 0) return `${pending} 条待审`;
  return "就绪";
}

/** 运行秒数的唯一算法：从所有在跑线程里**最早**那次 startedAt 起算，无在跑则归零（`tick()` 每秒调一次）。 */
export function runningSeconds(threads: Record<string, ThreadView>): number {
  const running = Object.values(threads).filter((thread) => thread.running);
  if (running.length === 0) return 0;
  const earliest = Math.min(...running.map((thread) => thread.startedAt));
  return Math.max(0, Math.floor((Date.now() - earliest) / 1000));
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
  // 用量那一行只在有数可说时才出现（sessionUsageText 空串即跳过）——没提问也没回报时不硬凑一句。
  const usage = sessionUsageText(thread?.items ?? []);
  const parts = [
    `线程 ${label}`,
    replay,
    `提案 ${facts.cards} 张（待审 ${facts.pending} 张）`,
    `排队 ${thread?.queued.length ?? 0} 条`,
    `权限档：${permission.text}`,
    `阶段：${facts.stageName}`,
    ...(usage === "" ? [] : [usage]),
    ended
  ];
  return `状态 · ${parts.join(" · ")}`;
}

/** 某条线程的待审张数：状态行、清视图、状态报告都数这一份，口径只留一处。 */
export function pendingCountOf(proposals: Record<string, CardViewLike>, threadKey: string): number {
  return Object.values(proposals).filter(
    (view) => view.proposal.threadKey === threadKey && view.status === "pending"
  ).length;
}

/** 某条线程的卡片总张数（清视图与状态报告共用；含待审与已决，不是只数待审）。 */
export function cardsCountOf(proposals: Record<string, CardViewLike>, threadKey: string): number {
  return Object.values(proposals).filter((view) => view.proposal.threadKey === threadKey).length;
}

/** 抹掉某条线程的全部提案（`/clear` 与换线程共用）：只删名下条目，别条线程一张不动。 */
export function purgeThreadProposals(
  proposals: Record<string, CardViewLike>,
  threadKey: string
): void {
  for (const id of Object.keys(proposals)) {
    if (proposals[id]?.proposal.threadKey === threadKey) delete proposals[id];
  }
}

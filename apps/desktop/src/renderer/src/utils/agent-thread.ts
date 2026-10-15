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
  type EditProposal,
  type PermissionMode,
  type ProposalStatus,
  type TurnEndStatus,
  UNBOUND
} from "@mochen/contracts";
import { permissionChipView } from "./permission-chip";
import { sessionUsageText } from "./token-usage";

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
 * deltaKind、delta text、turn-end status；其余字段缺失只会退化成空文案，不致命。
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

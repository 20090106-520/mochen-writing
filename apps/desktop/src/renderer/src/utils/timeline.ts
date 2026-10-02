import type { AgentEvent, AgentToolName, ProposalStatus } from "@mochen/contracts";

export interface StreamingTail {
  reasoning: string;
  message: string;
}

export interface PlanItemView {
  text: string;
  done: boolean;
}

export type TimelineBlock =
  | { kind: "user"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string; streaming: boolean; interrupted: boolean }
  | { kind: "plan"; id: string; items: PlanItemView[] }
  | { kind: "message"; id: string; text: string; streaming: boolean; interrupted: boolean }
  | { kind: "tool"; id: string; label: string; args: string; ok: boolean; resultText: string }
  | { kind: "error"; id: string; text: string }
  | { kind: "interrupted"; id: string; pending: number };

/**
 * 工具卡的中文标签（中栏给用户看的名字，不是工具 id）。
 * 裁定 r：键类型用 `AgentToolName`（唯一来源 `AGENT_TOOL_NAMES`）而不是 `string`——
 * 工具改名或新增时这张表必须编译报错，靠类型穷尽而不是靠人记得来改映射。
 */
export const TOOL_LABELS: Record<AgentToolName, string> = {
  read_doc: "读取文档",
  list_docs: "列出文档",
  search_docs: "全书检索",
  propose_patch: "提出改稿提案",
  write_doc: "写入文档"
};

/**
 * 持久事件 → 四层时间线（思考摘要 / 计划 / 正文 / 工具卡）。
 * 提案、裁决、写入三类事件刻意不进时间线：它们只挂在对应的提案卡上，
 * 免得同一件事在中栏出现两遍（spec §4 的中栏分工）。
 */
export function buildTimeline(items: AgentEvent[], tail: StreamingTail): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const event of items) {
    if (event.type === "user-message") {
      blocks.push({ kind: "user", id: event.id, text: event.text });
      continue;
    }
    if (event.type === "reasoning") {
      blocks.push({
        kind: "thinking",
        id: event.id,
        text: event.text,
        streaming: false,
        interrupted: event.interrupted
      });
      continue;
    }
    if (event.type === "plan") {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "plan") {
        last.items = event.items;
        last.id = event.id;
        continue;
      }
      blocks.push({ kind: "plan", id: event.id, items: event.items });
      continue;
    }
    if (event.type === "message") {
      blocks.push({
        kind: "message",
        id: event.id,
        text: event.text,
        streaming: false,
        interrupted: event.interrupted
      });
      continue;
    }
    if (event.type === "tool-call") {
      blocks.push({
        kind: "tool",
        id: event.id,
        // 取值处保留运行期兜底（裁定 r）：store 的闸门（useAgentStore.ts:79-111）只校验
        // threadKey/turnId/type，不校验嵌套的 event.tool，preload 也是裸 `payload as AgentOutbound`，
        // 所以表外的工具名确实能一路走到这里。类型上「不可能」，运行时可能——cast 不是装饰。
        label: (TOOL_LABELS as Partial<Record<string, string>>)[event.tool] ?? event.tool,
        args: event.args,
        ok: event.ok,
        resultText: event.resultText
      });
      continue;
    }
    if (event.type === "error") {
      blocks.push({ kind: "error", id: event.id, text: event.message });
      continue;
    }
    if (event.type === "interrupted") {
      blocks.push({ kind: "interrupted", id: event.id, pending: event.pendingProposals });
    }
  }
  if (tail.reasoning.trim() !== "")
    blocks.push({
      kind: "thinking",
      id: "tail-thinking",
      text: tail.reasoning,
      streaming: true,
      interrupted: false
    });
  if (tail.message.trim() !== "")
    blocks.push({
      kind: "message",
      id: "tail-message",
      text: tail.message,
      streaming: true,
      interrupted: false
    });
  return blocks;
}

/** 一轮的锚点：第几轮 + 该轮用户的提问原文（可能为空串）。 */
export interface TurnAnchor {
  index: number;
  userText: string;
}

/**
 * 按事件出现顺序给每个 turnId 编号（F-1：提案卡渲染在时间线之后，靠这张表认回自己那一轮）。
 * 只有**含 user-message 的轮次**才立锚点：历史重建时可能只剩工具卡，
 * 那种轮次查不到锚点，卡上的标签退回「本轮」（见 cardTurnLabel）。
 * 编号数的是「线程内第几轮」，所以没锚点的轮次照样占一个号，后面的轮次不会往前挪。
 */
export function turnAnchors(items: AgentEvent[]): Record<string, TurnAnchor> {
  const order: string[] = [];
  // 用无原型表存锚点：普通 {} 继承 Object.prototype，查询键是 "toString"/"valueOf"/"constructor"
  // 这类原型键时会命中继承的成员（IPC 被篡改/畸形推送下内层 turnId 可为任意串），
  // 让下游 anchor.userText.replace 抛 TypeError。Object.create(null) 从根上堵死这条面。
  const anchors: Record<string, TurnAnchor> = Object.create(null);
  for (const item of items) {
    const turnId = item.turnId;
    if (!order.includes(turnId)) order.push(turnId);
    if (item.type === "user-message" && anchors[turnId] === undefined)
      anchors[turnId] = { index: order.indexOf(turnId) + 1, userText: item.text };
  }
  return anchors;
}

/** 卡头标签里的提问原文最长显示这么多字，超了就截断加省略号。 */
const TURN_TEXT_MAX = 24;

/**
 * 卡头的轮次标签：有原文「第 2 轮 · 收紧比喻」，原文为空「第 2 轮」，查不到锚点「本轮」。
 * 刻意不返回空串——卡上没有可读标签就是 F-1 的原始现象。
 */
export function cardTurnLabel(anchors: Record<string, TurnAnchor>, turnId: string): string {
  const anchor = anchors[turnId];
  if (anchor === undefined) return "本轮";
  const text = anchor.userText.replace(/\s+/g, " ").trim();
  if (text === "") return `第 ${anchor.index} 轮`;
  // 按码点截断而不是按 UTF-16 码元：slice(0,24) 会把 emoji（代理对）劈成孤立高代理，
  // 卡头渲染出豆腐块。Array.from 先拆成码点数组，截 24 个码点再拼回，代理对要么整留要么整去。
  const chars = Array.from(text);
  const clipped =
    chars.length > TURN_TEXT_MAX ? `${chars.slice(0, TURN_TEXT_MAX).join("")}…` : text;
  return `第 ${anchor.index} 轮 · ${clipped}`;
}

/** splitProposalCards 用到的最小形状；渲染层直接把 ProposalView[] 传进来。 */
export interface ProposalCardInput {
  proposal: { turnId: string; createdAt: string };
  status: ProposalStatus;
}

export interface CardSplit<T extends ProposalCardInput = ProposalCardInput> {
  /** 待审：status === "pending"。 */
  open: T[];
  /** 已裁决：written / rejected / cancelled / stale / failed。 */
  settled: T[];
  /** 上次会话未处理：回放里没有 decision/written 配对的卡（D1，绝不伪装成可批准）。 */
  expired: T[];
}

/** 查不到锚点 ⇒ 轮次未知，排序时一律垫到最后。 */
const UNKNOWN_TURN_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * 分「待审 / 已裁决 / 上次会话未处理」三组（F-1：已裁决的卡收进默认折叠的分组，不再摊在最底部；
 * D1：expired 单独一组，绝不与可批准的待审混在一起）。
 * 排序所需的锚点表由调用方传入而不读 store——保持纯函数才可测（本仓没有组件测试）。
 * 三组都按轮次序号升序、同轮按 createdAt 升序；排序只发生在新数组里，不改传入数组。
 */
export function splitProposalCards<T extends ProposalCardInput>(
  cards: T[],
  anchors: Record<string, TurnAnchor>
): CardSplit<T> {
  const open: T[] = [];
  const settled: T[] = [];
  const expired: T[] = [];
  for (const card of cards) {
    if (card.status === "pending") open.push(card);
    else if (card.status === "expired") expired.push(card);
    else settled.push(card);
  }
  const byTurn = (a: T, b: T): number => {
    const indexA = anchors[a.proposal.turnId]?.index ?? UNKNOWN_TURN_INDEX;
    const indexB = anchors[b.proposal.turnId]?.index ?? UNKNOWN_TURN_INDEX;
    if (indexA !== indexB) return indexA - indexB;
    const createdA = a.proposal.createdAt;
    const createdB = b.proposal.createdAt;
    if (createdA === createdB) return 0;
    return createdA < createdB ? -1 : 1;
  };
  open.sort(byTurn);
  settled.sort(byTurn);
  expired.sort(byTurn);
  return { open, settled, expired };
}

/**
 * 回放派生扫描（spec §4.3 第 6 条）：对每条 proposal 事件，
 * 其后有 decision/written ⇒ 给已裁决态（沿用 store 语义）；没有 ⇒ expired。
 * accept 落了 decision 却没 written 视为 failed（写没成功），绝不留在可批准的 pending。
 */
export function replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus> {
  const status: Record<string, ProposalStatus> = Object.create(null);
  for (const event of events) {
    if (event.type === "proposal") {
      status[event.proposal.id] = "expired";
      continue;
    }
    if (event.type === "decision") {
      if (event.decision === "cancel") status[event.proposalId] = "cancelled";
      else if (event.decision === "deny-with-guidance") status[event.proposalId] = "rejected";
      else status[event.proposalId] = "failed";
      continue;
    }
    if (event.type === "written") {
      status[event.proposalId] = "written";
      continue;
    }
  }
  return status;
}

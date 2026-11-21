import type { AgentEvent, AgentToolName, ProposalStatus, WebSource } from "@mochen/contracts";
import { presentableFailureMessage } from "@mochen/contracts";
import { toolArgsText } from "./tool-args";
import { turnUsageText } from "./token-usage";

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
  | {
      kind: "tool";
      id: string;
      label: string;
      /** 摆上卡的那一行。已是人话（`toolArgsText` 转过）；`argsPlain` 决定画不画等宽字体。 */
      args: string;
      argsPlain: boolean;
      ok: boolean;
      /**
       * 卡头右上角那三个字背后的**判定**（2026-10-06 批次 5-⑮）。
       *
       * 为什么要第三态：`ok` 只答「这次调用有没有出错」，而「源都能用、只是这个说法没搜着东西」
       * **不是错**——它是模型据此换关键词的正常回执。可界面上只有 ok 时，
       * 那张卡就与「搜到了」长得一模一样（真机截图：没搜着的搜索写着「完成」）。
       *
       * 判定住这里而不是模板：`完成 / 未通过 / 没搜到` 这几个字只有这一处说了算，
       * 模板里写 `block.empty ? … : block.ok ? … : …` 就是第二份判据。
       */
      status: ToolStatus;
      resultText: string;
      sources: WebSource[];
      /**
       * 原始回执是否默认折起来（批次 5-⑪）。
       *
       * 只有「这张卡同时有结构化来源清单」时才折：那两种排版是**同一批数据**，
       * 360 的跳转链还会在回执里摊成几百字符的 base64——真机一张卡量到 398px 高，
       * 而真正给人看、给人点的清单被压在它下面。判定住这里而不是模板：
       * 模板里写 `v-if="block.sources.length > 0"` 就是第二份判据，改一边忘了另一边就折叠逻辑漂了。
       *
       * 刻意**不**对「没搜着的回执」折叠：那句话（失败原因、要换个词重搜）就是用户要读的东西，
       * 折起来等于把唯一有用的信息藏了。
       */
      rawFolded: boolean;
    }
  /**
   * 这一轮失败了。`at` 是事件自己的时间戳（回放时**必须**带上）——
   * 2026-10-23 真机走查：打开一本书就把上次会话的红底失败条原样摆出来，而那批是 15 天前的记录，
   * 界面上没有任何日期 ⇒ 读起来像「应用现在坏了」。判据与格式化都在 utils/history-time。
   *
   * 【2026-10-25 · §173】多两个字段：
   * - `stale`：这条失败**之后线程又往前走过了**（有过新的提问或新的助手回复）⇒
   *   它已经不是「当前状态」，只是一段历史。红底红字是「刚刚炸了」的语气，
   *   钉在一条两天前、后来已经聊回来的失败上，读起来像应用现在坏了（用户原话：
   *   「还有红色的那个东西」）。⇒ 判据在 `markStaleFailures`，模板只读这个布尔。
   * - `retryText`：失败前最近一条用户提问（「再问一次」要填回输入框的那句）。没有就 null。
   */
  | {
      kind: "error";
      id: string;
      text: string;
      at: string;
      stale: boolean;
      retryText: string | null;
    }
  /**
   * 本轮 token 用量（2026-10-15）。`text` 是**组好的人话**（`turnUsageText`），
   * 模板只渲染它、不自己拿 requests/reported 再拼一遍——判定与句子都只在这一处（铁律 6）。
   */
  | { kind: "usage"; id: string; text: string }
  | { kind: "interrupted"; id: string; pending: number };

/**
 * 来源清单默认摊开几条（批次 5-⑭）。
 *
 * 真机量到的（`p514-card-mass`，必应源十条来源那一轮）：
 *   卡片 874px = 清单 725px（83%）+ 卡头/参数/回执折叠件 149px；
 *   清单里**每条 69px，十条一模一样**（摘要 42 + 打开 23 + 标题 17）——
 *   **没有一条特别长，是条数堆出来的**，所以收条数比收摘要管用；
 *   对话区可视 1244px，这一张卡吃掉 **70%**，用户那句问和模型那句答都被挤到看不见。
 *
 * 取 5：够用户核对（模型最多引用两条），又不至于把对话压没。
 * 剩下的折在「展开其余 N 条」里——不是藏起来，是默认不铺开。
 * 判定住这里而不是模板：这个数是**为什么**，模板只需要照着切。
 */
export const SOURCE_LIST_PREVIEW = 5;

/**
 * 工具卡的状态（批次 5-⑮）：`done` 搜到了 / `empty` 跑通了却空手 / `failed` 这次调用出错。
 * 顺序有意义——`empty` 排在 `failed` 前面判：**空不是坏**，别把两者混成一类。
 */
export type ToolStatus = "done" | "empty" | "failed";

/** 由 `ok` + `empty` 两个字段归一成一态。带 `empty` 的事件可能来自老会话之外，所以只认显式 true。 */
export function toolStatusOf(ok: boolean, empty: boolean | undefined): ToolStatus {
  if (!ok) return "failed";
  if (empty === true) return "empty";
  return "done";
}

/** 卡头右上角那三个字。**只有这一处说了算**（见 TimelineBlock 工具分支的 status 注释）。 */
export function toolStatusLabel(status: ToolStatus): string {
  if (status === "failed") return "未通过";
  if (status === "empty") return "没搜到";
  return "完成";
}

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
  write_doc: "写入文档",
  web_search: "联网搜索",
  web_read: "读取网页",
  // 2026-10-23 技能自选：模型自己列技能库、按需载入正文（只读）。名字与 tool-roster 同一份口径。
  use_skill: "查技能",
  // 2026-11-20 设定提案：不写正文，生成一张待批准的设定卡。
  propose_bible: "提设定"
};

/**
 * 持久事件 → 四层时间线（思考摘要 / 计划 / 正文 / 工具卡）。
 * 提案、裁决、写入三类事件刻意不进时间线：它们只挂在对应的提案卡上，
 * 免得同一件事在中栏出现两遍（spec §4 的中栏分工）。
 */
export function buildTimeline(items: AgentEvent[], tail: StreamingTail): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  /** 失败条要用它：「再问一次」填回输入框的就是失败前最近那一句。 */
  let lastUserText: string | null = null;
  for (const event of items) {
    if (event.type === "user-message") {
      lastUserText = event.text;
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
      const sources = event.sources ?? [];
      const argsText = toolArgsText(event.tool, event.args);
      blocks.push({
        kind: "tool",
        id: event.id,
        // 取值处保留运行期兜底（裁定 r）：store 的闸门（useAgentStore.ts:79-111）只校验
        // threadKey/turnId/type，不校验嵌套的 event.tool，preload 也是裸 `payload as AgentOutbound`，
        // 所以表外的工具名确实能一路走到这里。类型上「不可能」，运行时可能——cast 不是装饰。
        label: (TOOL_LABELS as Partial<Record<string, string>>)[event.tool] ?? event.tool,
        // 2026-10-07 用户裁定「只显示文字，不用显示代码」：卡上那一行是人话，
        // 原始 args 仍原样留在事件里、也仍随会话落盘（那是给模型读与回放用的）。
        args: argsText.text,
        argsPlain: argsText.plain,
        ok: event.ok,
        // 三态归一只在这一处发生；模板只读 status，不自己拿 ok/empty 再判一遍。
        status: toolStatusOf(event.ok, event.empty),
        resultText: event.resultText,
        // 只有 web_search 带 sources，老会话里没有这个键；判空后给空数组，
        // 让工具卡的模板不必到处写 `?.` —— 这是展示层的一次归一，不是第二份来源。
        sources,
        rawFolded: sources.length > 0
      });
      continue;
    }
    // 【2026-10-25 用户批注「不应该显示这个」】失败条上那句话**渲染时**翻成人话。
    //
    // 为什么渲染层也要翻：盘上早就落下来的旧记录（2026-10-08 之前的主进程写的原始英文异常
    // `***.BadRequestError: OpenAIException - {…}`）主进程已经改不动了——那是历史事实。
    // 但**显示**是渲染层的事，屏上那句话必须是人话。
    //
    // 判据住在 `@mochen/contracts`（与主进程共用同一份，铁律 6），且是**幂等**的：
    // 主进程翻过的那批（含中文）原样不动。
    if (event.type === "error") {
      blocks.push({
        kind: "error",
        id: event.id,
        text: presentableFailureMessage(event.message),
        at: event.ts,
        // 「已经被后来的成功盖过」要回头看才知道 ⇒ 这一刀在最后统一标（markStaleFailures）。
        stale: false,
        retryText: lastUserText
      });
      continue;
    }
    if (event.type === "usage") {
      // 文案在 token-usage.ts 里组好，这里只把它摆成一块——模板读 text，不自己判。
      blocks.push({ kind: "usage", id: event.id, text: turnUsageText(event) });
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
  return markStaleFailures(blocks);
}

/**
 * 标出「已经被后来的成功盖过」的失败条（2026-10-25 · §173）。
 *
 * **判据**：失败条**之后**只要还有新的提问或新的助手回复，这条线程就往前走过了一格，
 * 那条失败于是不再是「当前状态」，只是一段历史。
 * 红底红字是「刚刚炸了」的语气；钉在两天前、后来已经聊回来的失败上，
 * 读起来像应用现在坏了（用户原话：「还有红色的那个东西，解决一下」）。
 * ⇒ 盖过的失败降成一行低调记录（`stale: true`，模板据此换样式），
 * **不藏**——失败必须看得见，只是不再冒充当前状态。
 *
 * 只有它**之后**才有东西才算「盖过」：失败条本身在链上的位置就是它发生的那一刻。
 * 尾部正在流式的那条助手回复（`tail-message`）也算——线程确实在往前走。
 */
export function markStaleFailures(blocks: TimelineBlock[]): TimelineBlock[] {
  let movedOn = false;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block === undefined) continue;
    if (block.kind === "user" || block.kind === "message") {
      movedOn = true;
      continue;
    }
    if (block.kind === "error" && movedOn) {
      blocks[i] = { ...block, stale: true };
    }
  }
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
 *
 * **已知前瞻边界（等 F-6 落地时再处理，现在别动）**：编号是在**传进来的 items 内**数的。
 * `/resume` 若只回放最近 N 轮，编号会从 1 重数，与会话的真实轮次对不上（卡头会出现「第 2 轮」
 * 指第二轮，其实它是第十九轮）。正解是给本函数加一个「起始轮次偏移」入参，由回放层按
 * 事件表里最小轮次算出来。现在**刻意不加**：还没有任何调用方会传它，加一个恒为默认值的
 * 参数就是铁律 6 说的第二份实现，且会诱使人以为偏移已经算对了。
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
 *
 * 「查不到锚点 ⇒ 本轮」这一格在**当前数据流下走不到**：anchors 与 cards 同源出自一条事件流，
 * 有卡的轮次必然进过 order。它不是死代码，是给 F-6（`/resume` 事件回放）预留的防御——
 * 回放时可能只重建出工具卡而丢掉 user-message，那种轮次就查不到锚点。
 * **别当成冗余分支删掉**：删了当时全绿，等 /resume 上线，卡头会空成 F-1 的原始现象。
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

/** 本线程的**全部**卡（含已裁决）。以前这份就叫 pending，名不副实且把卡全摊在最底部。 */
export function threadCardsOf<T extends { proposal: { threadKey: string } }>(
  views: T[],
  threadKey: string
): T[] {
  return views.filter((view) => view.proposal.threadKey === threadKey);
}

/**
 * 回放派生扫描（spec §4.3 第 6 条）：对每条 proposal 事件，
 * 其后有 decision/written ⇒ 给已裁决态（沿用 store 语义）；没有 ⇒ expired。
 * accept 落了 decision 却没 written 视为 failed（写没成功），绝不留在可批准的 pending。
 * 缺陷③补一条：带 proposalId 的 error 是主进程「这条提案已确定失效」的口径，
 * 它没有配对的 decision，所以先归到 expired 再改判 stale——两张卡都不可批准，只是文案不同。
 */
export function replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus> {
  const status: Record<string, ProposalStatus> = Object.create(null);
  for (const event of events) {
    if (event.type === "proposal") {
      status[event.proposal.id] = "expired";
      continue;
    }
    // 设定提案与正文提案共用一张 id → 状态表（id 是全局唯一的）：
    // 回放时卡片的初值同样是「未处理」，随后由 decision / bible-written 覆盖。
    if (event.type === "bible-proposal") {
      status[event.proposal.id] = "expired";
      continue;
    }
    if (event.type === "bible-written") {
      status[event.proposalId] = "written";
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
    if (event.type === "error") {
      // 缺陷③：error{stale} 在盘上没有配对的 decision，回放派生扫描会把这类卡归到 expired（未处理组）。
      // 规则：仅当当前值是 expired 才改判 stale；已 written / cancelled / rejected / failed 一律不动。
      if (event.proposalId !== undefined && status[event.proposalId] === "expired")
        status[event.proposalId] = "stale";
      continue;
    }
  }
  return status;
}

/**
 * 装配层去重（Wave A 顾虑 1）：`error` 事件既进 items（时间线里的 error 块），
 * 又写 thread.lastError（useAgentStore.ts:237-240），同一句中文会显示两遍。
 * 但 lastError 还有三类**不产生时间线块**的来源——send 被边界拒绝（:320-324）、
 * stop 被拒绝（:340-345）、turn-end{failed}（:214）——所以不能简单砍掉单列段。
 * 规则：与时间线里最后一条 error 文本相同就不重复渲染，其余照旧显示。
 * 刻意不改 store 与 timeline 的语义（那是上游契约）。
 *
 * 【2026-10-25】去重比对的是**原始**文本（event.message 对 thread.lastError），
 * 翻译只发生在**显示**那一步（两处都走 contracts 的 presentableFailureMessage）——
 * 所以去重不会因为两边都翻过而错位。
 */
export function orphanErrorText(threadLastError: string, items: AgentEvent[]): string {
  let lastTimelineError = "";
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const event = items[index];
    if (event?.type === "error") {
      lastTimelineError = event.message;
      break;
    }
  }
  if (threadLastError === "" || threadLastError === lastTimelineError) return "";
  // 与时间线那条同一个真身（contracts）：屏上不出现原始英文异常。
  return presentableFailureMessage(threadLastError);
}

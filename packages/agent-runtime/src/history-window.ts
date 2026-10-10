import type { ContextHistoryStat } from "@mochen/contracts";
import { estimateTokens } from "./context.js";
import type { ChatMessage } from "./chat-message.js";

/**
 * 上游窗口的**假设值**（tokens）。
 *
 * 为什么要有这一枚而不是让调用方传：`packages/contracts/provider.ts` 与
 * `providerConnectionSchema` 里没有一处声明窗口大小——那是模型属性而不是连接属性，
 * 契约目前装不下它。P1-3 要的是「不再把整段历史端出去」，得先有个保守上限起手。
 *
 * 为什么取 24000：本仓实测过的国内端点（DeepSeek、GLM、Kimi 的 8k 档、MiMo）里，
 * 最紧的输入档在 32k 上下；按 32k 打七折留一份安全余量给输出与工具回执，就是 24000。
 * 真接入 `contextWindow` 字段后，`agent-service` 那一路显式传 `windowTokens` 覆盖即可——
 * **不许**在别处再抄一份 24000（铁律 6：一个判据只许一处）。
 */
export const UPSTREAM_WINDOW_TOKENS = 24000;

/**
 * 历史这一路的**默认预算上限**（tokens），不含系统提示、上下文包与本轮用户输入。
 *
 * 为什么这一枚单独存在：调用方在装配前只想知道「历史能吃多少」，而不是把整套预留算完再传。
 * 有 `windowTokens` 显式覆盖时按 min(默认档, 窗口 − 预留) 取小者——保守那一头永远压得住。
 */
export const HISTORY_TOKEN_BUDGET = 6000;

/**
 * 一条消息在**上游 wire 上**大致占多少 tokens。
 *
 * 为什么不只数 `content`：OpenAI 兼容层把 `tool_calls` 的 `arguments` 原样发出去，
 * 半截 tool_call 之所以能把整轮打成 400，靠的就是 arguments 那一串。
 * 只按 content 估会**系统性低估**含工具调用的那一条，切完仍然撞墙。
 */
function messageTokens(m: ChatMessage): number {
  let total = estimateTokens(m.content);
  for (const call of m.toolCalls) total += estimateTokens(call.args);
  return total;
}

function messageChars(m: ChatMessage): number {
  let total = m.content.length;
  for (const call of m.toolCalls) total += call.args.length;
  return total;
}

/**
 * 历史切片的一块：要么全进 kept、要么全进 dropped。
 * `pinned` 是「系统消息必留」这一路；`malformed` 是孤儿 tool 回执——
 * 单独发出去上游就 400，宁可丢也不能留。
 */
interface Block {
  messages: ChatMessage[];
  tokens: number;
  chars: number;
  pinned: boolean;
  malformed: boolean;
}

/**
 * 把扁平的 history 拆成「同进同出」的块。
 *
 * 判据与 `tool-loop.test.ts:370-418` 与 `provider-client.test.ts` 里的配对约定同源：
 * 一条 assistant 带着 `toolCalls: [c1, c2]`，后面紧跟着的 `role==="tool"` 消息就是它的回执。
 * 这一层不认识事件形状，只认 `ChatMessage`——`rollout.eventsToMessages` 已经把
 * `tool-call` 事件展成 assistant + tool 两行（见 rollout.ts:227-232）。
 */
export function buildBlocks(history: readonly ChatMessage[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < history.length) {
    const m = history[i]!;
    if (m.role === "system") {
      blocks.push({
        messages: [m],
        tokens: messageTokens(m),
        chars: messageChars(m),
        pinned: true,
        malformed: false
      });
      i += 1;
      continue;
    }
    if (m.role === "assistant" && m.toolCalls.length > 0) {
      const group: ChatMessage[] = [m];
      let j = i + 1;
      while (j < history.length && history[j]!.role === "tool") {
        group.push(history[j]!);
        j += 1;
      }
      const tokens = group.reduce((sum, g) => sum + messageTokens(g), 0);
      const chars = group.reduce((sum, g) => sum + messageChars(g), 0);
      blocks.push({ messages: group, tokens, chars, pinned: false, malformed: false });
      i = j;
      continue;
    }
    if (m.role === "tool") {
      // 孤儿回执：上面没有配对的 assistant-with-tool_calls。单独发出去必被上游拒收，
      // 与「留半条 tool_call 上游直接 400」是同一件事的另一面——判成 malformed、整块丢。
      blocks.push({
        messages: [m],
        tokens: messageTokens(m),
        chars: messageChars(m),
        pinned: false,
        malformed: true
      });
      i += 1;
      continue;
    }
    blocks.push({
      messages: [m],
      tokens: messageTokens(m),
      chars: messageChars(m),
      pinned: false,
      malformed: false
    });
    i += 1;
  }
  return blocks;
}

export interface FitHistoryInput {
  /** 要发给上游的历史（eventsToMessages 的产物），不含系统提示与本轮 user。 */
  history: readonly ChatMessage[];
  /** 系统提示词的 token 估算（从窗口里先扣，不参与切片）。 */
  systemTokens: number;
  /** 本轮用户输入的 token 估算（同上）。 */
  userTokens: number;
  /** 装配好的上下文包（章节正文/大纲/人物卡那一叠）的 token 估算。 */
  contextPackTokens?: number;
  /** 上游整段窗口；契约没有 `contextWindow` 字段可读（见 UPSTREAM_WINDOW_TOKENS 注释）。 */
  windowTokens?: number;
  /** 显式给历史这一路定预算；给了就覆盖上面的窗口扣减，只按这一枚切。 */
  budgetTokens?: number;
}

export interface FitHistoryResult {
  /** 从后往前按预算装得下的那一段，顺序与原历史一致（回放不许打乱）。 */
  kept: ChatMessage[];
  /** 被丢的条数——界面写「更早的 N 条没有发给模型」靠它，不许写死 0。 */
  droppedCount: number;
  /** 被丢的大致字数（**字符数**，不是 token；用户读得懂的是字）。 */
  droppedChars: number;
  /** kept 里所有消息的 token 估算（含 pinned 系统消息），供占用条核对。 */
  keptTokens: number;
}

/**
 * 按预算从后往前保留历史；系统消息必留、tool-call 与配对回执同进同出。
 *
 * 为什么不是「先算条数、后按块切」的贪心：一块里带 assistant + 一串 tool 回执，
 * 只看条数会把 2~6 条当一条，切完仍然超窗口。按 tokens 贪心从尾部塞是唯一能同时
 * 守住「不留半条 tool_call」与「不撞上游超长」两条硬条件的写法。
 *
 * 为什么 `pinned` 一定要留：spec §4 与 tool-loop.ts:147-151 的组装是
 * `[system, ...history, user]`，系统那一层承载「你是谁 / 你能改哪儿」；
 * 切片把它切掉 = 整轮失忆，比超长更坏。pinned 超预算也照样留——
 * 宁可撑爆预算让上游报错，也不冒充「没有系统提示」把用户蒙在鼓里。
 */
export function fitHistoryToWindow(input: FitHistoryInput): FitHistoryResult {
  const window = input.windowTokens ?? UPSTREAM_WINDOW_TOKENS;
  const reserved = input.systemTokens + input.userTokens + (input.contextPackTokens ?? 0);
  const availableFromWindow = Math.max(0, window - reserved);
  const budget = input.budgetTokens ?? Math.min(HISTORY_TOKEN_BUDGET, availableFromWindow);

  const blocks = buildBlocks(input.history);
  const kept = new Set<Block>();
  let remaining = budget;
  // 系统块先扣：pinned 一定上桌，从剩余额度里划走；即便划成负数也照样留（见上文注释）。
  for (const b of blocks) {
    if (b.pinned) {
      kept.add(b);
      remaining = Math.max(0, remaining - b.tokens);
    }
  }
  // 尾部往头贪心：非 pinned、非 malformed 的块塞得下就塞；塞不下就整块丢。
  // malformed（孤儿 tool 回执）**必须**整块丢，与预算无关——留一条在上游就是 400。
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i]!;
    if (b.pinned || b.malformed) continue;
    if (b.tokens <= remaining) {
      kept.add(b);
      remaining -= b.tokens;
    }
  }
  const result: ChatMessage[] = [];
  let droppedCount = 0;
  let droppedChars = 0;
  let keptTokens = 0;
  for (const b of blocks) {
    if (kept.has(b)) {
      result.push(...b.messages);
      keptTokens += b.tokens;
    } else {
      droppedCount += b.messages.length;
      droppedChars += b.chars;
    }
  }
  return {
    kept: result,
    droppedCount,
    droppedChars,
    keptTokens
  };
}

/** 全零的历史格：没书 / 没会话 / 坏线程都用它——出不出行由渲染层 historyMeterRow 一处判。 */
const NO_HISTORY_STAT: ContextHistoryStat = {
  entries: 0,
  chars: 0,
  approxTokens: 0,
  droppedCount: 0,
  droppedChars: 0
};

/**
 * 占用条预览用的 `history` 格（P1-3，ContextPreview.history 的数据源）。
 *
 * 为什么按「预留为零」算：预览不知道这一轮真发时系统提示词会占多少，
 * 所以报的是**上界**——真实 startTurn 只会切得更狠、不会更松，
 * 占用条宁可略保守也不骗人说还有余量。`null`＝没历史可读，给全零而不是省略字段。
 */
export function historyStatFor(history: readonly ChatMessage[] | null): ContextHistoryStat {
  if (history === null) return NO_HISTORY_STAT;
  const f = fitHistoryToWindow({ history, systemTokens: 0, userTokens: 0 });
  return {
    entries: f.kept.length,
    chars: f.kept.reduce((sum, m) => sum + m.content.length, 0),
    approxTokens: f.keptTokens,
    droppedCount: f.droppedCount,
    droppedChars: f.droppedChars
  };
}

/**
 * 「更早的 N 条没有发给模型（约 M 字）。」那句人话（P1-3）。
 * 数字只来自 fitHistoryToWindow 一处（铁律 6）。渲染层 utils/history-window.ts
 * 有同一口径的文案副本——渲染层不许 import 本包（见 context-meter-wiring 契约），
 * 两处说的都是同一份 droppedCount/droppedChars，不各算各的。
 */
export function historyNotice(fitted: FitHistoryResult): string {
  if (fitted.droppedCount <= 0) return "";
  return `更早的 ${fitted.droppedCount} 条没有发给模型（约 ${fitted.droppedChars} 字）。`;
}

export interface FoldOrphanInput {
  /** `eventsToMessages` 端出来的会话历史（不含本轮用户输入——那一条由 runTurn 自己追加）。 */
  history: readonly ChatMessage[];
  /** 本轮正要发的那句：判断末尾那条 user 是不是它的重复。 */
  userText: string;
}

export interface FoldOrphanResult {
  /** 折过之后的历史，顺序与原历史一致，条目是原引用（不复制、不改动入参）。 */
  kept: ChatMessage[];
  /** 被折掉的条数；0 表示这一轮什么都没动，notice 也是空串。 */
  foldedCount: number;
  /** 上屏那句人话，只在真折了东西时非空。 */
  notice: string;
}

/**
 * 把「上一轮没得到回答、这一轮又发一遍」的那条 user 折掉（2026-10-10 扫描总单 P2-6）。
 *
 * 缺陷的形状：`user-message` 事件在开流**之前**就落盘（tool-loop.ts:144 第一条就发它，
 * agent-service 的 publish 逐条写 JSONL）。那一轮随后失败（连不上、超长、密钥错……），
 * 会话文件里于是留下一条没有任何回答的 user。用户照着同一句再发一次，
 * `eventsToMessages` 就给出 `user(q), user(q)`：同一句话向上游付两遍钱，
 * 而且模型会读到「用户把同一句催了两遍」。
 *
 * 为什么判据是「相邻且同文」而不是「后面没有 assistant」：后者要在整段历史上做后视扫描，
 * 会把 `（审批结果：…）`、`（用户对上一条提案的意见：…）` 这类**合成的 user 行**
 * （rollout.ts:233-243）和真正的用户提问混为一谈。相邻同文只有可能是重发造成的，
 * 中间只要夹着任何一条 assistant / tool 就说明上一句已经得到回应，一条都不许折。
 *
 * 为什么**不**改成「失败轮不写 user 那行」：那要么往 JSONL 里加新字段语义（会话格式是硬约束），
 * 要么把整轮事件攒到成功再一次性落盘（失败时用户看到的半截内容就真没了）。
 * 折在发出去之前这一处，磁盘上的一行字节一个不动，回放历史照样看得到那次失败。
 */
export function foldOrphanUserMessages(input: FoldOrphanInput): FoldOrphanResult {
  const history = input.history;
  const incoming = input.userText.trim();
  const kept: ChatMessage[] = [];
  let foldedCount = 0;
  for (let i = 0; i < history.length; i += 1) {
    const m = history[i]!;
    if (m.role === "user") {
      const next = history[i + 1];
      const sameAsNext =
        next !== undefined && next.role === "user" && next.content.trim() === m.content.trim();
      // 末尾那条单独判：它与本轮要发的这句同文时，留在历史里就是第二次付费（runTurn 会再追加一次）。
      const sameAsIncoming = i === history.length - 1 && m.content.trim() === incoming;
      if (sameAsNext || sameAsIncoming) {
        foldedCount += 1;
        continue;
      }
    }
    kept.push(m);
  }
  return {
    kept,
    foldedCount,
    notice:
      foldedCount === 0
        ? ""
        : `上一轮没有得到回答的那 ${foldedCount} 条重复内容已经合并，这一句只发给模型一遍。`
  };
}

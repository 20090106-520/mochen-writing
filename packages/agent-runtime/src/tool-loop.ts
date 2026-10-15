import type {
  AgentDeltaKind,
  AgentEvent,
  AuthHeader,
  EditProposal,
  ProposalDecision,
  ThinkingLevel,
  ThinkingWire,
  TokenUsage,
  TurnEndStatus,
  WebSource
} from "@mochen/contracts";
import { parseProtocolBlocks } from "./patch-protocol.js";
import { ProviderError, TRUNCATED_TOOL_CALL_RECEIPT, truncationNotice } from "./provider-client.js";
import type { ChatToolSpec, StreamEvent } from "./provider-client.js";
import {
  assistantToolMessage,
  chatMessage,
  toolMessage,
  type AssistantToolCall,
  type ChatMessage
} from "./chat-message.js";
import {
  dispatchToolCall,
  toolGateOf,
  toolsFor,
  type ToolHost,
  type ToolOutcome
} from "./tools.js";
import { estimateTokens } from "./context.js";
import { fitHistoryToWindow, historyNotice } from "./history-window.js";

export interface TurnInput {
  turnId: string;
  threadKey: string;
  systemPrompt: string;
  history: ChatMessage[];
  userText: string;
  /** 每轮开关，由主进程从已校验的 StartTurnInput 原样搬来；循环不认识字段名，只负责往下传。 */
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
}

export interface StreamRequestLike {
  baseURL: string;
  apiKey: string;
  /** 密钥放哪个头（小米 MiMo 那类端点只认 api-key）；与 provider 同源，循环只负责往下传。 */
  authHeader?: AuthHeader;
  /** 最高档思考在线上叫什么；与 provider 同源，循环只负责往下传。 */
  thinkingWire?: ThinkingWire;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolSpec[];
  signal: AbortSignal;
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
}

export interface TurnDeps {
  stream: (req: StreamRequestLike) => AsyncGenerator<StreamEvent>;
  host: ToolHost;
  emit(event: AgentEvent): void;
  emitDelta(kind: AgentDeltaKind, text: string): void;
  newId(): string;
  now(): string;
  signal: AbortSignal;
  maxToolRounds: number;
  /** provider 参数由调用方（主进程）填好，循环只负责对话结构。 */
  provider: {
    baseURL: string;
    apiKey: string;
    model: string;
    authHeader?: AuthHeader;
    thinkingWire?: ThinkingWire;
  };
}

export interface TurnOutcome {
  status: TurnEndStatus;
  message: string;
}

/**
 * 打断这句话只留一份：它同时进 `turn-end` 的 message（界面右上那条）与用例断言。
 * 三处各抄一遍迟早会变成三种说法，而用户要靠这句话判断自己丢没丢字。
 */
const INTERRUPTED_MESSAGE = "已打断当前轮次，已流出的内容保留。";

/** 一轮里没轮到执行的那些工具调用的回执（同一句，逐条配对，绝不留悬空 tool_call）。 */
const SKIPPED_BY_INTERRUPT = "这一轮已打断，这条调用没有执行。";

interface Collected {
  reasoning: string;
  text: string;
  calls: AssistantToolCall[];
  /**
   * 参数没收全的那些调用（P2-5）。provider-client 仍然不把它们当可执行调用交出来，
   * 但也不再静默丢：这里逐条落一张 ok:false 的回执卡，用户看得见「它想调，被截断了」。
   */
  truncatedCalls: AssistantToolCall[];
  finishReason: string;
}

type EmitBody =
  | { type: "user-message"; text: string }
  | { type: "reasoning"; text: string; interrupted: boolean }
  | { type: "plan"; items: { text: string; done: boolean }[] }
  | { type: "message"; text: string; interrupted: boolean }
  | {
      type: "tool-call";
      callId: string;
      // 与 contracts 的 agent-event 对齐：插件工具名运行时才知道，枚举装不下（2026-10-07 批次 5-㉘）。
      tool: string;
      args: string;
      ok: boolean;
      resultText: string;
      /** 只有 web_search 带：这一轮搜到的来源。 */
      sources?: WebSource[];
      /**
       * 跑通了但没东西可给（2026-10-06 批次 5-⑮）。只有 web_search 会带。
       * 语义见 `ToolOutcome.empty`：它不是失败，是**空**。
       */
      empty?: boolean;
    }
  | { type: "proposal"; proposal: EditProposal }
  | {
      type: "decision";
      proposalId: string;
      decision: ProposalDecision;
      guidance: string;
      auto: boolean;
    }
  | {
      type: "written";
      proposalId: string;
      docRelPath: string;
      fingerprint: string;
      backupRelPath: string | null;
    }
  | { type: "interrupted"; pendingProposals: number }
  | { type: "error"; message: string }
  | {
      /**
       * 这一轮发了几次请求、其中几次上游回了用量、以及**已回报部分**的三枚数之和（2026-10-15）。
       * 没回报的那几次不估算、不补零；`requests - reported` 就是「有几发没给数」这件事本身。
       */
      type: "usage";
      requests: number;
      reported: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutcome> {
  const stamp = () => ({ id: deps.newId(), ts: deps.now(), turnId: input.turnId });
  // EmitBody 与 AgentEvent 去掉基字段后一一对应；这里用一次 as 收敛，真正的净网在
  // Task 6 的 readSession：形状不合法的行会被 agentEventSchema 判掉并计入 droppedLines。
  const emitSimple = (body: EmitBody): void => {
    deps.emit({ ...stamp(), ...body } as AgentEvent);
  };
  emitSimple({ type: "user-message", text: input.userText });

  // 本轮用量计数（2026-10-15）。requests 每发一次请求就 +1（连接期失败也算发过）；
  // reported 只在某一发上游回了用量时 +1；三枚数只累加**已回报**的那些，没回报的不估算、不补零。
  let requests = 0;
  let reported = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  /**
   * 用量播报只在这一处出口（2026-10-15）。reported === 0 时一个字都不发：
   * 失败轮/打断轮本来就没有可信的数，冒一行「用量」只会是噪音。
   */
  const emitUsage = (): void => {
    if (reported === 0) return;
    emitSimple({ type: "usage", requests, reported, promptTokens, completionTokens, totalTokens });
  };

  /**
   * 收口唯一（2026-10-15）：全部 return 都从这里出去，用量事件正好在收尾前发出一次。
   * 六个 return 点各写一遍 emitUsage 迟早会漏一处——漏的那处最容易被忘，往往正是打断。
   */
  const finish = (outcome: TurnOutcome): TurnOutcome => {
    emitUsage();
    return outcome;
  };

  /**
   * 打断的收尾只有一份：三个入口（流式期打断、一轮工具跑一半被打断、上一轮工具执行期间
   * 被打断）此前各写各的，句子与事件顺序迟早会分家——同一个处境两种说法是这仓反复栽过的。
   */
  const finishInterrupted = (pending: number): TurnOutcome => {
    emitSimple({ type: "interrupted", pendingProposals: pending });
    return finish({ status: "interrupted", message: INTERRUPTED_MESSAGE });
  };

  /**
   * 发出去之前把历史切窗（2026-10-10 扫描总单 P1-3）。
   *
   * 原来这里是 `...input.history` 原样端出去：长会话（一天几十轮）必然越过上游窗口，
   * 上游回一句 context_length_exceeded，界面上只有一句「请求失败」——用户既不知道为什么，
   * 也没有任何办法继续（除了新开会话，而那意味着丢掉全部上下文）。
   * 切窗的口径只在 `history-window.ts` 一处（系统提示必留、tool 调用与回执同进同出、从后往前贪心）；
   * 这里只负责**在真正的派发点上调用它**，并把「裁了多少」如实说出去。
   *
   * 那句人话走既有的 `error` 事件，句子由 `historyNotice` 组（2026-10-12 收掉 P1-3 的另一半）：
   * 主进程在 `agent-service.ts` 里已经先把历史切过一遍再递进来，所以这一处**在桌面应用里是兜底**
   * ——真正常开的通路是主进程那一条 `emitOnly(historyNotice(fitted))`。两处说的是同一句、同一个数字，
   * 就不许再造第二种「说法」：原来这里发一条 `history-truncated` 事件，而渲染层与回放对它的消费方**是零**，
   * 于是同一件事实有两条通路，一条上屏、一条静默丢（详见扫描台账第二十五节）。
   */
  const fit = fitHistoryToWindow({
    history: input.history,
    systemTokens: estimateTokens(input.systemPrompt),
    userTokens: estimateTokens(input.userText)
  });
  const fitNotice = historyNotice(fit);
  if (fitNotice !== "") emitSimple({ type: "error", message: fitNotice });

  const messages: ChatMessage[] = [
    chatMessage("system", input.systemPrompt),
    ...fit.kept,
    chatMessage("user", input.userText)
  ];
  let pendingProposals = 0;

  // 上限的守卫（2026-10-14 审计项 7）：0 与负数在旧循环里是「模型一个字都不发就 done」——
  // 静默的空结果比把话说出口更坏；非整数一律收口到 1。真身只传常量，这层兜的是未来的手滑。
  const maxRounds = Number.isFinite(deps.maxToolRounds)
    ? Math.max(1, Math.floor(deps.maxToolRounds))
    : 1;
  for (let round = 0; round < maxRounds; round += 1) {
    // P1-1 的③之一：**每轮开头**查一次打断。
    // 上一轮那条工具可能正好跑着用户按了 Esc——那时照样发下一笔请求，界面上就是
    // 「按了打断还在转圈」。（这里不做整轮硬总时长：长回答会被误杀，只掐「没有任何新字节」，
    // 那一条在上游看门狗 provider-fetch.ts。）
    if (deps.signal.aborted) return finishInterrupted(pendingProposals);
    // 每轮开头记一次请求（连接期失败也算发过一次请求，见契约注释）。
    requests += 1;
    // 这一轮的用量：上游在**同一请求内**可能发多帧 usage，后到覆盖先到（usage 是累计值，
    // 绝不逐帧相加）。整轮正常走完才并入总计。
    let roundUsage: TokenUsage | null = null;
    const collected: Collected = {
      reasoning: "",
      text: "",
      calls: [],
      truncatedCalls: [],
      finishReason: ""
    };
    try {
      for await (const event of deps.stream({
        // **整个 provider 铺开**，不逐字段点名（2026-10-09 批次 5-㊻）。
        //
        // 改之前这里是逐个写 `baseURL:` / `apiKey:` / `model:`，
        // 于是 `authHeader` 成了**死字段**：`TurnDeps.provider` 上声明了、
        // `StreamRequestLike` 上也声明了，唯独这里没递下去。
        // 后果与当初一模一样——小米 MiMo 那条连接永远发 `Authorization: Bearer`
        // 而不是 `api-key`，界面全对、请求永远 401，而代码上完全看不出原因。
        //
        // 逐字段点名 = 每加一个连接级字段就再犯一次（`thinkingWire` 差点就是第二个）。
        // 铺开 = `ProviderSettings.config()` 上多一个字段，它自己就到出站了。
        // 每轮开关（档位/联网）在下面显式覆盖，它们归这一轮管、不归连接管。
        ...deps.provider,
        messages,
        // 本轮在场的工具（花名册 + 插件，再按本轮联网开关过滤）。
        // **清单与派发用同一份判据**（P1-2）：派发那一层调的也是这个函数，
        // provider-client 的 `wireToolsFor` 再作用一次是幂等的，留着是因为它对
        // 任何调用方都成立（不许只靠调用方自觉）。
        tools: toolsFor(deps.host, input.webSearchEnabled),
        signal: deps.signal,
        thinkingLevel: input.thinkingLevel,
        webSearchEnabled: input.webSearchEnabled
      })) {
        if (event.kind === "reasoning-delta") {
          collected.reasoning += event.text;
          deps.emitDelta("reasoning", event.text);
        } else if (event.kind === "text-delta") {
          collected.text += event.text;
          deps.emitDelta("message", event.text);
        } else if (event.kind === "tool-call") collected.calls.push(event.call);
        // 这一支必须在 `else collected.finishReason` 之前：漏掉它，截断标记会被当成收尾原因，
        // 于是 `reason` 是 undefined、上面那句人话也就发不出去了。
        else if (event.kind === "tool-call-truncated") collected.truncatedCalls.push(event.call);
        // usage 这一支必须在最后那个 else 之前：那是 finish 的兜底，漏掉这里，
        // usage 事件会被当成收尾原因（event.reason 对 usage 根本不存在）。
        else if (event.kind === "usage") roundUsage = event.usage;
        else collected.finishReason = event.reason;
      }
    } catch (error) {
      // 打断优先于失败（2026-10-14 审计项 1）：provider-client 已把打断折成 finish:aborted，
      // 但取消与坏帧/错误帧竞态时异常仍会从这里逃出。人已经叫停了，异常只是打断的余波——
      // 折成 interrupted，界面该说「已打断」，不该说「失败」。
      if (deps.signal.aborted) return finishInterrupted(pendingProposals);
      const message =
        error instanceof ProviderError ? error.message : `本轮执行失败：${String(error)}`;
      emitSimple({ type: "error", message });
      return finish({ status: "failed", message });
    }

    // 流循环正常走完才并入这一轮的用量：失败那一发从 catch 里提前 return，没有可信的数，
    // 于是它只计入 requests、不计入 reported——正是「有几发上游没给数」要如实说的事。
    if (roundUsage !== null) {
      reported += 1;
      promptTokens += roundUsage.promptTokens;
      completionTokens += roundUsage.completionTokens;
      totalTokens += roundUsage.totalTokens;
    }

    const aborted = deps.signal.aborted || collected.finishReason === "aborted";
    if (collected.reasoning !== "")
      emitSimple({ type: "reasoning", text: collected.reasoning, interrupted: aborted });
    if (aborted) {
      // §6.3：半截文本入库并标注；未收全的 tool_call 视为不存在；pending 提案保持不动。
      if (collected.text !== "")
        emitSimple({ type: "message", text: collected.text, interrupted: true });
      return finishInterrupted(pendingProposals);
    }

    const parsed = parseProtocolBlocks(collected.text);
    if (parsed.planItems.length > 0)
      emitSimple({ type: "plan", items: parsed.planItems.map((text) => ({ text, done: false })) });
    for (const problem of parsed.problems)
      emitSimple({
        type: "error",
        message: `提案文本块有问题（${problem.reason}：${problem.detail}）；这条建议没有生成。`
      });
    if (collected.text !== "")
      emitSimple({ type: "message", text: parsed.prose, interrupted: false });

    /**
     * P2-5：被截断的一轮不再是「答完了」。位置在打断分支之后——用户自己按的 Esc 不是模型被截断，
     * 那条路已有 INTERRUPTED_MESSAGE，这里再补一句就成两句话说同一件事。
     * 轮级事实走既有的 `error` 事件（进时间线、写 lastError；与上面那句切窗提示同一条先例），
     * 不新造事件类型：契约没动，渲染层与回放自动认得。
     */
    const truncation = truncationNotice(collected.finishReason);
    if (truncation !== "") emitSimple({ type: "error", message: truncation });
    for (const dropped of collected.truncatedCalls) {
      // 半截参数逐条回一张 ok:false 的配对回执，口径照 SKIPPED_BY_INTERRUPT：绝不静默丢。
      // 但它**不**进 messages：那串解析不了的 arguments 一旦回喂上游就是整批 400，
      // 那正是 provider-client 的 argumentsComplete 门禁要防的事（这里只补可见性，不放宽门禁）。
      emitSimple({
        type: "tool-call",
        callId: dropped.id,
        tool: dropped.name,
        args: dropped.args,
        ok: false,
        resultText: TRUNCATED_TOOL_CALL_RECEIPT
      });
    }

    // 双路汇聚（§6.1）：文本块这条路也走同一个 host 调用、产出同一个 EditProposal schema。
    // 没有走 dispatchToolCall 是因为这条路不是原生 tool_calls，但仍要落一张工具卡，
    // 好让"提案从哪来"在 UI 与审计日志里都看得见。
    for (const block of parsed.patches) {
      const outcome = await deps.host.call("propose_patch", {
        doc: block.doc,
        anchor: block.anchor,
        replace: block.replace,
        why: block.why,
        mode: block.mode,
        source: "text-block"
      });
      emitSimple({
        type: "tool-call",
        callId: `block-${deps.newId()}`,
        tool: "propose_patch",
        args: JSON.stringify(block),
        ok: outcome.ok,
        resultText: outcome.text
      });
      for (const proposal of outcome.proposals) {
        emitSimple({ type: "proposal", proposal });
        pendingProposals += 1;
      }
    }

    if (collected.calls.length === 0) return finish({ status: "done", message: "" });

    messages.push(assistantToolMessage("", collected.calls));
    for (const [index, call] of collected.calls.entries()) {
      // P1-1 的③之二：**每条工具执行前**查一次打断。
      // 一轮可以派发好几条调用，而它们是一次性从流里给出的；真机情形正是
      // 「第一条（联网搜索）跑到一半用户按了 Esc」——不查就会把剩下的挨个跑完。
      // 没轮到执行的那几条照样逐条给回执：一句中文说清「没有执行」，
      // 既让时间线上看得见，也不给模型留悬空 tool_call（下一轮直接 400 那种）。
      if (deps.signal.aborted) {
        for (const skipped of collected.calls.slice(index)) {
          emitSimple({
            type: "tool-call",
            callId: skipped.id,
            tool: skipped.name,
            args: skipped.args,
            ok: false,
            resultText: SKIPPED_BY_INTERRUPT
          });
          messages.push(toolMessage(skipped.id, SKIPPED_BY_INTERRUPT));
        }
        return finishInterrupted(pendingProposals);
      }
      const gate = toolGateOf(deps.host, call.name, input.webSearchEnabled);
      if (!gate.allowed) {
        // §4 裁定：对模型的拒绝必须用中文回喂，绝不静默丢弃。
        // tool 回执保证上面那条 assistant 消息里的**每一条** tool_call 都有配对——缺回执时
        // toWireMessages 发出悬空 tool_calls，OpenAI 兼容端点直接 400，整轮会被 runTurn 判成 failed。
        if (gate.kind === "unknown") {
          // 模型凭空造了一枚不存在的工具：界面上没有对应的工具卡可画，走 error 事件。
          emitSimple({ type: "error", message: gate.reason });
          messages.push(toolMessage(call.id, gate.reason));
          continue;
        }
        // 工具明明在花名册上，只是这一轮的开关把它摘了（P1-2）。
        // 这里走**既有的工具失败回执通路**：tool-call 事件本来就装得下 ok:false + 一句原因，
        // 不新造事件类型——契约没动，渲染层与历史回放（eventsToMessages）自动认得这张卡。
        emitSimple({
          type: "tool-call",
          callId: call.id,
          tool: call.name,
          args: call.args,
          ok: false,
          resultText: gate.reason
        });
        messages.push(toolMessage(call.id, gate.reason));
        continue;
      }
      // 工具炸了不掀桌（2026-10-14 审计项 2）：dispatchToolCall 内部只拦参数解析，
      // host.call 抛的异常会一路穿到这里。折成一张 ok:false 的工具回执——
      // 模型看得见原因能自我纠正，回合照常收尾，不再因为一枚工具崩掉整轮对话。
      let outcome: ToolOutcome;
      try {
        outcome = await dispatchToolCall(deps.host, call, input.webSearchEnabled);
      } catch (error) {
        const text = `工具 ${call.name} 执行异常：${
          error instanceof Error ? error.message : String(error)
        }`;
        outcome = { ok: false, text, proposals: [] };
      }
      emitSimple({
        type: "tool-call",
        callId: call.id,
        tool: call.name,
        args: call.args,
        ok: outcome.ok,
        resultText: outcome.text,
        // exactOptionalPropertyTypes 开着：无来源的工具**不能**显式写 sources: undefined，
        // 那会让老会话的判别（"sources" in event）翻转。条件展开才是缺省就真的缺省。
        // empty 同理：不带它的工具不该在事件里留下这个键。
        ...(outcome.sources === undefined ? {} : { sources: outcome.sources }),
        ...(outcome.empty === true ? { empty: true } : {})
      });
      for (const proposal of outcome.proposals) {
        emitSimple({ type: "proposal", proposal });
        pendingProposals += 1;
      }
      messages.push(toolMessage(call.id, outcome.text));
    }
    if (round === maxRounds - 1) {
      // 上限计的是「轮」不是「次」：一轮可以派发好几个工具调用，单位写错会让用户以为还能再调几次。
      const message = `本轮工具调用达到上限（${maxRounds} 轮），已停下等你介入。`;
      emitSimple({ type: "error", message });
      return finish({ status: "failed", message });
    }
  }
  return finish({ status: "done", message: "" });
}

import type {
  AgentDeltaKind,
  AgentEvent,
  AuthHeader,
  EditProposal,
  ProposalDecision,
  ThinkingLevel,
  ThinkingWire,
  TurnEndStatus,
  WebSource
} from "@mochen/contracts";
import { parseProtocolBlocks } from "./patch-protocol.js";
import { ProviderError } from "./provider-client.js";
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
  TOOL_SPECS,
  isCallableTool,
  extraSpecsOf,
  callableToolNames,
  type ToolHost
} from "./tools.js";

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

interface Collected {
  reasoning: string;
  text: string;
  calls: AssistantToolCall[];
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
  | { type: "error"; message: string };

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutcome> {
  const stamp = () => ({ id: deps.newId(), ts: deps.now(), turnId: input.turnId });
  // EmitBody 与 AgentEvent 去掉基字段后一一对应；这里用一次 as 收敛，真正的净网在
  // Task 6 的 readSession：形状不合法的行会被 agentEventSchema 判掉并计入 droppedLines。
  const emitSimple = (body: EmitBody): void => {
    deps.emit({ ...stamp(), ...body } as AgentEvent);
  };
  emitSimple({ type: "user-message", text: input.userText });

  const messages: ChatMessage[] = [
    chatMessage("system", input.systemPrompt),
    ...input.history,
    chatMessage("user", input.userText)
  ];
  let pendingProposals = 0;

  for (let round = 0; round < deps.maxToolRounds; round += 1) {
    const collected: Collected = { reasoning: "", text: "", calls: [], finishReason: "" };
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
        // 花名册那五个，外加插件注册进来的（没有插件时就是逐字原来那份）。
        tools: [...TOOL_SPECS, ...extraSpecsOf(deps.host)],
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
        else collected.finishReason = event.reason;
      }
    } catch (error) {
      const message =
        error instanceof ProviderError ? error.message : `本轮执行失败：${String(error)}`;
      emitSimple({ type: "error", message });
      return { status: "failed", message };
    }

    const aborted = deps.signal.aborted || collected.finishReason === "aborted";
    if (collected.reasoning !== "")
      emitSimple({ type: "reasoning", text: collected.reasoning, interrupted: aborted });
    if (aborted) {
      // §6.3：半截文本入库并标注；未收全的 tool_call 视为不存在；pending 提案保持不动。
      if (collected.text !== "")
        emitSimple({ type: "message", text: collected.text, interrupted: true });
      emitSimple({ type: "interrupted", pendingProposals });
      return { status: "interrupted", message: "已打断当前轮次，已流出的内容保留。" };
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

    if (collected.calls.length === 0) return { status: "done", message: "" };

    messages.push(assistantToolMessage("", collected.calls));
    for (const call of collected.calls) {
      if (!isCallableTool(deps.host, call.name)) {
        // §4 裁定：对模型的拒绝必须用中文回喂，绝不静默丢弃。
        // error 事件让这件事在 UI 与审计日志里可见；tool 回执则保证上面那条 assistant 消息里的
        // **每一条** tool_call 都有配对——缺回执时 toWireMessages 发出悬空 tool_calls，
        // OpenAI 兼容端点直接 400，整轮会被 runTurn 判成 failed。
        const reason = `模型请求了不存在的工具「${call.name}」，这条调用已被忽略。可用工具只有 ${callableToolNames(deps.host).join("、")}。`;
        emitSimple({ type: "error", message: reason });
        messages.push(toolMessage(call.id, reason));
        continue;
      }
      const outcome = await dispatchToolCall(deps.host, call);
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
    if (round === deps.maxToolRounds - 1) {
      // 上限计的是「轮」不是「次」：一轮可以派发好几个工具调用，单位写错会让用户以为还能再调几次。
      const message = `本轮工具调用达到上限（${deps.maxToolRounds} 轮），已停下等你介入。`;
      emitSimple({ type: "error", message });
      return { status: "failed", message };
    }
  }
  return { status: "done", message: "" };
}

/**
 * 思考态**空窗期**的判据（2026-10-08 批次 5-㊹）。
 *
 * ## 它补的是哪一格
 * `buildTimeline` 只在 `tail.reasoning` / `tail.message` 非空时才产出块。
 * 于是「用户按了发送」到「第一个字到达」之间——按 OpenAI 公开的说法通常一到三秒，
 * 长模型更久——**时间线上一个块都没有**：用户那句问孤零零地挂着，界面看着像没发出去。
 * 那是推理型 AI 最容易让人重复发一次的地方（业界叫「十秒空窗」）。
 *
 * ## 为什么判据不写成「running 就显示」
 * 那会在**每一轮**都显示，包括第二轮之后——而那时时间线上已经有上一轮的满屏内容，
 * 底��突然多一行「正在想」会让人以为上一轮还在跑。
 *
 * ⇒ 判据是「**当前这一轮**还没有产出任何助手侧内容」：
 *   当前轮 = 最后一条 `user-message` 的 `turnId`（事件都带 turnId，见 contracts/agent-event.ts）；
 *   助手侧 = reasoning / plan / message / tool-call 四类；
 *   再加上 tail 必须为空——tail 非空说明正在流式，正由 `.thinking-card` / `.message-line` 接管。
 *
 * ## 为什么「第一个块一到就消失」是判据的一部分，而不是样式问题
 * 两处同时显示「正在想」是同一句话说两遍。真身只回答开/关，模板只读它。
 */
import type { AgentEvent } from "@mochen/contracts";
import type { StreamingTail } from "./timeline";

/** 算「助手侧产出」的那四类。其余（user-message / proposal / decision / written / interrupted / error）都不算。 */
const ASSISTANT_TURN_TYPES = new Set(["reasoning", "plan", "message", "tool-call"]);

export interface ThinkingWindowState {
  /** 这一格该不该出现。 */
  open: boolean;
  /** 当前轮的 id；没开时为 null（模板不必自己去找是哪一轮）。 */
  turnId: string | null;
}

export function thinkingWindowState(input: {
  running: boolean;
  items: AgentEvent[];
  tail: StreamingTail;
}): ThinkingWindowState {
  const closed: ThinkingWindowState = { open: false, turnId: null };
  if (!input.running) return closed;

  // 当前轮从「最后一条用户消息」认起，而不是从「整个线程有没有助手内容」——
  // 后者在第二轮之后永远为真，窗口就再也不开了。
  let currentTurnId: string | null = null;
  for (const event of input.items) {
    if (event.type === "user-message") currentTurnId = event.turnId;
  }
  if (currentTurnId === null) return closed;

  const alreadyProduced = input.items.some(
    (event) => event.turnId === currentTurnId && ASSISTANT_TURN_TYPES.has(event.type)
  );
  if (alreadyProduced) return closed;

  // tail 有字 = 已经在流式了，那张卡/正文自己接管。
  if (input.tail.reasoning.trim() !== "" || input.tail.message.trim() !== "") return closed;

  return { open: true, turnId: currentTurnId };
}

/** 秒数第一次露出来的门槛。太早露出来像在催，太晚又失去「它在动」的实感。 */
export const ELAPSED_SHOW_AFTER_MS = 1000;
/** 过了这个数，换一句承认等待的话——比一直「正在想」诚实。 */
export const PATIENCE_LABEL_AFTER_MS = 8000;

/**
 * 「正在想」这三个字有**两处**要出现：流式思考卡上那枚 is-live 徽标（AgentTimeline.vue），
 * 与空窗期这一行的开头。它们说的是**同一个状态**，措辞却是两份就会漂。
 * ⇒ 徽标改成读这个常量，两处共用一句话。
 */
export const THINKING_LIVE_LABEL = "正在想";

/**
 * 空窗期那一行的文案。**只有这一处说了算**：
 * 模板里写 `elapsed > 8000 ? "还在想" : "正在想"` 就是第二份判据。
 */
export function thinkingWindowLabel(elapsedMs: number): string {
  return elapsedMs >= PATIENCE_LABEL_AFTER_MS ? "还在想" : THINKING_LIVE_LABEL;
}

/** 秒数的呈现：`1 秒` / `12 秒`；不到一秒不画（由调用方按门槛挡）。 */
export function thinkingWindowElapsedText(elapsedMs: number): string {
  return `${Math.max(1, Math.floor(elapsedMs / 1000))} 秒`;
}

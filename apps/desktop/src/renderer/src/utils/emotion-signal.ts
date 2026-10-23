import type { AgentEvent } from "@mochen/contracts";
import type { StreamingTail } from "./timeline";

/**
 * 对话头像的状态判定（2026-10-21）。
 *
 * 头像本身只是「画哪种表情」，**画哪一种必须只由这一处说了算**——组件里不许再写
 * `running && xxx ? "30" : …` 这类第二份判据（铁律 6 的同一条：同一件事不留两份实现）。
 *
 * 编号取自 Emotion Ball 的分段契约（编号即对外契约，已有编号永不重排）：
 *   00-09 生命周期 · 10-29 情绪反应 · 30-49 代理工作状态
 * 这一层只驱动「代理工作状态」那一组（30-41），生命周期与情绪反应留给表情图鉴手动选。
 */
export const EMOTION_IDLE = "02";
export const EMOTION_DONE = "33";

export interface AssistantEmotionInput {
  running: boolean;
  items: AgentEvent[];
  tail: StreamingTail;
  /** 本轮结束态：''（未结束）/ done / interrupted / failed。 */
  endedAs: string;
  /** 最近一条错误（时间线与边界拒绝共用这一格）。 */
  lastError: string;
  /** 仍在等待审批的提案数。 */
  pendingProposals: number;
  /** 正在恢复历史线程。 */
  hydrating: boolean;
}

/**
 * 「拒绝/受限」与「出错」分开：权限挡下、额度不足这类**不是故障**，
 * 用生气的红脸去报一个 403 会让用户以为软件崩了。只认明确的拒绝口径。
 */
const REFUSAL = /拒绝|受限|权限不足|无权限|denied|forbidden|not allowed|\b403\b/i;

function lastToolCall(items: AgentEvent[]): Extract<AgentEvent, { type: "tool-call" }> | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.type === "tool-call") return item;
  }
  return undefined;
}

/**
 * 助手头像这一刻应该画哪种表情。
 *
 * 优先级按「用户最需要一眼看懂的那件事」排：
 *   出错 > 已停止 > 正在跑（细分成输出 / 联网 / 检索 / 忙碌 / 思考 / 刚接单）
 *   > 待审批 > 恢复历史 > 失败 > 完成 > 待机
 * 先把终止态判掉，是因为 running 结束后 endedAs 才落值；两条同时为真时，
 * 屏上的状态应当是「这一轮已经结束了」，而不是「还在跑」。
 */
export function assistantEmotion(input: AssistantEmotionInput): string {
  if (input.lastError.trim() !== "") return REFUSAL.test(input.lastError) ? "38" : "34";
  if (input.endedAs === "interrupted") return "41";

  if (input.running) {
    if (input.tail.message.trim() !== "") return "39";
    const tool = lastToolCall(input.items);
    if (tool?.tool === "web_search" || tool?.tool === "web_read") {
      return (tool.sources?.length ?? 0) > 0 ? "40" : "36";
    }
    if (tool !== undefined) return "32";
    if (input.tail.reasoning.trim() !== "") return "30";
    return "31";
  }

  if (input.pendingProposals > 0) return "35";
  if (input.hydrating) return "37";
  if (input.endedAs === "failed") return "34";
  if (input.endedAs === "done") return "33";
  return EMOTION_IDLE;
}

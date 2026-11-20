/**
 * 「继续」这一族（2026-11-20 · 主线第一刀）。
 *
 * 【病灶】状态行原来写着「已打断 · 可点「继续」」，而那一行是纯文本 `<span>`
 * （`utils/agent-thread.ts` 的 composeStatusLine + 中栏状态栏模板）。全仓没有一枚
 * 「继续」按钮——这句话是一句**点不动**的承诺。
 * 对写稿主线的代价比"文案不准"大：AI 被打断之后，作者被晾在原地，
 * 只能把上一句原样重打一遍——而重打与"点一下"之间隔着一次记忆与手速。
 *
 * 【这一族只回答两件事】
 *   ① 上一句用户指令是什么（`lastUserTextOf`）——重发要有内容，不能凭空造一句；
 *   ② 此刻该不该给「继续」这一枚钮（`resumeAffordanceOf`）——不该给的时刻不给，
 *      免得它在「就绪」时也摆着一枚，点下去只会白跑一轮。
 *
 * 【判据只有这一份】状态栏（CenterColumn）与 store（`resumeLastTurn`）都读它，
 * 谁也不自己 if 一遍（铁律 6）。
 *
 * 【为什么重发的是"用户自己那句"而不是机器话】
 * store 里那句注释记着一条更早的裁定：「不记『继续』的内置文案（那是机器的话，
 * 不该塞回用户的地盘）」。于是这里走的是另一条路——**把用户自己说过的那句原样再发一次**：
 * 字是他的、上下文是同一线程的、还字账不记它（它早就在中栏转录里了，再还一次就是第二份）。
 */
import type { ThreadView } from "./agent-thread";

/** 按钮上的字。 */
export const RESUME_LABEL = "继续";

/**
 * 悬停说明：这一下到底会发生什么。
 *
 * 刻意**不写**「AI 会接着刚才那轮做」——那是预测，不是这一枚钮保证的事。
 * 它保证的只有一句：上一句原样再发一次，同一线程，带着上文。
 */
export const RESUME_TITLE = "把上一句原样再发一次（同一线程，带着上文）";

/** 「继续」这一枚钮的全部内容。 */
export interface ResumeAffordance {
  /** 按钮上的字。 */
  readonly label: string;
  /** 悬停说明。 */
  readonly title: string;
  /** 要重发的正文。 */
  readonly text: string;
}

/**
 * 上一句用户指令：线程里**最后一条** user-message 的正文。
 *
 * 口径与 `utils/turn-progress.ts` 那条一致（"本轮"从最后一条 user-message 认起），
 * 但这里取的是**正文**而不是轮次号。
 *
 * 空白的那条不算——它发出去过，但重发它没有意义，所以往前找有字的那一条。
 */
export function lastUserTextOf(thread: ThreadView | undefined): string {
  if (thread === undefined) return "";
  for (let i = thread.items.length - 1; i >= 0; i -= 1) {
    const item = thread.items[i];
    if (item?.type !== "user-message") continue;
    const text = item.text.trim();
    if (text !== "") return text;
  }
  return "";
}

/**
 * 此刻该不该给「继续」这一枚钮。
 *
 * 四个条件同时成立才给：
 *   ① 有线程；
 *   ② 这一轮没在跑（跑着的时候，"打断"才是那一条路）；
 *   ③ 上一轮收得**不好**——`interrupted`（被打断）或 `failed`（失败）；
 *   ④ 有一句可重发的用户指令。
 *
 * 第 ④ 条是关键：没有可重发的内容还给一枚钮，点下去只会白跑一轮——那比不给更坏。
 */
export function resumeAffordanceOf(thread: ThreadView | undefined): ResumeAffordance | null {
  if (thread === undefined) return null;
  if (thread.running) return null;
  if (thread.endedAs !== "interrupted" && thread.endedAs !== "failed") return null;
  const text = lastUserTextOf(thread);
  if (text === "") return null;
  return { label: RESUME_LABEL, title: RESUME_TITLE, text };
}

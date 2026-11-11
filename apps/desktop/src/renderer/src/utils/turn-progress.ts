/**
 * W-06：长文生成的进度读数（按字数，不按工程阶段）。
 *
 * 写作者的焦虑是「它还在写吗、写了多少、还要等吗」，不是「现在跑到哪一步」。
 * 所以这里的三个数全部**从事件流与在途残字推出来**，不让模型自报进度，也不显示
 * 「准备 / 取材 / 自检」这类工程阶段名。模型说「我已写了三千字」不作数。
 *
 * 「本轮」的界定：最后一条 `user-message` 之后的事件。为什么不按 turnId 过滤——
 * `turn-end` 会把 `thread.turnId` 置 null（迟到的 delta 靠这个门挡住），一轮结束之后
 * 反而拿不到轮次号；而 `user-message` 是每轮发流前落盘的那条受理凭据，回放里也在。
 * 在途残字 `streaming.message` 单独加一次：`reduceEvent` 收到 `message` 事件时就把它
 * 清空，两者永远不会重叠，不会把同一批字报两遍。
 */

import type { ThreadView } from "./agent-thread";
import { bodyCharCount } from "./char-count";

export interface TurnProgress {
  /** 本轮模型正文的非空白字数（含在途残字、含被打断的半截文本）。 */
  chars: number;
  /** 自然段数：按连续换行切块、非空算一段。粗读数，不解析 markdown。 */
  paragraphs: number;
  /** 本轮真正落盘的改动条数（`written` 事件，不是「待审提案」）。 */
  edits: number;
}

export const EMPTY_TURN_PROGRESS: TurnProgress = { chars: 0, paragraphs: 0, edits: 0 };

/** 递给状态行的全部进度事实；`targetChars = 0` 表示本章没设目标，状态行就不摆分母。 */
export interface StatusProgress {
  progress: TurnProgress;
  targetChars: number;
}

export function turnProgressOf(thread: ThreadView | undefined): TurnProgress {
  if (thread === undefined) return { ...EMPTY_TURN_PROGRESS };

  let turnStart = -1;
  for (let i = thread.items.length - 1; i >= 0; i -= 1) {
    if (thread.items[i]?.type === "user-message") {
      turnStart = i;
      break;
    }
  }
  // 没有受理凭据就不认旧轮的字（宁可少报，不许把历史回放算成这一轮的产出）。
  const turnItems = turnStart < 0 ? [] : thread.items.slice(turnStart + 1);

  let text = "";
  let edits = 0;
  for (const event of turnItems) {
    if (event.type === "message") text += event.text;
    else if (event.type === "written") edits += 1;
  }
  text += thread.streaming.message;

  const paragraphs = text.split(/\n+/).filter((part) => part.trim() !== "").length;
  return { chars: bodyCharCount(text), paragraphs, edits };
}

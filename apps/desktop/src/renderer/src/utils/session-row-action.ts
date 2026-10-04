import type { SessionListItem } from "@mochen/contracts";

/**
 * 「没有绑定文稿」那几条的禁用理由（全仓唯一一份；store 的 notice 与面板的 title 都从这里取）。
 * 为什么是禁用而不是「能点但会出问题」：本仓 unbound 线程只在没有任何文稿标签时出现，
 * 从面板走过去必须先关掉全部标签，而 `useBookStore.closeTab` 会删掉 draftsByPath 里的未保存草稿。
 */
export const UNBOUND_ROW_REASON =
  "这条对话没有绑定文稿，打开它要先关掉当前文稿标签，未保存的草稿会丢。";

/** 会话落盘后文稿被删掉/移走的行：`openDocTab` 这条路根本没有文件。 */
export const MISSING_DOC_ROW_REASON = "这条对话的文稿已经不在书里，读不回来了。";

/** 「正在回复」那句照 deepwrite ConversationHistoryMenu.vue:163 的原文，不自创新文案。 */
const RESPONDING_ROW_REASON = "回复完成或停止后可切换。";
const CURRENT_ROW_REASON = "正在看这一条。";

export interface SessionRowContext {
  /**
   * 当前正在看的那条会话 id；空串 = 渲染层还不知道（这一轮由发轮新建，id 只在主进程那边）。
   * 空串时**谁都不算当前**——否则整列都会被标成「正在看」。
   */
  currentSessionId: string;
  /** 这本书里现在还存在的文稿相对路径（`book.docs`）。 */
  existingDocPaths: string[];
  /** 正在看的那条线程是否跑着一轮回复。 */
  responding: boolean;
  /** 这一行是否属于 unbound 线程。判断留给调用方（store 里的 `UNBOUND` 才是那份口径）。 */
  unbound: boolean;
}

export type SessionRowAction =
  { kind: "open" } | { kind: "current"; reason: string } | { kind: "disabled"; reason: string };

/**
 * 面板每一行的行动判定（#113e）。顺序即优先级：不可逆的数据丢失 > 通路断了 > 已经在看 > 忙。
 * store 的 `rowActionFor` 是唯一装配点——组件不许自己再拼一份上下文（铁律①）。
 */
export function sessionRowAction(
  item: SessionListItem,
  context: SessionRowContext
): SessionRowAction {
  if (context.unbound) return { kind: "disabled", reason: UNBOUND_ROW_REASON };
  if (!context.existingDocPaths.includes(item.docRelPath))
    return { kind: "disabled", reason: MISSING_DOC_ROW_REASON };
  if (context.currentSessionId !== "" && item.sessionId === context.currentSessionId)
    return { kind: "current", reason: CURRENT_ROW_REASON };
  if (context.responding) return { kind: "disabled", reason: RESPONDING_ROW_REASON };
  return { kind: "open" };
}

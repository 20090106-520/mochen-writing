/**
 * 消息操作条（2026-10-25 · §173）：一条消息上给哪些动作、动作叫什么、复制成了说什么。
 *
 * **判据只有这一份**（铁律 6）：组件（AgentTimeline）只读它，不自己 if。
 * 同样的话不许在模板里再写一遍——文案改一次要改两处的地方，迟早只改一处。
 */

/** 一条消息上能有的动作。 */
export type MessageActionId = "copy" | "edit-ask";

/** 消息的两种身份：自己说的 / 助手回的。 */
export type MessageSpeaker = "user" | "assistant";

/** 一枚动作的呈现：按钮上的字与悬停说明。 */
export interface MessageActionView {
  id: MessageActionId;
  label: string;
  title: string;
}

/**
 * 各动作的文案（一份）。
 *
 * 「改一改再问」而不是「编辑」：按下去**不会**直接改掉已经发出去的那句，
 * 只是把原话填回输入框由你改完再发——发出去的话是历史，不该被偷偷改写。
 */
export const MESSAGE_ACTION_VIEWS: Record<MessageActionId, MessageActionView> = {
  copy: {
    id: "copy",
    label: "复制",
    title: "把这段话复制到剪贴板（Markdown 原文）"
  },
  "edit-ask": {
    id: "edit-ask",
    label: "改一改再问",
    title: "把这句话填回输入框，你改完再发一次"
  }
};

/**
 * 哪一种消息给哪些动作。
 *
 * - 助手回复：只给「复制」——回复是成稿，要拿走；「改一改再问」对它没有意义（那是改自己的问法）。
 * - 自己说的：给「复制」与「改一改再问」——改自己的问法是这一族里最常干的事。
 */
export function actionsForSpeaker(speaker: MessageSpeaker): MessageActionView[] {
  if (speaker === "assistant") return [MESSAGE_ACTION_VIEWS.copy];
  return [MESSAGE_ACTION_VIEWS.copy, MESSAGE_ACTION_VIEWS["edit-ask"]];
}

/** 失败条上那枚「再问一次」（把失败前那句填回输入框）。 */
export const ASK_AGAIN_VIEW: MessageActionView = {
  id: "edit-ask",
  label: "再问一次",
  title: "把刚才那句填回输入框，你改完再发一次"
};

/** 复制成了/没成，各给一句人话（提示条那一份文案）。 */
export const COPY_NOTICES = {
  ok: { title: "已复制", message: "这段话已经放进剪贴板。", level: "success" },
  failed: { title: "复制失败", message: "系统没让这一段进剪贴板。", level: "warning" }
} as const;

/** 填回输入框之后的那句提示。 */
export const PREFILL_NOTICE = {
  title: "已填进输入框",
  message: "改完再发送。",
  level: "info"
} as const;

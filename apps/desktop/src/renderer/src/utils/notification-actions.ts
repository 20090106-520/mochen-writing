/**
 * 通知动作表（2026-11-20 通知整修 A3+C2）。
 *
 * 【这一层只住「名字」，不住「怎么执行」】
 * AppNotification 要进 localStorage（useNotificationStore.load/save），函数进不去；
 * 所以通知数据里只存动作的 kind（可序列化的字符串），执行器住在
 * composables/useNotificationActionRunner.ts——它拿得到 Pinia，能把 kind 换成
 * layout.showSettings(...) 这一类的真动作。两份通过「同一张 kind 表」对上。
 *
 * 加一枚新动作的完整清单：
 * ① 这张表加 kind + 中文标签；② runner 的 switch 加一支；
 * ③ 发通知的那一处传 actionKind。三处缺一，对应测试会红。
 */

/** 现役动作 kind。值必须可 JSON 序列化（它要进 localStorage）。 */
export type NotificationActionKind = "open-model-settings" | "open-project-settings";

/** kind → 按钮文案。按钮上只写动作本身，不写「点击」之类的废话。 */
export const NOTIFICATION_ACTION_LABELS: Readonly<Record<NotificationActionKind, string>> = {
  "open-model-settings": "去模型设置",
  "open-project-settings": "打开作品设置"
};

/**
 * 盘上（localStorage）那一份的 kind 是不是一枚现役动作。
 * 旧数据 / 坏形状一律按「没有动作」处理，不能把一个未知字符串递给执行器。
 */
export function isNotificationActionKind(value: unknown): value is NotificationActionKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(NOTIFICATION_ACTION_LABELS, value)
  );
}

/**
 * NotificationStore —— 系统通知
 *
 * 管理应用内通知，也可桥接到系统通知（Electron Notification）：
 * - 导出完成、长任务结束、AI响应出错等场景
 * - 通知历史（最近 50 条）
 * - 未读标记
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import {
  isNotificationActionKind,
  type NotificationActionKind
} from "../utils/notification-actions";

export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  timestamp: number;
  read: boolean;
  /**
   * 可选动作（2026-11-20 通知整修 A3+C2）。只存 kind——可序列化的字符串，
   * 能进 localStorage；kind → 中文标签住 utils/notification-actions.ts，
   * kind → 真动作住 composables/useNotificationActionRunner.ts。
   * 原 actionLabel 是一个没人传、没人画的死字段，这一刀把它换成了真能力。
   */
  actionKind?: NotificationActionKind;
}

const STORAGE_KEY = "mochen.notifications.v1";
const HISTORY_LIMIT = 50;
const LEVELS: readonly NotificationLevel[] = ["info", "success", "warning", "error"];

/**
 * 盘上那一份是不是一条通知（2026-11-20 审计 R-5）。
 * `try` 只能包住 `JSON.parse`，包不住之后在 computed 里 `.filter(...)`——
 * 一旦存成 `{}` 这类合法 JSON，坏形状会一路带到渲染，把通知铃铛整块带崩。宁可否掉也不能信。
 */
function isNotification(raw: unknown): raw is AppNotification {
  if (typeof raw !== "object" || raw === null) return false;
  const one = raw as Record<string, unknown>;
  // actionKind 是可选格：在场时必须是现役 kind——localStorage 里一个旧数据 / 手改出来的
  // 坏字符串不能递给执行器（utils/notification-actions.test.ts 钉着这张表）。
  const kindOk = one.actionKind === undefined || isNotificationActionKind(one.actionKind);
  return (
    typeof one.id === "string" &&
    typeof one.title === "string" &&
    typeof one.message === "string" &&
    typeof one.timestamp === "number" &&
    typeof one.read === "boolean" &&
    typeof one.level === "string" &&
    LEVELS.includes(one.level as NotificationLevel) &&
    kindOk
  );
}

function load(): AppNotification[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isNotification) : [];
  } catch {
    return [];
  }
}

function save(notifications: AppNotification[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, HISTORY_LIMIT)));
  } catch {
    // 静默
  }
}

function genId(): string {
  return `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const useNotificationStore = defineStore("notification", () => {
  const notifications = ref<AppNotification[]>(load());

  watch(notifications, (val) => save(val), { deep: true });

  const unreadCount = computed(() => notifications.value.filter((n) => !n.read).length);

  const unreadNotifications = computed(() =>
    notifications.value.filter((n) => !n.read).sort((a, b) => b.timestamp - a.timestamp)
  );

  /** 最近通知（已读 + 未读，按时间倒序） */
  const recentNotifications = computed(() =>
    [...notifications.value].sort((a, b) => b.timestamp - a.timestamp)
  );

  /** 添加通知 */
  function notify(input: {
    title: string;
    message: string;
    level?: NotificationLevel;
    /** 可选动作 kind（按钮文案与执行见 utils/notification-actions.ts 一族）。 */
    actionKind?: NotificationActionKind;
    /** 是否在窗口失焦时同步发系统通知（Electron）；前台只走应用内 Toast。 */
    systemNotify?: boolean;
  }): AppNotification {
    const n: AppNotification = {
      id: genId(),
      title: input.title,
      message: input.message,
      level: input.level ?? "info",
      timestamp: Date.now(),
      read: false,
      ...(input.actionKind !== undefined ? { actionKind: input.actionKind } : {})
    };

    notifications.value.unshift(n);

    // 维持上限
    if (notifications.value.length > HISTORY_LIMIT) {
      notifications.value = notifications.value.slice(0, HISTORY_LIMIT);
    }

    // 系统通知（异步；若 IPC 不可用就退化到应用内）。只在窗口失焦时发——
    // 用户正对着屏幕时再弹一枚原生通知是双重打扰（2026-11-20 C3）。
    if (input.systemNotify && typeof document !== "undefined" && !document.hasFocus()) {
      void sendSystemNotification(n);
    }

    return n;
  }

  /** 标记已读 */
  function markAsRead(id: string): void {
    const n = notifications.value.find((x) => x.id === id);
    if (n) n.read = true;
  }

  /** 全部已读 */
  function markAllAsRead(): void {
    for (const n of notifications.value) n.read = true;
  }

  /** 删除通知 */
  function remove(id: string): void {
    const idx = notifications.value.findIndex((n) => n.id === id);
    if (idx !== -1) notifications.value.splice(idx, 1);
  }

  /** 清空 */
  function clearAll(): void {
    notifications.value = [];
  }

  /** 发送系统通知 */
  async function sendSystemNotification(n: AppNotification): Promise<void> {
    // Electron preload 注入的接口（`notify` 契约上是 void：preload 内部已 `void invoke(...)` 接住拒绝，
    // 这里不另加一层 catch——多写一层只会让人以为它会 reject）。
    if (window.mochen?.notify) {
      window.mochen.notify(n.title, n.message);
    } else if ("Notification" in window) {
      // 浏览器降级
      if (Notification.permission === "granted") {
        new Notification(n.title, { body: n.message });
      } else if (Notification.permission === "default") {
        void Notification.requestPermission().then((perm) => {
          if (perm === "granted") new Notification(n.title, { body: n.message });
        });
      }
    }
  }

  /** 请求通知权限（第一次导出完成之类的主动提醒前调用） */
  function requestPermission(): void {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }

  return {
    notifications,
    unreadCount,
    unreadNotifications,
    recentNotifications,
    notify,
    markAsRead,
    markAllAsRead,
    remove,
    clearAll,
    sendSystemNotification,
    requestPermission
  };
});

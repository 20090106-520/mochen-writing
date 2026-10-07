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

export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  timestamp: number;
  read: boolean;
  /** 可选动作标签，通知可点击 */
  actionLabel?: string;
}

const STORAGE_KEY = "mochen.notifications.v1";
const HISTORY_LIMIT = 50;

function load(): AppNotification[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AppNotification[];
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
    actionLabel?: string;
    /** 是否同步发系统通知（Electron） */
    systemNotify?: boolean;
  }): AppNotification {
    const n: AppNotification = {
      id: genId(),
      title: input.title,
      message: input.message,
      level: input.level ?? "info",
      timestamp: Date.now(),
      read: false,
      ...(input.actionLabel !== undefined ? { actionLabel: input.actionLabel } : {})
    };

    notifications.value.unshift(n);

    // 维持上限
    if (notifications.value.length > HISTORY_LIMIT) {
      notifications.value = notifications.value.slice(0, HISTORY_LIMIT);
    }

    // 系统通知（异步；若 IPC 不可用就退化到应用内）
    if (input.systemNotify && typeof window !== "undefined") {
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
    // Electron preload 注入的接口
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

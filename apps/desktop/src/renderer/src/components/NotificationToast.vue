<!-- 通知 Toast：应用内短暂提示，分级自动消失（2026-11-20 通知整修 A1+C1+C5） -->
<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  useNotificationStore,
  type AppNotification,
  type NotificationLevel
} from "../stores/useNotificationStore";
import { notificationDwellMs } from "../utils/notification-dwell";
import { NOTIFICATION_ACTION_LABELS } from "../utils/notification-actions";
import { useNotificationActionRunner } from "../composables/useNotificationActionRunner";
import { useLayoutStore } from "../stores/layoutStore";
import AppIcon from "./AppIcon.vue";

const notif = useNotificationStore();
const layout = useLayoutStore();
const { unreadNotifications, unreadCount } = storeToRefs(notif);
const runner = useNotificationActionRunner();

const VISIBLE_LIMIT = 3;
const visibleToasts = computed(() => unreadNotifications.value.slice(0, VISIBLE_LIMIT));
/** 排队没露脸的条数（>0 时给一枚 +N 徽章，点它进通知中心）。 */
const queuedCount = computed(() => Math.max(0, unreadCount.value - visibleToasts.value.length));

function iconFor(level: NotificationLevel): string {
  switch (level) {
    case "success":
      return "check";
    case "warning":
      return "shield";
    case "error":
      // 【2026-11-20 A6】这里原先写的是 "x"——图标表里根本没有这个名字，
      // 错误通知的图标一直是空白。并到既有那枚 close 上。
      return "close";
    default:
      return "sparkles";
  }
}

/**
 * 自动消失（2026-11-20 A1 重写）。
 *
 * 【原先错在哪】旧实现把「给每条在场 toast 安排 4 秒计时器」的 for 循环写在
 * `<script setup>` 顶层——它只在组件挂载那一刻跑一次，而本组件在 App.vue 里
 * 常驻挂载。于是**启动后到达的每一条新通知都不会自动消失**，只能手动点掉。
 *
 * 现在的判据：watch 在场的 toast，进场安排计时、离场撤销计时。
 * 计时器按 id 收进 Map 去重（同一条永远只有一个计时器在跑），
 * 卸载时全部清掉，不留越过组件生命周期的回调。
 * 驻留时长按级别分级（utils/notification-dwell.ts），不再一律 4 秒。
 *
 * 【2026-11-20 复审补钉：暂停是暂停，不是重置】
 * hover 中的 toast 的计时器是**拿掉的**（Map 里没有它）。此前 watch 回调给全体在场
 * toast 重排计时，会把这条悬停中的也续上——旁边任何一条 toast 进出，用户的阅读
 * 计时就重置一次。悬停集合（hovered）挡在 scheduleDismiss 最前面：悬停中的 id
 * 谁也不许给它排计时，mouseleave 才交还给计时器。
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const hovered = new Set<string>();

function scheduleDismiss(id: string): void {
  if (hovered.has(id)) return;
  if (timers.has(id)) return;
  const n = notif.notifications.find((x) => x.id === id);
  if (n === undefined) return;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      notif.markAsRead(id);
    }, notificationDwellMs(n.level))
  );
}

function cancelDismiss(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

watch(
  visibleToasts,
  (list) => {
    const present = new Set(list.map((n) => n.id));
    // 先撤不在场的：已读 / 已删的 toast，计时器与悬停标记必须跟着退场，不许留空转。
    for (const [id, timer] of timers) {
      if (!present.has(id)) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }
    for (const id of hovered) {
      if (!present.has(id)) hovered.delete(id);
    }
    for (const n of list) scheduleDismiss(n.id);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  hovered.clear();
});

function dismiss(id: string): void {
  cancelDismiss(id);
  hovered.delete(id);
  notif.markAsRead(id);
}

/** 悬停暂停：error 的理由很长，用户读一半被收走比不出现还糟（C1）。
 * 暂停 = 计时器拿掉 + 悬停集合记账——后者挡住 watch 重排时把它续上。 */
function pauseDismiss(id: string): void {
  hovered.add(id);
  cancelDismiss(id);
}

function resumeDismiss(id: string): void {
  hovered.delete(id);
  scheduleDismiss(id);
}

function runAction(n: AppNotification): void {
  if (n.actionKind === undefined) return;
  runner.run(n.actionKind);
  dismiss(n.id);
}

/** +N 徽章的出口（2026-11-20 复审补钉）：Toast 常驻四页（App.vue），而通知中心的面板
 * 只挂在中栏——设置页里点徽章若只开真身，面板根本不在屏上，就成了「点了没反应」。
 * 先把视图带回工作台，再开面板；已经在工作台时 showWorkspace 是幂等的。 */
function openCenter(): void {
  layout.showWorkspace();
  layout.openNotificationCenter();
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <div class="toast-stack">
    <transition-group name="toast">
      <div
        v-for="n in visibleToasts"
        :key="n.id"
        :class="['toast', `is-${n.level}`]"
        @mouseenter="pauseDismiss(n.id)"
        @mouseleave="resumeDismiss(n.id)"
      >
        <span class="toast-badge">
          <AppIcon :name="iconFor(n.level)" :size="14" class="toast-icon" />
        </span>
        <div class="toast-body">
          <span class="toast-title">{{ n.title }}</span>
          <span class="toast-msg">{{ n.message }}</span>
          <button
            v-if="n.actionKind !== undefined"
            class="toast-action"
            type="button"
            @click.stop="runAction(n)"
          >
            {{ NOTIFICATION_ACTION_LABELS[n.actionKind] }}
          </button>
        </div>
        <span class="toast-time">{{ formatTime(n.timestamp) }}</span>
        <button
          class="toast-close"
          type="button"
          aria-label="关闭通知"
          title="关闭通知"
          @click.stop="dismiss(n.id)"
        >
          <AppIcon name="close" :size="10" />
        </button>
      </div>
    </transition-group>
    <button
      v-if="queuedCount > 0"
      class="toast-queue-badge"
      type="button"
      :aria-label="`还有 ${queuedCount} 条通知，打开通知中心`"
      title="还有更多通知，点这里全部查看"
      @click="openCenter"
    >
      +{{ queuedCount }}
    </button>
  </div>
</template>

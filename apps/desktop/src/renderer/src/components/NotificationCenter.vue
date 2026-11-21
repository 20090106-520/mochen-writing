<!--
  通知中心（2026-11-20 通知整修 A2+B4）。

  【为什么必须有这一格】useNotificationStore 从 2026-10 起就承诺「通知历史（最近 50 条）+ 未读标记」，
  unreadCount / recentNotifications / markAllAsRead / remove / clearAll 五个 API 也都实现了——
  但界面上一直没有出口：Toast 只露未读前 3 条，滑走就永远找不回来。这一格就是那个出口。

  形态照中栏头部浮层家族（历史对话那一族）：触发钮 + 遮罩 + 绝对定位面板，
  材质走浮层家族的同一张面（发丝线 / 12px 圆角 / 浮层阴影；玻璃归 liquid-glass.css 总闸）。
  开合真身住 layout.notificationCenterOpen——Toast 的「+N」徽章也开这一张面板，两个入口一份布尔。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, useId } from "vue";
import { storeToRefs } from "pinia";
import {
  useNotificationStore,
  type AppNotification,
  type NotificationLevel
} from "../stores/useNotificationStore";
import { useLayoutStore } from "../stores/layoutStore";
import { NOTIFICATION_ACTION_LABELS } from "../utils/notification-actions";
import { useNotificationActionRunner } from "../composables/useNotificationActionRunner";
import AppIcon from "./AppIcon.vue";

const notif = useNotificationStore();
const layout = useLayoutStore();
const { recentNotifications, unreadCount } = storeToRefs(notif);
const runner = useNotificationActionRunner();

const panelId = useId();
const open = computed({
  get: () => layout.notificationCenterOpen,
  set: (value: boolean) => {
    layout.notificationCenterOpen = value;
  }
});

function iconFor(level: NotificationLevel): string {
  switch (level) {
    case "success":
      return "check";
    case "warning":
      return "shield";
    case "error":
      return "close";
    default:
      return "sparkles";
  }
}

function close(): void {
  open.value = false;
}

/**
 * 切到设置页等整页视图时，中栏（连着这一格）会被卸载——开合真身却还留在 layoutStore 里，
 * 回到工作台时面板自动开着，与隔壁「历史对话」（局部 ref，切页即消）行为不一致。
 * 卸载时把真身关掉：真身已经关了（比如徽章路径先关过）就不重复写。
 */
onBeforeUnmount(() => {
  if (open.value) open.value = false;
});

/** 执行一枚通知的动作：跑完顺手标记已读——动作被接住了，这条就不再欠着未读。 */
function runAction(n: AppNotification): void {
  if (n.actionKind === undefined) return;
  runner.run(n.actionKind);
  notif.markAsRead(n.id);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <div class="notification-center-control" @keydown.esc.stop="close()">
    <button
      class="header-text-button notification-center-trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="panelId"
      aria-label="通知中心"
      title="通知中心"
      @click="open = !open"
    >
      <AppIcon name="bell" :size="16" />
      <span v-if="unreadCount > 0" class="notification-center-dot" aria-hidden="true">
        {{ unreadCount > 9 ? "9+" : unreadCount }}
      </span>
    </button>
    <div v-if="open" class="notification-center-dismiss" aria-hidden="true" @mousedown="close()" />
    <section
      v-if="open"
      :id="panelId"
      class="notification-center"
      role="dialog"
      aria-label="通知中心"
    >
      <header>
        <div class="notification-center-heading">
          <strong>通知中心</strong>
          <span>{{ unreadCount > 0 ? `${unreadCount} 条未读` : "都已读" }}</span>
        </div>
        <div class="notification-center-head-actions">
          <button
            v-if="unreadCount > 0"
            class="notification-center-head-button"
            type="button"
            @click="notif.markAllAsRead()"
          >
            全部已读
          </button>
          <button
            v-if="recentNotifications.length > 0"
            class="notification-center-head-button"
            type="button"
            @click="notif.clearAll()"
          >
            清空
          </button>
          <button type="button" aria-label="关闭通知中心" @click="close()">
            <AppIcon name="close" :size="15" />
          </button>
        </div>
      </header>
      <div v-if="recentNotifications.length" class="notification-center-list">
        <div
          v-for="n in recentNotifications"
          :key="n.id"
          class="notification-center-item"
          :class="[`is-${n.level}`, { 'is-unread': !n.read }]"
        >
          <span class="notification-center-badge">
            <AppIcon :name="iconFor(n.level)" :size="13" />
          </span>
          <div class="notification-center-copy">
            <div class="notification-center-title-row">
              <strong>{{ n.title }}</strong>
              <time :datetime="new Date(n.timestamp).toISOString()">{{
                formatTime(n.timestamp)
              }}</time>
            </div>
            <small>{{ n.message }}</small>
            <button
              v-if="n.actionKind !== undefined"
              class="notification-center-action"
              type="button"
              @click="runAction(n)"
            >
              {{ NOTIFICATION_ACTION_LABELS[n.actionKind] }}
            </button>
          </div>
          <button
            class="notification-center-remove"
            type="button"
            :aria-label="`删除通知：${n.title}`"
            title="删除这条通知"
            @click="notif.remove(n.id)"
          >
            <AppIcon name="close" :size="11" />
          </button>
        </div>
      </div>
      <div v-else class="notification-center-empty">
        <AppIcon name="bell" :size="22" />
        <strong>还没有通知</strong>
      </div>
    </section>
  </div>
</template>

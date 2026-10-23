<!-- 通知 Toast：应用内短暂提示，自动消失 -->
<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useNotificationStore, type NotificationLevel } from "../stores/useNotificationStore";
import AppIcon from "./AppIcon.vue";

const notif = useNotificationStore();
const { unreadNotifications } = storeToRefs(notif);

const visibleToasts = computed(() => unreadNotifications.value.slice(0, 3));

function iconFor(level: NotificationLevel): string {
  switch (level) {
    case "success":
      return "check";
    case "warning":
      return "shield";
    case "error":
      return "x";
    default:
      return "sparkles";
  }
}

function dismiss(id: string): void {
  notif.markAsRead(id);
}

function autoDismiss(id: string): void {
  setTimeout(() => notif.markAsRead(id), 4000);
}

// 自动消失
for (const n of visibleToasts.value) {
  autoDismiss(n.id);
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
        @click="dismiss(n.id)"
      >
        <AppIcon :name="iconFor(n.level)" :size="14" class="toast-icon" />
        <div class="toast-body">
          <span class="toast-title">{{ n.title }}</span>
          <span class="toast-msg">{{ n.message }}</span>
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
  </div>
</template>

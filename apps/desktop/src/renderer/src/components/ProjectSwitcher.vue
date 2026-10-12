<!-- 项目切换器：头部下拉，展示最近作品列表 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useProjectManagerStore } from "../stores/useProjectManagerStore";
import { useLayoutStore } from "../stores/layoutStore";
import AppIcon from "./AppIcon.vue";
import { formatCharCount } from "../utils/char-count";

const emit = defineEmits<{ "open-manager": [] }>();

const pm = useProjectManagerStore();
const layout = useLayoutStore();

const open = ref(false);
const hoveredId = ref<string | null>(null);

const displayProjects = computed(() => pm.sortedProjects.slice(0, 8));

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function selectProject(id: string): void {
  pm.setActiveProject(id);
  open.value = false;
}

function close(): void {
  open.value = false;
}
</script>

<template>
  <div class="project-switcher">
    <button
      class="project-switcher-trigger"
      type="button"
      :title="pm.activeProject?.title ?? '未选择作品'"
      @click="open = !open"
    >
      <AppIcon name="book" :size="15" />
      <span class="project-title">{{ pm.activeProject?.title ?? "未选择作品" }}</span>
      <AppIcon name="chevron" :size="12" :class="{ 'is-open': open }" />
    </button>

    <div v-if="open" class="project-switcher-dropdown" @keydown.escape="close">
      <div class="project-dropdown-header">
        <span>我的作品</span>
        <button class="link-btn" type="button" @click="emit('open-manager')">管理全部</button>
      </div>

      <div v-if="displayProjects.length === 0" class="project-dropdown-empty">
        还没有作品。在左栏新建或打开一个目录吧。
      </div>

      <ul v-else class="project-dropdown-list">
        <li
          v-for="proj in displayProjects"
          :key="proj.id"
          :class="['project-item', { 'is-active': proj.id === pm.activeProjectId }]"
          @mouseenter="hoveredId = proj.id"
          @mouseleave="hoveredId = null"
          @click="selectProject(proj.id)"
        >
          <AppIcon :name="proj.kind === 'novel' ? 'book' : 'archive'" :size="14" />
          <div class="project-item-info">
            <span class="project-item-title">{{ proj.title }}</span>
            <span class="project-item-meta">
              {{ formatCharCount(proj.totalChars) }} · {{ proj.chapterCount }} 章 ·
              {{ formatTimestamp(proj.lastOpenedAt) }}
            </span>
          </div>
          <AppIcon
            v-if="proj.id === pm.activeProjectId"
            name="check"
            :size="12"
            class="project-item-check"
          />
        </li>
      </ul>

      <div class="project-dropdown-footer">
        <button class="link-btn" type="button" @click="layout.openNewBook()">
          <AppIcon name="plus" :size="12" /> 新建作品
        </button>
        <button class="link-btn" type="button">
          <AppIcon name="folder" :size="12" /> 打开目录
        </button>
      </div>
    </div>

    <!-- 点击外部关闭 -->
    <div v-if="open" class="project-switcher-backdrop" @click="close" />
  </div>
</template>

<style scoped>
.project-switcher {
  position: relative;
  display: inline-block;
}

.project-switcher-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.928571rem;
  color: var(--text-primary, #e8e8e8);
  max-width: 160px;
}

.project-switcher-trigger:hover {
  background: var(--hover-bg, rgba(255, 255, 255, 0.06));
}

.project-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.is-open {
  transform: rotate(180deg);
}

.project-switcher-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 280px;
  max-width: 340px;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  padding: 4px 0;
}

.project-dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  font-size: 0.785714rem;
  color: var(--text-secondary, #999);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.project-dropdown-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 0.928571rem;
  color: var(--text-muted, #777);
}

.project-dropdown-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 300px;
  overflow-y: auto;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
}

.project-item:hover,
.project-item.is-active {
  background: var(--hover-bg, rgba(255, 255, 255, 0.06));
  /* 状态档底：条目下面那行 `.project-item-meta`（路径与篇数）是 muted。
     判据见 composables/appearance-surface-ladder.test.ts。 */
  --text-muted: var(--text-on-state);
}

.project-item-info {
  flex: 1;
  min-width: 0;
}

.project-item-title {
  display: block;
  font-size: 0.928571rem;
  color: var(--text-primary, #e8e8e8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-item-meta {
  display: block;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
  margin-top: 2px;
}

.project-item-check {
  color: var(--accent, #6c9eff);
}

.project-dropdown-footer {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  margin-top: 4px;
}

.link-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--accent, #6c9eff);
  font-size: 0.857143rem;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.link-btn:hover {
  background: var(--hover-bg, rgba(255, 255, 255, 0.06));
}

.project-switcher-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}
</style>

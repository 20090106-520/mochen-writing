<!-- 项目管理面板（设置浮层的「项目管理」页签）：当前作品、操作按钮、最近作品列表。
     数据真身是 useProjectManagerStore（书签册，不是文件柜）：删除只从列表移除，不动磁盘文件。
     打开/创建走 window.mochen IPC（主进程落盘）。 -->
<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { useProjectManagerStore } from "../stores/useProjectManagerStore";
import { useBookStore } from "../stores/useBookStore";
import { formatCharCount } from "../utils/char-count";

const layout = useLayoutStore();
const pm = useProjectManagerStore();
const book = useBookStore();

const currentBookTitle = computed(() => pm.activeProject?.title ?? null);

/** 字数展示：≥1万显示「X.X万」，否则显示千分位整数 */

/** 最近打开时间：今天显示时分，同年显示月-日，跨年显示年-月-日 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  const options: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
  }
  return date.toLocaleDateString("zh-CN", options);
}

function openProjectDir(): void {
  void window.mochen.pickBookDirectory();
}

function createBook(): void {
  layout.openNewBook();
}

async function switchProject(project: { id: string; rootPath: string }): Promise<void> {
  pm.setActiveProject(project.id);
  await book.openBook(project.rootPath);
}
</script>

<template>
  <div class="project-settings">
    <section class="settings-group">
      <h2 class="settings-group-title">当前作品</h2>
      <p class="settings-static-text">{{ currentBookTitle ?? "尚未打开" }}</p>
    </section>

    <section class="settings-group">
      <h2 class="settings-group-title">操作</h2>
      <div class="project-actions">
        <button class="settings-btn" type="button" @click="openProjectDir">
          <AppIcon name="folder" :size="14" /> 打开作品目录
        </button>
        <button class="settings-btn" type="button" @click="createBook">
          <AppIcon name="plus" :size="14" /> 创建新书
        </button>
      </div>
    </section>

    <section class="settings-group">
      <h2 class="settings-group-title">最近作品</h2>
      <ul v-if="pm.sortedProjects.length > 0" class="project-list">
        <li
          v-for="project in pm.sortedProjects"
          :key="project.id"
          class="project-row"
          :class="{ 'is-active': pm.activeProjectId === project.id }"
        >
          <button class="project-row-main" type="button" @click="switchProject(project)">
            <AppIcon name="book" :size="12" />
            <span class="project-row-title">{{ project.title }}</span>
            <span class="project-row-meta"
              >{{ formatCharCount(project.totalChars) }} ·
              {{ formatTime(project.lastOpenedAt) }}</span
            >
          </button>
          <button
            class="project-row-remove"
            type="button"
            :aria-label="`移除项目 ${project.title}`"
            @click="pm.removeProject(project.id)"
          >
            <AppIcon name="close" :size="10" />
          </button>
        </li>
      </ul>
      <p v-else class="settings-static-text">还没有任何作品，点「创建新书」开始写作。</p>
    </section>
  </div>
</template>

<style scoped>
.project-settings {
  max-width: var(--settings-measure, 880px);
}

.settings-static-text {
  margin: 0;
  color: var(--text-soft);
  font-size: 0.928571rem;
  line-height: 1.5;
}

.project-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  color: var(--text);
  font: inherit;
  font-size: 0.928571rem;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out-soft),
    box-shadow var(--dur-fast) var(--ease-out-soft),
    border-color var(--dur-fast) var(--ease-out-soft);
}

.settings-btn:hover {
  background: var(--hover);
  box-shadow: var(--shadow-md);
  border-color: var(--accent-soft);
}

.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line-soft);
  border-radius: 13px;
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.project-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  transition: background var(--dur-fast) var(--ease-out-soft);
}

.project-row:not(:last-child) {
  border-bottom: 1px solid var(--line-soft);
}

.project-row.is-active {
  background: color-mix(in srgb, var(--accent-soft) 40%, var(--surface-card));
}

.project-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 10px 8px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.project-row-main:hover {
  color: var(--accent);
}

.project-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 590;
}

.project-row-meta {
  flex-shrink: 0;
  color: var(--text-soft);
  font-size: 0.857143rem;
}

.project-row-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out-soft),
    color var(--dur-fast) var(--ease-out-soft);
}

.project-row-remove:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>

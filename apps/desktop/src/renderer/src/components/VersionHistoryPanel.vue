<!-- 版本历史面板：展示当前文档的备份快照，支持浏览、diff、恢复 -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useVersionStore } from "../stores/useVersionStore";
import { useBookStore } from "../stores/useBookStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: []; restore: [content: string] }>();

const version = useVersionStore();
const book = useBookStore();
const notif = useNotificationStore();

const selectedSnapshotId = ref<string | null>(null);
const viewMode = ref<"preview" | "diff">("preview");

// 当前文档的快照
const activeDoc = computed(() => (book.activeDocTab ? book.refOf(book.activeDocTab) : null));
const snapshots = computed(() =>
  activeDoc.value ? version.getSnapshots(activeDoc.value.relPath) : []
);

const selectedSnapshot = computed(
  () => snapshots.value.find((s) => s.id === selectedSnapshotId.value) ?? null
);

const snapshotContent = computed(() => {
  if (!activeDoc.value || !selectedSnapshotId.value) return null;
  return version.getSnapshotContent(activeDoc.value.relPath, selectedSnapshotId.value);
});

const diffInfo = computed(() => {
  if (snapshots.value.length < 2 || !selectedSnapshotId.value) return null;
  const idx = snapshots.value.findIndex((s) => s.id === selectedSnapshotId.value);
  if (idx >= snapshots.value.length - 1) return null; // 最新一版没有下一版可比较
  const next = snapshots.value[idx + 1];
  return version.diffSnapshots(activeDoc.value!.relPath, next.id, selectedSnapshotId.value);
});

watch(
  () => props.visible,
  (vis) => {
    if (vis && snapshots.value.length > 0) {
      selectedSnapshotId.value = snapshots.value[0].id;
    }
    if (!vis) {
      selectedSnapshotId.value = null;
    }
  }
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatChars(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万字`;
  return `${n.toLocaleString("zh-CN")} 字`;
}

function restoreSnapshot(): void {
  if (!snapshotContent.value) return;
  emit("restore", snapshotContent.value);
  notif.notify({
    title: "已恢复",
    message: `已恢复到「${selectedSnapshot.value?.summary ?? ""}」版本`,
    level: "success"
  });
}

function deleteAllVersions(): void {
  if (!activeDoc.value) return;
  version.clearDocVersions(activeDoc.value.relPath);
  notif.notify({
    title: "已清除",
    message: "该文档的版本历史已清空",
    level: "info"
  });
}
</script>

<template>
  <div v-if="visible" class="ver-overlay" @click.self="emit('close')">
    <div class="ver-panel" role="dialog" aria-label="版本历史">
      <header class="ver-header">
        <h3>版本历史</h3>
        <span class="ver-doc-name">{{ activeDoc?.title ?? "无打开文档" }}</span>
        <button class="icon-btn" type="button" @click="emit('close')">
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <div v-if="snapshots.length === 0" class="ver-empty">
        <AppIcon name="history" :size="24" />
        <p>该文档还没有版本快照。</p>
        <p class="ver-empty-hint">每次自动保存时会自动生成快照（最多 50 个）。</p>
      </div>

      <div v-else class="ver-body">
        <!-- 左侧：快照列表 -->
        <div class="ver-list">
          <div class="ver-list-head">
            <span>{{ snapshots.length }} 个版本</span>
            <button
              v-if="snapshots.length > 1"
              class="link-btn"
              type="button"
              @click="deleteAllVersions"
            >
              清除全部
            </button>
          </div>
          <ul>
            <li
              v-for="(snap, idx) in snapshots"
              :key="snap.id"
              :class="['ver-item', { 'is-selected': selectedSnapshotId === snap.id }]"
              @click="selectedSnapshotId = snap.id"
            >
              <div class="ver-item-dot" :class="{ 'is-latest': idx === 0 }" />
              <div class="ver-item-info">
                <span class="ver-item-summary">{{ snap.summary || "（空）" }}</span>
                <span class="ver-item-meta">
                  {{ formatTime(snap.timestamp) }} · {{ formatChars(snap.charCount) }} ·
                  {{ snap.contentHash.slice(0, 6) }}
                </span>
                <span v-if="idx === 0" class="ver-item-badge">最新</span>
              </div>
            </li>
          </ul>
        </div>

        <!-- 右侧：预览 / diff -->
        <div class="ver-preview">
          <div class="ver-preview-head">
            <div class="ver-view-toggle">
              <button
                :class="{ 'is-active': viewMode === 'preview' }"
                type="button"
                @click="viewMode = 'preview'"
              >
                预览
              </button>
              <button
                :class="{ 'is-active': viewMode === 'diff' }"
                type="button"
                :disabled="!diffInfo"
                @click="viewMode = 'diff'"
              >
                Diff
              </button>
            </div>
            <button
              class="ver-restore-btn"
              type="button"
              :disabled="!selectedSnapshot"
              @click="restoreSnapshot"
            >
              <AppIcon name="redo" :size="12" />
              恢复此版本
            </button>
          </div>

          <!-- 预览 -->
          <div v-if="viewMode === 'preview'" class="ver-preview-content">
            <pre v-if="snapshotContent">{{ snapshotContent }}</pre>
            <div v-else class="ver-no-select">选择一个版本以预览</div>
          </div>

          <!-- Diff -->
          <div v-else class="ver-diff-view">
            <div v-if="diffInfo" class="ver-diff-stats">
              <span class="ver-diff-added">+{{ diffInfo.added }} 行变更</span>
              <span class="ver-diff-removed">-{{ diffInfo.removed }} 行删除</span>
              <span class="ver-diff-unchanged">{{ diffInfo.unchanged }} 行未变</span>
            </div>
            <div v-else class="ver-diff-na">最早一版无可比较的上一版本。</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ver-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
}

.ver-panel {
  width: 720px;
  max-width: 90vw;
  height: 540px;
  max-height: 80vh;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ver-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.ver-header h3 {
  margin: 0;
  font-size: 14px;
  color: var(--text-primary, #e8e8e8);
}

.ver-doc-name {
  font-size: 11px;
  color: var(--text-muted, #777);
  flex: 1;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.ver-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted, #777);
}

.ver-empty p {
  margin: 0;
  font-size: 13px;
}

.ver-empty-hint {
  font-size: 11px !important;
  opacity: 0.6;
}

.ver-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.ver-list {
  width: 240px;
  border-right: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  overflow-y: auto;
  flex-shrink: 0;
}

.ver-list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 11px;
  color: var(--text-muted, #777);
  position: sticky;
  top: 0;
  background: var(--dropdown-bg, #1e1e2a);
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.04));
}

.link-btn {
  font-size: 11px;
  background: none;
  border: none;
  color: var(--accent, #6c9eff);
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.ver-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ver-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 2px solid transparent;
}

.ver-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.ver-item.is-selected {
  background: rgba(108, 158, 255, 0.06);
  border-left-color: var(--accent, #6c9eff);
}

.ver-item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  margin-top: 3px;
  flex-shrink: 0;
}

.ver-item-dot.is-latest {
  background: #50c878;
}

.ver-item-info {
  flex: 1;
  min-width: 0;
}

.ver-item-summary {
  display: block;
  font-size: 12px;
  color: var(--text-primary, #e8e8e8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ver-item-meta {
  display: block;
  font-size: 10px;
  color: var(--text-muted, #777);
  margin-top: 1px;
}

.ver-item-badge {
  display: inline-block;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(80, 200, 120, 0.15);
  color: #50c878;
  margin-top: 2px;
}

.ver-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ver-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.04));
}

.ver-view-toggle {
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 4px;
  padding: 2px;
}

.ver-view-toggle button {
  padding: 3px 10px;
  font-size: 11px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-muted, #777);
  cursor: pointer;
}

.ver-view-toggle button.is-active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e8e8e8);
}

.ver-view-toggle button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ver-restore-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  background: var(--accent, #6c9eff);
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
}

.ver-restore-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ver-preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.ver-preview-content pre {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #bbb);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, "SF Mono", monospace;
}

.ver-no-select {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted, #777);
  font-size: 12px;
}

.ver-diff-view {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.ver-diff-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
}

.ver-diff-added {
  color: #50c878;
}

.ver-diff-removed {
  color: #f06060;
}

.ver-diff-unchanged {
  color: var(--text-muted, #777);
}

.ver-diff-na {
  color: var(--text-muted, #777);
  font-size: 12px;
}
</style>

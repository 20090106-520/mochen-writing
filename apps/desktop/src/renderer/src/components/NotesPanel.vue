<!-- 笔记面板：右侧栏浮层，展示笔记列表、新建、编辑、搜索 -->
<script setup lang="ts">
import { computed, ref, watch, toRef } from "vue";
import { storeToRefs } from "pinia";
import { useNotesStore, type Note } from "../stores/useNotesStore";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: []; "create-annotation": [docRelPath: string] }>();

/**
 * 焦点与 Esc 的真身在 useModalFocus（批次 5-㊲）。
 * 这一层是整屏遮罩 + role="dialog"，功能上就是模态层；真机量测（p536g）实测六处一模一样：
 * 焦点从不在层内、Esc 一次也收不掉（连 OutlinePanel 那一处 @keydown.esc 也够不着——
 * 它挂在搜索框上，而焦点压根没进过面板）。
 * Esc 与焦点进出统一由那一处接管，本组件不再留第二份判定。
 */
const panelRoot = ref<HTMLElement>();
useModalFocus({
  root: panelRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.visible)
});

const notes = useNotesStore();
const book = useBookStore();

const { activeNotes, allTags } = storeToRefs(notes);

const tab = ref<"all" | "quick" | "annotations">("all");
const searchQuery = ref("");
const editingId = ref<string | null>(null);
const editingContent = ref("");
const newNoteText = ref("");
const showNewForm = ref(false);

const filteredNotes = computed(() => {
  let list: Note[] = activeNotes.value;
  if (tab.value === "quick") list = list.filter((n) => n.kind === "quick");
  else if (tab.value === "annotations") list = list.filter((n) => n.kind === "annotation");
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLocaleLowerCase();
    list = list.filter(
      (n) => n.content.toLocaleLowerCase().includes(q) || n.tags.some((t) => t.includes(q))
    );
  }
  return list;
});

watch(
  () => props.visible,
  (vis) => {
    if (!vis) {
      editingId.value = null;
      showNewForm.value = false;
      newNoteText.value = "";
    }
  }
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function startEdit(note: Note): void {
  editingId.value = note.id;
  editingContent.value = note.content;
}

function saveEdit(): void {
  if (editingId.value && editingContent.value.trim()) {
    notes.updateNote(editingId.value, editingContent.value.trim());
  }
  editingId.value = null;
}

function createNote(): void {
  if (!newNoteText.value.trim()) return;
  notes.createQuickNote(newNoteText.value.trim());
  newNoteText.value = "";
  showNewForm.value = false;
}

function getDocTitle(note: Note): string {
  if (!note.docRelPath) return "";
  return book.refOf(note.docRelPath)?.title ?? note.docRelPath;
}

function jumpToDoc(note: Note): void {
  if (!note.docRelPath) return;
  const ref = book.refOf(note.docRelPath);
  if (!ref) return;
  if (ref.kind === "chapter") void book.openDocTab(note.docRelPath);
  else book.browse(ref);
  emit("close");
}
</script>

<template>
  <div v-if="visible" class="notes-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="notes-panel"
      role="dialog"
      aria-modal="true"
      aria-label="笔记"
      tabindex="-1"
    >
      <header class="notes-header">
        <h3>笔记</h3>
        <div class="notes-header-actions">
          <button
            class="icon-btn"
            type="button"
            title="新建笔记"
            @click="showNewForm = !showNewForm"
          >
            <AppIcon name="plus" :size="14" />
          </button>
          <button class="icon-btn" type="button" title="关闭" @click="emit('close')">
            <AppIcon name="close" :size="14" />
          </button>
        </div>
      </header>

      <!-- 标签页 -->
      <nav class="notes-tabs">
        <button
          v-for="t in ['all', 'quick', 'annotations'] as const"
          :key="t"
          :class="['notes-tab', { 'is-active': tab === t }]"
          type="button"
          @click="tab = t"
        >
          {{ t === "all" ? "全部" : t === "quick" ? "速记" : "批注" }}
        </button>
      </nav>

      <!-- 搜索 -->
      <div class="notes-search">
        <AppIcon name="search" :size="13" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索笔记…"
          class="notes-search-input"
        />
      </div>

      <!-- 新建笔记表单 -->
      <div v-if="showNewForm" class="notes-new-form">
        <textarea v-model="newNoteText" placeholder="记点什么…" rows="3" class="notes-textarea" />
        <div class="notes-new-actions">
          <button class="is-primary" type="button" @click="createNote">保存</button>
          <button type="button" @click="showNewForm = false">取消</button>
        </div>
      </div>

      <!-- 笔记列表 -->
      <div class="notes-list">
        <div v-if="filteredNotes.length === 0" class="notes-empty">
          <p>还没有笔记。</p>
          <p class="notes-empty-hint">速记灵感，或在文档上添加批注。</p>
        </div>

        <article
          v-for="note in filteredNotes"
          :key="note.id"
          class="note-card"
          :class="[`is-${note.kind}`]"
        >
          <!-- 编辑态 -->
          <div v-if="editingId === note.id" class="note-edit">
            <textarea v-model="editingContent" rows="3" class="notes-textarea" />
            <div class="note-edit-actions">
              <button class="is-primary" type="button" @click="saveEdit">保存</button>
              <button type="button" @click="editingId = null">取消</button>
            </div>
          </div>

          <!-- 展示态 -->
          <template v-else>
            <p class="note-content">{{ note.content }}</p>

            <div v-if="note.tags.length" class="note-tags">
              <span v-for="tag in note.tags" :key="tag" class="note-tag">{{ tag }}</span>
            </div>

            <footer class="note-footer">
              <div v-if="note.kind === 'annotation'" class="note-doc-ref" @click="jumpToDoc(note)">
                <AppIcon name="attach" :size="11" />
                <span>{{ getDocTitle(note) }}</span>
                <span v-if="note.lineNumber">第 {{ note.lineNumber }} 行</span>
              </div>
              <span class="note-time">{{ formatTime(note.updatedAt) }}</span>
              <div class="note-actions">
                <button class="icon-btn-sm" type="button" title="编辑" @click="startEdit(note)">
                  <AppIcon name="pen" :size="11" />
                </button>
                <button
                  class="icon-btn-sm"
                  type="button"
                  title="归档"
                  @click="notes.archiveNote(note.id)"
                >
                  <AppIcon name="archive" :size="11" />
                </button>
              </div>
            </footer>
          </template>
        </article>
      </div>

      <!-- 标签集 -->
      <div v-if="allTags.length" class="notes-tag-cloud">
        <span class="notes-section-label">标签</span>
        <div class="tag-cloud-list">
          <button
            v-for="tag in allTags"
            :key="tag"
            class="tag-pill"
            type="button"
            @click="searchQuery = tag"
          >
            #{{ tag }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notes-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: flex-end;
  z-index: 1500;
}

.notes-panel {
  width: 420px;
  max-width: 90vw;
  height: 100%;
  background: var(--dropdown-bg, #1e1e2a);
  border-left: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.3);
}

.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.notes-header h3 {
  font-size: 14px;
  margin: 0;
  color: var(--text-primary, #e8e8e8);
}

.notes-header-actions {
  display: flex;
  gap: 4px;
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
  color: var(--text-primary, #e8e8e8);
}

.notes-tabs {
  display: flex;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  gap: 4px;
}

.notes-tab {
  padding: 8px 12px;
  font-size: 12px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted, #777);
  cursor: pointer;
}

.notes-tab.is-active {
  color: var(--text-primary, #e8e8e8);
  border-bottom-color: var(--accent, #6c9eff);
}

.notes-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px;
  padding: 6px 10px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  color: var(--text-muted, #777);
}

.notes-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary, #e8e8e8);
  font-size: 12px;
}

.notes-new-form {
  margin: 0 12px 8px;
  padding: 10px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
}

.notes-textarea {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary, #e8e8e8);
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}

.notes-new-actions,
.note-edit-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 6px;
}

.notes-new-actions button,
.note-edit-actions button {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.notes-new-actions button.is-primary,
.note-edit-actions button.is-primary {
  background: var(--accent, #6c9eff);
  color: #fff;
  border-color: var(--accent, #6c9eff);
}

.notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px;
}

.notes-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-muted, #777);
}

.notes-empty p {
  margin: 4px 0;
  font-size: 13px;
}

.notes-empty-hint {
  font-size: 11px !important;
  opacity: 0.6;
}

.note-card {
  padding: 10px 12px;
  margin-bottom: 6px;
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
}

.note-card.is-quick {
  border-left: 2px solid var(--accent, #6c9eff);
}

.note-card.is-annotation {
  border-left: 2px solid #f0a040;
}

.note-content {
  margin: 0 0 6px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary, #e8e8e8);
  white-space: pre-wrap;
  word-break: break-word;
}

.note-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.note-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary, #999);
}

.note-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted, #777);
}

.note-doc-ref {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.note-doc-ref:hover {
  color: var(--accent, #6c9eff);
}

.note-time {
  margin-left: auto;
}

.note-actions {
  display: flex;
  gap: 2px;
}

.icon-btn-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted, #777);
  cursor: pointer;
}

.icon-btn-sm:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary, #e8e8e8);
}

.notes-tag-cloud {
  padding: 8px 12px;
  border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  max-height: 80px;
  overflow-y: auto;
}

.notes-section-label {
  display: block;
  font-size: 10px;
  color: var(--text-muted, #777);
  margin-bottom: 4px;
}

.tag-cloud-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag-pill {
  padding: 2px 8px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.tag-pill:hover {
  background: rgba(255, 255, 255, 0.08);
}
</style>

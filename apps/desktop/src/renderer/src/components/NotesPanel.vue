<!-- 笔记面板：右侧栏浮层，展示笔记列表、新建、编辑、搜索 -->
<script setup lang="ts">
import { computed, ref, watch, toRef } from "vue";
import { storeToRefs } from "pinia";
import { useNotesStore, type Note } from "../stores/useNotesStore";
import { useBookStore } from "../stores/useBookStore";
import {
  NOTE_SCOPES,
  annotationTarget,
  filterNotesByQuery,
  notesForScope,
  scopeEmptyText,
  type NoteScope
} from "../utils/note-scope";
import { parseTags } from "../utils/tag-input";
import { useModalFocus } from "../composables/useModalFocus";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

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

const { activeNotes, archivedNotes, allTags } = storeToRefs(notes);

/**
 * 档位、筛法、空态文案的判定全在 `utils/note-scope`（那边 17 条纯函数用例）。
 * 这里只留接线：以前四件事都写在本组件里，而「批注」那一档筛的是一条**没人写入**的 kind
 * （`createAnnotation` 全仓零调用），标签也只有展示端没有录入端——屏上说着有，代码里没做。
 */
const tab = ref<NoteScope>("all");
const searchQuery = ref("");
const editingId = ref<string | null>(null);
const editingContent = ref("");
const newNoteText = ref("");
const newNoteTags = ref("");
/** 勾上 = 这条挂在中栏当前章上，落成 `kind: "annotation"`；不勾就是速记。 */
const attachToCurrentDoc = ref(false);
const showNewForm = ref(false);

const filteredNotes = computed(() =>
  filterNotesByQuery(
    notesForScope(tab.value, { active: activeNotes.value, archived: archivedNotes.value }),
    searchQuery.value
  )
);

const emptyText = computed(() =>
  scopeEmptyText({
    scope: tab.value,
    libraryEmpty: activeNotes.value.length === 0,
    query: searchQuery.value
  })
);

/** 当前能挂批注的那一章；`ok: false` 时勾选项要禁用并把 reason 摆出来。 */
const attachTarget = computed(() => annotationTarget(book.activeDocTab));

/** 面板里的一句即时反馈：只在"用户刚做了个做不成的动作"时出现（不是常驻说明文字）。 */
const notice = ref("");

watch(
  () => props.visible,
  (vis) => {
    if (!vis) {
      editingId.value = null;
      showNewForm.value = false;
      newNoteText.value = "";
      newNoteTags.value = "";
      attachToCurrentDoc.value = false;
      notice.value = "";
    } else {
      // 面板开着时用户可能去中栏换了章：重新打开表单前把"挂不上"的陈旧勾选清掉。
      if (attachTarget.value.ok === false) attachToCurrentDoc.value = false;
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
  const content = newNoteText.value.trim();
  if (!content) return;
  const tags = parseTags(newNoteTags.value);
  /*
   * 勾了「附在当前章上」却挂不上去时，**不落成一条笔记**：旧世界里没有这条路（`createAnnotation`
   * 一次都没被调过），而现在如果把它降级成速记，用户会在「批注」那一档找不到自己刚写的东西——
   * 那比不建更糟。所以这里把判定给的 reason 原样上屏，让用户先在中栏开一章。
   */
  if (attachToCurrentDoc.value) {
    const target = attachTarget.value;
    if (target.ok === false) {
      notice.value = target.reason;
      return;
    }
    notes.createAnnotation(content, target.docRelPath, undefined, tags);
  } else {
    notes.createQuickNote(content, tags);
  }
  newNoteText.value = "";
  newNoteTags.value = "";
  notice.value = "";
  showNewForm.value = false;
}

function docTitleOf(docRelPath: string): string {
  return book.refOf(docRelPath)?.title ?? docRelPath;
}

function getDocTitle(note: Note): string {
  if (!note.docRelPath) return "";
  return docTitleOf(note.docRelPath);
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

      <!-- 标签页：档位表是 utils/note-scope 那一份，第四档「已归档」把取回通路摆在明面上 -->
      <nav class="notes-tabs">
        <button
          v-for="s in NOTE_SCOPES"
          :key="s.id"
          :class="['notes-tab', { 'is-active': tab === s.id }]"
          type="button"
          @click="tab = s.id"
        >
          {{ s.label }}
        </button>
      </nav>

      <!-- 落盘失败必须上屏（P0-7）：`useBookFileData` 把原因留在 store.saveError，这一行是它唯一的出口。
           以前存不进这本书的目录是静默的——列表照涨、屏上像已经存好了，用户以为它跟着书存在目录里。 -->
      <p v-if="notes.saveError" class="notes-save-error" role="status" aria-live="polite">
        {{ notes.saveError }}
      </p>

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

      <!-- 新建笔记表单：正文 + 标签 + 「附在当前章上」三件都能真的落库 -->
      <div v-if="showNewForm" class="notes-new-form">
        <textarea v-model="newNoteText" placeholder="记点什么…" rows="3" class="notes-textarea" />
        <input
          v-model="newNoteTags"
          type="text"
          class="notes-input"
          placeholder="标签，逗号分隔（可留空）"
        />
        <label :class="['notes-attach', { 'is-disabled': attachTarget.ok === false }]">
          <input
            v-model="attachToCurrentDoc"
            type="checkbox"
            class="notes-attach-box"
            :disabled="attachTarget.ok === false"
          />
          <span>
            附在当前章上（批注）
            <em v-if="attachTarget.ok === true">· {{ docTitleOf(attachTarget.docRelPath) }}</em>
            <em v-else>· {{ attachTarget.reason }}</em>
          </span>
        </label>
        <p v-if="notice" class="notes-notice">{{ notice }}</p>
        <div class="notes-new-actions">
          <button class="is-primary" type="button" @click="createNote">保存</button>
          <button type="button" @click="showNewForm = false">取消</button>
        </div>
      </div>

      <!-- 笔记列表 -->
      <div class="notes-list">
        <div v-if="filteredNotes.length === 0" class="notes-empty">
          <p>{{ emptyText.title }}</p>
          <p class="notes-empty-hint">{{ emptyText.hint }}</p>
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
                <!--
                  归档是**双向**的：这一枚钮在已归档的那条上换成「取回」。
                  旧实现只有归档一半（`unarchiveNote` 全仓零调用），点完归档那条笔记就从所有列表里
                  消失且再也回不来——在作者眼里等同于软件删了他的东西（扫描总单 P0-8）。
                -->
                <button
                  v-if="note.archived"
                  class="notes-restore-btn"
                  type="button"
                  title="把这条取回笔记列表"
                  @click="notes.unarchiveNote(note.id)"
                >
                  取回
                </button>
                <button
                  v-else
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
  font-size: 1rem;
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
  font-size: 0.857143rem;
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
  font-size: 0.857143rem;
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
  font-size: 0.928571rem;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}

/* 标签那一行：与描述框同一套底色，只多一圈边，让"这是一个输入框"看得出来 */
.notes-input {
  width: 100%;
  margin-top: 6px;
  padding: 4px 6px;
  background: transparent;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 5px;
  outline: none;
  color: var(--text-primary, #e8e8e8);
  font-size: 0.857143rem;
}

.notes-attach {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  color: var(--text-muted, #777);
  font-size: 0.785714rem;
  cursor: pointer;
}

.notes-attach em {
  font-style: normal;
  opacity: 0.75;
}

/* 挂不上时不置灰成"看不出这是个能用的钮"，而是把原因写在旁边（reason 已经在模板里） */
.notes-attach.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.notes-attach-box {
  margin: 2px 0 0;
  accent-color: var(--accent, #6c9eff);
}

.notes-notice {
  margin: 6px 0 0;
  color: var(--danger, #e0556e);
  font-size: 0.785714rem;
}

/* 设定没能落进这本书的目录（P0-7）：与表单里的 .notes-notice 分开，
   那一条跟着新建表单出现、这一条跟着通路失败出现，两者不同时存在也各有自己的开关。 */
.notes-save-error {
  margin: 8px 12px 0;
  color: var(--danger, #e0556e);
  font-size: 0.785714rem;
}

.notes-restore-btn {
  padding: 2px 8px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.14));
  border-radius: 999px;
  background: transparent;
  color: var(--text-primary, #e8e8e8);
  font-size: 0.714286rem;
  cursor: pointer;
}

.notes-restore-btn:hover {
  border-color: var(--accent, #6c9eff);
  color: var(--accent, #6c9eff);
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
  font-size: 0.785714rem;
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
  font-size: 0.928571rem;
}

.notes-empty-hint {
  font-size: 0.785714rem !important;
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
  font-size: 0.928571rem;
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
  font-size: 0.714286rem;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary, #999);
}

.note-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.785714rem;
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
  font-size: 0.714286rem;
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
  font-size: 0.714286rem;
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

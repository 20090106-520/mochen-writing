<!-- 大纲/思维导图视图：以浮层方式展示全部文档的结构化大纲，可折叠展开、搜索、排序。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, toRef } from "vue";
import type { BookKind, DocRef } from "@mochen/contracts";
import { storeToRefs } from "pinia";
import type { IconName } from "../types/icons";
import AppIcon from "./AppIcon.vue";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "../utils/book-kinds";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";

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

const book = useBookStore();
const { docs, activeDocTab } = storeToRefs(book);

// 图标是渲染资产不是业务枚举（设计决定 6）：标签/顺序来自 utils/book-kinds 唯一表，这里只留 icon。
const KIND_ICON: Record<BookKind, IconName> = {
  chapter: "book",
  outline: "list",
  character: "user",
  plot: "ledger",
  material: "library",
  worldview: "globe",
  faction: "directory",
  location: "map",
  timeline: "history",
  glossary: "library",
  volume: "archive",
  foreshadow: "pin",
  skill: "wand"
};

// —— 搜索 ——
const searchQuery = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      setTimeout(() => inputRef.value?.focus(), 50);
    } else {
      searchQuery.value = "";
      collapsedSections.value = {};
    }
  }
);

// —— 排序方式 ——
type SortMode = "order" | "kind" | "chars";
const sortMode = ref<SortMode>("order");
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "order", label: "章节顺序" },
  { value: "kind", label: "按类型" },
  { value: "chars", label: "按字数" }
];

function sortDocs(items: DocRef[], mode: SortMode): DocRef[] {
  if (mode === "chars") {
    return [...items].sort((a, b) => (b.chars ?? 0) - (a.chars ?? 0));
  }
  return items;
}

// —— 折叠状态 ——
const collapsedSections = ref<Record<string, boolean>>({});

function toggleSection(id: string): void {
  collapsedSections.value[id] = !collapsedSections.value[id];
}

function expandAll(): void {
  collapsedSections.value = {};
}

function collapseAll(): void {
  collapsedSections.value = Object.fromEntries(BOOK_KIND_ORDER.map((k) => [k, true]));
}

// —— 分组节点（Kind → Docs） ——
interface OutlineSection {
  id: BookKind;
  label: string;
  icon: IconName;
  nodes: DocRef[];
}

const filteredSections = computed((): OutlineSection[] => {
  const q = searchQuery.value.trim().toLowerCase();
  return BOOK_KIND_ORDER.map((kind) => {
    const matching = docs.value.filter((doc) => doc.kind === kind);
    const filtered =
      q === ""
        ? matching
        : matching.filter(
            (doc) =>
              doc.title.toLowerCase().includes(q) || (doc.excerpt ?? "").toLowerCase().includes(q)
          );
    return {
      id: kind,
      label: BOOK_KIND_LABELS[kind],
      icon: KIND_ICON[kind],
      nodes: sortDocs(filtered, sortMode.value)
    };
  }).filter((section) => section.nodes.length > 0);
});

// —— 选中判定 ——
function isSelected(relPath: string): boolean {
  return activeDocTab.value === relPath;
}

// —— 激活文档 ——
function activateDoc(doc: DocRef): void {
  if (doc.kind === "chapter") {
    void book.openDocTab(doc.relPath);
  } else {
    book.browse(doc);
  }
}

// —— 字数格式化 ——
function formatChars(chars: number | undefined): string {
  const n = chars ?? 0;
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} 千字`;
  return `${n} 字`;
}

// —— 总数统计 ——
const totalWords = computed(() => docs.value.reduce((sum, doc) => sum + (doc.chars ?? 0), 0));
const totalCount = computed(() => docs.value.length);

// —— 滚动条控制器 ——
const panelScrollbar = createTransientScrollbarController();
function handleScroll(event: Event): void {
  const element = event.currentTarget;
  if (element instanceof HTMLElement) panelScrollbar.reveal(element);
}
onBeforeUnmount(() => panelScrollbar.dispose());

// —— 拖拽排序（仅章节顺序模式下启用，按 BookKind 排序时无效） ——
// book 的 schema 中 chapterOrder 由主进程管理，这里只做视觉占位。
</script>

<template>
  <div v-if="visible" class="outline-overlay" @click.self="emit('close')">
    <aside
      ref="panelRoot"
      class="outline-panel"
      role="dialog"
      aria-modal="true"
      aria-label="文档大纲"
      tabindex="-1"
    >
      <!-- 标题栏 -->
      <header class="outline-header">
        <div class="outline-header-title">
          <AppIcon name="list" :size="18" />
          <span>文档大纲</span>
        </div>
        <button
          class="outline-close"
          type="button"
          aria-label="关闭大纲面板"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <!-- 统计信息 -->
      <div class="outline-stats">
        <span class="outline-stat-item">
          <AppIcon name="file" :size="13" />
          {{ totalCount }} 篇
        </span>
        <span class="outline-stat-item">
          <AppIcon name="pen" :size="13" />
          {{ formatChars(totalWords) }}
        </span>
      </div>

      <!-- 搜索框 -->
      <div class="outline-search-wrap">
        <AppIcon name="search" :size="15" class="outline-search-icon" />
        <input
          ref="inputRef"
          v-model="searchQuery"
          class="outline-search-input"
          type="text"
          placeholder="按标题过滤文档…"
        />
      </div>

      <!-- 工具栏：排序 + 折叠展开 -->
      <div class="outline-toolbar">
        <div class="outline-sort">
          <button
            v-for="opt in SORT_OPTIONS"
            :key="opt.value"
            class="outline-sort-btn"
            :class="{ 'is-active': sortMode === opt.value }"
            type="button"
            @click="sortMode = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <div class="outline-toolbar-actions">
          <button class="outline-toolbar-btn" type="button" title="全部展开" @click="expandAll">
            <AppIcon name="plus" :size="13" />
          </button>
          <button class="outline-toolbar-btn" type="button" title="全部折叠" @click="collapseAll">
            <AppIcon name="minus" :size="13" />
          </button>
        </div>
      </div>

      <!-- 分组树形列表 -->
      <div class="outline-scroll transient-scrollbar" @scroll.passive="handleScroll">
        <div v-if="filteredSections.length === 0" class="outline-empty">
          <AppIcon name="search" :size="32" />
          <p>没有匹配「{{ searchQuery }}」的文档</p>
        </div>

        <div v-else class="outline-sections">
          <section
            v-for="section in filteredSections"
            :key="section.id"
            class="outline-section"
            :class="{ 'is-collapsed': collapsedSections[section.id] }"
          >
            <!-- 分组头 -->
            <button
              class="outline-section-head"
              type="button"
              :aria-expanded="!collapsedSections[section.id]"
              @click="toggleSection(section.id)"
            >
              <AppIcon class="outline-chevron" name="chevron" :size="12" />
              <AppIcon :name="section.icon" :size="15" />
              <span class="outline-section-label">{{ section.label }}</span>
              <span class="outline-section-count">{{ section.nodes.length }}</span>
            </button>

            <!-- 文档节点列表 -->
            <ul v-if="!collapsedSections[section.id]" class="outline-nodes">
              <li v-for="node in section.nodes" :key="node.relPath" class="outline-node">
                <button
                  class="outline-node-row"
                  :class="{ 'is-selected': isSelected(node.relPath) }"
                  type="button"
                  :title="node.title"
                  @click="activateDoc(node)"
                >
                  <AppIcon :name="section.icon" :size="14" class="outline-node-icon" />
                  <span class="outline-node-title">{{ node.title }}</span>
                  <span class="outline-node-chars">{{ formatChars(node.chars) }}</span>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <!-- 底部快捷键提示 -->
      <footer class="outline-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> 浏览</span>
        <span><kbd>↵</kbd> 打开</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.outline-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
}

.outline-panel {
  position: absolute;
  top: 0;
  left: 0;
  width: 400px;
  max-width: 85vw;
  height: 100vh;
  display: grid;
  grid-template-rows: auto auto auto auto 1fr auto;
  background: var(--sidebar, var(--surface-main, #1e1e2a));
  border-right: 1px solid var(--line, rgba(255, 255, 255, 0.08));
  box-shadow: var(--shadow-lg, 0 16px 48px rgba(0, 0, 0, 0.4));
}

/* —— 标题栏 —— */
.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line-soft, rgba(255, 255, 255, 0.06));
}

.outline-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary, #e8e8e8);
  font-size: 1rem;
  font-weight: 600;
}

.outline-header-title svg {
  color: var(--accent, #4a76c4);
}

.outline-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary, #777);
  cursor: pointer;
}

.outline-close:hover {
  background: var(--hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, #e8e8e8);
}

/* —— 统计 —— */
.outline-stats {
  display: flex;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line-soft, rgba(255, 255, 255, 0.04));
}

.outline-stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary, #777);
}

.outline-stat-item svg {
  color: var(--text-muted, #666);
}

/* —— 搜索框 —— */
.outline-search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 12px 6px;
  padding: 7px 10px;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: var(--surface-raised, rgba(255, 255, 255, 0.03));
}

.outline-search-wrap:focus-within {
  border-color: var(--accent, #4a76c4);
}

.outline-search-icon {
  color: var(--text-tertiary, #777);
  flex-shrink: 0;
}

.outline-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary, #e8e8e8);
  font-size: 13px;
  padding: 2px 0;
}

.outline-search-input::placeholder {
  color: var(--text-muted, #555);
}

/* —— 工具栏 —— */
.outline-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px 8px;
}

.outline-sort {
  display: flex;
  gap: 4px;
}

.outline-sort-btn {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-tertiary, #777);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  cursor: pointer;
}

.outline-sort-btn:hover {
  color: var(--text-secondary, #bbb);
}

.outline-sort-btn.is-active {
  color: var(--accent, #4a76c4);
  border-color: var(--accent, #4a76c4);
  background: color-mix(in srgb, var(--accent, #4a76c4) 10%, transparent);
}

.outline-toolbar-actions {
  display: flex;
  gap: 2px;
}

.outline-toolbar-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary, #777);
  cursor: pointer;
}

.outline-toolbar-btn:hover {
  background: var(--hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, #e8e8e8);
}

/* —— 滚动区 —— */
.outline-scroll {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 8px;
  overscroll-behavior: contain;
}

/* —— 空态 —— */
.outline-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  color: var(--text-tertiary, #777);
  text-align: center;
}

.outline-empty p {
  font-size: 13px;
  margin: 0;
}

.outline-empty svg {
  opacity: 0.5;
}

/* —— 分组 —— */
.outline-sections {
  display: grid;
  gap: 2px;
  padding: 2px 0 16px;
}

.outline-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  padding: 5px 8px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary, #e8e8e8);
  font-size: 0.892857rem;
  font-weight: 620;
  text-align: left;
  cursor: pointer;
}

.outline-section-head:hover {
  background: var(--hover, rgba(255, 255, 255, 0.04));
}

.outline-chevron {
  flex-shrink: 0;
  color: var(--text-tertiary, #777);
  transform: rotate(90deg);
  transition: transform 140ms ease;
}

.outline-section.is-collapsed .outline-chevron {
  transform: rotate(0);
}

.outline-section-label {
  overflow: hidden;
  min-width: 0;
  flex: 0 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-section-count {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-tertiary, #777);
  font-size: 10px;
  font-weight: 500;
  margin-left: auto;
}

/* —— 文档节点列表 —— */
.outline-nodes {
  display: grid;
  gap: 1px;
  position: relative;
  margin: 2px 0 4px 18px;
  padding-left: 9px;
  border-left: 1px solid var(--line, rgba(255, 255, 255, 0.08));
}

.outline-node-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 3px 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #bbb);
  font-size: 0.857143rem;
  text-align: left;
  cursor: pointer;
}

.outline-node-row:hover {
  background: var(--hover, rgba(255, 255, 255, 0.04));
  color: var(--text-primary, #e8e8e8);
}

.outline-node-row.is-selected {
  color: var(--accent, #4a76c4);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent, #4a76c4) 8%, transparent);
}

.outline-node-row.is-selected .outline-node-chars {
  color: var(--accent, #4a76c4);
  opacity: 0.7;
}

.outline-node-icon {
  flex-shrink: 0;
  color: var(--text-secondary, #999);
}

.outline-node-row.is-selected .outline-node-icon {
  color: var(--accent, #4a76c4);
}

.outline-node-title {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-node-chars {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted, #555);
  font-variant-numeric: tabular-nums;
}

/* —— 底部 —— */
.outline-footer {
  display: flex;
  gap: 14px;
  padding: 8px 16px;
  border-top: 1px solid var(--line-soft, rgba(255, 255, 255, 0.06));
  font-size: 10px;
  color: var(--text-tertiary, #777);
}

.outline-footer kbd {
  display: inline-block;
  padding: 1px 4px;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
  border-radius: 3px;
  margin: 0 2px;
  font-size: 10px;
  font-family: inherit;
}
</style>

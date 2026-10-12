<!-- 大纲/思维导图视图：以浮层方式展示全部文档的结构化大纲，可折叠展开、搜索、排序。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, toRef } from "vue";
import type { BookKind, DocRef } from "@mochen/contracts";
import { storeToRefs } from "pinia";
import type { IconName } from "../types/icons";
import AppIcon from "./AppIcon.vue";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { stepNavNode, visibleNavNodes } from "../utils/outline-navigation";
import { imeOwnsKey } from "../utils/slash-commands";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "../utils/book-kinds";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";
import { formatCharCount } from "../utils/char-count";

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
/** ↑↓ 游标当前停在哪一枚节点上；`null` = 焦点还没进节点列表（还在搜索框）。 */
const cursorPath = ref<string | null>(null);

// 面板每次打开都从"没有游标"起：上一次的焦点位置不该决定这一次 ↓ 落在哪。
watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      setTimeout(() => inputRef.value?.focus(), 50);
      cursorPath.value = null;
    } else {
      searchQuery.value = "";
      collapsedSections.value = {};
    }
  }
);

// —— 排序方式 ——
type SortMode = "order" | "chars";
const sortMode = ref<SortMode>("order");
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "order", label: "章节顺序" },
  { value: "chars", label: "按字数" }
];

function sortDocs(items: DocRef[], mode: SortMode): DocRef[] {
  /*
   * 原先这里还有第三档「按类型」：点下去 `sortDocs` 走的是「原样返回」那条路，
   * 而列表本来就按 `BOOK_KIND_ORDER` 分节渲染——那一枚按钮什么也不改变，是枚假控件
   * （2026-10-09 扫描总单「假控件」大纲那一行，摘掉而不是再补一层空转的排序）。
   * 「章节顺序」同样是原样返回，但它不是假档：`docs` 进这里之前已经按 `book.json`
   * 的 `chapterOrder` 排过（`useBookStore.sortDocsByOrder`），"不另排"正是它承诺的行为。
   */
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

// —— ↑↓ 浏览（页脚那句提示的真身，2026-10-09 接上） ——
/*
 * 「往哪儿走」的算术住在 `utils/outline-navigation`（纯函数，那边有 9 条用例）；
 * 这里只做两件事：把算出来的那一枚节点拿到焦点、滚进视野，以及把焦点已经在哪个节点上告诉算术。
 * ↵ 不用另写：每个节点本来就是 `<button>`，拿到焦点后回车/空格由浏览器自己派发 click。
 */
const nodeEls = new Map<string, HTMLElement>();

function setNodeRef(relPath: string, el: unknown): void {
  if (el instanceof HTMLElement) nodeEls.set(relPath, el);
  else nodeEls.delete(relPath);
}

const navNodes = computed(() => visibleNavNodes(filteredSections.value, collapsedSections.value));

function focusNode(relPath: string): void {
  const el = nodeEls.get(relPath);
  if (el === undefined) return;
  cursorPath.value = relPath;
  el.focus();
  el.scrollIntoView({ block: "nearest" });
}

/** 走一步；`false` = 没处可去（全部折叠、或空列表），这时连按键都不该吞掉。 */
function moveCursor(delta: 1 | -1): boolean {
  const next = stepNavNode(navNodes.value, cursorPath.value, delta);
  if (next === null) return false;
  focusNode(next);
  return true;
}

/**
 * ↑↓ 走大纲节点。闸口与 `SearchPanel` 同一条：中文输入法组合态里那一下方向键是**在选候选词**，
 * 不是浏览大纲——判据用 `imeOwnsKey` 那一份，组件里不许散写（ime-guard-wiring 有全仓普查守卫）。
 */
function onPanelKeydown(event: KeyboardEvent): void {
  if (imeOwnsKey(event)) return;
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const delta = event.key === "ArrowDown" ? 1 : -1;
  if (moveCursor(delta)) event.preventDefault();
}

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

// —— 拖拽排序 ——
// 这一层**没有**拖拽：章节次序的拖拽住在 `LeftSidebar.vue`（那边调 `book.moveChapterByRelPath`，
// 先落 `book.json` 的 `chapterOrder` 再上屏）。原先这里留着两句"视觉占位"的注释，
// 既没有 `draggable` 也没有 drop 处理，读代码的人会以为大纲里能拖动排序——注释已按事实改掉。
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
      @keydown="onPanelKeydown"
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
          {{ formatCharCount(totalWords) }}
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
                  :ref="(el) => setNodeRef(node.relPath, el)"
                  class="outline-node-row"
                  :class="{ 'is-selected': isSelected(node.relPath) }"
                  type="button"
                  :title="node.title"
                  @focus="cursorPath = node.relPath"
                  @click="activateDoc(node)"
                >
                  <AppIcon :name="section.icon" :size="14" class="outline-node-icon" />
                  <span class="outline-node-title">{{ node.title }}</span>
                  <span class="outline-node-chars">{{ formatCharCount(node.chars) }}</span>
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
  font-size: 0.785714rem;
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
  font-size: 0.928571rem;
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
  font-size: 0.785714rem;
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
  font-size: 0.928571rem;
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
  /* 状态档底：箭头 `.outline-chevron` 与右侧计数 `.outline-section-count` 都是三级灰。
     判据见 composables/appearance-surface-ladder.test.ts。 */
  --text-tertiary: var(--text-on-state);
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
  font-size: 0.714286rem;
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
  /* 状态档底：行里两枚后代自己写着灰字——图标是二级、字数（`.outline-node-chars`）是 muted。
     `color:` 那一行只管得到这一行自己，管不到它们，所以升档走 shadow。
     判据见 composables/appearance-surface-ladder.test.ts。 */
  --text-secondary: var(--text-on-state);
  --text-muted: var(--text-on-state);
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
  font-size: 0.714286rem;
  color: var(--text-muted, #555);
  font-variant-numeric: tabular-nums;
}

/* —— 底部 —— */
.outline-footer {
  display: flex;
  gap: 14px;
  padding: 8px 16px;
  border-top: 1px solid var(--line-soft, rgba(255, 255, 255, 0.06));
  font-size: 0.714286rem;
  color: var(--text-tertiary, #777);
}

.outline-footer kbd {
  display: inline-block;
  padding: 1px 4px;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
  border-radius: 3px;
  margin: 0 2px;
  font-size: 0.714286rem;
  font-family: inherit;
}
</style>

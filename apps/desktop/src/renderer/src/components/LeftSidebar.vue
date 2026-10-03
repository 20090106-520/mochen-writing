<!-- 左栏：结构、类名与 transient 滚动条用法取自 deepwrite（Apache-2.0）的 LeftSidebar.vue / TreeSection.vue / TreeNodeItem.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { BookKind } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import AppIcon from "./AppIcon.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "../utils/book-kinds";
import { CLEAR_VIEW_SENTENCE, threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";

const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();
const layout = useLayoutStore();
const agent = useAgentStore();

// 图标是渲染资产不是业务枚举（设计决定 6）：标签/顺序来自 utils/book-kinds 唯一表，这里只留 icon。
const KIND_ICON: Record<BookKind, IconName> = {
  chapter: "book",
  outline: "list",
  character: "user",
  plot: "ledger",
  material: "library"
};

const sections = computed(() =>
  BOOK_KIND_ORDER.map((kind) => ({
    id: kind,
    label: BOOK_KIND_LABELS[kind],
    icon: KIND_ICON[kind],
    nodes: book.docs.filter((doc) => doc.kind === kind)
  })).filter((section) => section.nodes.length > 0)
);

const collapsedSections = ref<Record<string, boolean>>({});

function toggleSection(id: string): void {
  collapsedSections.value[id] = !collapsedSections.value[id];
}

function isSelected(relPath: string): boolean {
  return book.activeDocTab === relPath || book.activeBrowse === relPath;
}

// 章节进文稿标签；其他一律只浏览——浏览不动 docTabs 与草稿（store 有测试守着）。
function activate(kind: BookKind, relPath: string): void {
  const ref = book.refOf(relPath);
  if (!ref) return;
  if (kind === "chapter") void book.openDocTab(relPath);
  else book.browse(ref);
}

const sidebarScrollbar = createTransientScrollbarController();
function handleSidebarScroll(event: Event): void {
  const element = event.currentTarget;
  if (element instanceof HTMLElement) sidebarScrollbar.reveal(element);
}
onBeforeUnmount(() => sidebarScrollbar.dispose());

async function pickBook(): Promise<void> {
  await book.pickAndOpen();
}

// 段②：与中栏头部两处入口同一个真身（设计决定 2 之后 showSettings 是唯一路径）。
function openModelSettings(): void {
  layout.showSettings();
}

// 段③：只清渲染层视图，不碰 JSONL、不碰主进程 pending —— clearThreadView 的真实边界。
// 渲染层这一份提案视图确实会随本页清空（store 会给出带条数的警告文案），动不到的只有主进程那一份。
function newThreadForActiveChapter(): void {
  agent.clearThreadView(threadKeyFor(book.activeDocTab));
}
</script>

<template>
  <aside class="left-sidebar" aria-label="墨宸 AI 导航与文稿树">
    <header class="sidebar-brand-row">
      <span class="brand-button">
        <span class="brand-mark"><img :src="brandMark" alt="" width="27" height="27" /></span>
        <span class="brand-name">墨宸 AI</span>
      </span>
      <button class="icon-button" type="button" aria-label="收起左侧栏" @click="emit('collapse')">
        <AppIcon name="panel-left" :size="18" />
      </button>
    </header>

    <nav class="primary-nav new-book-nav" aria-label="主操作">
      <button class="nav-row" type="button" data-nav-id="open-book" @click="pickBook">
        <AppIcon name="directory" :size="17" />
        <span>打开作品目录</span>
        <kbd>Ctrl O</kbd>
      </button>
      <button class="nav-row" type="button" data-nav-id="model-config" @click="openModelSettings">
        <AppIcon name="settings" :size="17" />
        <span>模型配置</span>
      </button>
      <button
        class="nav-row"
        type="button"
        data-nav-id="new-thread"
        :disabled="book.activeDocTab === null"
        :title="CLEAR_VIEW_SENTENCE"
        @click="newThreadForActiveChapter"
      >
        <AppIcon name="plus" :size="17" />
        <span>{{ book.activeDocTab === null ? "本章新对话（先打开一章）" : "本章新对话" }}</span>
      </button>
    </nav>

    <div class="sidebar-scroll transient-scrollbar" @scroll.passive="handleSidebarScroll">
      <div class="resource-list">
        <section
          v-for="section in sections"
          :key="section.id"
          class="resource-section"
          :class="{ 'is-collapsed': collapsedSections[section.id] }"
        >
          <div class="resource-section-heading">
            <button
              class="section-toggle"
              type="button"
              :aria-expanded="!collapsedSections[section.id]"
              :aria-label="
                collapsedSections[section.id] ? `展开${section.label}` : `折叠${section.label}`
              "
              @click="toggleSection(section.id)"
            >
              <AppIcon :name="section.icon" :size="15" />
              <span>{{ section.label }}</span>
              <AppIcon class="section-toggle-chevron" name="chevron" :size="13" />
            </button>
          </div>

          <ul
            v-if="!collapsedSections[section.id]"
            class="resource-tree"
            :aria-label="`${section.label}下的内容`"
          >
            <li v-for="node in section.nodes" :key="node.relPath" class="tree-node">
              <button
                class="tree-row"
                :class="{ 'is-selected': isSelected(node.relPath) }"
                :style="{ '--tree-depth': 0 }"
                type="button"
                :data-resource-id="node.relPath"
                :title="node.title"
                @click="activate(section.id, node.relPath)"
              >
                <AppIcon :name="section.icon" :size="15" />
                <span class="tree-label">{{ node.title }}</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </aside>
</template>

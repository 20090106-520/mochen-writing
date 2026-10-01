<!-- 左栏：结构、类名与 transient 滚动条用法取自 deepwrite（Apache-2.0）的 LeftSidebar.vue / TreeSection.vue / TreeNodeItem.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { BookKind } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import AppIcon from "./AppIcon.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { useBookStore } from "../stores/useBookStore";

const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();

const KIND_META: Record<BookKind, { label: string; icon: IconName }> = {
  chapter: { label: "章节", icon: "book" },
  outline: { label: "大纲", icon: "list" },
  character: { label: "人物", icon: "user" },
  plot: { label: "剧情", icon: "ledger" },
  material: { label: "素材库", icon: "library" }
};

const SECTION_ORDER: BookKind[] = ["chapter", "outline", "character", "plot", "material"];

const sections = computed(() =>
  SECTION_ORDER.map((kind) => ({
    id: kind,
    label: KIND_META[kind].label,
    icon: KIND_META[kind].icon,
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

    <nav class="primary-nav new-book-nav" aria-label="作品">
      <button class="nav-row" type="button" data-nav-id="open-book" @click="pickBook">
        <AppIcon name="directory" :size="17" />
        <span>打开作品目录</span>
        <kbd>Ctrl O</kbd>
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

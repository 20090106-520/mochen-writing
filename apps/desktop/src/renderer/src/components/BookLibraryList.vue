<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useBookStore } from "../stores/useBookStore";
import { bookDisplayTitle, uniqueRootPathLabels } from "../utils/book-path";
import { briefCharText } from "../utils/conversation-brief";

withDefaults(defineProps<{ variant?: "list" | "cards" }>(), { variant: "list" });

const book = useBookStore();

const searchQuery = ref("");
type SortMode = "recent" | "title" | "chars";
const sortMode = ref<SortMode>("recent");

const pathLabels = computed(() =>
  uniqueRootPathLabels(filteredBooks.value.map((entry) => entry.rootPath))
);

const filteredBooks = computed(() => {
  let list = book.recentBooks;
  const q = searchQuery.value.trim().toLowerCase();
  if (q !== "") list = list.filter((entry) => entry.title.toLowerCase().includes(q));
  if (sortMode.value === "title") {
    list = [...list].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  } else if (sortMode.value === "chars") {
    list = [...list].sort((a, b) => (b.totalChars ?? 0) - (a.totalChars ?? 0));
  }
  return list;
});

function progressText(entry: {
  chapterCount?: number;
  totalChars?: number;
  rootPath: string;
}): string {
  if (entry.rootPath === book.rootPath) {
    const chapters = book.docs.filter((doc) => doc.kind === "chapter").length;
    const chars = book.docs.reduce((sum, doc) => sum + (doc.chars ?? 0), 0);
    if (chapters === 0) return "";
    return `${chapters} 章 · ${briefCharText(chars)}`;
  }
  const cc = entry.chapterCount;
  const tc = entry.totalChars;
  if (cc === undefined && tc === undefined) return "";
  if (cc !== undefined && tc !== undefined) return `${cc} 章 · ${briefCharText(tc)}`;
  if (cc !== undefined) return `${cc} 章`;
  if (tc !== undefined) return briefCharText(tc);
  return "";
}

function openBook(rootPath: string): void {
  if (rootPath === book.rootPath) return;
  void book.openBook(rootPath);
}

function forget(event: MouseEvent, rootPath: string): void {
  event.stopPropagation();
  void book.forgetRecentBook(rootPath);
}
</script>

<template>
  <div class="book-library" :class="{ 'is-cards': variant === 'cards' }">
    <div v-if="book.recentBooks.length > 3" class="book-library-toolbar">
      <input
        v-model="searchQuery"
        class="book-library-search"
        type="text"
        placeholder="搜索作品…"
        aria-label="搜索作品"
      />
      <div class="book-library-sort">
        <button
          v-for="mode in ['recent', 'title', 'chars'] as SortMode[]"
          :key="mode"
          class="book-library-sort-btn"
          :class="{ 'is-active': sortMode === mode }"
          type="button"
          :aria-pressed="sortMode === mode"
          @click="sortMode = mode"
        >
          {{ mode === "recent" ? "最近" : mode === "title" ? "书名" : "字数" }}
        </button>
      </div>
    </div>
    <p v-if="book.recentBooks.length === 0" class="book-library-empty">
      还没有作品记录。新建或打开一本之后，会出现在这里。
    </p>
    <p v-else-if="filteredBooks.length === 0" class="book-library-empty">
      没有匹配「{{ searchQuery }}」的作品。
    </p>
    <ul v-else class="book-library-list" aria-label="作品库">
      <li
        v-for="(entry, index) in filteredBooks"
        :key="entry.rootPath"
        class="book-library-row"
        :class="{ 'is-current': entry.rootPath === book.rootPath }"
      >
        <button
          class="book-library-open"
          type="button"
          :title="`打开《${bookDisplayTitle(entry.title, entry.rootPath)}》\n${entry.rootPath}`"
          :aria-current="entry.rootPath === book.rootPath ? 'true' : undefined"
          @click="openBook(entry.rootPath)"
        >
          <span class="book-library-icon"><AppIcon name="book" :size="15" /></span>
          <span class="book-library-main">
            <span class="book-library-title">
              {{ bookDisplayTitle(entry.title, entry.rootPath) }}
            </span>
            <span class="book-library-meta">
              <span class="book-library-path" :title="entry.rootPath">{{ pathLabels[index] }}</span>
              <span v-if="progressText(entry)" class="book-library-progress">{{
                progressText(entry)
              }}</span>
            </span>
          </span>
          <span v-if="entry.rootPath === book.rootPath" class="book-library-state">正在写</span>
        </button>
        <button
          class="book-library-forget"
          type="button"
          :aria-label="`从作品库移除《${bookDisplayTitle(entry.title, entry.rootPath)}》（不删除文件）`"
          title="从作品库移除（不会删除书目录）"
          @click="forget($event, entry.rootPath)"
        >
          <AppIcon name="close" :size="13" />
        </button>
      </li>
    </ul>
  </div>
</template>

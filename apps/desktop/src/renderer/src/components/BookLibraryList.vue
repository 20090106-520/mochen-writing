<!--
  作品库（2026-10-21）。
  存在理由：用户原话「我的作品只能保存一个，不能创建其他的」——此前左栏那组只画**当前这本**的文稿树，
  换书只能靠 Ctrl+O 或「打开作品目录」再选一次目录，盘上写过哪几本在界面上没有任何入口。
  这一格把主进程记下的最近作品列出来：点一行就切过去，行尾 × 只从清单移除（不删盘上任何文件）。
  清单真身在主进程（book:recent），这里是只读镜像；store 里的 recentBooks 由 useBookStore 统一维护。
-->
<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useBookStore } from "../stores/useBookStore";
import { bookDisplayTitle, uniqueRootPathLabels } from "../utils/book-path";

withDefaults(defineProps<{ variant?: "list" | "cards" }>(), { variant: "list" });

const book = useBookStore();

/** 同名目录（两个「新建文件夹」）只给撞车的那几行多留一段路径，其余行不改口径。 */
const pathLabels = computed(() =>
  uniqueRootPathLabels(book.recentBooks.map((entry) => entry.rootPath))
);

/** 已经是当前这本就不再发一次 IPC；点当前行等于「我就在这本里」。 */
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
    <p v-if="book.recentBooks.length === 0" class="book-library-empty">
      还没有作品记录。新建或打开一本之后，会出现在这里。
    </p>
    <ul v-else class="book-library-list" aria-label="作品库">
      <li
        v-for="(entry, index) in book.recentBooks"
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
            <span class="book-library-path" :title="entry.rootPath">{{ pathLabels[index] }}</span>
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

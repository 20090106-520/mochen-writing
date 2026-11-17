<!-- 编辑器页脚左侧那半格（2026-11-16 从 DocumentPane.vue 搬出）。
     搬的理由是行数预算：DocumentPane 已贴 800 行上限，而这一格要新增本章读数胶囊。
     搬的是模板，不是判定：正文/阅读时长/目标三格的口径与保存状态一字未动。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { DocRef } from "@mochen/contracts";
import ChapterQuota from "./ChapterQuota.vue";
import StyleReadoutChips from "./StyleReadoutChips.vue";
import { useBookStore, type RightPaneMode } from "../stores/useBookStore";
import { chapterChipsOf } from "../utils/style-readout";

defineProps<{
  mode: RightPaneMode;
  characterCount: number;
  readingTimeLabel: string;
  activeDoc: DocRef | null;
  stateText: string;
}>();

const book = useBookStore();
/** 随草稿实时变：扫的是编辑器里这一篇的当前内容，不是盘上那份。 */
const chips = computed(() => chapterChipsOf(book.draft));
</script>

<template>
  <div class="editor-footer-meta">
    <template v-if="mode === 'manuscript'">
      <span>正文 {{ characterCount.toLocaleString("zh-CN") }} 字</span>
      <span class="reading-time">{{ readingTimeLabel }}</span>
      <ChapterQuota
        v-if="activeDoc?.kind === 'chapter'"
        :chars="characterCount"
        :rel-path="activeDoc?.relPath ?? ''"
      />
    </template>
    <!-- 批次 5-⑳：保存状态全栏只此一处（栏头那份已去掉，见上）。`is-dirty` 是从那边搬过来的：
         原来只有栏头那份会变色，去掉副本若不补上，「有未保存修改」就只剩字面变化、丢了告警色。 -->
    <span class="editor-save-status" :class="{ 'is-dirty': book.dirty }">
      {{ book.notice || stateText }}
    </span>
    <StyleReadoutChips v-if="mode === 'manuscript'" :chips="chips" />
  </div>
</template>

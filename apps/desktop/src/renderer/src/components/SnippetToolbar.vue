<!-- 右栏「插入 md 片段」工具栏（从 DocumentPane.vue 抽出：纯渲染，判定住在 utils/markdown-snippets.ts）。 -->
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import type { SnippetKind, SnippetToolbarView } from "../utils/markdown-snippets";

/** 整份视图状态（含 visible）由 snippetToolbarState 算好：浏览与作品资料态连容器都不渲染。 */
defineProps<{ state: SnippetToolbarView }>();
const emit = defineEmits<{ pick: [kind: SnippetKind] }>();
</script>

<template>
  <div v-if="state.visible" class="editor-text-tools" role="group" aria-label="插入 md 片段">
    <button
      v-for="btn in state.buttons"
      :key="btn.kind"
      class="format-button"
      type="button"
      :aria-label="btn.label"
      :disabled="btn.disabled"
      :title="btn.title"
      @mousedown.prevent
      @click="emit('pick', btn.kind)"
    >
      <!-- #113a：按钮上画字形，中文标签退居可及名（灰态的 title 是空串，没有 aria-label 就读屏只剩一句「按钮」）。
           @mousedown.prevent 照搬 deepwrite 的 .text-tool-button：按下别抢走 textarea 的焦点与选区。 -->
      <AppIcon :name="btn.icon" :size="16" />
    </button>
    <!-- 复审 I-1：禁用理由必须是**看得见的**一行——Chromium 不给 disabled 按钮弹 title。
         文案的唯一真身在 utils/markdown-snippets.ts，这里只负责显示（铁律 6）。 -->
    <p v-if="state.hint" class="editor-tools-hint">{{ state.hint }}</p>
  </div>
</template>

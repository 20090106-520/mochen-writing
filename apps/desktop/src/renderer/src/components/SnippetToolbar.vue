<!-- 右栏「插入 md 片段」工具栏（从 DocumentPane.vue 抽出：纯渲染，判定住在 utils/markdown-snippets.ts）。 -->
<script setup lang="ts">
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
      :disabled="btn.disabled"
      :title="btn.title"
      @click="emit('pick', btn.kind)"
    >
      {{ btn.label }}
    </button>
  </div>
</template>

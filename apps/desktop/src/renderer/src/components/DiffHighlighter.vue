<!-- Diff 高亮渲染器：对提案卡 diff 文本做行级着色 -->
<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  diff: string;
}>();

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  text: string;
}

const lines = computed<DiffLine[]>(() => {
  return props.diff.split("\n").map((line) => {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      return { type: "header", text: line };
    }
    if (line.startsWith("+")) {
      return { type: "add", text: line.slice(1) };
    }
    if (line.startsWith("-")) {
      return { type: "remove", text: line.slice(1) };
    }
    return { type: "context", text: line };
  });
});
</script>

<template>
  <div class="diff-highlight">
    <div v-for="(line, i) in lines" :key="i" :class="['diff-line', `is-${line.type}`]">
      <span class="diff-gutter">
        <span v-if="line.type === 'add'" class="diff-marker">+</span>
        <span v-else-if="line.type === 'remove'" class="diff-marker">−</span>
        <span v-else-if="line.type === 'header'" class="diff-marker">·</span>
      </span>
      <span class="diff-text">{{ line.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.diff-highlight {
  /* 排版与外距沿用原 styles/agent-pane.css 的 .proposal-diff 规则（迁移过来，
     换渲染器不换版式）：硬编码色值只留给 diff 的增删语义色，不碰主题 token。 */
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.7;
  max-height: 300px;
  margin: 10px 12px;
  overflow: auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--editor) 82%, transparent);
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.diff-line {
  display: flex;
  min-height: 20px;
}

.diff-line.is-add {
  background: rgba(80, 200, 120, 0.08);
}

.diff-line.is-remove {
  background: rgba(240, 96, 96, 0.08);
}

.diff-line.is-header {
  background: rgba(108, 158, 255, 0.06);
  color: var(--accent, #6c9eff);
}

.diff-gutter {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-light, rgba(255, 255, 255, 0.04));
  user-select: none;
}

.diff-marker {
  font-weight: 600;
  font-size: 11px;
}

.is-add .diff-marker {
  color: #50c878;
}

.is-remove .diff-marker {
  color: #f06060;
}

.is-header .diff-marker {
  color: var(--accent, #6c9eff);
  opacity: 0.6;
}

.diff-text {
  flex: 1;
  padding: 1px 8px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary, #bbb);
}

.is-add .diff-text {
  color: #c8e6c9;
}

.is-remove .diff-text {
  color: #f5c6cb;
}

.is-header .diff-text {
  color: var(--accent, #6c9eff);
  opacity: 0.7;
  font-style: italic;
}
</style>

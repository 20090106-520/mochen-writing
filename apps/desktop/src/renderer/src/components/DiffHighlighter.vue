<!-- Diff 高亮渲染器：对 diff 文本做行级着色（提案卡与改稿历史的逐行对比共用它） -->
<script setup lang="ts">
import { computed } from "vue";
// 行级分类的真身在 utils/diff-lines.ts：改稿历史头部那句「新增几行、删除几行」数的是同一份，
// 这里再抄一遍判断就是第二份判据（铁律 6）——两处一旦分家，染绿的行数与报出的行数会打起来。
import { parseDiffLines } from "../utils/diff-lines";

const props = defineProps<{
  diff: string;
}>();

const lines = computed(() => parseDiffLines(props.diff));
</script>

<template>
  <div class="diff-highlight">
    <div v-for="(line, i) in lines" :key="i" :class="['diff-line', `is-${line.type}`]">
      <span class="diff-gutter">
        <span v-if="line.type === 'add'" class="diff-marker">+</span>
        <span v-else-if="line.type === 'remove'" class="diff-marker">−</span>
        <span v-else-if="line.type === 'header'" class="diff-marker">·</span>
      </span>
      <span class="diff-text">
        <!-- 2026-10-22 逐字 diff：成对的改动行再切成「没变的 / 变了的」，
             只给变色那几段加底色——否则改一处字，看到的是一整行红配一整行绿。
             v-text 而不是插值：插值外层换行会在 pre-wrap 里变成一个真的空格。 -->
        <template v-if="line.segments">
          <span
            v-for="(seg, s) in line.segments"
            :key="s"
            :class="{ 'diff-frag': seg.changed }"
            v-text="seg.text"
          />
        </template>
        <span v-else v-text="line.text" />
      </span>
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
  font-size: 0.785714rem;
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

/* 逐字片段（2026-10-22）：整行底色仍标「这一行变了」，这一层只把真正动过的那几个字拎出来。
   色值沿用上面增删语义色，只提高不透明度——两套颜色会让同一处改动看起来是两回事。 */
.diff-frag {
  border-radius: 4px;
  background: rgba(80, 200, 120, 0.28);
}

.is-remove .diff-frag {
  background: rgba(240, 96, 96, 0.3);
  text-decoration: line-through;
  text-decoration-color: rgba(240, 96, 96, 0.55);
}
</style>

<!-- 写后自动体检卡（2026-11-17 spec 阶段 B5）：回合结束时，模型这一轮写过的篇自动过一遍
     去 AI 味 / 标点 / 重复句，只有真有问题才在对话流末尾摆这张紧凑卡。
     判据与文案的真身分别在 utils/auto-checkup.ts 与 useAutoCheckupStore——本组件只接线。
     「查看全部」打开的是左栏既有的书稿体检对话框（经 layout.libraryDialogRequest 一次性信号），
     不在这里复制第二份全书扫描。 -->
<script setup lang="ts">
import { computed } from "vue";
import { useAutoCheckupStore } from "../stores/useAutoCheckupStore";
import { useLayoutStore } from "../stores/layoutStore";
import type { AutoCheckupFinding } from "../utils/auto-checkup";

const props = defineProps<{ threadKey: string }>();

const store = useAutoCheckupStore();
const layout = useLayoutStore();

const findings = computed(() => store.findingsOf(props.threadKey));
const total = computed(() => findings.value.reduce((sum, one) => sum + one.total, 0));

/** 卡片只摊前三篇，其余在「查看全部」里看——自动的东西不许占满对话流。 */
const VISIBLE_DOCS = 3;

const rows = computed(() =>
  findings.value.slice(0, VISIBLE_DOCS).map((one) => ({
    relPath: one.docRelPath,
    title: one.title,
    detail: detailOf(one)
  }))
);

const hiddenCount = computed(() => Math.max(0, findings.value.length - VISIBLE_DOCS));

function detailOf(one: AutoCheckupFinding): string {
  const parts: string[] = [];
  if (one.aiFlavor.length > 0) parts.push(`AI 味 ${one.aiFlavor.length}`);
  if (one.punctuation.length > 0) parts.push(`标点 ${one.punctuation.length}`);
  if (one.duplicates.length > 0) parts.push(`重复句 ${one.duplicates.length}`);
  return parts.join(" · ");
}

function openAll(): void {
  layout.requestLibraryDialog("terms");
}

function dismiss(): void {
  store.dismiss(props.threadKey);
}
</script>

<template>
  <section v-if="total > 0" class="auto-checkup" aria-label="写后自动体检">
    <p class="auto-checkup-title">这一轮写完，自动体检发现 {{ total }} 处可以看看</p>
    <ul class="auto-checkup-list">
      <li v-for="row in rows" :key="row.relPath" class="auto-checkup-row">
        <span class="auto-checkup-doc">{{ row.title }}</span>
        <span class="auto-checkup-detail">{{ row.detail }}</span>
      </li>
    </ul>
    <p v-if="hiddenCount > 0" class="auto-checkup-more">还有 {{ hiddenCount }} 篇没列出来</p>
    <div class="auto-checkup-foot">
      <button class="auto-checkup-open" type="button" @click="openAll">查看全部</button>
      <button class="auto-checkup-dismiss" type="button" @click="dismiss">先不管</button>
    </div>
  </section>
</template>

<style scoped>
/* 与计划卡/工具卡同一族语言：发丝线 + 12px 圆角 + 半透明侧栏底。 */
.auto-checkup {
  margin: 10px 0 0;
  padding: 9px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: color-mix(in srgb, var(--sidebar) 42%, transparent);
}

.auto-checkup-title {
  margin-bottom: 6px;
  color: var(--text-soft);
  font-size: 0.785714rem;
}

.auto-checkup-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.auto-checkup-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.auto-checkup-doc {
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--text);
  font-size: 0.785714rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auto-checkup-detail {
  flex: none;
  color: var(--text-faint);
  font-size: 0.785714rem;
}

.auto-checkup-more {
  margin-top: 4px;
  color: var(--text-faint);
  font-size: 0.785714rem;
}

.auto-checkup-foot {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.auto-checkup-open,
.auto-checkup-dismiss {
  padding: 2px 9px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: transparent;
  color: var(--text-soft);
  font-size: 0.785714rem;
  cursor: pointer;
}

.auto-checkup-open:hover,
.auto-checkup-dismiss:hover {
  color: var(--text);
  border-color: var(--focus);
}

.auto-checkup-open:focus-visible,
.auto-checkup-dismiss:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>

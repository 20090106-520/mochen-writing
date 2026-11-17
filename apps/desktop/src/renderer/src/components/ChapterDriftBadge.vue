<!-- 章节列表的腔调偏离标（2026-11-16）。
     文字恒为「偏」，档位只改颜色：warn 用淡字、off 用告警色；悬停说明说清哪一维偏了多少。
     数据来自 useStyleReadoutStore（按盘上正文量，打开书后一次性扫描）。 -->
<script setup lang="ts">
import { computed, watch } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { useStyleReadoutStore } from "../stores/useStyleReadoutStore";

const props = defineProps<{ relPath: string }>();

const book = useBookStore();
const readout = useStyleReadoutStore();

watch(
  () => book.docs,
  (docs) => void readout.ensure(docs, book.rootPath),
  { immediate: true }
);

const mark = computed(() => readout.marks[props.relPath]);
</script>

<template>
  <span
    v-if="mark"
    class="tree-drift"
    :class="{ 'is-off': mark.severity === 'off' }"
    :title="mark.title"
    >偏</span
  >
</template>

<!-- 思考态空窗期那一行（批次 5-㊹）。
     存在的理由一句话：用户按了发送到第一个字到达之间，中栏原本**一个块都没有**，
     界面看着像没发出去——那是推理型 AI 最容易让人重复发一次的地方。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  ELAPSED_SHOW_AFTER_MS,
  thinkingWindowElapsedText,
  thinkingWindowLabel
} from "../utils/thinking-window";

const props = defineProps<{ open: boolean }>();

/**
 * 已经等了多少毫秒。**组件自己记**而不是从 store 取：
 * 这一段等待从来没有任何持久事件落盘（第一个字到达前什么都没有），
 * 想从数据里算就得往契约里加字段——那是为主动画去改持久化格式，不划算。
 */
const elapsedMs = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer(): void {
  stopTimer();
  startedAt = Date.now();
  elapsedMs.value = 0;
  timer = setInterval(() => {
    elapsedMs.value = Date.now() - startedAt;
  }, 200);
}

watch(
  () => props.open,
  (open) => {
    if (open) startTimer();
    else stopTimer();
  },
  { immediate: true }
);

onBeforeUnmount(stopTimer);

const label = computed(() => thinkingWindowLabel(elapsedMs.value));
const showElapsed = computed(() => elapsedMs.value >= ELAPSED_SHOW_AFTER_MS);
const elapsedText = computed(() => thinkingWindowElapsedText(elapsedMs.value));
</script>

<template>
  <!-- role=status + polite：这是「状态变了」，不是「打断用户」的那类播报。
       秒数那一格刻意 aria-hidden——它每秒变一次，留在 live region 里会把读屏用户淹掉。 -->
  <section v-if="open" class="thinking-window" role="status" aria-live="polite">
    <span class="thinking-window-dots" aria-hidden="true"><i /><i /><i /></span>
    <span class="thinking-window-label">{{ label }}…</span>
    <span v-if="showElapsed" class="thinking-window-elapsed" aria-hidden="true">{{
      elapsedText
    }}</span>
    <span class="sr-only">助手正在思考</span>
  </section>
</template>

<!-- 中栏四层流式渲染：类名沿用 deepwrite 的 message/message-body（见 ATTRIBUTION.md），卡片样式自有 -->
<script setup lang="ts">
import { computed } from "vue";
import type { AgentEvent } from "@mochen/contracts";
import { buildTimeline, type StreamingTail, type TimelineBlock } from "../utils/timeline";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ items: AgentEvent[]; tail: StreamingTail }>();
const blocks = computed<TimelineBlock[]>(() => buildTimeline(props.items, props.tail));
</script>

<template>
  <div class="agent-timeline">
    <section v-for="block in blocks" :key="block.id" class="agent-block" :data-kind="block.kind">
      <div v-if="block.kind === 'user'" class="user-line">
        <span class="user-tag">你</span>
        <p class="user-text">{{ block.text }}</p>
      </div>

      <details v-else-if="block.kind === 'thinking'" class="thinking-card" :open="block.streaming">
        <summary>
          <AppIcon name="brain" :size="15" />
          <span>思考摘要</span>
          <em v-if="block.interrupted" class="tail-flag">已打断</em>
          <em v-else-if="block.streaming" class="tail-flag is-live">正在想</em>
        </summary>
        <p class="thinking-text">{{ block.text }}</p>
      </details>

      <div v-else-if="block.kind === 'plan'" class="plan-card">
        <header class="card-head">
          <AppIcon name="list" :size="15" />
          <span>计划</span>
        </header>
        <ul class="plan-list">
          <li
            v-for="(item, index) in block.items"
            :key="`${block.id}-${index}`"
            :class="{ 'is-done': item.done }"
          >
            <AppIcon :name="item.done ? 'check' : 'minus'" :size="13" />
            <span>{{ item.text }}</span>
          </li>
        </ul>
      </div>

      <div v-else-if="block.kind === 'tool'" class="tool-card" :class="{ 'is-failed': !block.ok }">
        <header class="card-head">
          <AppIcon name="terminal" :size="15" />
          <span class="tool-label">{{ block.label }}</span>
          <em>{{ block.ok ? "完成" : "未通过" }}</em>
        </header>
        <p v-if="block.args" class="tool-args">{{ block.args }}</p>
        <pre v-if="block.resultText" class="tool-result">{{ block.resultText }}</pre>
      </div>

      <p v-else-if="block.kind === 'error'" class="error-line">{{ block.text }}</p>

      <p v-else-if="block.kind === 'interrupted'" class="interrupted-line">
        已打断 · {{ block.pending }} 条提案仍在等待审批
      </p>

      <div v-else class="message-line" :class="{ 'is-streaming': block.streaming }">
        <div class="message-body">
          <div class="message-content message-markdown">
            <p class="message-text">{{ block.text }}</p>
            <em v-if="block.interrupted" class="tail-flag">已打断</em>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

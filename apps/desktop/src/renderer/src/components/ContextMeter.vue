<!-- 上下文占用条 · 折叠态（spec §5「token 估算 + 已装配条目数」）。
     真身：主进程 agent:context-preview ——它与 startTurn 走同一条 assembleFor，
     所以这里显示的条目数与字数就是这一轮真会发出去的那些（两处各装一遍的话，占用条就是个骗人的装饰）。

     它存在的理由是「让人知道自己花了多少」：折叠态一句话（几条 · 约多少 tokens），
     展开态逐条列出装了什么（ContextMeterPanel）。装配不出任何东西时不显形——没开书、
     或当前档案什么都不装，空占一行还让人以为出了错。

     判定与文案全在 utils/context-meter.ts：.vue 只渲染与派发，不许在模板里数条目、取整或截断。
     样式不住这里：本仓 .vue 不写 style 段，全部进 styles/agent-pane.css（见 composer-card-wiring 契约）。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import ContextMeterPanel from "./ContextMeterPanel.vue";
import {
  contextMeterQuery,
  contextMeterQueryKey,
  contextMeterRows,
  contextMeterSummary
} from "../utils/context-meter";
// P1-3：历史这一格的判据只住在 utils/history-window.ts，这里只挂线（铁律 6）。
import { appendHistoryRow, historyNoticeText } from "../utils/history-window";
import { activeProfileOf } from "../utils/profile-options";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

const book = useBookStore();
const agent = useAgentStore();

const open = shallowRef(false);
const anchor = shallowRef<HTMLElement>();
// 串行的旧请求直接作废，免得旧档案的数字盖掉刚切的那一枚。
let inflight = 0;
// 声明必须在 watch 之前：immediate:true 会在声明之前就同步跑一次回调（TDZ）。
let timer = 0;

const source = computed(() => ({
  docRelPath: book.activeDocTab,
  // 书级当前档案；没设过就交 null，让主进程按 阶段 → 阶段默认 → 兜底 解析（与 startTurn 同一条路）。
  profileId: book.meta?.activeProfile ?? null,
  // 本线程显式挂入的技能 id —— 与 startTurn 用的是**同一个** `skillPathsOf`（2026-10-07 修）。
  // 原先这里写死 `[]`，于是占用条上那句「这一轮真会发出去的那些」在挂了技能时是**假的**：
  // 真发出去的那一轮带着技能，占用条一个字都不提。键里含 `...source.pinned`，
  // 所以挂入/取下都会自动重问，不必另盯一个字段。
  pinned: agent.skillPathsOf(threadKeyFor(book.activeDocTab))
}));
const key = computed(() => contextMeterQueryKey(source.value));
const summary = computed(() => contextMeterSummary(agent.contextPreview));
// 占用条把历史这一格算进去（P1-3）：不报历史的剩余预算是假的。判据在 util，这里只串。
const rows = computed(() =>
  appendHistoryRow(contextMeterRows(agent.contextPreview), agent.contextPreview)
);
const historyNotice = computed(() => historyNoticeText(agent.contextPreview));

async function refresh(): Promise<void> {
  const ticket = (inflight += 1);
  await agent.refreshContextPreview(contextMeterQuery(source.value));
  if (ticket !== inflight) return;
}

// 书里的文档增减、阶段默认档案变化都影响装了什么，但都不在这三个字段里：
// 所以除了 key，再盯住装配输入本身（rootPath / meta / docs / 解析出的档案 id）。
watch(
  () => [key.value, book.rootPath, book.meta, book.docs, activeProfileOf(book.meta).id],
  () => {
    // 200ms 静默窗：连着切几个标签时只问一次，不把 IPC 打成连珠炮。
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 200);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  window.clearTimeout(timer);
  open.value = false;
});

function toggle(event: MouseEvent): void {
  anchor.value = event.currentTarget as HTMLElement;
  open.value = !open.value;
}
</script>

<template>
  <button
    v-if="summary.visible"
    ref="anchor"
    class="composer-context-item context-meter"
    type="button"
    :title="summary.title"
    :aria-label="summary.title"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="toggle"
  >
    <AppIcon name="library" :size="16" />
    <span class="context-meter-text">{{ summary.text }}</span>
    <AppIcon class="context-chevron" name="chevron" :size="12" />
  </button>
  <ContextMeterPanel
    v-if="open && anchor"
    :anchor="anchor"
    :rows="rows"
    :profile-name="agent.contextPreview?.profileName ?? ''"
    :history-notice="historyNotice"
    @close="open = false"
  />
</template>

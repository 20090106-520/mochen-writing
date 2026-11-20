<!-- 上下文占用条 · 折叠态（spec §5「token 估算 + 已装配条目数」）。
     真身：主进程 agent:context-preview ——装配那一路与 startTurn 走同一条 assembleFor，
     历史那一路走同一个 historyStatFor，所以 chip 上的条数与字数**就是这一轮要发出去的两路合账**
     （两处各装一遍的话，占用条就是个骗人的装饰；只报装配那一路、把历史藏在展开态，
     是 2026-10-12 第二十二节抓到的那条口径分裂，已由清单第 1 项修掉）。
     要说清的边界：历史这一路按「预留为零」的上界报，真起一轮只会切得更狠，所以 chip 是上界，
     不是发票——这句话由 utils/context-meter.ts 组在 tooltip 里，组件不另写一遍。

     它存在的理由是「让人知道自己花了多少」：折叠态一句话（约多少 tokens，条数在 tooltip 与
     展开面板里——12em 装不下「N 条 · ≈M tokens」，见 utils/context-meter.ts 那处注释），
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
  contextMeterSummary,
  contextPressureReading
} from "../utils/context-meter";
// P1-3：历史这一格的判据只住在 utils/history-window.ts，这里只挂线（铁律 6）。
import { appendHistoryRow, historyNoticeText } from "../utils/history-window";
import { activeProfileOf } from "../utils/profile-options";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBibleExclusionStore } from "../stores/useBibleExclusionStore";
import { useBookStore } from "../stores/useBookStore";

const book = useBookStore();
const agent = useAgentStore();
const exclusion = useBibleExclusionStore();

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
  pinned: agent.skillPathsOf(threadKeyFor(book.activeDocTab)),
  // 本轮「不带」的设定（2026-11-20）：占用条必须按移除后的样子报，否则数字不是真会发出去的那份。
  // 键里含 `...source.excludedBible`，点掉/恢复一条就会自动重问，不必另盯一个字段。
  excludedBible: book.meta === null ? [] : exclusion.keysOf(book.meta.id)
}));
const key = computed(() => contextMeterQueryKey(source.value));
const summary = computed(() => contextMeterSummary(agent.contextPreview));
// 窗口压力那一行只住展开面板：折叠 chip 的横向额度是稀缺资源（见 composer-toolbar-overflow
// 那笔 13px 缺额摊成五枚省略号的实测），而百分比是给「点开想知道详情的人」看的。
const pressure = computed(() => contextPressureReading(agent.contextPreview));
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
    class="context-meter context-meter--compact"
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
    :pressure="pressure"
    :history-notice="historyNotice"
    @close="open = false"
  />
</template>

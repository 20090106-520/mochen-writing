/** * 存稿仪表（W-05）：整本书的章节状态、字数与最近改动，只读。 * *
【挂在哪】中栏稿件区顶部的写作工具组里多一枚「存稿仪表」按钮；这一层是标准模态 * （遮罩 +
`role="dialog"`，焦点与 Esc 走 useModalFocus），开在整屏之上，不占左/右栏的网格行。 * 与右栏
W-03「本章参考」/ W-04「交稿体检」的关系：那两件始终按「当前这一章」工作， *
本仪表始终按「整本书」工作；互不读写对方的状态，也不占用右栏高度。 * *
【状态从哪来】`utils/chapter-inventory.ts` 只用两样既有事实：扫描字数与逐章写作目标。 *
本仓没有「交稿/发布」这种既有事实，所以不设那一档、不给手动勾选——理由写在页脚。 * *
【状态存哪里】不存。档位与汇总每次打开时从 `book.docs` + 写作目标现算； *
最近改动从既有改稿历史（`.mochen/changes`）读一份快照。换书时 `docs`/目标整体换掉、 *
补读改稿历史，不会留下上一本书的读数；重开软件同样是重新现算，没有需要保留的本地状态。 */
<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { storeToRefs } from "pinia";
import { useBookStore } from "../stores/useBookStore";
import { useChapterInventoryStore } from "../stores/useChapterInventoryStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useWritingGoalStore } from "../stores/useWritingGoalStore";
import { useModalFocus } from "../composables/useModalFocus";
import AppIcon from "./AppIcon.vue";
import { formatCharCount } from "../utils/char-count";
import {
  chapterInventoryRows,
  chapterInventorySummary,
  INVENTORY_CHANGE_NOTE,
  INVENTORY_EMPTY_TEXT,
  INVENTORY_GOAL_NOTE,
  INVENTORY_NOTE
} from "../utils/chapter-inventory";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

const panelRoot = ref<HTMLElement>();
useModalFocus({
  root: panelRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.visible)
});

const book = useBookStore();
const goalStore = useWritingGoalStore();
const inventory = useChapterInventoryStore();
const layout = useLayoutStore();
const { docs, meta, activeDocTab, dirty } = storeToRefs(book);

watch(
  () => props.visible,
  (visible) => {
    if (visible) void inventory.loadChanges();
    else inventory.reset();
  },
  { immediate: true }
);

// 换书：改稿历史按书隔离，必须整份重读。令牌在 store 里，迟到的旧书回包不会盖上来。
watch(
  () => meta.value?.id,
  (id, previous) => {
    if (props.visible && id !== previous) void inventory.loadChanges();
  }
);

const rows = computed(() =>
  chapterInventoryRows({
    docs: docs.value,
    chapterOrder: meta.value?.chapterOrder ?? [],
    targetOf: (relPath) => goalStore.chapterTargetOf(relPath),
    // 读回包到达前先在空表上算：时间列显示「读取中…」，绝不拿上一本书的戳凑数。
    changes: inventory.loading ? [] : inventory.changes,
    activeDocTab: activeDocTab.value,
    dirty: dirty.value
  })
);

const summary = computed(() => chapterInventorySummary(rows.value, goalStore.goal.totalWordTarget));

function openChapter(relPath: string): void {
  void book.openDocTab(relPath);
  emit("close");
}

function goSetTotalTarget(): void {
  emit("close");
  layout.openWordCount();
}
</script>

<template>
  <div v-if="visible" class="ci-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="ci-panel"
      role="dialog"
      aria-modal="true"
      aria-label="存稿仪表"
      tabindex="-1"
    >
      <header class="ci-header">
        <h3>存稿仪表</h3>
        <span v-if="inventory.loading" class="ci-reading" role="status" aria-live="polite">
          正在读改稿记录…
        </span>
        <span v-else class="ci-readonly">只读</span>
        <button
          class="icon-btn"
          type="button"
          aria-label="关闭存稿仪表"
          title="关闭存稿仪表"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <p v-if="inventory.notice" class="ci-error" role="status" aria-live="polite">
        {{ inventory.notice }}
      </p>

      <div class="ci-stats">
        <div class="ci-stat">
          <span class="ci-stat-value">{{ formatCharCount(summary.totalChars) }}</span>
          <span class="ci-stat-label">总正文</span>
        </div>
        <div class="ci-stat">
          <span class="ci-stat-value">{{ summary.chapterCount }}</span>
          <span class="ci-stat-label">章节数（空稿 {{ summary.emptyCount }}）</span>
        </div>
        <div class="ci-stat">
          <span class="ci-stat-value">{{ formatCharCount(summary.avgChars) }}</span>
          <span class="ci-stat-label">平均章字数</span>
        </div>
        <div class="ci-stat">
          <span class="ci-stat-value">
            {{ summary.targetCount === 0 ? "—" : summary.reachedCount }}
          </span>
          <span class="ci-stat-label">
            {{
              summary.targetCount === 0 ? "未设章目标" : `已达标 / 设目标 ${summary.targetCount} 章`
            }}
          </span>
        </div>
      </div>

      <div class="ci-goal">
        <template v-if="summary.totalTarget > 0">
          <div class="ci-goal-head">
            <span>全书目标</span>
            <span class="ci-goal-pct">{{ summary.percent }}%</span>
          </div>
          <div class="ci-goal-bar">
            <div class="ci-goal-fill" :style="{ width: summary.percent + '%' }" />
          </div>
          <div class="ci-goal-numbers">
            <span
              >{{ formatCharCount(summary.totalChars) }} /
              {{ formatCharCount(summary.totalTarget) }}</span
            >
            <span v-if="summary.remaining !== null">
              {{
                summary.remaining === 0 ? "已达成" : `还差 ${formatCharCount(summary.remaining)}`
              }}
            </span>
          </div>
        </template>
        <div v-else class="ci-goal-unset">
          <span>全书目标未设——不编默认值。</span>
          <button class="ci-goal-link" type="button" @click="goSetTotalTarget">
            去字数统计设定
          </button>
        </div>
      </div>

      <p v-if="rows.length === 0" class="ci-empty">{{ INVENTORY_EMPTY_TEXT }}</p>

      <div v-else class="ci-list">
        <div
          v-for="row in rows"
          :key="row.relPath"
          class="ci-row"
          :class="{ 'is-current': row.current }"
        >
          <span class="ci-chip" :class="row.tone">{{ row.statusLabel }}</span>
          <div class="ci-row-main">
            <button
              class="ci-row-title"
              type="button"
              :title="`打开 ${row.title}`"
              @click="openChapter(row.relPath)"
            >
              {{ row.title }}
              <span v-if="row.current" class="ci-current">当前</span>
            </button>
            <span class="ci-row-meta">
              <template v-if="row.status === 'empty'">还没落正文</template>
              <template v-else-if="row.status === 'untargeted'">未设章目标</template>
              <template v-else-if="row.status === 'writing'">
                目标 {{ formatCharCount(row.target) }} · 还差 {{ formatCharCount(row.gap) }}
              </template>
              <template v-else>目标 {{ formatCharCount(row.target) }} · 已达成</template>
            </span>
          </div>
          <span class="ci-row-chars">{{ formatCharCount(row.chars) }}</span>
          <span class="ci-row-when" :title="row.lastChangeLabel">
            <template v-if="row.unsaved">未保存的改动</template>
            <template v-else-if="row.lastChange === '' && inventory.loading">读取中…</template>
            <template v-else>{{ row.lastChangeLabel }}</template>
          </span>
        </div>
      </div>

      <footer class="ci-foot">
        <p>{{ INVENTORY_NOTE }}</p>
        <p>{{ INVENTORY_CHANGE_NOTE }}</p>
        <p>{{ INVENTORY_GOAL_NOTE }}</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ci-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-drawer);
}

.ci-panel {
  width: 640px;
  max-width: 92vw;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  padding: 16px;
  overflow: hidden;
}

.ci-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ci-header h3 {
  margin: 0;
  font-size: 1.071429rem;
  color: var(--text-primary, #e8e8e8);
}

.ci-readonly,
.ci-reading {
  font-size: 0.785714rem;
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
}

.ci-header .icon-btn {
  margin-left: auto;
}

.ci-error {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--danger, #e0556e);
  border-radius: 6px;
  color: var(--danger, #e0556e);
  font-size: 0.785714rem;
}

.ci-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.ci-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: var(--surface-raised, rgba(255, 255, 255, 0.03));
}

.ci-stat-value {
  font-size: 1.071429rem;
  color: var(--text-primary, #e8e8e8);
}

.ci-stat-label {
  font-size: 0.785714rem;
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
}

.ci-goal {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ci-goal-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.857143rem;
  color: var(--text-secondary, rgba(232, 232, 232, 0.65));
}

.ci-goal-pct {
  color: var(--accent, #c9a86a);
}

.ci-goal-bar {
  height: 6px;
  border-radius: 4px;
  background: var(--border, rgba(255, 255, 255, 0.08));
  overflow: hidden;
}

.ci-goal-fill {
  height: 100%;
  background: var(--accent, #c9a86a);
}

.ci-goal-numbers {
  display: flex;
  justify-content: space-between;
  font-size: 0.785714rem;
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
}

.ci-goal-unset {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.857143rem;
  color: var(--text-secondary, rgba(232, 232, 232, 0.65));
}

.ci-goal-link {
  padding: 2px 8px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 6px;
  background: none;
  color: var(--accent, #c9a86a);
  font-size: 0.785714rem;
  cursor: pointer;
}

.ci-goal-link:hover {
  background: var(--surface-raised, rgba(255, 255, 255, 0.05));
}

.ci-empty {
  margin: 0;
  padding: 16px 0;
  text-align: center;
  font-size: 0.857143rem;
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
}

.ci-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
}

.ci-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.06));
}

.ci-row:last-child {
  border-bottom: none;
}

.ci-row.is-current {
  background: var(--accent-soft, rgba(201, 168, 106, 0.08));
}

.ci-chip {
  flex: none;
  min-width: 56px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.785714rem;
  text-align: center;
}

.ci-chip.is-empty {
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
  background: rgba(255, 255, 255, 0.05);
}

.ci-chip.is-plain {
  color: var(--text-secondary, rgba(232, 232, 232, 0.65));
  background: rgba(255, 255, 255, 0.08);
}

.ci-chip.is-writing {
  color: var(--warning, #d9964a);
  background: rgba(217, 150, 74, 0.14);
}

.ci-chip.is-done {
  color: var(--success, #5aa87c);
  background: rgba(90, 168, 124, 0.14);
}

.ci-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ci-row-title {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-primary, #e8e8e8);
  font-size: 0.928571rem;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.ci-row-title:hover {
  color: var(--accent, #c9a86a);
}

.ci-current {
  margin-left: 6px;
  font-size: 0.714286rem;
  color: var(--accent, #c9a86a);
}

.ci-row-meta {
  font-size: 0.785714rem;
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
}

.ci-row-chars {
  flex: none;
  width: 84px;
  text-align: right;
  font-size: 0.857143rem;
  color: var(--text-secondary, rgba(232, 232, 232, 0.65));
}

.ci-row-when {
  flex: none;
  width: 108px;
  text-align: right;
  font-size: 0.785714rem;
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ci-foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  padding-top: 8px;
}

.ci-foot p {
  margin: 0;
  font-size: 0.785714rem;
  line-height: 1.5;
  color: var(--text-tertiary, rgba(232, 232, 232, 0.45));
}
</style>

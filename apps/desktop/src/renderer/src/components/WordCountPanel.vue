<!-- 字数统计看板：作品字数总览 + 章节分布 + 写作进度 -->
<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { storeToRefs } from "pinia";
import { useBookStore } from "../stores/useBookStore";
import { useWritingGoalStore } from "../stores/useWritingGoalStore";
import { useModalFocus } from "../composables/useModalFocus";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

/**
 * 焦点与 Esc 的真身在 useModalFocus（批次 5-㊲）。
 * 这一层是整屏遮罩 + role="dialog"，功能上就是模态层；真机量测（p536g）实测六处一模一样：
 * 焦点从不在层内、Esc 一次也收不掉（连 OutlinePanel 那一处 @keydown.esc 也够不着——
 * 它挂在搜索框上，而焦点压根没进过面板）。
 * Esc 与焦点进出统一由那一处接管，本组件不再留第二份判定。
 */
const panelRoot = ref<HTMLElement>();
useModalFocus({
  root: panelRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.visible)
});

const book = useBookStore();
const goalStore = useWritingGoalStore();
const { docs } = storeToRefs(book);

interface ChapterStat {
  title: string;
  relPath: string;
  chars: number;
  percentage: number;
}

/**
 * 章节字数分布。
 *
 * **读 `DocRef.chars`，不是 `.content`**（2026-10-06 真机撞出来的）：
 * `DocRef` 只有 `excerpt` / `chars` / `relPath` / `kind` / `title`——**没有 `content`**。
 * 原先写的是 `c.content ?? ""`，于是每章都算成 0 字、全书总正文永远是「0 字」，
 * 而面板看上去一切正常（不报错、不空、只是恒为 0）。
 * `scan` 那一趟已经把每篇的正文字数算好带出来了，口径与 `proseCharCount` 的非空白码点一致，
 * 消费处按契约写 `?? 0`。**顺带省掉每篇一次 readFile。**
 */
const chapterStats = computed<ChapterStat[]>(() => {
  const chapters = docs.value.filter((d) => d.kind === "chapter");
  const total = chapters.reduce((sum, c) => sum + (c.chars ?? 0), 0);
  return chapters.map((c) => {
    const chars = c.chars ?? 0;
    return {
      title: c.title,
      relPath: c.relPath,
      chars,
      percentage: total > 0 ? (chars / total) * 100 : 0
    };
  });
});

const totalChars = computed(() => chapterStats.value.reduce((sum, c) => sum + c.chars, 0));

const chapterCount = computed(() => chapterStats.value.length);

const avgCharsPerChapter = computed(() =>
  chapterCount.value > 0 ? Math.round(totalChars.value / chapterCount.value) : 0
);

const longestChapter = computed(() =>
  chapterStats.value.reduce((max, c) => (c.chars > max.chars ? c : max), {
    title: "",
    relPath: "",
    chars: 0,
    percentage: 0
  })
);

const shortestChapter = computed(() =>
  chapterStats.value.reduce((min, c) => (c.chars < min.chars && c.chars > 0 ? c : min), {
    title: "",
    relPath: "",
    chars: Infinity,
    percentage: 0
  })
);

function formatChars(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(2)} 万字`;
  return `${n.toLocaleString("zh-CN")} 字`;
}

function openChapter(relPath: string): void {
  void book.openDocTab(relPath);
  emit("close");
}

// 全书字数目标：目标值存在 useWritingGoalStore（落盘），字数从 book.docs 现算。
// 这里不另开一个组件内 ref —— 那种目标活不过一次重启，进度条会骗人。
const wordGoalTarget = computed(() => goalStore.goal.totalWordTarget);
const wordGoalEnabled = computed(() => wordGoalTarget.value > 0);
const wordGoalPercent = computed(() => {
  if (wordGoalTarget.value <= 0) return 0;
  return Math.min(100, Math.round((totalChars.value / wordGoalTarget.value) * 100));
});

function enableGoal(): void {
  goalStore.updateGoal({ totalWordTarget: 100_000 });
}
</script>

<template>
  <div v-if="visible" class="wc-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="wc-panel"
      role="dialog"
      aria-modal="true"
      aria-label="字数统计"
      tabindex="-1"
    >
      <header class="wc-header">
        <h3>字数统计</h3>
        <button class="icon-btn" type="button" @click="emit('close')">
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <!-- 概览卡片 -->
      <div class="wc-overview">
        <div class="wc-stat-card wc-stat-total">
          <span class="wc-stat-value">{{ formatChars(totalChars) }}</span>
          <span class="wc-stat-label">总正文</span>
        </div>
        <div class="wc-stat-card">
          <span class="wc-stat-value">{{ chapterCount }}</span>
          <span class="wc-stat-label">章节数</span>
        </div>
        <div class="wc-stat-card">
          <span class="wc-stat-value">{{ formatChars(avgCharsPerChapter) }}</span>
          <span class="wc-stat-label">平均章字数</span>
        </div>
      </div>

      <!-- 写作目标 -->
      <div class="wc-goal">
        <template v-if="wordGoalEnabled">
          <div class="wc-goal-head">
            <span>写作目标</span>
            <span class="wc-goal-pct">{{ wordGoalPercent }}%</span>
          </div>
          <div class="wc-goal-bar">
            <div class="wc-goal-fill" :style="{ width: wordGoalPercent + '%' }" />
          </div>
          <div class="wc-goal-numbers">
            <span>{{ formatChars(totalChars) }}</span>
            <span>目标 {{ formatChars(wordGoalTarget) }}</span>
          </div>
        </template>
        <button v-else class="wc-goal-enable" type="button" @click="enableGoal">
          <AppIcon name="pin" :size="13" />
          设定写作目标（默认 10 万字）
        </button>
      </div>

      <!-- 分布条形图 -->
      <div class="wc-distribution">
        <h4>章节分布</h4>
        <div class="wc-bars">
          <div
            v-for="stat in chapterStats"
            :key="stat.relPath"
            class="wc-bar-row"
            @click="openChapter(stat.relPath)"
          >
            <span class="wc-bar-title" :title="stat.title">{{ stat.title }}</span>
            <div class="wc-bar-track">
              <div class="wc-bar-fill" :style="{ width: stat.percentage + '%' }" />
            </div>
            <span class="wc-bar-count">{{ formatChars(stat.chars) }}</span>
          </div>
        </div>
      </div>

      <!-- 极值 -->
      <div v-if="chapterStats.length > 1" class="wc-extremes">
        <div v-if="longestChapter.chars > 0" class="wc-extreme">
          <AppIcon name="arrow-up" :size="12" class="wc-extreme-icon is-up" />
          <span>最长：{{ longestChapter.title }}（{{ formatChars(longestChapter.chars) }}）</span>
        </div>
        <div
          v-if="shortestChapter.chars !== Infinity && shortestChapter.chars > 0"
          class="wc-extreme"
        >
          <AppIcon name="chart" :size="12" class="wc-extreme-icon is-down" />
          <span>最短：{{ shortestChapter.title }}（{{ formatChars(shortestChapter.chars) }}）</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
}

.wc-panel {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  padding: 16px;
  overflow-y: auto;
}

.wc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.wc-header h3 {
  margin: 0;
  font-size: 15px;
  color: var(--text-primary, #e8e8e8);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.wc-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.wc-stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.wc-stat-total {
  background: rgba(108, 158, 255, 0.08);
  border-color: rgba(108, 158, 255, 0.2);
}

.wc-stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #e8e8e8);
}

.wc-stat-label {
  font-size: 11px;
  color: var(--text-muted, #777);
  margin-top: 4px;
}

.wc-goal {
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  border-radius: 8px;
}

.wc-goal-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary, #999);
  margin-bottom: 6px;
}

.wc-goal-pct {
  color: var(--accent, #6c9eff);
  font-weight: 600;
}

.wc-goal-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

.wc-goal-fill {
  height: 100%;
  background: var(--accent, #6c9eff);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.wc-goal-numbers {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-muted, #777);
  margin-top: 4px;
}

.wc-goal-enable {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--border, rgba(255, 255, 255, 0.15));
  border-radius: 6px;
  color: var(--text-secondary, #999);
  cursor: pointer;
  transition: all 0.2s;
}

.wc-goal-enable:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--accent, #6c9eff);
  color: var(--text-primary, #e8e8e8);
}

.wc-distribution {
  margin-bottom: 12px;
}

.wc-distribution h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-secondary, #999);
  font-weight: 500;
}

.wc-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wc-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}

.wc-bar-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.wc-bar-title {
  width: 70px;
  font-size: 11px;
  color: var(--text-secondary, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.wc-bar-track {
  flex: 1;
  height: 14px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  overflow: hidden;
}

.wc-bar-fill {
  height: 100%;
  background: var(--accent, #6c9eff);
  border-radius: 3px;
  opacity: 0.7;
  transition: width 0.3s ease;
}

.wc-bar-count {
  width: 56px;
  text-align: right;
  font-size: 10px;
  color: var(--text-muted, #777);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.wc-extremes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary, #999);
}

.wc-extreme {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wc-extreme-icon.is-up {
  color: #6c9eff;
}

.wc-extreme-icon.is-down {
  color: #f0a040;
}
</style>

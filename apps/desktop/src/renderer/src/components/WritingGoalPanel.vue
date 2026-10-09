<!-- 写作目标面板：右侧浮层，今日进度环 + 连续天数 + 本周热力图 + 设置 + 底部统计 -->
<script setup lang="ts">
import { computed, ref, watch, toRef } from "vue";
import { storeToRefs } from "pinia";
import { useWritingGoalStore } from "../stores/useWritingGoalStore";
import { heatBorder, heatFill, ringStroke } from "../utils/writing-goal-heat";
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

const store = useWritingGoalStore();
const { goal, streak, todayProgress, recentProgress, averageSpeed, todayDurationSeconds } =
  storeToRefs(store);

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const dashOffset = computed(() => CIRCUMFERENCE * (1 - todayProgress.value.percentage / 100));

const settingsOpen = ref(false);
const inputWordTarget = ref(goal.value.dailyWordTarget);
const inputTimeTarget = ref(goal.value.dailyTimeTarget);

watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      inputWordTarget.value = goal.value.dailyWordTarget;
      inputTimeTarget.value = goal.value.dailyTimeTarget;
    }
  }
);

function saveSettings(): void {
  const words = Math.max(0, Math.round(inputWordTarget.value));
  const minutes = Math.max(0, Math.round(inputTimeTarget.value));
  if (words > 0) store.updateGoal({ dailyWordTarget: words });
  if (minutes > 0) store.updateGoal({ dailyTimeTarget: minutes });
  settingsOpen.value = false;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}分钟`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}小时${remainMins}分`;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 热力格与进度圈的颜色判定住 `utils/writing-goal-heat`（逐档有用例钉），这里只挂进 :style。 */

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

const heatDays = computed(() => recentProgress.value);
</script>

<template>
  <div v-if="visible" class="goal-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="goal-panel"
      role="dialog"
      aria-modal="true"
      aria-label="写作目标"
      tabindex="-1"
    >
      <!-- 头部 -->
      <header class="goal-header">
        <h3>写作目标</h3>
        <button class="icon-btn" type="button" title="关闭" @click="emit('close')">
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <div class="goal-body">
        <!-- 落盘失败必须上屏（P0-7）：进度环、连续天数这些数字都在内存里涨，
             而那份数据存不进这本书的目录时，原先屏上一个字都不说。原因住在 store.saveError。 -->
        <p v-if="store.saveError" class="goal-save-error" role="status" aria-live="polite">
          {{ store.saveError }}
        </p>

        <!-- ===== 今日进度区 ===== -->
        <section class="goal-section goal-progress-section">
          <div class="goal-ring-container">
            <svg
              :width="RADIUS * 2 + 20"
              :height="RADIUS * 2 + 20"
              :viewBox="`0 0 ${(RADIUS + 10) * 2} ${(RADIUS + 10) * 2}`"
            >
              <!-- 背景圈 -->
              <circle
                :cx="RADIUS + 10"
                :cy="RADIUS + 10"
                :r="RADIUS"
                fill="none"
                stroke="var(--border, rgba(255,255,255,0.1))"
                stroke-width="5"
              />
              <!-- 进度圈 -->
              <circle
                :cx="RADIUS + 10"
                :cy="RADIUS + 10"
                :r="RADIUS"
                fill="none"
                :stroke="ringStroke(todayProgress.reached)"
                stroke-width="5"
                stroke-linecap="round"
                :stroke-dasharray="CIRCUMFERENCE"
                :stroke-dashoffset="dashOffset"
                :transform="`rotate(-90 ${RADIUS + 10} ${RADIUS + 10})`"
                class="goal-progress-circle"
                :class="{ 'is-reached': todayProgress.reached }"
              />
            </svg>
            <div class="goal-ring-text">
              <span class="goal-ring-words">
                {{ todayProgress.wordsWritten }} / {{ todayProgress.target }}
              </span>
              <span class="goal-ring-unit">字</span>
              <span class="goal-ring-pct">{{ todayProgress.percentage }}%</span>
            </div>
          </div>
          <!-- 每日时长目标（2026-10-09 扫描总单「假控件」第 2 行）：
               这一格以前能存、能回显，却在进度计算里一个字都没用——设了等于没设。
               现在时长由 activity() 逐次结算（同清单第 1 行），这一行把它摆上进度。
               没设目标时不许显示「0 / 0 分钟」那种自欺样式，直接说「未设目标」。 -->
          <p class="goal-time-line">
            <span>时长 {{ formatDuration(todayProgress.secondsWritten) }}</span>
            <span v-if="todayProgress.targetSeconds > 0">/ {{ goal.dailyTimeTarget }} 分钟</span>
            <span v-else class="goal-time-unset">未设目标</span>
          </p>
          <div
            v-if="todayProgress.targetSeconds > 0"
            class="goal-time-bar"
            role="progressbar"
            :aria-valuenow="todayProgress.timePercentage"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="今日写作时长进度"
          >
            <i
              :class="{ 'is-reached': todayProgress.timeReached }"
              :style="{ width: todayProgress.timePercentage + '%' }"
            />
          </div>
          <p v-if="todayProgress.reached" class="goal-reached-msg">今日字数目标已达成</p>
          <p v-else-if="todayProgress.timeReached" class="goal-reached-msg">今日时长目标已达成</p>
        </section>

        <!-- ===== 连续天数区 ===== -->
        <section class="goal-section goal-streak-section">
          <div class="goal-streak-main">
            <AppIcon name="sparkles" :size="22" class="goal-flame-icon" />
            <span class="goal-streak-num">{{ streak.currentStreak }}</span>
            <span class="goal-streak-unit">天连续达标</span>
          </div>
          <p class="goal-streak-record">最长记录：{{ streak.longestStreak }} 天</p>
        </section>

        <!-- ===== 本周热力图 ===== -->
        <section class="goal-section goal-heatmap-section">
          <span class="goal-section-label">本周热力图</span>
          <div class="goal-heatmap">
            <div class="goal-heatmap-grid">
              <div
                v-for="(day, idx) in heatDays"
                :key="day.date"
                class="goal-heat-cell"
                :style="{
                  backgroundColor: heatFill(day.percentage, day.reached),
                  border: heatBorder(day.percentage)
                }"
                :title="`${formatShortDate(day.date)}：${day.wordsWritten} 字 (${day.percentage}%)`"
              >
                <span class="goal-heat-label">{{ weekdayLabels[idx] }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ===== 设置区 ===== -->
        <section class="goal-section goal-settings-section">
          <button class="goal-settings-toggle" type="button" @click="settingsOpen = !settingsOpen">
            <AppIcon name="settings" :size="13" />
            <span>目标设置</span>
            <AppIcon name="chevron" :size="11" :class="{ 'is-open': settingsOpen }" />
          </button>

          <div v-if="settingsOpen" class="goal-settings-form">
            <div class="goal-setting-row">
              <label>每日字数目标</label>
              <input
                v-model.number="inputWordTarget"
                type="number"
                min="0"
                step="100"
                class="goal-setting-input"
              />
            </div>
            <div class="goal-setting-row">
              <label>每日时长目标（分钟）</label>
              <input
                v-model.number="inputTimeTarget"
                type="number"
                min="0"
                step="5"
                class="goal-setting-input"
              />
            </div>
            <div class="goal-setting-actions">
              <button type="button" class="is-primary" @click="saveSettings">保存</button>
              <button type="button" @click="settingsOpen = false">取消</button>
            </div>
          </div>
        </section>
      </div>

      <!-- ===== 底栏统计 ===== -->
      <footer class="goal-footer">
        <span class="goal-footer-stat">
          <AppIcon name="chart" :size="12" />
          平均速度 {{ averageSpeed }} 字/分钟
        </span>
        <span class="goal-footer-stat">
          <AppIcon name="history" :size="12" />
          今日 {{ formatDuration(todayDurationSeconds) }}
        </span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.goal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: flex-end;
  z-index: 1500;
}

.goal-panel {
  width: 360px;
  max-width: 90vw;
  height: 100%;
  background: var(--dropdown-bg, #1e1e2a);
  border-left: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.3);
}

.goal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  flex-shrink: 0;
}

.goal-header h3 {
  font-size: 1rem;
  margin: 0;
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
  color: var(--text-primary, #e8e8e8);
}

.goal-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.goal-section {
  margin-bottom: 16px;
}

/* 目标与今日统计没能落进这本书的目录（P0-7）：进度环照样在涨，盘上却没东西，
   所以这一行必须由通路（store.saveError）来说，而不是让它静默停在内存里。 */
.goal-save-error {
  margin: 0 0 10px;
  padding: 6px 8px;
  border: 1px solid var(--danger, #e0556e);
  border-radius: 6px;
  color: var(--danger, #e0556e);
  font-size: 0.785714rem;
}

/* ---- 今日进度 ---- */
.goal-progress-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0 8px;
}

.goal-ring-container {
  position: relative;
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.goal-ring-container svg {
  position: absolute;
  top: 0;
  left: 0;
}

.goal-progress-circle {
  transition: stroke-dashoffset 0.6s ease;
}

.goal-progress-circle.is-reached {
  animation: goal-sparkle 2s ease-in-out infinite;
}

@keyframes goal-sparkle {
  0%,
  100% {
    stroke: var(--success);
  }
  50% {
    /* 闪烁那一半不从主题里另挑一支绿：把 --success 往表面色里提一档，
       换主题时亮的那一下跟着整片一起换（原先这里抄的是一支写死的亮绿，浅色主题下就是凭空一条)。 */
    stroke: color-mix(in srgb, var(--success) 62%, var(--surface-main));
  }
}

.goal-ring-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  z-index: 1;
}

.goal-ring-words {
  font-size: 0.928571rem;
  font-weight: 600;
  color: var(--text-primary, #e8e8e8);
}

.goal-ring-unit {
  font-size: 0.714286rem;
  color: var(--text-muted, #777);
}

.goal-ring-pct {
  font-size: 0.785714rem;
  color: var(--text-secondary, #999);
  margin-top: 2px;
}

.goal-reached-msg {
  font-size: 0.857143rem;
  color: var(--success);
  margin: 8px 0 0;
  text-align: center;
}

/* ---- 今日时长（每日时长目标终于进进度了，见上面模板那段注释） ----
   字号一律用 rem：`:root` 的 font-size 就是 `--ui-font-size`（styles.css:33），
   写 px 的话用户调字号这一格不动，会被判定成「设置坏了」——2026-10-09 扫描总单那条正在数这个。 */
.goal-time-line {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 0.857143rem;
  color: var(--text-secondary, #999);
}

.goal-time-unset {
  color: var(--text-muted, #777);
}

.goal-time-bar {
  width: 100%;
  max-width: 160px;
  height: 4px;
  margin: 6px auto 0;
  border-radius: 999px;
  background: var(--border, rgba(255, 255, 255, 0.1));
  overflow: hidden;
}

.goal-time-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent, #6c9eff);
  transition: width 0.6s ease;
}

.goal-time-bar i.is-reached {
  background: var(--success);
}

/* ---- 连续天数 ---- */
.goal-streak-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.goal-streak-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.goal-flame-icon {
  color: var(--warning);
}

.goal-streak-num {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary, #e8e8e8);
  line-height: 1;
}

.goal-streak-unit {
  font-size: 0.857143rem;
  color: var(--text-muted, #777);
}

.goal-streak-record {
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
  margin: 4px 0 0;
}

/* ---- 热力图 ---- */
.goal-heatmap-section {
  padding: 12px 0;
  border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.goal-section-label {
  display: block;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.goal-heatmap-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.goal-heat-cell {
  aspect-ratio: 1;
  border-radius: 4px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 2px;
  min-height: 32px;
  transition: transform 0.15s ease;
}

.goal-heat-cell:hover {
  transform: scale(1.1);
}

.goal-heat-label {
  font-size: 0.642857rem;
  color: var(--text-muted, #777);
  opacity: 0.7;
}

/* ---- 设置 ---- */
.goal-settings-section {
  padding: 8px 0;
  border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.goal-settings-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 0;
  background: transparent;
  border: none;
  color: var(--text-secondary, #999);
  font-size: 0.857143rem;
  cursor: pointer;
}

.goal-settings-toggle:hover {
  color: var(--text-primary, #e8e8e8);
}

.is-open {
  transform: rotate(180deg);
}

.goal-settings-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.goal-setting-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.goal-setting-row label {
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
}

.goal-setting-input {
  background: transparent;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  padding: 4px 8px;
  color: var(--text-primary, #e8e8e8);
  font-size: 0.928571rem;
  outline: none;
}

.goal-setting-input:focus {
  border-color: var(--accent, #6c9eff);
}

.goal-setting-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 4px;
}

.goal-setting-actions button {
  padding: 4px 12px;
  font-size: 0.785714rem;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.goal-setting-actions button.is-primary {
  background: var(--accent, #6c9eff);
  color: var(--accent-contrast);
  border-color: var(--accent, #6c9eff);
}

/* ---- 底栏 ---- */
.goal-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  flex-shrink: 0;
}

.goal-footer-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
}
</style>
